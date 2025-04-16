const dotenv = require("dotenv");
const customConfig = require("./custom-config");
dotenv.config();

module.exports = {
  ...customConfig,
  API_KEY: process.env.API_KEY,
  API_SECRET: process.env.API_SECRET,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  LEND: {
    USD: process.env.LEND_USD === "true",
    USDT: process.env.LEND_USDT === "true",
  },
};
