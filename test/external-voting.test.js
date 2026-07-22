const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createApp } = require("../server");
const { openDatabase, createStore } = require("../db");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azsv-external-"));
  return createStore(openDatabase(path.join(dir, "votes.sqlite")));
}

function testConfig() {
  return {
    nodeEnv: "test",
    databasePath: ":memory:",
    azuracast: { baseUrl: "http://azuracast.test", stationId: "1", stationShortName: "", apiKey: "", timeoutMs: 1000 },
    publicBaseUrl: "https://radio.example/votes",
    voterHashSecret: "test-secret",
    trustProxy: false,
    corsAllowedOrigins: [],
    widgetTheme: "dark",
    hidePublicDownvotes: false,
    widgetPublicPath: "/widget",
    embedScriptPath: "/embed.js",
    rateLimitWindowMs: 60000,
    rateLimitMaxVotes: 20,
    chatRateLimitWindowMs: 60000,
    chatRateLimitMaxMessages: 5,
  };
}

async function startApp(t, { store = tempStore(), client, cfg = testConfig() } = {}) {
  const azuracastClient = client || {
    async getNowPlaying() {
      return { ok: true, streamActive: false, song: null };
    },
  };
  const app = createApp({ cfg, store, azuracastClient });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  return { store, baseUrl: `http://127.0.0.1:${server.address().port}/votes` };
}

async function resolveSong(baseUrl, artist, title, ip = "203.0.113.10") {
  return fetch(`${baseUrl}/api/external-now-playing`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify({ artist, title }),
  });
}

test("external resolver normalizes and reuses the shared metadata song identity without schema changes", async (t) => {
  const { store, baseUrl } = await startApp(t);

  const firstResponse = await resolveSong(baseUrl, "  THE  BAND ", " A  Song ");
  const first = await firstResponse.json();
  const secondResponse = await resolveSong(baseUrl, "the band", "a song");
  const second = await secondResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(first.ok, true);
  assert.equal(first.song.song_key, "meta:the band::a song");
  assert.equal(first.song.artist, "THE BAND");
  assert.equal(first.song.title, "A Song");
  assert.deepEqual(first.votes, { upvotes: 0, downvotes: 0, score: 0, my_vote: null });
  assert.equal(secondResponse.status, 200);
  assert.equal(second.song.id, first.song.id);
  assert.equal(store.db.prepare("select count(*) as count from songs").get().count, 1);
  assert.deepEqual(
    store.db.prepare("select name from sqlite_master where type = 'table' order by name").all().map((row) => row.name),
    ["chat_messages", "song_rotation_rules", "songs", "sqlite_sequence", "votes"]
  );
});

test("external resolver returns totals for the requesting listener", async (t) => {
  const { baseUrl } = await startApp(t);
  const created = await (await resolveSong(baseUrl, "Artist", "Title", "203.0.113.20")).json();

  const otherListenerVote = await fetch(`${baseUrl}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.21" },
    body: JSON.stringify({ song_key: created.song.song_key, vote: 1 }),
  });

  const listenerVote = await fetch(`${baseUrl}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.20" },
    body: JSON.stringify({ song_key: created.song.song_key, vote: -1 }),
  });
  const resolvedAgain = await (await resolveSong(baseUrl, "Artist", "Title", "203.0.113.20")).json();

  assert.equal(otherListenerVote.status, 200);
  assert.equal(listenerVote.status, 200);
  assert.deepEqual(resolvedAgain.votes, { upvotes: 1, downvotes: 1, score: 0, my_vote: -1 });
});

test("external resolver requires bounded nonempty normalized JSON fields", async (t) => {
  const { baseUrl } = await startApp(t);
  const cases = [
    { body: { artist: "", title: "Title" }, status: 400 },
    { body: { artist: "Unknown", title: "Title" }, status: 400 },
    { body: { artist: "Artist", title: " ".repeat(4) }, status: 400 },
    { body: { artist: "A".repeat(201), title: "Title" }, status: 400 },
    { body: { artist: "Artist", title: "T".repeat(201) }, status: 400 },
  ];

  for (const entry of cases) {
    const response = await resolveSong(baseUrl, entry.body.artist, entry.body.title);
    assert.equal(response.status, entry.status);
  }

  const wrongContentType = await fetch(`${baseUrl}/api/external-now-playing`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "Artist - Title",
  });
  assert.equal(wrongContentType.status, 415);
});

test("external resolver uses the initialized vote limiter", async (t) => {
  const cfg = testConfig();
  cfg.rateLimitMaxVotes = 1;
  const { baseUrl } = await startApp(t, { cfg });

  const first = await resolveSong(baseUrl, "Artist", "One");
  const second = await resolveSong(baseUrl, "Artist", "Two");

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
});

test("known external song can be voted on while the main stream is offline but unknown keys are rejected", async (t) => {
  const { baseUrl } = await startApp(t);
  const resolved = await (await resolveSong(baseUrl, "Artist", "External title")).json();

  const known = await fetch(`${baseUrl}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ song_key: resolved.song.song_key, vote: 1 }),
  });
  const knownBody = await known.json();
  const unknown = await fetch(`${baseUrl}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ song_key: "meta:artist::missing", vote: 1 }),
  });

  assert.equal(known.status, 200);
  assert.equal(knownBody.song.song_key, resolved.song.song_key);
  assert.equal(knownBody.votes.my_vote, 1);
  assert.equal(unknown.status, 409);
});

test("unknown song keys retain the main-stream mismatch validation", async (t) => {
  const client = {
    async getNowPlaying() {
      return {
        ok: true,
        streamActive: true,
        song: { azuracast_song_id: "main", song_key: "az:main", artist: "Main", title: "Song", album: null, art_url: null },
      };
    },
  };
  const { baseUrl } = await startApp(t, { client });

  const response = await fetch(`${baseUrl}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ song_key: "meta:artist::missing", vote: 1 }),
  });

  assert.equal(response.status, 404);
});
