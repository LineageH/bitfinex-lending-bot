module.exports = {
  SubmitTime: 5, // The time gap to submit the funding offer (in minutes)
  Strategy: {
    splitEqually: {
      MIN_TO_LEND: 50,
      NUM_ALL_IN: 1100,
      SPLIT_UNIT: 1000,
      RATE_EXPECTED_OVER_AMOUNT: 50000,
    }, // The default strategy is splitEqually, you need to edit the code in server/submit-funding-offer.js to change the strategy
    splitPyramidally: {
      // The interest APY fomula is (1 + rate) ^ 365 - 1
      MIN_TO_LEND: 50, // The minimum amount to lend
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
      RATE_EXPECTED_OVER_AMOUNT: 10000, // Ignore amount when reading the order book
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
