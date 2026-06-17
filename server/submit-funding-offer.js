const bitfinext = require("./bitfinex");
const {
  getWallet,
  getCurrentLending,
  getCurrentFundingOffers,
  cancelAllFundingOffers,
  submitFundingOffer,
} = bitfinext;
const {
  readableLend,
  toTime,
  readableOffer,
  sleep,
  asyncForEach,
} = require("./utils");
const Stratege = require("./strategy");
const {
  Strategy: strategyConfig,
  AutoReduce: autoReduceConfig,
} = require("./config");

const autoReduceStateByCurrency = new Map();

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getAutoReduceSettings() {
  const autoReduce = autoReduceConfig || {};
  return {
    enabled: autoReduce.AUTO_REDUCE_RATE === true,
    timeGapMinutes: Math.max(
      1,
      toFiniteNumber(autoReduce.AUTO_REDUCE_TIME_GAP, 60),
    ),
    rateStep: clampNumber(
      toFiniteNumber(autoReduce.AUTO_REDUCE_RATE_STEP, 0.95),
      0.000001,
      1,
    ),
    untilFilled: clampNumber(
      toFiniteNumber(autoReduce.AUTO_REDUCE_UNTIL_FILLED, 0.9),
      0,
      1,
    ),
    // 0.5 means every 2 filled trades approximately undo 1 reduce step
    recoverPerFill: clampNumber(
      toFiniteNumber(autoReduce.AUTO_REDUCE_RECOVER_PER_FILL, 0.5),
      0,
      1,
    ),
  };
}

function getAutoReduceFactor({
  ccy,
  balance,
  availableBalance,
  currentOfferAmount,
}) {
  const settings = getAutoReduceSettings();
  const AUTO_REDUCE_RATE = settings.enabled;

  if (!AUTO_REDUCE_RATE || balance <= 0) {
    autoReduceStateByCurrency.delete(ccy);
    return 1;
  }

  const AUTO_REDUCE_TIME_GAP_MINUTES = settings.timeGapMinutes;
  const AUTO_REDUCE_RATE_STEP = settings.rateStep;
  const AUTO_REDUCE_UNTIL_FILLED = settings.untilFilled;

  const shouldHaveUnfilledRatio = Math.max(0, 1 - AUTO_REDUCE_UNTIL_FILLED);
  const unfilledAmount = Math.max(0, availableBalance + currentOfferAmount);
  const unfilledRatio = unfilledAmount / balance;
  const lentAmount = Math.max(0, balance - unfilledAmount);

  if (unfilledRatio <= shouldHaveUnfilledRatio) {
    autoReduceStateByCurrency.delete(ccy);
    return 1;
  }

  const now = Date.now();
  const gapMs = Math.max(1, AUTO_REDUCE_TIME_GAP_MINUTES) * 60 * 1000;
  const state = autoReduceStateByCurrency.get(ccy) || {
    reduceFactor: 1,
    lastProgressMts: now,
    lastLentAmount: lentAmount,
  };

  if (lentAmount > state.lastLentAmount + 1e-8) {
    state.lastProgressMts = now;
    state.lastLentAmount = lentAmount;
  }

  const elapsed = now - state.lastProgressMts;
  if (elapsed >= gapMs) {
    state.reduceFactor *= AUTO_REDUCE_RATE_STEP;
    state.lastProgressMts = now;
    state.lastLentAmount = lentAmount;
  }

  autoReduceStateByCurrency.set(ccy, state);
  return state.reduceFactor;
}

function onNewLendingFilled({ ccy, fillCount }) {
  const settings = getAutoReduceSettings();
  if (!settings.enabled) {
    return;
  }

  const count = Math.max(0, Math.floor(Number(fillCount) || 0));
  if (count <= 0) {
    return;
  }

  const state = autoReduceStateByCurrency.get(ccy);
  if (!state) {
    return;
  }

  const recoverPower = count * settings.recoverPerFill;
  const recoverMultiplier = Math.pow(1 / settings.rateStep, recoverPower);
  state.reduceFactor = clampNumber(
    state.reduceFactor * recoverMultiplier,
    0,
    1,
  );
  state.lastProgressMts = Date.now();

  autoReduceStateByCurrency.set(ccy, state);
}

function getAutoReduceStatus(ccy) {
  const autoReduce = autoReduceConfig || {};
  const enabled = autoReduce.AUTO_REDUCE_RATE === true;
  if (!enabled) {
    return { enabled: false };
  }

  const state = autoReduceStateByCurrency.get(ccy);
  const reduceFactor = state ? Number(state.reduceFactor || 1) : 1;

  return {
    enabled: true,
    reduceFactor,
  };
}

function setManualAutoReducePercent({ ccy, percent }) {
  const settings = getAutoReduceSettings();
  if (!settings.enabled) {
    return { ok: false, reason: "disabled" };
  }

  const p = Number(percent);
  if (!Number.isFinite(p) || p > 0 || p < -100) {
    return { ok: false, reason: "invalid_percent" };
  }

  const reduceFactor = clampNumber(1 + p / 100, 0, 1);
  const now = Date.now();
  const state = autoReduceStateByCurrency.get(ccy) || {
    reduceFactor: 1,
    lastProgressMts: now,
    lastLentAmount: 0,
  };

  state.reduceFactor = reduceFactor;
  state.lastProgressMts = now; // reset next reduce countdown
  autoReduceStateByCurrency.set(ccy, state);

  return {
    ok: true,
    reduceFactor,
    percent: (reduceFactor - 1) * 100,
  };
}

async function getFundingOffers(
  ccy,
  avaliableBalance,
  currentOfferAmount,
  currentOfferRateMin,
  options = {},
) {
  return Stratege.splitByRate(
    ccy,
    avaliableBalance,
    currentOfferAmount,
    currentOfferRateMin,
    options,
  ); // You can change the strategy here
}

function toOfferKey(offer) {
  return [
    Number(offer.amount || 0).toFixed(0),
    Number(offer.rate || 0).toFixed(7),
    Number(offer.period || 0),
  ].join("|");
}

function isSameOrNullOfferSet(currentOffers, targetOffers) {
  if (targetOffers.length === 0) {
    return true;
  }

  if (currentOffers.length !== targetOffers.length) {
    return false;
  }

  const counts = new Map();
  currentOffers.forEach((offer) => {
    const key = toOfferKey(offer);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  for (const offer of targetOffers) {
    const key = toOfferKey(offer);
    const count = counts.get(key) || 0;
    if (count === 0) {
      return false;
    }
    counts.set(key, count - 1);
  }

  return true;
}

function printStatus(balance, lending, offers) {
  console.log("=========================================================");
  const time = toTime();
  console.log(`Time: ${time}`);
  console.log(`Balance: $${balance}`);
  console.log("Status:");
  const items = lending.map((l) => ({
    ...readableLend(l),
    executed: true,
  }));

  offers.forEach((o) => {
    items.push({
      ...readableOffer(o),
      exp: null,
      executed: false,
    });
  });
  if (lending.length) {
    console.table(items);
  }
}

async function main({ showDetail = false, ccy = "USD" } = {}) {
  try {
    const wallet = await getWallet(ccy);
    const balance = wallet.balance;
    const avaliableBalance = wallet.availableBalance;
    const lending = await getCurrentLending(ccy);
    const currentOffers = await getCurrentFundingOffers(ccy);
    const currentOfferAmount = currentOffers.reduce(
      (sum, offer) => sum + Math.abs(Number(offer.amount || 0)),
      0,
    );
    const currentOfferRateMin = currentOffers.reduce(
      (min, offer) =>
        Math.min(min, Number(offer.rate || Number.POSITIVE_INFINITY)),
      Number.POSITIVE_INFINITY,
    );
    const reduceRateFactor = getAutoReduceFactor({
      ccy,
      balance,
      availableBalance: avaliableBalance,
      currentOfferAmount,
    });

    const offers = await getFundingOffers(
      ccy,
      avaliableBalance,
      currentOfferAmount,
      currentOfferRateMin,
      { reduceRateFactor },
    );
    const hasNoCurrentAndNoTarget =
      currentOffers.length === 0 && offers.length === 0;
    const shouldReplaceOffers = !isSameOrNullOfferSet(currentOffers, offers);

    if (hasNoCurrentAndNoTarget) {
    } else if (shouldReplaceOffers) {
      // submit funding offer only when target offers differ from current offers
      await cancelAllFundingOffers(ccy);
      await sleep(500);
      await asyncForEach(offers, async (offer) => {
        try {
          await submitFundingOffer(offer);
          await sleep(500);
        } catch (error) {
          if (error.response !== undefined) {
            console.log(
              `${toTime()}: Failed to submit funding offers for ${ccy}`,
              error.response,
            );
          } else {
            throw error;
          }
        }
      });
    }

    if (showDetail) {
      printStatus(balance, lending, offers);
    }
  } catch (error) {
    console.error(
      `${toTime()}: Failed to submit funding offers for ${ccy}`,
      error,
    );
  }
}

module.exports = main;
module.exports.getAutoReduceStatus = getAutoReduceStatus;
module.exports.onNewLendingFilled = onNewLendingFilled;
module.exports.setManualAutoReducePercent = setManualAutoReducePercent;

if (require.main === module) {
  let ccy = "USD";
  if (process.argv.length > 2 && process.argv[2] === "ust") {
    ccy = "UST";
  }
  main({ showDetail: true, ccy });
}
