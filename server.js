const path = require("path");
const express = require("express");
const { config, validateConfig } = require("./config");
const { openDatabase, createStore } = require("./db");
const { AzuraCastClient } = require("./azuracast");
const { createVotingService, getVoterHash, sanitizeSong } = require("./votes");
const { applySecurity, jsonParser, voteLimiter, requireJson, safeError } = require("./security");

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

function parseLimit(value, fallback, max) {
  const limit = Number.parseInt(value || "", 10);
  if (!Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(limit, max);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "azuravote" });
  });

  app.get(["/widget", "/widget/", "/widget.html"], (req, res) => {
    res.sendFile(path.join(__dirname, "public", "widget.html"));
  });

  app.get("/embed.js", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "embed.js"));
  });

  app.get("/api/config", (req, res) => {
    res.json({
      theme: cfg.widgetTheme,
      hidePublicDownvotes: cfg.hidePublicDownvotes,
    });
  });

  app.get("/api/now-playing", async (req, res) => {
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

  app.post("/api/vote", voteLimiter(cfg), requireJson, async (req, res) => {
    try {
      const voteValue = Number(req.body?.vote);
      const songKey = typeof req.body?.song_key === "string" && req.body.song_key.trim() ? req.body.song_key.trim() : "";
      const voterHash = getVoterHash(req, cfg.voterHashSecret);
      const result = await voting.submitVote({ songKey, voteValue, voterHash });
      res.json({ ok: true, stream_active: result.streamActive !== false, song: publicSong(result.song), votes: result.votes });
    } catch (error) {
      console.error("vote failed:", error.message);
      safeError(res, error, "Unable to save vote");
    }
  });

  app.get("/api/song/:songKey/votes", (req, res) => {
    const song = database.getSongByKey(req.params.songKey);
    if (!song) return res.status(404).json({ ok: false, error: "Unknown song" });
    res.json({ song: publicSong(song), votes: database.getVoteTotals(song.id, getVoterHash(req, cfg.voterHashSecret)) });
  });

  app.get("/api/recent", (req, res) => {
    res.json({ songs: database.listRecent(parseLimit(req.query.limit, 10, 50)) });
  });

  app.get("/api/top", (req, res) => {
    res.json({ songs: database.listRanked(parseLimit(req.query.limit, 20, 100), "top") });
  });

  app.get("/api/bottom", (req, res) => {
    res.json({ songs: database.listRanked(parseLimit(req.query.limit, 20, 100), "bottom") });
  });

  app.get("/api/export.csv", (req, res) => {
    const rows = database.exportRows();
    const header = "artist,title,album,upvotes,downvotes,score,first_seen_at,last_seen_at";
    const lines = rows.map((row) => [row.artist, row.title, row.album, row.upvotes, row.downvotes, row.score, row.first_seen_at, row.last_seen_at].map(csvEscape).join(","));
    res.type("text/csv").send([header, ...lines].join("\n"));
  });

  app.use("/public", express.static(path.join(__dirname, "public"), { fallthrough: false }));
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
