# Bitfinex Lending Bot

The project is written in node.js.

Forked From [@huaying/bitfinex-lending-bot](https://github.com/huaying/bitfinex-lending-bot) and make the following changes:

- Upgrade to Node.js 22
- Added a Telegram Bot
- Remove the React Web
- Remove the Express.js API

## Prerequisite

- Node.js version 22+
- npm / pnpm / yarn
- pnpm install -g pm2 (Optional)

## Installation

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

API_KEY=xxx //Bitfinex API KEY

API_SECRET=xxx //Bitfinex API SECRET

TELEGRAM_BOT_TOKEN=xxx //Telegram Bot Token

TELEGRAM_CHAT_ID=xxx //Your Telegram UserID

LEND_USD=0 //Lending USD [true/false]

LEND_USDT=1 //Lending USDT [true/false]

```

3. Copy `server/custom-config.example.js` to `server/custom-config.js`, you may edit the variable of the lending strategy.

4. Run `pnpm install` to install required packages

## Run the bot

If you just want to start the bot and automatically lend your money out, you only need to start the backend service.

It will check your remaining/submit funding offers every <b>5</b> minutes.

```

pnpm run start

```

## Submit the lending offer manually

Although the bot will run it regularly, you can run the script directly.

```

pnpm run auto-submit # For USD lending

pnpm run auto-submit:usdt # For USDT lending

```

## Read the earning data manually

Although the bot will run it regularly, you can run the script directly.

```

pnpm run sync-earning

```
