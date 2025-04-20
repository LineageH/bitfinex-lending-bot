const scheduler = require("./scheduler");
const telegram = require("./telegram");

scheduler();

telegram.login();
