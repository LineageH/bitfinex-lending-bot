const { TelegramClient } = require("telegramsjs");
const NodeCache = require("node-cache");
const checkAndSubmitOffer = require("./submit-funding-offer");
const syncEarning = require("./sync-funding-earning");
const { compoundInterest, getLowRate } = require("./utils");
const bitfinext = require("./bitfinex");
const config = require("./config");
const db = require("./db");

const client = new TelegramClient(config.TELEGRAM_BOT_TOKEN);
const cache = new NodeCache();

client.on("ready", async ({ user }) => {
  await user?.setCommands([
    {
      command: "/summary",
      description: "Show lending summary",
    },
    {
      command: "/earnings",
      description: "Earnings details - 7 days",
    },
    {
      command: "/syncearnings",
      description: "Sync funding earnings",
    },
    { command: "/submitoffers", description: "Submit funding offers" },
  ]);

  console.log(`Logged in as @${user?.username}`);
});

client.on("message", async (message) => {
  if (message.chat.id === config.TELEGRAM_CHAT_ID && message.author) {
    const command = message.content.split(/[ @]/)[0].toLowerCase();
    let data;
    switch (command) {
      case "/summary":
        data = await getData();
        let summary = "Summary:\n\n";
        for (const d of data) {
          const symbol = d.ccy === "USD" ? "USD" : "USDT";
          summary += `${symbol}\n`;
          summary += `Balance   : ${d.balance.toFixed(2)}\n`;
          summary += `Available : ${d.availableBalance.toFixed(2)}\n`;
          summary += `Provided  : ${d.providedAmount}\n`;
          summary += `Reminding : ${d.remindingAmount}\n`;
          summary += `Earning   : ${d.totalEarnings} (Last 30 Days)\n`;
          summary += `Provided  : ${d.providedRate}%\n`;
          summary += `Market    : ${d.rate}%\n\n`;
        }

        await client.sendMessage({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: "```" + summary + "```",
          parse_mode: "MarkdownV2",
        });
        break;
      case "/earnings":
        data = await getData();
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

        await client.sendMessage({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: "```" + earnings + "```",
          parse_mode: "MarkdownV2",
        });
        break;
      case "/syncearnings":
        await message.reply("Syncing funding earnings...");
        syncEarning();
        await client.sendMessage({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: "Funding earnings updated successfully.",
        });
        break;
      case "/submitoffers":
        await message.reply("Submitting funding offers...");
        if (config.LEND.USD) await checkAndSubmitOffer();
        if (config.LEND.USDT) await checkAndSubmitOffer({ ccy: "UST" });
        await client.sendMessage({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: "Funding offers submitted successfully.",
        });
        break;
    }
  }
});

module.exports = {
  client,
};

async function getData() {
  const getDataByCurrency = async (ccy) => {
    const balance = await bitfinext.getBalance(ccy); // get balance of the funding wallet
    const availableBalance = await bitfinext.getAvailableBalance(ccy); // get available balance of the funding wallet
    const lending = (await bitfinext.getCurrentLending(ccy)).map((l) => ({
      amount: l.amount,
      period: l.period,
      rate: compoundInterest(l.rate).toFixed(4),
      exp: l.time + l.period * 86400000,
    })); // get current provided lending

    let total = 0;
    let interest = 0;
    for (const l of lending) {
      total += l.amount;
      interest += l.amount * l.rate;
    }
    const providedRate = ((interest / total) * 100).toFixed(2); // interest rate of provided lending
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
