const { Table } = require("voici.js");
const Telegram = require("node-telegram-bot-api");
const NodeCache = require("node-cache");
const moment = require("moment-timezone");
const checkAndSubmitOffer = require("./submit-funding-offer");
const syncEarning = require("./sync-funding-earning");
const { compoundInterest, getLowRate, getFRR } = require("./utils");
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
    { command: "/listoffer", description: "List open funding offers" },
  ]);

  client.onText(/\/summary/, async (msg) => {
    try {
      if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
        const data = await getData();
        for (const d of data) {
          let summary = "Summary:\n\n";
          const symbol = d.ccy === "USD" ? "USD" : "USDT";
          summary += `${symbol}\n`;
          summary += `Balance   : ${d.balance.toFixed(2)}\n`;
          summary += `Available : ${d.availableBalance.toFixed(2)}\n`;
          summary += `Provided  : ${d.providedAmount} (${((d.providedAmount / (d.balance || 1)) * 100).toFixed(2)}%)\n`;
          summary += `Offered   : ${d.remindingAmount}\n`;
          summary += `Provided  : ${d.providedRate || 0}%\n`;
          summary += `Effective : ${(((d.providedRate || 0) * d.providedAmount) / (d.balance || 1)).toFixed(2)}%\n`;
          summary += `Mkt. Low  : ${d.rate}%\n`;
          summary += `FRR       : ${d.frrRate}%\n`;
          summary += `Earning   : ${d.totalEarnings} (Last 30 Days)\n`;
          summary += `Life Time : ${d.lifeTimeEarnings} (From ${d.fistDate})\n`;
          await sendMessage("```" + summary + "```");
        }
      }
    } catch (error) {
      console.error("Error in /summary command:", error);
      await sendMessage("An error occurred while fetching the summary.");
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
        provided += `FRR       : ${d.frrRate}%\n`;
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

  client.onText(/\/listoffer/, async (msg) => {
    try {
      if (msg.chat.id == config.TELEGRAM_CHAT_ID) {
        const currencies = [];
        if (config.LEND.USD) currencies.push("USD");
        if (config.LEND.USDT) currencies.push("UST");

        if (currencies.length === 0) {
          await sendMessage("```Lending is disabled in config\n```");
          return;
        }

        for (const ccy of currencies) {
          const offers = await bitfinext.getCurrentFundingOffers(ccy);
          const symbol = ccy === "USD" ? "USD" : "USDT";

          if (offers.length === 0) {
            await sendMessage(
              "```No open funding offers (" + symbol + ")\n```",
            );
            continue;
          }

          const total = offers.reduce(
            (acc, offer) => acc + Number(offer.amount || 0),
            0,
          );

          let content = `\nOffers (${symbol})\n`;
          content += `Count : ${offers.length}\n`;
          content += `Total : ${total.toFixed(2)}\n\n`;

          offers.slice(0, 20).forEach((offer, index) => {
            const rate = (compoundInterest(offer.rate || 0) * 100).toFixed(2);
            const createdAt = moment(offer.time).format("MM-DD HH:mm");
            content += `${index + 1}. ${Number(offer.amount || 0).toFixed(2)} @ ${rate}% for ${offer.period}d\n`;
          });

          if (offers.length > 20) {
            content += `...and ${offers.length - 20} more\n`;
          }

          await sendMessage("```" + content + "```");
        }
      }
    } catch (error) {
      console.error("Error in /listoffer command:", error);
      await sendMessage(
        "An error occurred while fetching open funding offers.",
      );
    }
  });
};

const sendMessage = async (msg) => {
  return await client.sendMessage(config.TELEGRAM_CHAT_ID, msg, {
    parse_mode: "MarkdownV2",
  });
};

const notifyNewLending = async ({ ccy, loans }) => {
  if (!loans || loans.length === 0) {
    return;
  }

  const symbol = ccy === "USD" ? "USD" : "USDT";
  const total = loans.reduce((acc, loan) => acc + Number(loan.amount || 0), 0);

  let message = `\nNew ${symbol} Transactions (${loans.length})\n`;

  loans.slice(0, 10).forEach((loan, index) => {
    const rate = (compoundInterest(loan.rate || 0) * 100).toFixed(2);
    message += `${index + 1}. ${Number(loan.amount || 0).toFixed(2)} @ ${rate}% for ${loan.period}d\n`;
  });

  if (loans.length > 10) {
    message += `...and ${loans.length - 10} more\n`;
  }

  await sendMessage("```" + message + "```");
};

module.exports = {
  login,
  notifyNewLending,
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
    const providedRate =
      total > 0 && Number.isFinite(interest / total)
        ? (interest / total).toFixed(2)
        : "0"; // interest rate of provided lending
    const providedAmount = total.toFixed(2); // total amount of provided lending
    const remindingAmount = (balance - total).toFixed(2); // remaining amount of the funding wallet
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
        fistDate = new Date(e.mts).toLocaleDateString("en-US", {
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
      remindingAmount,
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
