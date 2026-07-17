require("dotenv").config();

const DEFAULT_SECRET = "change-this-long-random-secret";

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function csv(name) {
  return (process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

const config = {
  port: int("PORT", 3099),
  nodeEnv: process.env.NODE_ENV || "development",
  databasePath: process.env.DATABASE_PATH || "./data/votes.sqlite",
  azuracast: {
    baseUrl: cleanBaseUrl(process.env.AZURACAST_BASE_URL),
    stationId: process.env.AZURACAST_STATION_ID || "",
    stationShortName: process.env.AZURACAST_STATION_SHORT_NAME || "",
    apiKey: process.env.AZURACAST_API_KEY || "",
    timeoutMs: int("AZURACAST_TIMEOUT_MS", 5000),
  },
  publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL),
  voterHashSecret: process.env.VOTER_HASH_SECRET || "",
  trustProxy: bool("TRUST_PROXY", false),
  corsAllowedOrigins: csv("CORS_ALLOWED_ORIGINS"),
  widgetTheme: process.env.WIDGET_THEME || "dark",
  hidePublicDownvotes: bool("HIDE_PUBLIC_DOWNVOTES", false),
  widgetPublicPath: process.env.WIDGET_PUBLIC_PATH || "/widget",
  embedScriptPath: process.env.EMBED_SCRIPT_PATH || "/embed.js",
  rateLimitWindowMs: int("RATE_LIMIT_WINDOW_MS", 60000),
  rateLimitMaxVotes: int("RATE_LIMIT_MAX_VOTES", 20),
  chatRateLimitWindowMs: int("CHAT_RATE_LIMIT_WINDOW_MS", 60000),
  chatRateLimitMaxMessages: int("CHAT_RATE_LIMIT_MAX_MESSAGES", 1),
};

function validateConfig(cfg = config) {
  const errors = [];
  if (!cfg.azuracast.baseUrl) errors.push("AZURACAST_BASE_URL is required");
  if (!cfg.azuracast.stationId && !cfg.azuracast.stationShortName) {
    errors.push("At least one of AZURACAST_STATION_ID or AZURACAST_STATION_SHORT_NAME is required");
  }
  if (!cfg.voterHashSecret) errors.push("VOTER_HASH_SECRET is required");
  if (cfg.nodeEnv === "production" && cfg.voterHashSecret === DEFAULT_SECRET) {
    errors.push("VOTER_HASH_SECRET must not use the default value in production");
  }
  if (errors.length) {
    const error = new Error(errors.join("; "));
    error.code = "CONFIG_INVALID";
    error.details = errors;
    throw error;
  }
}

module.exports = { config, validateConfig, DEFAULT_SECRET };
