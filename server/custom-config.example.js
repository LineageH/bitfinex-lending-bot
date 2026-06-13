module.exports = {
  SubmitTime: 3, // The time gap to submit the funding offer (in minutes)
  LendingNotifyInterval: 15, // The time gap to check new lending and send Telegram notifications (in minutes), set 0 to disable
  TELEGRAM_LANGUAGE: "en", // Telegram message language: en or zh-TW
  BITFINEX_REQUEST_INTERVAL_MS: 500, // Minimum gap between Bitfinex API requests
  Strategy: {
    // The default strategy is splitByRate, you need to edit the code in server/submit-funding-offer.js to change the strategy
    splitByRate: {
      MIN_TO_LEND: 150, // The minimum amount to lend (Bitfinex API minimum offer size is 150 USD)
      MIN_APY: 0.09, // 0.7 = 7%, if the minimum APY is not met, the bot will not lend
      FRR_FACTOR: 0.95, // Offers rate = FRR * FRR_FACTOR * TIER_RATE_MULTIPLIERS
      TIER_RATE_MULTIPLIERS: [1.0, 1.04, 1.09, 1.14, 1.19, 1.25, 1.35, 1.45], // The multiplier for each tier to determine the offer rate
      TIER_WEIGHTS: [1.0, 1.5, 2.0, 2.5, 2.5, 2.0, 1.5, 1.0], // The weight for each tier
    },
  },
  AutoReduce: {
    AUTO_REDUCE_RATE: false, // Whether to automatically reduce the offer rate when no offer filled after some time
    AUTO_REDUCE_TIME_GAP: 60, // The time gap to reduce the offer rate (in minutes)
    AUTO_REDUCE_RATE_STEP: 0.95, // The reduction step of the offer rate, 0.95 means reducing 5% each time
    AUTO_REDUCE_UNTIL_FILLED: 0.9, // Stop reducing after this wallet ratio is lent out, 0.9 means 90% lent
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
