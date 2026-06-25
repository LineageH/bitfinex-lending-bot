const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const dotenv = require("dotenv");
dotenv.config();

const customConfigPath = path.join(__dirname, "custom-config.js");

const config = {
  API_KEY: process.env.API_KEY,
  API_SECRET: process.env.API_SECRET,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  TELEGRAM_LANGUAGE: process.env.TELEGRAM_LANGUAGE || "en",
  LEND: {
    USD: process.env.LEND_USD === "true",
    USDT: process.env.LEND_USDT === "true",
  },
};

let loadedCustomKeys = new Set();
const reloadEmitter = new EventEmitter();
const TRACKED_CONFIG_SECTIONS = [
  "SubmitTime",
  "LendingNotifyInterval",
  "Strategy",
  "AutoReduce",
  "Period",
];
let trackedCustomSnapshot = null;
let hasLoadedCustomConfig = false;

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isEqualValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function collectChangedPaths(beforeValue, afterValue, prefix = "") {
  if (isEqualValue(beforeValue, afterValue)) {
    return [];
  }

  if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
    return [prefix || "(array)"];
  }

  if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
    const keySet = new Set([
      ...Object.keys(beforeValue || {}),
      ...Object.keys(afterValue || {}),
    ]);

    const paths = [];
    Array.from(keySet)
      .sort()
      .forEach((key) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        paths.push(
          ...collectChangedPaths(beforeValue[key], afterValue[key], nextPrefix),
        );
      });

    return paths.length > 0 ? paths : [prefix || "(object)"];
  }

  return [prefix || "(value)"];
}

function pickTrackedSections(source) {
  return TRACKED_CONFIG_SECTIONS.reduce((acc, section) => {
    acc[section] = deepClone(source?.[section]);
    return acc;
  }, {});
}

function buildTrackedChanges(previousSnapshot, nextSnapshot) {
  const prev = previousSnapshot || {};
  const next = nextSnapshot || {};

  return TRACKED_CONFIG_SECTIONS.filter(
    (section) => !isEqualValue(prev[section], next[section]),
  ).map((section) => ({
    section,
    before: deepClone(prev[section]),
    after: deepClone(next[section]),
    paths: collectChangedPaths(prev[section], next[section]),
  }));
}

function loadCustomConfig() {
  const resolvedPath = require.resolve("./custom-config");
  delete require.cache[resolvedPath];
  return require("./custom-config");
}

function applyCustomConfig(nextCustomConfig = {}) {
  loadedCustomKeys.forEach((key) => {
    delete config[key];
  });

  loadedCustomKeys = new Set(Object.keys(nextCustomConfig));
  Object.assign(config, nextCustomConfig);

  config.API_KEY = process.env.API_KEY;
  config.API_SECRET = process.env.API_SECRET;
  config.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  config.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  config.TELEGRAM_LANGUAGE =
    process.env.TELEGRAM_LANGUAGE || config.TELEGRAM_LANGUAGE || "en";
  config.LEND = {
    USD: process.env.LEND_USD === "true",
    USDT: process.env.LEND_USDT === "true",
  };
}

function reloadCustomConfig() {
  try {
    const previousSnapshot = trackedCustomSnapshot;
    const nextCustomConfig = loadCustomConfig();
    const nextSnapshot = pickTrackedSections(nextCustomConfig);
    applyCustomConfig(nextCustomConfig);
    trackedCustomSnapshot = nextSnapshot;
    console.log(
      `[Config] Reloaded custom-config.js at ${new Date().toISOString()}`,
    );

    const changes = buildTrackedChanges(previousSnapshot, nextSnapshot);
    if (hasLoadedCustomConfig && changes.length > 0) {
      reloadEmitter.emit("custom-config-reloaded", {
        file: customConfigPath,
        changes,
        at: Date.now(),
      });
    }
    hasLoadedCustomConfig = true;
  } catch (error) {
    console.error("[Config] Failed to reload custom-config.js", error);
  }
}

reloadCustomConfig();

fs.watchFile(
  customConfigPath,
  { interval: 1000, persistent: false },
  (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) {
      return;
    }
    reloadCustomConfig();
  },
);

Object.defineProperty(config, "onCustomConfigReload", {
  enumerable: false,
  value: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }

    reloadEmitter.on("custom-config-reloaded", listener);
    return () => {
      reloadEmitter.off("custom-config-reloaded", listener);
    };
  },
});

module.exports = config;
