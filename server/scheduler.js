const schedule = require("node-schedule");
const moment = require("moment-timezone");
const checkAndSubmitOffer = require("./submit-funding-offer");
const syncEarning = require("./sync-funding-earning");
const { toTime } = require("./utils");
const { LEND, SubmitTime: SUBMIT_TIME } = require("./config");

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
};
