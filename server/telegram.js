const { Table } = require("voici.js");
const Telegram = require("node-telegram-bot-api");
const moment = require("moment-timezone");
const checkAndSubmitOffer = require("./submit-funding-offer");
const syncEarning = require("./sync-funding-earning");
const { compoundInterest, getLowRate, getFRR } = require("./utils");
const bitfinext = require("./bitfinex");
const config = require("./config");
const db = require("./db");
const { getTelegramI18n } = require("./i18n/telegram");

const client = new Telegram(config.TELEGRAM_BOT_TOKEN, { polling: true });
const { t, dateLocale: DATE_LOCALE } = getTelegramI18n(
  config.TELEGRAM_LANGUAGE,
);

const toSymbol = (ccy) => (ccy === "USD" ? "USD" : "USDT");

function formatReduceRate(ccy) {
  if (typeof checkAndSubmitOffer.getAutoReduceStatus !== "function") {
    return null;
  }

  const status = checkAndSubmitOffer.getAutoReduceStatus(ccy);
  if (!status || !status.enabled) {
    return null;
  }

  const factor = Number(status.reduceFactor || 1);
  const pct = (factor * 100 - 100).toFixed(2);
  return t("autoReduceRateLine", { rate: pct });
}

const login = async () => {
  client.setMyCommands([
    {
      command: "/summary",
      description: t("cmdSummary"),
    },
    {
      command: "/earnings",
      description: t("cmdEarnings"),
    },
    {
      command: "/provided",
      description: t("cmdProvided"),
    },
    {
      command: "/syncearnings",
      description: t("cmdSyncEarnings"),
    },
    {
      command: "/setreducerate",
      description: t("cmdSetReduceRate"),
    },
    { command: "/submitoffers", description: t("cmdSubmitOffers") },
    { command: "/listoffer", description: t("cmdListOffer") },
  ]);

  client.onText(/\/summary/, async (msg) => {
    try {
      if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
        const data = await getData();
        for (const d of data) {
          const symbol = toSymbol(d.ccy);
          let summary = `👾 <b>${t("summaryTitle", { symbol })}</b>\n`;
          summary += `${t("balance")} : ${d.balance.toFixed(2)}\n`;
          summary += `${t("available")} : ${d.availableBalance.toFixed(2)}\n`;
          summary += `${t("marketLow")}  : ${d.rate}%\n`;
          summary += `${t("frr")} : ${d.frrRate}%\n`;
          const reduceRateLine = formatReduceRate(d.ccy);
          if (reduceRateLine) {
            summary += `${reduceRateLine}\n`;
          }

          summary += `\n📊 <b>${t("lendingStatus")}</b>\n`;
          summary += `${t("provided")}  : ${d.providedAmount} (${((d.providedAmount / (d.balance || 1)) * 100).toFixed(2)}%)\n`;
          summary += `${t("offered")} : ${d.offersBalance.toFixed(2)}\n`;
          summary += `${t("providedRate")}  : ${d.providedRate || 0}%\n`;
          summary += `${t("effective")} : ${(((d.providedRate || 0) * d.providedAmount) / (d.balance || 1)).toFixed(2)}%\n`;
          summary += `${t("earning30d")} : ${d.totalEarnings} (${t("last30Days")})\n`;
          summary += `${t("lifetime")} : ${d.lifeTimeEarnings} (${t("fromDate", { date: d.fistDate })})\n`;

          await sendMessage(summary, { parse_mode: "HTML" });
        }
      }
    } catch (error) {
      console.error("Error in /summary command:", error);
      await sendMessage(t("summaryError"));
    }
  });

  client.onText(/\/earnings/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      const data = await getData();
      for (const d of data) {
        const symbol = toSymbol(d.ccy);
        let earnings = `💰 <b>${t("earningsTitle", { symbol })}</b>\n\n`;
        for (const e of d.earnings) {
          const date = new Date(e.mts).toLocaleDateString(DATE_LOCALE, {
            month: "short",
            day: "2-digit",
          });
          earnings += `${date}: ${e.amount.toFixed(2)}\n`;
        }
        earnings += "\n";
        await sendMessage(earnings, { parse_mode: "HTML" });
      }
    }
  });

  client.onText(/\/provided/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      const data = await getData();
      for (const d of data) {
        const symbol = toSymbol(d.ccy);
        let provided = `🧾 <b>${t("providedTitle", { symbol })}</b>\n\n`;
        provided += `<pre>${d.tableString}</pre>\n\n`;
        provided += `${t("total")} : ${d.providedAmount}\n`;
        provided += `${t("avgRate")}  : ${d.providedRate}%\n`;
        provided += `${t("remaining")} : ${(d.availableBalance + d.offersBalance).toFixed(2)}\n`;
        provided += `${t("frr")} : ${d.frrRate}%\n`;
        await sendMessage(provided, { parse_mode: "HTML" });
      }
    }
  });

  client.onText(/\/syncearnings/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      syncEarning();
      await sendMessage(t("syncEarningsDone"));
    }
  });

  client.onText(
    /\/setreducerate(?:\s+([^\s]+))?(?:\s+([a-zA-Z]+))?/,
    async (msg, match) => {
      if (msg.chat.id != config.TELEGRAM_CHAT_ID) {
        return;
      }

      const rawPercent = (match && match[1] ? String(match[1]) : "").trim();
      const rawCurrency = (match && match[2] ? String(match[2]) : "").trim();

      if (!rawPercent) {
        await sendMessage(t("setReduceUsage"));
        return;
      }

      const normalizedPercent = rawPercent.endsWith("%")
        ? rawPercent.slice(0, -1)
        : rawPercent;
      const percent = Number(normalizedPercent);
      if (!Number.isFinite(percent) || percent > 0 || percent < -100) {
        await sendMessage(t("setReduceInvalidPercent"));
        return;
      }

      const enabledCurrencies = [];
      if (config.LEND.USD) enabledCurrencies.push("USD");
      if (config.LEND.USDT) enabledCurrencies.push("UST");

      let targetCurrencies = enabledCurrencies;
      if (rawCurrency) {
        const input = rawCurrency.toUpperCase();
        if (input === "USD") {
          targetCurrencies = ["USD"];
        } else if (input === "USDT" || input === "UST") {
          targetCurrencies = ["UST"];
        } else {
          await sendMessage(t("setReduceInvalidCurrency"));
          return;
        }
      }

      if (targetCurrencies.length === 0) {
        await sendMessage(t("lendingDisabled"));
        return;
      }

      if (
        typeof checkAndSubmitOffer.setManualAutoReducePercent !== "function"
      ) {
        await sendMessage(t("setReduceAutoDisabled"));
        return;
      }

      const lines = [];
      for (const ccy of targetCurrencies) {
        const result = checkAndSubmitOffer.setManualAutoReducePercent({
          ccy,
          percent,
        });

        if (!result || result.ok !== true) {
          await sendMessage(t("setReduceAutoDisabled"));
          return;
        }

        lines.push(
          t("setReduceUpdatedLine", {
            symbol: toSymbol(ccy),
            rate: result.percent.toFixed(2),
          }),
        );
      }

      const message = `${t("setReduceUpdated")}\n${lines.join("\n")}`;
      await sendMessage(message);
    },
  );

  client.onText(/\/submitoffers/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      await sendMessage(t("submittingOffers"));
      if (config.LEND.USD) await checkAndSubmitOffer();
      if (config.LEND.USDT) await checkAndSubmitOffer({ ccy: "UST" });
      listOpenOffers(msg);
    }
  });

  client.onText(/\/listoffer/, async (msg) => {
    await listOpenOffers(msg);
  });

  async function listOpenOffers(msg) {
    try {
      if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
        const currencies = [];
        if (config.LEND.USD) currencies.push("USD");
        if (config.LEND.USDT) currencies.push("UST");

        if (currencies.length === 0) {
          await sendMessage(t("lendingDisabled") + "\n");
          return;
        }

        for (const ccy of currencies) {
          const offers = await bitfinext.getCurrentFundingOffers(ccy);
          const symbol = toSymbol(ccy);

          if (offers.length === 0) {
            let content = `🎯 <b>${t("offersTitle", { symbol })}</b>\n`;
            content += t("noOpenOffers") + "\n";
            await sendMessage(content, { parse_mode: "HTML" });
            continue;
          }

          const total = offers.reduce(
            (acc, offer) => acc + Number(offer.amount || 0),
            0,
          );

          let content = `🎯 <b>${t("offersTitle", { symbol })}</b>\n`;
          content += `${t("count")} : ${offers.length}\n`;
          content += `${t("total")} : ${total.toFixed(2)}\n`;

          const reduceRateLine = formatReduceRate(ccy);
          if (reduceRateLine) {
            content += `${reduceRateLine}\n\n`;
          }

          offers.slice(0, 20).forEach((offer, index) => {
            const rate = (compoundInterest(offer.rate || 0) * 100).toFixed(2);
            const createdAt = moment(offer.time).format("MM-DD HH:mm");
            content += `${index + 1}. ${Number(offer.amount || 0).toFixed(2)} @ ${rate}% for ${offer.period}d\n`;
          });

          if (offers.length > 20) {
            content += `${t("andMore", { count: offers.length - 20 })}\n`;
          }

          await sendMessage(content, { parse_mode: "HTML" });
        }
      }
    } catch (error) {
      console.error("Error in /listoffer command:", error);
      await sendMessage(t("listOfferError"));
    }
  }
};

const sendMessage = async (msg, options = {}) => {
  return await client.sendMessage(config.TELEGRAM_CHAT_ID, msg, options);
};

const notifyNewLending = async ({ ccy, loans }) => {
  if (!loans || loans.length === 0) {
    return;
  }

  const symbol = toSymbol(ccy);
  const total = loans.reduce((acc, loan) => acc + Number(loan.amount || 0), 0);

  let message = `🔥 <b>${t("newTransactionsTitle", { symbol, count: loans.length })}</b>\n`;

  loans.slice(0, 10).forEach((loan, index) => {
    const rate = (compoundInterest(loan.rate || 0) * 100).toFixed(2);
    message += `${index + 1}. ${Number(loan.amount || 0).toFixed(2)} @ ${rate}% for ${loan.period}d\n`;
  });

  if (loans.length > 10) {
    message += `${t("andMore", { count: loans.length - 10 })}\n`;
  }

  await sendMessage(message, { parse_mode: "HTML" });
};

module.exports = {
  login,
  notifyNewLending,
};

async function getData() {
  const getDataByCurrency = async (ccy) => {
    const wallet = await bitfinext.getWallet(ccy); // get balance and available balance of the funding wallet
    const balance = wallet.balance;
    const availableBalance = wallet.availableBalance;
    const lending = (await bitfinext.getCurrentLending(ccy)).map((l) => ({
      amount: l.amount,
      period: l.period,
      rate: (compoundInterest(l.rate) * 100).toFixed(2),
      exp: l.time + l.period * 86400000,
      fromNow: moment(l.time + l.period * 86400000).fromNow(),
    })); // get current provided lending

    const acc = {};
    lending.forEach((l) => {
      const key = l.period + l.fromNow;
      if (acc[key] == undefined) {
        acc[key] = l;
        acc[key].count = 1;
      } else {
        acc[key].amount = Math.random(acc[key].amount + l.amount);
        acc[key].rate = (
          (Number(acc[key].rate) * acc[key].amount +
            Number(l.rate) * l.amount) /
          (acc[key].amount + l.amount)
        ).toFixed(2);
        acc[key].count++;
      }
    }); // group by period and time
    const reducedLending = Object.values(acc);
    reducedLending.sort((a, b) => {
      return a.exp - b.exp || a.period - b.period;
    });

    const tableConfig = {
      padding: {
        size: 1,
      },
      header: {
        include: ["amount", "period", "rate", "count", "fromNow"],
        displayNames: {
          amount: t("tableAmount"),
          period: t("tablePeriod"),
          rate: t("tableRate"),
          count: t("tableCount"),
          fromNow: t("tableExpires"),
        },
      },
    };

    const table = new Table(reducedLending, tableConfig);
    const tableString = table.toPlainString();

    let total = 0;
    let interest = 0;
    for (const l of reducedLending) {
      total += l.amount;
      interest += l.amount * l.rate;
    }
    const providedRate =
      total > 0 && Number.isFinite(interest / total)
        ? (interest / total).toFixed(2)
        : "0"; // interest rate of provided lending
    const providedAmount = total.toFixed(2); // total amount of provided lending
    const offersBalance = balance - availableBalance - providedAmount; // total amount of open offers
    const offersAmount = offersBalance.toFixed(2);
    const rate = (compoundInterest(await getLowRate(ccy)) * 100).toFixed(2); // interest rate of the lowest public offer

    const frrRate = (compoundInterest(await getFRR(ccy)) * 100).toFixed(2); // interest rate of the FRR

    // take only recently 30 days
    const day30diff = 30 * 24 * 3600 * 1000;
    const day30ago = Date.now() - day30diff;
    const earnings30 = await db.earnings
      .find({
        mts: { $gt: day30ago },
        currency: ccy,
      })
      .sort({ _id: -1 });

    let totalEarnings = 0;
    earnings30.forEach((e) => {
      totalEarnings += e.amount;
    });

    totalEarnings = totalEarnings.toFixed(2); // total earnings of the last 30 days

    const day7diff = 7 * 24 * 3600 * 1000;
    const day7ago = Date.now() - day7diff;
    const earnings = await db.earnings
      .find({
        mts: { $gt: day7ago },
        currency: ccy,
      })
      .sort({ _id: -1 });

    const lifeEarnings = await db.earnings
      .find({ currency: ccy })
      .sort({ _id: -1 });
    let lifeTimeEarnings = 0;
    let fistDate = "";
    lifeEarnings.forEach((e) => {
      if (e.currency === ccy) {
        lifeTimeEarnings += e.amount;
        fistDate = new Date(e.mts).toLocaleDateString(DATE_LOCALE, {
          month: "short",
          day: "2-digit",
          year: "2-digit",
        });
      }
    });

    return {
      ccy,
      balance,
      availableBalance,
      providedAmount,
      offersBalance,
      earnings,
      totalEarnings,
      providedRate,
      rate,
      frrRate,
      tableString,
      lifeTimeEarnings: lifeTimeEarnings.toFixed(2),
      fistDate,
    };
  };

  if (!config.LEND.USD && !config.LEND.USDT) {
    return [];
  }

  const data = [];

  if (config.LEND.USD) {
    const usdData = await getDataByCurrency("USD");
    data.push(usdData);
  }

  if (config.LEND.USDT) {
    const ustData = await getDataByCurrency("UST");
    data.push(ustData);
  }

  return data;
}
