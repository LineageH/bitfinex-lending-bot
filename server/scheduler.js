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
const latestCreditIdsAtMtsByCurrency = new Map();
let isCheckingNewLending = false;

const enabledCurrencies = () => {
  const list = [];
  if (LEND.USD) list.push("USD");
  if (LEND.USDT) list.push("UST");
  return list;
};

async function checkNewLendingAndNotify() {
  if (isCheckingNewLending) {
    return;
  }

  isCheckingNewLending = true;
  const currencies = enabledCurrencies();
  if (currencies.length === 0) {
    isCheckingNewLending = false;
    return;
  }

  try {
    for (const ccy of currencies) {
      const lastMtsCreate = latestCreditMtsByCurrency.get(ccy);
      const lastIdsAtMts = latestCreditIdsAtMtsByCurrency.get(ccy) || new Set();
      const credits = await bitfinex.getFundingTrades(ccy, lastMtsCreate);

      const newCredits = credits.filter((credit) => {
        if (lastMtsCreate == null) {
          return true;
        }

        if (credit.mtsCreate > lastMtsCreate) {
          return true;
        }

        if (credit.mtsCreate < lastMtsCreate) {
          return false;
        }

        return !lastIdsAtMts.has(String(credit.id));
      });

      if (credits.length > 0) {
        const latestMtsCreate = credits[credits.length - 1].mtsCreate;
        const latestIdsAtMts = new Set(
          credits
            .filter((credit) => credit.mtsCreate === latestMtsCreate)
            .map((credit) => String(credit.id)),
        );

        latestCreditMtsByCurrency.set(ccy, latestMtsCreate);
        latestCreditIdsAtMtsByCurrency.set(ccy, latestIdsAtMts);
      }

      if (lastMtsCreate == null) {
        if (credits.length === 0) {
          latestCreditMtsByCurrency.set(ccy, Date.now());
          latestCreditIdsAtMtsByCurrency.set(ccy, new Set());
        }
        continue;
      }

      if (newCredits.length > 0) {
        if (typeof checkAndSubmitOffer.onNewLendingFilled === "function") {
          checkAndSubmitOffer.onNewLendingFilled({
            ccy,
            fillCount: newCredits.length,
          });
        }

        const newLoans = newCredits.map((credit) => ({
          id: credit.id,
          amount: credit.amount,
          rate: credit.rate,
          period: credit.period,
          time: credit.mtsCreate,
        }));
        await telegram.notifyNewLending({ ccy, loans: newLoans });
      }
    }
  } catch (error) {
    console.error(`${toTime()}: Failed to check new lending`, error);
  } finally {
    isCheckingNewLending = false;
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
    schedule.scheduleJob(
      `*/${LENDING_NOTIFY_INTERVAL_MINUTES} * * * *`,
      async () => {
        await checkNewLendingAndNotify();
      },
    );

    checkNewLendingAndNotify();
  } else {
    console.log(`${toTime()}: New lending Telegram notification is disabled`);
  }
};
