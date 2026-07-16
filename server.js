const path = require("path");
const express = require("express");
const { config, validateConfig } = require("./config");
const { openDatabase, createStore } = require("./db");
const { AzuraCastClient } = require("./azuracast");
const { createVotingService, getClientIp, getVoterHash, sanitizeSong } = require("./votes");
const { applySecurity, jsonParser, voteLimiter, chatLimiter, requireJson, safeError } = require("./security");

const CHAT_MESSAGE_MAX_LENGTH = 200;

function publicSong(row) {
  const song = sanitizeSong(row);
  if (!song) return null;
  return {
    id: song.id,
    song_key: song.song_key,
    azuracast_song_id: song.azuracast_song_id,
    artist: song.artist,
    title: song.title,
    album: song.album,
    art_url: song.art_url,
  };
}

function publicChatMessage(row) {
  return {
    id: Number(row.id),
    nickname: String(row.voter_hash).slice(0, 6),
    body: row.body,
    created_at: row.created_at,
  };
}

function parseLimit(value, fallback, max) {
  const limit = Number.parseInt(value || "", 10);
  if (!Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(limit, max);
}

function parseChatQueryInteger(value, { name, fallback, min, max }) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) {
    const error = new Error(`${name} must be an integer from ${min} to ${max}`);
    error.status = 400;
    throw error;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    const error = new Error(`${name} must be an integer from ${min} to ${max}`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function publicPathPrefix(cfg) {
  try {
    return new URL(cfg.publicBaseUrl || "http://localhost").pathname.replace(/\/+$/, "");
  } catch (error) {
    return "";
  }
}

function withPublicPrefix(route, cfg) {
  const prefix = publicPathPrefix(cfg);
  if (!prefix || prefix === "/") return [route];
  return Array.from(new Set([route, `${prefix}${route === "/" ? "" : route}`]));
}

function createApp({ cfg = config, store, azuracastClient } = {}) {
  validateConfig(cfg);
  const app = express();
  if (cfg.trustProxy) app.set("trust proxy", true);

  const database = store || createStore(openDatabase(cfg.databasePath));
  const client = azuracastClient || new AzuraCastClient(cfg.azuracast);
  const voting = createVotingService(database, client);

  applySecurity(app, cfg);
  app.use(jsonParser(express));

  app.get(withPublicPrefix("/health", cfg), (req, res) => {
    res.json({ ok: true, service: "azuravote" });
  });

  app.get([].concat(withPublicPrefix("/widget", cfg), withPublicPrefix("/widget/", cfg), withPublicPrefix("/widget.html", cfg)), voteLimiter(cfg), (req, res) => {
    res.sendFile(path.join(__dirname, "public", "widget.html"));
  });

  app.get(withPublicPrefix("/embed.js", cfg), voteLimiter(cfg), (req, res) => {
    res.sendFile(path.join(__dirname, "public", "embed.js"));
  });

  app.get(withPublicPrefix("/api/config", cfg), (req, res) => {
    res.json({
      theme: cfg.widgetTheme,
      hidePublicDownvotes: cfg.hidePublicDownvotes,
    });
  });

  app.get(withPublicPrefix("/api/now-playing", cfg), async (req, res) => {
    try {
      const result = await voting.currentSong();
      if (!result.ok) return res.status(503).json({ ok: false, error: result.error });
      if (result.streamActive === false) {
        return res.json({ stream_active: false, song: null, votes: null });
      }
      const voterHash = getVoterHash(req, cfg.voterHashSecret);
      res.json({ stream_active: true, song: publicSong(result.song), votes: database.getVoteTotals(result.song.id, voterHash) });
    } catch (error) {
      console.error("now-playing failed:", error.message);
      safeError(res, error, "Unable to load current song");
    }
  });

  app.post(withPublicPrefix("/api/vote", cfg), voteLimiter(cfg), requireJson, async (req, res) => {
    try {
      const voteValue = Number(req.body?.vote);
      const songKey = typeof req.body?.song_key === "string" && req.body.song_key.trim() ? req.body.song_key.trim() : "";
      const voterHash = getVoterHash(req, cfg.voterHashSecret);
      const voterIp = getClientIp(req);
      const result = await voting.submitVote({ songKey, voteValue, voterHash, voterIp });
      res.json({ ok: true, stream_active: result.streamActive !== false, song: publicSong(result.song), votes: result.votes });
    } catch (error) {
      console.error("vote failed:", error.message);
      safeError(res, error, "Unable to save vote");
    }
  });

  app.get(withPublicPrefix("/api/song/:songKey/votes", cfg), (req, res) => {
    const song = database.getSongByKey(req.params.songKey);
    if (!song) return res.status(404).json({ ok: false, error: "Unknown song" });
    res.json({ song: publicSong(song), votes: database.getVoteTotals(song.id, getVoterHash(req, cfg.voterHashSecret)) });
  });

  app.get(withPublicPrefix("/api/chat/messages", cfg), (req, res) => {
    try {
      const after = parseChatQueryInteger(req.query.after, { name: "after", fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
      const limit = parseChatQueryInteger(req.query.limit, { name: "limit", fallback: 50, min: 1, max: 100 });
      const voterHash = getVoterHash(req, cfg.voterHashSecret);
      const messages = database.listChatMessages({ after, limit }).map(publicChatMessage);
      res.json({
        ok: true,
        nickname: voterHash.slice(0, 6),
        messages,
        latest_id: messages.length ? messages[messages.length - 1].id : after,
      });
    } catch (error) {
      safeError(res, error, "Unable to load chat messages");
    }
  });

  app.post(withPublicPrefix("/api/chat/messages", cfg), chatLimiter(cfg), requireJson, (req, res) => {
    try {
      const body = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (!body || Array.from(body).length > CHAT_MESSAGE_MAX_LENGTH) {
        const error = new Error("Message must be between 1 and 200 characters");
        error.status = 400;
        throw error;
      }
      const voterHash = getVoterHash(req, cfg.voterHashSecret);
      const row = database.createChatMessage(voterHash, getClientIp(req), body);
      res.status(201).json({ ok: true, message: publicChatMessage(row) });
    } catch (error) {
      console.error("chat message failed:", error.message);
      safeError(res, error, "Unable to post chat message");
    }
  });

  app.get(withPublicPrefix("/api/recent", cfg), (req, res) => {
    res.json({ songs: database.listRecent(parseLimit(req.query.limit, 10, 50)) });
  });

  app.get(withPublicPrefix("/api/top", cfg), (req, res) => {
    res.json({ songs: database.listRanked(parseLimit(req.query.limit, 20, 100), "top") });
  });

  app.get(withPublicPrefix("/api/bottom", cfg), (req, res) => {
    res.json({ songs: database.listRanked(parseLimit(req.query.limit, 20, 100), "bottom") });
  });

  app.get(withPublicPrefix("/api/export.csv", cfg), (req, res) => {
    const rows = database.exportRows();
    const header = "artist,title,album,upvotes,downvotes,score,first_seen_at,last_seen_at";
    const lines = rows.map((row) => [row.artist, row.title, row.album, row.upvotes, row.downvotes, row.score, row.first_seen_at, row.last_seen_at].map(csvEscape).join(","));
    res.type("text/csv").send([header, ...lines].join("\n"));
  });

  app.use(withPublicPrefix("/public", cfg), express.static(path.join(__dirname, "public"), { fallthrough: false }));
  const prefix = publicPathPrefix(cfg);
  if (prefix && prefix !== "/") app.use(prefix, express.static(path.join(__dirname, "public")));
  app.use(express.static(path.join(__dirname, "public")));

  app.use((error, req, res, next) => {
    console.error("request failed:", error.message);
    safeError(res, error);
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`azuravote listening on ${config.port}`);
  });
}

module.exports = { createApp };
