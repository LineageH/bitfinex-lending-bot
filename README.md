# Bitfinex Lending Bot

The project is written in node.js.

If you don't have Bitfinex account yet, you may [register here](https://www.bitfinex.com/sign-up?refcode=00xhxk-55).

Forked From [@huaying/bitfinex-lending-bot](https://github.com/huaying/bitfinex-lending-bot) and make the following changes:

- Upgrade to Node.js 22+
- Added a Telegram Bot
- New Strategy
- Auto Reduct Offer Rate by Time
- Remove the React Web
- Remove the Express.js API

## Prerequisite

- Node.js version 22+
- npm / pnpm / yarn

## Installation & Configuration

1. Create an API Key in Bitfinex, please note that need to have the following permissions:

> <b>Margin Funding</b>
> Get funding statuses and info. - On

> Offer, cancel and close funding. - On

> <b>Wallets</b>
> Get wallet balances and addresses. - On

If you don't have a static public IP:

> <b>IP Access restrictions</b>
> Allow access from any IP - On

2. Rename the `.env.example` to `.env` and update the variable in the file

```

API_KEY=xxx # Bitfinex API KEY

API_SECRET=xxx # Bitfinex API SECRET

TELEGRAM_BOT_TOKEN=xxx # Telegram Bot Token, Create from [@BotFather](https://t.me/botfather)

TELEGRAM_CHAT_ID=xxx # Your Telegram UserID, Can check from [@userinfobot](https://t.me/userinfobot)

LEND_USD=false # Lending USD [true/false]

LEND_USDT=true # Lending USDT [true/false]

```

3. Copy `server/custom-config.example.js` to `server/custom-config.js`, you may edit the variable of the lending strategy.

Optional: you can also set `TELEGRAM_LANGUAGE` in `server/custom-config.js` (for example `"zh-TW"`).

## Choose one of the following method to run the bot:

1. Run by PM2 on Linux / MacOS

```bash
npm install pnpm -g
pnpm install
pnpm install pm2 -g
pm2 startup
pm2 start pnpm --name "bitfinex" -- run start
pm2 save
```

2. Run by PM2 on Windows

```bash
npm install pnpm -g
pnpm install
pnpm install pm2 -g
pnpm install pm2-windows-startup -g
pm2-startup install
pm2 start pnpm --name "bitfinex" -- run start
pm2 save
```

3. Run with Docker

```bash
docker build -t bitfinex-lending-bot .
docker run --name bitfinex-lending-bot bitfinex-lending-bot
```

4. Run with process

```bash
npm install pnpm -g
pnpm install
pnpm run start
```

## Telegram Bot Commands

Telegram messages now support English and Traditional Chinese. Set `TELEGRAM_LANGUAGE` to `en` or `zh-TW`.

All commands below are available after the bot is started, and only the configured `TELEGRAM_CHAT_ID` can use them.

```
/summary
Show lending summary (balance, available, provided, offered, effective rate, FRR, earnings)

/earnings
Show earnings details of the last 7 days

/provided
Show provided lending details grouped by period and expiry

/syncearnings
Sync funding earnings from Bitfinex immediately

/setreducerate <0~-100%> [USD|USDT]
Set auto-reduce rate manually. Examples:
/setreducerate -5%
/setreducerate -8 USD
/setreducerate -10% USDT

/submitoffers
Submit funding offers immediately for enabled currencies

/listoffer
List current open funding offers
```
