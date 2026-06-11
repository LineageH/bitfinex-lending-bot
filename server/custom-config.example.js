module.exports = {
  SubmitTime: 30, // The time gap to submit the funding offer (in minutes)
  LendingNotifyInterval: 5, // The time gap to check new lending and send Telegram notifications (in minutes), set 0 to disable
  Strategy: {
    // The default strategy is splitByRate, you need to edit the code in server/submit-funding-offer.js to change the strategy
    splitByRate: {
      MIN_TO_LEND: 150, // The minimum amount to lend (Bitfinex API minimum offer size is 150 USD)
      MIN_APY: 0.09, // 0.7 = 7%, if the minimum APY is not met, the bot will not lend
      FRR_FACTOR: 0.95, // The bot will use FRR * FRR_FACTOR as the base rate for offers, so it sits just under FRR by default
      TIER_RATE_MULTIPLIERS: [1.0, 1.04, 1.09, 1.14, 1.19, 1.25, 1.35, 1.45], // The multiplier for each tier to determine the offer rate
      TIER_WEIGHTS: [1.0, 1.5, 2.0, 2.5, 2.5, 2.0, 1.5, 1.0], // The weight for each tier
    },
    splitEqually: {
      MIN_TO_LEND: 150,
      NUM_ALL_IN: 1100,
      SPLIT_UNIT: 1000,
      RATE_EXPECTED_OVER_AMOUNT: 50000,
    },
    splitPyramidally: {
      // The interest APY fomula is (1 + rate) ^ 365 - 1
      MIN_TO_LEND: 150, // The minimum amount to lend
      UP_BOUND_RATE: 0.001, // The maximum interest (per day), 0.001 = 43.8% APY
      LOW_BOUND_RATE: 0.0001, // The minimum interest (per day), 0.0001 = 3.7% APY
      AMOUNT_GROW_EXP: 1.4, // The growth rate of the amount
      AMOUNT_INIT_MAP: [
        [0.0007, 1200],
        [0.0006, 900],
        [0.0005, 700],
        [0.0004, 550],
        [0.0003, 400],
        [0.0002, 300],
      ], // Initial interest rate [interest (per day), amount]
      RATE_EXPECTED_OVER_AMOUNT: 50000, // Ignore amount when reading the order book
    },
  },
  Period: {
    PERIOD_MAP: [
      [0.3, 30],
      [0.25, 20],
      [0.2, 10],
      [0.15, 5],
      [0.12, 3],
    ],
  }, // The lending period of the funding offer [APY, Days]
};
