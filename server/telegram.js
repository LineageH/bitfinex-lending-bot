const { Table } = require("voici.js");
const Telegram = require("node-telegram-bot-api");
const NodeCache = require("node-cache");
const moment = require("moment-timezone");
const checkAndSubmitOffer = require("./submit-funding-offer");
const syncEarning = require("./sync-funding-earning");
const { compoundInterest, getLowRate } = require("./utils");
const bitfinext = require("./bitfinex");
const config = require("./config");
const db = require("./db");

const cache = new NodeCache();

const client = new Telegram(config.TELEGRAM_BOT_TOKEN, { polling: true });

const login = async () => {
  client.setMyCommands([
    {
      command: "/summary",
      description: "Show lending summary",
    },
    {
      command: "/earnings",
      description: "Earnings details - 7 days",
    },
    {
      command: "/provided",
      description: "Provided leading details",
    },
    {
      command: "/syncearnings",
      description: "Sync funding earnings",
    },
    { command: "/submitoffers", description: "Submit funding offers" },
  ]);

  client.onText(/\/summary/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      const data = await getData();
      let summary = "Summary:\n\n";
      for (const d of data) {
        const symbol = d.ccy === "USD" ? "USD" : "USDT";
        summary += `${symbol}\n`;
        summary += `Balance   : ${d.balance.toFixed(2)}\n`;
        summary += `Available : ${d.availableBalance.toFixed(2)}\n`;
        summary += `Provided  : ${d.providedAmount}\n`;
        summary += `Remaining : ${d.remindingAmount}\n`;
        summary += `Earning   : ${d.totalEarnings} (Last 30 Days)\n`;
        summary += `Provided  : ${d.providedRate}%\n`;
        summary += `Market    : ${d.rate}%\n\n`;
      }
      await sendMessage("```" + summary + "```");
    }
  });

  client.onText(/\/earnings/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      const data = await getData();
      let earnings = "Earnings:\n\n";
      for (const d of data) {
        const symbol = d.ccy === "USD" ? "USD" : "USDT";
        earnings += `${symbol}\n`;
        for (const e of d.earnings) {
          const date = new Date(e.mts).toLocaleDateString("en-US", {
            month: "short",
            day: "2-digit",
          });
          earnings += `${date}: ${e.amount.toFixed(2)}\n`;
        }
        earnings += "\n";
      }
      await sendMessage("```" + earnings + "```");
    }
  });

  client.onText(/\/provided/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      const data = await getData();
      for (const d of data) {
        const symbol = d.ccy === "USD" ? "USD" : "USDT";
        let provided = `Provided ${symbol}:\n\n`;
        provided += `${d.tableString}\n\n`;
        provided += `Total     : ${d.providedAmount}\n`;
        provided += `Avg Rate  : ${d.providedRate}%\n`;
        provided += `Remaining : ${d.remindingAmount}\n`;
        await sendMessage("```" + provided + "```");
      }
    }
  });

  client.onText(/\/syncearnings/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      syncEarning();
      await sendMessage("Funding earnings updated successfully");
    }
  });

  client.onText(/\/submitoffers/, async (msg) => {
    if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
      await sendMessage("Submitting funding offers");
      if (config.LEND.USD) await checkAndSubmitOffer();
      if (config.LEND.USDT) await checkAndSubmitOffer({ ccy: "UST" });
      await sendMessage("Funding offers submitted successfully");
    }
  });
};

const sendMessage = async (msg) => {
  return await client.sendMessage(config.TELEGRAM_CHAT_ID, msg, {
    parse_mode: "MarkdownV2",
  });
};

module.exports = {
  login,
};

async function getData() {
  const getDataByCurrency = async (ccy) => {
    const balance = await bitfinext.getBalance(ccy); // get balance of the funding wallet
    const availableBalance = await bitfinext.getAvailableBalance(ccy); // get available balance of the funding wallet
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
        acc[key].amount += l.amount;
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
          amount: "Amount",
          period: "Period",
          rate: "Rate",
          count: "Count",
          fromNow: "Expires",
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
    const providedRate = (interest / total).toFixed(2); // interest rate of provided lending
    const providedAmount = total.toFixed(2); // total amount of provided lending
    const remindingAmount = (balance - total).toFixed(2); // remaining amount of the funding wallet
    const rate = (compoundInterest(await getLowRate(ccy)) * 100).toFixed(2); // interest rate of the lowest public offer

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

    return {
      ccy,
      balance,
      availableBalance,
      providedAmount,
      remindingAmount,
      earnings,
      totalEarnings,
      providedRate,
      rate,
      tableString,
    };
  };

  if (!config.LEND.USD && !config.LEND.USDT) {
    return [];
  }

  let data = cache.get("data");
  if (data) {
    return data;
  }

  data = [];

  if (config.LEND.USD) {
    const usdData = await getDataByCurrency("USD");
    data.push(usdData);
  }

  if (config.LEND.USDT) {
    const ustData = await getDataByCurrency("UST");
    data.push(ustData);
  }

  cache.set("data", data, 10);

  return data;
}
