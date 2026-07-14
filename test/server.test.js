const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createApp } = require("../server");
const { openDatabase, createStore } = require("../db");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azsv-"));
  return createStore(openDatabase(path.join(dir, "votes.sqlite")));
}

function testConfig() {
  return {
    nodeEnv: "test",
    databasePath: ":memory:",
    azuracast: { baseUrl: "http://azuracast.test", stationId: "1", stationShortName: "", apiKey: "", timeoutMs: 1000 },
    publicBaseUrl: "",
    voterHashSecret: "test-secret",
    trustProxy: false,
    corsAllowedOrigins: [],
    widgetTheme: "dark",
    hidePublicDownvotes: false,
    widgetPublicPath: "/widget",
    embedScriptPath: "/embed.js",
    rateLimitWindowMs: 60000,
    rateLimitMaxVotes: 20,
  };
}

test("vote endpoint stores the forwarded client IP without exposing it", async (t) => {
  const store = tempStore();
  const app = createApp({
    cfg: testConfig(),
    store,
    azuracastClient: {
      async getNowPlaying() {
        return {
          ok: true,
          streamActive: true,
          song: {
            azuracast_song_id: "song-1",
            song_key: "az:song-1",
            artist: "Artist",
            title: "Title",
            album: "",
            art_url: "",
          },
        };
      },
    },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/vote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10, 10.0.0.2",
      "x-real-ip": "198.51.100.4",
    },
    body: JSON.stringify({ vote: 1 }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(body).includes("voter_ip"), false);
  assert.equal(store.db.prepare("select voter_ip from votes").get().voter_ip, "203.0.113.10");
});


test("embed script route initializes its rate limiter before serving requests", async (t) => {
  const app = createApp({ cfg: testConfig(), store: tempStore(), azuracastClient: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const { port } = server.address();
  const response = await fetch("http://127.0.0.1:" + port + "/embed.js");

  assert.equal(response.status, 200);
});
