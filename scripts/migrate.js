const { config, validateConfig } = require("../config");
const { openDatabase } = require("../db");

validateConfig(config);
const db = openDatabase(config.databasePath);
db.close();
console.log(`Database ready at ${config.databasePath}`);
