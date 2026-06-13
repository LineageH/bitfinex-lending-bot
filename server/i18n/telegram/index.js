const en = require("./en");
const zhTW = require("./zh-tw");

const normalizeLanguage = (lang) => {
  const value = String(lang || "").toLowerCase();
  if (value === "zh" || value === "zh-tw" || value === "zh_tw") {
    return "zh-TW";
  }
  return "en";
};

const getTelegramI18n = (lang) => {
  const language = normalizeLanguage(lang);
  const dict = language === "zh-TW" ? zhTW : en;

  const t = (key, params = {}) => {
    const template = dict[key] || en[key] || key;
    return Object.keys(params).reduce((text, paramKey) => {
      return text.replaceAll(`{{${paramKey}}}`, String(params[paramKey]));
    }, template);
  };

  return {
    language,
    dateLocale: language === "zh-TW" ? "zh-TW" : "en-US",
    t,
  };
};

module.exports = {
  normalizeLanguage,
  getTelegramI18n,
};
