const fs = require("fs");
const path = require("path");
const config = require("./config");

const nonceStatePath = path.join(__dirname, ".bitfinex-nonce");

function loadLastNonce() {
  try {
    const raw = fs.readFileSync(nonceStatePath, "utf8").trim();
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch (_error) {
    return 0;
  }
}

function persistLastNonce(value) {
  try {
    fs.writeFileSync(nonceStatePath, String(value), "utf8");
  } catch (_error) {
    // Ignore persistence errors; in-memory monotonicity still protects the process.
  }
}

function buildPersistentNonceGenerator() {
  let lastNonce = loadLastNonce();

  return () => {
    const current = Date.now() * 1000;
    lastNonce = Math.max(lastNonce + 1, current);
    persistLastNonce(lastNonce);
    return lastNonce;
  };
}

function installNonceGenerator() {
  const nonceGenerator = buildPersistentNonceGenerator();
  const candidatePaths = [];

  try {
    candidatePaths.push(require.resolve("bfx-api-node-util/lib/nonce"));
  } catch (_error) {}

  try {
    const rest2Path = require.resolve("bfx-api-node-rest/lib/rest2");
    const rest2Dir = path.dirname(rest2Path);
    candidatePaths.push(
      require.resolve("bfx-api-node-util/lib/nonce", { paths: [rest2Dir] }),
    );
  } catch (_error) {}

  for (const noncePath of new Set(candidatePaths)) {
    try {
      const nonceModule = require(noncePath);
      if (typeof nonceModule === "function") {
        require.cache[noncePath].exports = nonceGenerator;
      }
    } catch (_error) {
      // If a candidate path cannot be loaded, keep trying the others.
    }
  }
}

installNonceGenerator();

const { RESTv2 } = require("bfx-api-node-rest");
const { FundingOffer } = require("bfx-api-node-models");

const client = new RESTv2({
  apiKey: config.API_KEY,
  apiSecret: config.API_SECRET,
  transform: true,
  affCode: "o94zsAobf",
});

const DEFAULT_CCY = "USD";

// Serialize all API calls so nonces are always issued in order.
let _apiQueue = Promise.resolve();
function enqueue(fn) {
  const result = _apiQueue.then(() => fn());
  _apiQueue = result.catch(() => {});
  return result;
}

async function getWallet(ccy = DEFAULT_CCY) {
  const wallets = await enqueue(() => client.wallets());
  const wallet = wallets.find(
    (w) => w.type === "funding" && w.currency === ccy,
  );
  const walletInfo = {
    balance: wallet ? wallet.balance : 0,
    availableBalance: wallet ? wallet.balanceAvailable : 0,
  };
  return walletInfo;
}

async function getCurrentLending(ccy = DEFAULT_CCY) {
  // get current active lending
  return (
    await enqueue(() => client.fundingCredits({ symbol: `f${ccy}` }))
  ).map((c) => ({
    id: c.id,
    amount: c.amount,
    rate: c.rate,
    period: c.period,
    time: c.mtsOpening,
  }));
}

async function getCurrentFundingOffers(ccy = DEFAULT_CCY) {
  // get current active funding offers (not executed yet)
  return (await enqueue(() => client.fundingOffers({ symbol: `f${ccy}` }))).map(
    (offer) => ({
      id: offer.id,
      amount: offer.amount,
      rate: offer.rate,
      period: offer.period,
      time:
        offer.mtsCreate || offer.mtsCreated || offer.mtsUpdate || Date.now(),
    }),
  );
}

async function getFundingTrades(ccy = DEFAULT_CCY, sinceMtsCreate = null) {
  const records = await enqueue(() =>
    client.fundingTrades({ symbol: `f${ccy}`, limit: 50 }),
  );

  return records
    .map((trade) => {
      const mtsCreate =
        trade.mtsCreate || trade.mts_create || trade.mtsCreated || 0;
      return {
        id: trade.id,
        amount: trade.amount,
        rate: trade.rate,
        period: trade.period,
        mtsCreate,
      };
    })
    .filter((trade) =>
      sinceMtsCreate == null ? true : trade.mtsCreate > sinceMtsCreate,
    )
    .sort((a, b) => a.mtsCreate - b.mtsCreate);
}

async function cancelAllFundingOffers(ccy = DEFAULT_CCY) {
  return await enqueue(() => client.cancelAllFundingOffers({ currency: ccy }));
}

async function submitFundingOffer({
  rate,
  amount,
  period = 2,
  ccy = DEFAULT_CCY,
}) {
  return await enqueue(() =>
    client.submitFundingOffer({
      offer: new FundingOffer({
        type: "LIMIT",
        symbol: `f${ccy}`,
        rate,
        amount,
        period,
      }),
    }),
  );
}

async function getFundingBook(ccy = DEFAULT_CCY) {
  const book = await enqueue(() =>
    client.orderBook({ symbol: `f${ccy}`, prec: "P0" }),
  );
  return {
    request: book.filter((item) => item[3] < 0),
    offer: book.filter((item) => item[3] > 0),
  };
}

async function getFundingEarning(ccy = null) {
  const ONE_DAY_IN_MS = 86400000;
  const now = Date.now();
  const filters = { category: 28 };
  if (ccy) {
    filters.ccy = ccy;
  }
  const res = await enqueue(() =>
    client.ledgers({
      filters,
      start: now - ONE_DAY_IN_MS * 30,
      end: now,
      limit: 500,
    }),
  );

  const earnings = res
    .map((r) => ({
      id: r.id,
      currency: r.currency,
      amount: r.amount,
      balance: r.balance,
      mts: r.mts,
    }))
    .reverse();
  return earnings;
}

async function fetchFRR(ccy = DEFAULT_CCY) {
  const t = await enqueue(() => client.ticker({ symbol: `f${ccy}` }));
  return t.frr || 0.00000001; // fallback to a very low rate if FRR is not available
}

module.exports = {
  client,
  getWallet,
  getCurrentLending,
  getCurrentFundingOffers,
  getFundingTrades,
  getFundingCreditHistory: getFundingTrades,
  cancelAllFundingOffers,
  submitFundingOffer,
  getFundingBook,
  getFundingEarning,
  fetchFRR,
};
