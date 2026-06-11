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
const lendingSnapshot = new Map();
let lendingSnapshotInitialized = false;

const getLendingKey = (loan) => {
  if (loan.id !== undefined && loan.id !== null) {
    return String(loan.id);
  }
  return [loan.time, loan.period, loan.rate, loan.amount].join("_");
};

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
      const loans = await bitfinex.getCurrentLending(ccy);
      const currentKeys = new Set(loans.map(getLendingKey));
      const previousKeys = lendingSnapshot.get(ccy) || new Set();

      if (lendingSnapshotInitialized) {
        const newLoans = loans.filter(
          (loan) => !previousKeys.has(getLendingKey(loan)),
        );
        if (newLoans.length > 0) {
          await telegram.notifyNewLending({ ccy, loans: newLoans });
        }
      }

      lendingSnapshot.set(ccy, currentKeys);
    }

    if (!lendingSnapshotInitialized) {
      lendingSnapshotInitialized = true;
    }
  } catch (error) {
    console.error(`${toTime()}: Failed to check new lending`, error);
  }
}

module.exports = () => {
  console.log("start scheduler");

  schedule.scheduleJob(`*/${SUBMIT_TIME} * * * *`, async function () {
    console.log(`${toTime()}: Check and submit funding offers automatically`);
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
