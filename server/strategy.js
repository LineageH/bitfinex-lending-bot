const {
  getPeriod,
  getRate,
  step,
  compoundInterest,
  getFRR,
} = require("./utils");
const { Strategy: config } = require("./config");

const splitByRate = async (
  ccy,
  availableBalance,
  currentOfferAmount,
  currentOfferRateMin,
) => {
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

  if (TIER_RATE_MULTIPLIERS.length < TIER_WEIGHTS.length) {
    console.warn(
      `The length of TIER_RATE_MULTIPLIERS is less than TIER_WEIGHTS, the first multiplier will be used for the remaining tiers`,
    );
  }

  if (currentOfferRateMin == baseRate && availableBalance < MIN_TO_LEND) {
    return [];
  } else if (availableBalance < MIN_TO_LEND) {
    return [];
  }

  let amount;
  let rate;

  const totalBalance = availableBalance + currentOfferAmount;
  let reminingBalance = totalBalance;
  const WEIGHT_SUM = TIER_WEIGHTS.reduce((a, b) => a + b, 0);

  while (reminingBalance >= MIN_TO_LEND) {
    amount = Math.min(
      reminingBalance,
      Math.max(MIN_TO_LEND, totalBalance * (TIER_WEIGHTS[i] / WEIGHT_SUM)),
    );
    amount = Math.floor(amount);
    reminingBalance -= amount;
    if (reminingBalance < MIN_TO_LEND && Math.floor(reminingBalance) > 0) {
      amount += reminingBalance;
      amount = Math.floor(amount);
      reminingBalance = 0;
    }
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
  splitByRate,
};
