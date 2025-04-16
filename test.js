const bitfinext = require("./server/bitfinex");
const { getFundingEarning } = bitfinext;
const { compoundInterest, getLowRate } = require("./server/utils");

const db = require("./server/db");
const NodeCache = require("node-cache");
const cache = new NodeCache();

async function main() {
  const getDataByCurrency = async (ccy) => {
    const balance = await bitfinext.getBalance(ccy);
    console.log(JSON.stringify(balance, null, 2));
    const availableBalance = await bitfinext.getAvailableBalance(ccy);
    console.log(JSON.stringify(availableBalance, null, 2));
    const lending = (await bitfinext.getCurrentLending(ccy)).map((l) => ({
      amount: l.amount,
      period: l.period,
      rate: compoundInterest(l.rate).toFixed(4),
      exp: l.time + l.period * 86400000,
    }));
    //console.log(JSON.stringify(lending, null, 2));

    let total = 0;
    let interest = 0;
    for (const l of lending) {
      total += l.amount;
      interest += l.amount * l.rate;
    }
    const lendingRate = ((interest / total) * 100).toFixed(2);
    const lentingAmount = total.toFixed(2);
    const remindingAmount = (balance - total).toFixed(2);

    const rate = compoundInterest(await getLowRate(ccy)).toFixed(2);

    console.log(JSON.stringify(rate, null, 2));

    // take only recently 30 days
    const day30diff = 30 * 24 * 3600 * 1000;
    const day30ago = Date.now() - day30diff;
    const earnings = await db.earnings
      .find({
        mts: { $gt: day30ago },
        currency: ccy,
      })
      .sort({ _id: -1 });

    console.log(JSON.stringify(earnings, null, 2));

    return {
      ccy,
      balance,
      availableBalance,
      lentingAmount,
      remindingAmount,
      earnings,
      lendingRate,
      rate,
    };
  };

  let data;

  const usdData = await getDataByCurrency("USD");
  const ustData = await getDataByCurrency("UST");
  data = [usdData, ustData];

  //console.log(JSON.stringify(data, null, 2));
}

main();
