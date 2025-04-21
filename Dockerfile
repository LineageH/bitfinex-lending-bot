FROM node:22-alpine
ENV NODE_ENV=production

RUN mkdir /app
WORKDIR /app

RUN npm install -g pnpm

COPY package.json ./
COPY pnpm-lock.yaml ./

RUN pnpm install

COPY . .

CMD ["pnpm", "run start"]

