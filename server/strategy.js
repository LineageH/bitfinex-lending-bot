const {
  getPeriod,
  getRate,
  step,
  compoundInterest,
  getFRR,
} = require("./utils");
const { Strategy: config } = require("./config");

const splitEqually = async (avaliableBalance, ccy) => {
  const CONFIG = config.splitEqually;
  const MIN_TO_LEND = CONFIG.MIN_TO_LEND;
  const NUM_ALL_IN = CONFIG.NUM_ALL_IN;
  const SPLIT_UNIT = CONFIG.SPLIT_UNIT;
  const rate = await getRate(ccy, CONFIG.RATE_EXPECTED_OVER_AMOUNT);

  const amounts = [];
  while (avaliableBalance > NUM_ALL_IN) {
    amounts.push(SPLIT_UNIT);
    avaliableBalance -= SPLIT_UNIT;
  }

  if (avaliableBalance <= NUM_ALL_IN && avaliableBalance >= MIN_TO_LEND) {
    amounts.push(avaliableBalance);
  }

  const period = getPeriod(rate);
  return amounts.map((amount) => ({
    rate,
    amount,
    period,
    ccy,
  }));
};

function getDerivedRate(l, h, x) {
  x = Math.max(l, Math.min(h, x));
  return 1 + (1 - (x - l) / (h - l)) * 0.1;
}

const splitPyramidally = async (avaliableBalance, ccy) => {
  const CONFIG = config.splitPyramidally;
  const MIN_TO_LEND = CONFIG.MIN_TO_LEND;
  const UP_BOUND_RATE = CONFIG.UP_BOUND_RATE;
  const LOW_BOUND_RATE = CONFIG.LOW_BOUND_RATE;
  const offers = [];
  const baseRate = await getRate(ccy, CONFIG.RATE_EXPECTED_OVER_AMOUNT);
  let amountInit = step(CONFIG.AMOUNT_INIT_MAP, baseRate);
  let amount;
  let rate;
  let i = 0;

  while (avaliableBalance > MIN_TO_LEND) {
    amount = Math.min(
      avaliableBalance,
      amountInit * Math.pow(CONFIG.AMOUNT_GROW_EXP, i),
    );
    amount = Math.floor(amount);
    rate =
      baseRate *
      Math.pow(getDerivedRate(LOW_BOUND_RATE, UP_BOUND_RATE, baseRate), i);

    offers.push({
      amount,
      rate,
      period: getPeriod(rate),
      ccy,
    });
    avaliableBalance -= amount;
    i++;
  }

  return offers;
};

const splitByRate = async (availableBalance, ccy) => {
  const CONFIG = config.splitByRate || {};
  const MIN_TO_LEND = Math.max(CONFIG.MIN_TO_LEND || 150, 150);
  const MIN_APY = CONFIG.MIN_APY || 0.1;
  const FRR_FACTOR = CONFIG.FRR_FACTOR || 0.95;
  const TIER_RATE_MULTIPLIERS = CONFIG.TIER_RATE_MULTIPLIERS || [
    1.0, 1.04, 1.09, 1.14, 1.19, 1.25, 1.35, 1.45,
  ];
  const TIER_WEIGHTS = CONFIG.TIER_WEIGHTS || [
    1.0, 1.5, 2.0, 2.5, 2.5, 2.0, 1.5, 1.0,
  ];

  const offers = [];
  let i = 0;

  const frr = await getFRR(ccy);
  let baseRate = frr * FRR_FACTOR;
  const baseApr = compoundInterest(baseRate);
  if (baseApr < MIN_APY) baseRate = Math.pow(1 + MIN_APY, 1 / 365) - 1;

  let amount;
  let rate;

  const totalBalance = availableBalance;
  const WEIGHT_SUM = TIER_WEIGHTS.reduce((a, b) => a + b, 0);

  while (availableBalance > MIN_TO_LEND) {
    amount = Math.min(
      availableBalance,
      Math.max(MIN_TO_LEND, totalBalance * (TIER_WEIGHTS[i] / WEIGHT_SUM)),
    );
    availableBalance -= amount;
    if (availableBalance < MIN_TO_LEND && availableBalance > 0) {
      amount += availableBalance;
    }
    amount = Math.floor(amount);
    if (amount < MIN_TO_LEND) break;
    rate = baseRate * (TIER_RATE_MULTIPLIERS[i] || TIER_RATE_MULTIPLIERS[0]);
    if (rate < baseRate) rate = baseRate;

    offers.push({
      amount,
      rate,
      period: getPeriod(rate),
      ccy,
    });
    i++;
  }

  return offers;
};

module.exports = {
  splitEqually,
  splitPyramidally,
  splitByRate,
};
