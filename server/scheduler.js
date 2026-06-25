const moment = require("moment-timezone");
const bitfinex = require("./bitfinex");
const checkAndSubmitOffer = require("./submit-funding-offer");
const syncEarning = require("./sync-funding-earning");
const telegram = require("./telegram");
const { toTime } = require("./utils");
const config = require("./config");

const latestCreditMtsByCurrency = new Map();
const latestCreditIdsAtMtsByCurrency = new Map();
let isCheckingNewLending = false;
let isSubmittingOffers = false;
let schedulerStarted = false;
let submitIntervalId = null;
let notifyIntervalId = null;
let syncIntervalId = null;
let lastSyncRunKey = null;
let isSyncEarning = false;

const enabledCurrencies = () => {
  const list = [];
  if (config.LEND?.USD) list.push("USD");
  if (config.LEND?.USDT) list.push("UST");
  return list;
};

function parsePositiveMinutes(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getSubmitIntervalMinutes() {
  return parsePositiveMinutes(config.SubmitTime, 5);
}

function getNotifyIntervalMinutes() {
  const parsed = Number(config.LendingNotifyInterval);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return parsed;
}

async function submitOffersForEnabledCurrencies() {
  if (isSubmittingOffers) {
    return;
  }

  const currencies = enabledCurrencies();
  if (currencies.length === 0) {
    return;
  }

  isSubmittingOffers = true;
  try {
    if (config.LEND?.USD) await checkAndSubmitOffer();
    if (config.LEND?.USDT) await checkAndSubmitOffer({ ccy: "UST" });
  } catch (error) {
    console.error(`${toTime()}: Failed to submit funding offers`, error);
  } finally {
    isSubmittingOffers = false;
  }
}

function clearSchedulerTimer(timerId) {
  if (timerId) {
    clearInterval(timerId);
  }
  return null;
}

function restartSubmitInterval() {
  submitIntervalId = clearSchedulerTimer(submitIntervalId);

  const submitMinutes = getSubmitIntervalMinutes();
  const submitMs = Math.max(1000, Math.floor(submitMinutes * 60 * 1000));
  submitIntervalId = setInterval(() => {
    submitOffersForEnabledCurrencies();
  }, submitMs);

  console.log(
    `${toTime()}: Submit scheduler updated to every ${submitMinutes} minute(s)`,
  );
}

function restartNotifyInterval() {
  notifyIntervalId = clearSchedulerTimer(notifyIntervalId);

  const notifyMinutes = getNotifyIntervalMinutes();
  if (notifyMinutes <= 0) {
    console.log(`${toTime()}: New lending Telegram notification is disabled`);
    return;
  }

  const notifyMs = Math.max(1000, Math.floor(notifyMinutes * 60 * 1000));
  notifyIntervalId = setInterval(() => {
    checkNewLendingAndNotify();
  }, notifyMs);

  console.log(
    `${toTime()}: Lending notify scheduler updated to every ${notifyMinutes} minute(s)`,
  );
}

function restartSyncInterval() {
  syncIntervalId = clearSchedulerTimer(syncIntervalId);

  syncIntervalId = setInterval(() => {
    runScheduledSyncEarning();
  }, 30000);
}

async function runScheduledSyncEarning() {
  const now = moment().tz(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const hour = moment
    .utc("2025-05-16 01:30")
    .tz(Intl.DateTimeFormat().resolvedOptions().timeZone)
    .hour();
  const minute = now.minute();

  if (now.hour() !== hour || (minute !== 35 && minute !== 40)) {
    return;
  }

  const runKey = `${now.format("YYYY-MM-DD")}-${hour}-${minute}`;
  if (lastSyncRunKey === runKey || isSyncEarning) {
    return;
  }

  lastSyncRunKey = runKey;
  isSyncEarning = true;

  try {
    console.log(`${toTime()}: Sync Earning`);
    await syncEarning();
  } catch (error) {
    console.error(`${toTime()}: Failed to sync earning`, error);
  } finally {
    isSyncEarning = false;
  }
}

function rebuildDynamicSchedulers() {
  restartSubmitInterval();
  restartNotifyInterval();
}

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
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  console.log("start scheduler");

  rebuildDynamicSchedulers();
  restartSyncInterval();
  submitOffersForEnabledCurrencies();

  if (getNotifyIntervalMinutes() > 0) {
    checkNewLendingAndNotify();
  }

  if (typeof config.onCustomConfigReload === "function") {
    config.onCustomConfigReload(({ changes }) => {
      const changeSections = Array.isArray(changes)
        ? changes.map((change) => change.section)
        : [];
      const shouldRestartDynamicSchedulers = Array.isArray(changes)
        ? changeSections.some(
            (section) =>
              section === "SubmitTime" || section === "LendingNotifyInterval",
          )
        : true;

      if (shouldRestartDynamicSchedulers) {
        rebuildDynamicSchedulers();

        if (
          changeSections.includes("LendingNotifyInterval") &&
          getNotifyIntervalMinutes() > 0
        ) {
          checkNewLendingAndNotify();
        }
      }
    });
  }
};
