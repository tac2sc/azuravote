const cors = require("cors");
const helmet = require("helmet");
const rateLimitModule = require("express-rate-limit");
const rateLimit = rateLimitModule.rateLimit || rateLimitModule;
const ipKeyGenerator = rateLimitModule.ipKeyGenerator || ((ip) => ip);

function applySecurity(app, config) {
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
  }));

  if (config.corsAllowedOrigins.length) {
    app.use(cors((req, cb) => cb(null, {
      origin(origin, originCb) {
        if (!origin || isSameOrigin(req, origin) || config.corsAllowedOrigins.includes(origin)) {
          return originCb(null, true);
        }
        return originCb(new Error("CORS origin denied"));
      },
    })));
  }
}


function isSameOrigin(req, origin) {
  try {
    const originUrl = new URL(origin);
    return originUrl.host === req.get("host");
  } catch (error) {
    return false;
  }
}
function jsonParser(express) {
  return express.json({ limit: "10kb", type: ["application/json", "*/json"] });
}

function voteLimiter(config) {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMaxVotes,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      return ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown");
    },
    message: { ok: false, error: "Too many votes. Please wait a moment." },
  });
}

function chatLimiter(config, resolveClientIp = (req) => req.ip || req.socket?.remoteAddress || "unknown") {
  return rateLimit({
    windowMs: config.chatRateLimitWindowMs,
    limit: config.chatRateLimitMaxMessages,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true,
    keyGenerator(req) {
      return ipKeyGenerator(resolveClientIp(req) || "unknown");
    },
    message: { ok: false, error: "Too many chat messages. Please wait a moment." },
  });
}

function requireJson(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({ ok: false, error: "Content-Type must be application/json" });
  }
  return next();
}

function safeError(res, error, fallback = "Something went wrong") {
  const status = Number(error.status || error.statusCode || 500);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    ok: false,
    error: status >= 500 ? fallback : error.message,
  });
}

module.exports = { applySecurity, jsonParser, voteLimiter, chatLimiter, requireJson, safeError };
