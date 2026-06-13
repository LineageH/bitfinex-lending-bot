const bitfinext = require("./bitfinex");
const {
  getBalance,
  getAvailableBalance,
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

async function getFundingOffers(
  ccy,
  avaliableBalance,
  currentOfferAmount,
  currentOfferRateMin,
) {
  return Stratege.splitByRate(
    ccy,
    avaliableBalance,
    currentOfferAmount,
    currentOfferRateMin,
  ); // You can change the strategy here
}

function toOfferKey(offer) {
  return [
    Number(offer.amount || 0).toFixed(8),
    Number(offer.rate || 0).toFixed(12),
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
    const balance = await getBalance(ccy);
    const lending = await getCurrentLending(ccy);
    const currentOffers = await getCurrentFundingOffers(ccy);
    const avaliableBalance = await getAvailableBalance(ccy);
    const currentOfferAmount = currentOffers.reduce(
      (sum, offer) => sum + Math.abs(Number(offer.amount || 0)),
      0,
    );
    const currentOfferRateMin = currentOffers.reduce(
      (min, offer) =>
        Math.min(min, Number(offer.rate || Number.POSITIVE_INFINITY)),
      Number.POSITIVE_INFINITY,
    );
    const offers = await getFundingOffers(
      ccy,
      avaliableBalance,
      currentOfferAmount,
      currentOfferRateMin,
    );
    const hasNoCurrentAndNoTarget =
      currentOffers.length === 0 && offers.length === 0;
    const shouldReplaceOffers = !isSameOrNullOfferSet(currentOffers, offers);

    if (hasNoCurrentAndNoTarget) {
      console.log(
        `${toTime()}: No active offers and strategy generated no offers, skip submit`,
      );
    } else if (shouldReplaceOffers) {
      // submit funding offer only when target offers differ from current offers
      await cancelAllFundingOffers(ccy);
      await sleep(2000);
      try {
        await asyncForEach(offers, async (offer) => {
          await submitFundingOffer(offer);
          await sleep(500);
        });
      } catch (error) {
        if (error.response !== undefined) {
          console.log(
            `${toTime()}: Failed to submit funding offers for ${ccy}`,
            error.response,
          );
        } else {
          console.error(
            `${toTime()}: Failed to submit funding offers for ${ccy}`,
            error,
          );
        }
      }
    } else {
      console.log(`${toTime()}: Offers unchanged, skip submit for ${ccy}`);
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

if (require.main === module) {
  let ccy = "USD";
  if (process.argv.length > 2 && process.argv[2] === "ust") {
    ccy = "UST";
  }
  main({ showDetail: true, ccy });
}
