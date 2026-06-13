const schedule = require("node-schedule");
const moment = require("moment-timezone");
const bitfinex = require("./bitfinex");
const checkAndSubmitOffer = require("./submit-funding-offer");
const syncEarning = require("./sync-funding-earning");
const telegram = require("./telegram");
const { toTime } = require("./utils");
const {
  LEND,
  SubmitTime: SUBMIT_TIME,
  LendingNotifyInterval,
} = require("./config");

const parsedNotifyInterval = Number(LendingNotifyInterval);
const LENDING_NOTIFY_INTERVAL_MINUTES = Number.isNaN(parsedNotifyInterval)
  ? 5
  : parsedNotifyInterval;
const latestCreditMtsByCurrency = new Map();

const enabledCurrencies = () => {
  const list = [];
  if (LEND.USD) list.push("USD");
  if (LEND.USDT) list.push("UST");
  return list;
};

async function checkNewLendingAndNotify() {
  const currencies = enabledCurrencies();
  if (currencies.length === 0) {
    return;
  }

  try {
    for (const ccy of currencies) {
      const lastMtsCreate = latestCreditMtsByCurrency.get(ccy);
      const credits = await bitfinex.getFundingTrades(ccy, lastMtsCreate);

      if (lastMtsCreate == null) {
        if (credits.length > 0) {
          latestCreditMtsByCurrency.set(
            ccy,
            credits[credits.length - 1].mtsCreate,
          );
        } else {
          latestCreditMtsByCurrency.set(ccy, Date.now());
        }
        continue;
      }

      if (credits.length > 0) {
        const newLoans = credits.map((credit) => ({
          id: credit.id,
          amount: credit.amount,
          rate: credit.rate,
          period: credit.period,
          time: credit.mtsCreate,
        }));
        await telegram.notifyNewLending({ ccy, loans: newLoans });

        latestCreditMtsByCurrency.set(
          ccy,
          credits[credits.length - 1].mtsCreate,
        );
      }
    }
  } catch (error) {
    console.error(`${toTime()}: Failed to check new lending`, error);
  }
}

module.exports = () => {
  console.log("start scheduler");

  schedule.scheduleJob(`*/${SUBMIT_TIME} * * * *`, async function () {
    if (LEND.USD) await checkAndSubmitOffer();
    if (LEND.USDT) await checkAndSubmitOffer({ ccy: "UST" });
  });

  const hour = moment
    .utc("2025-05-16 01:30")
    .tz(Intl.DateTimeFormat().resolvedOptions().timeZone)
    .hour();

  [`35 ${hour} * * *`, `40 ${hour} * * *`].forEach((rule) => {
    schedule.scheduleJob(rule, function () {
      console.log(`${toTime()}: Sync Earning`);
      syncEarning();
    });
  });

  if (LENDING_NOTIFY_INTERVAL_MINUTES > 0) {
    schedule.scheduleJob(`*/${LENDING_NOTIFY_INTERVAL_MINUTES} * * * *`, () => {
      checkNewLendingAndNotify();
    });

    checkNewLendingAndNotify();
  } else {
    console.log(`${toTime()}: New lending Telegram notification is disabled`);
  }
};
