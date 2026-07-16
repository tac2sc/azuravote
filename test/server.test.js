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
    chatRateLimitWindowMs: 60000,
    chatRateLimitMaxMessages: 5,
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
  const adapterResponse = await fetch("http://127.0.0.1:" + port + "/player-adapter.js");

  assert.equal(response.status, 200);
  assert.equal(adapterResponse.status, 200);
});

test("listener can post and read an anonymous chat message", async (t) => {
  const app = createApp({ cfg: testConfig(), store: tempStore(), azuracastClient: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const postResponse = await fetch(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.25",
    },
    body: JSON.stringify({ message: " Hello station! " }),
  });
  const posted = await postResponse.json();

  assert.equal(postResponse.status, 201);
  assert.deepEqual(Object.keys(posted.message), ["id", "nickname", "body", "created_at"]);
  assert.equal(posted.message.nickname, "ce7845");
  assert.equal(posted.message.body, "Hello station!");

  const getResponse = await fetch(`${baseUrl}/api/chat/messages`, {
    headers: { "x-forwarded-for": "203.0.113.25" },
  });
  const history = await getResponse.json();

  assert.equal(getResponse.status, 200);
  assert.equal(history.nickname, "ce7845");
  assert.deepEqual(history.messages, [posted.message]);
  assert.equal(history.latest_id, posted.message.id);
});

test("chat history supports an incremental cursor and bounded limit", async (t) => {
  const app = createApp({ cfg: testConfig(), store: tempStore(), azuracastClient: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const message of ["one", "two", "three"]) {
    const response = await fetch(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    assert.equal(response.status, 201);
  }

  const response = await fetch(`${baseUrl}/api/chat/messages?after=1&limit=1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.messages.map((message) => message.body), ["two"]);
  assert.equal(body.latest_id, 2);
});

test("chat rejects invalid messages and accepts exactly 200 characters", async (t) => {
  const app = createApp({ cfg: testConfig(), store: tempStore(), azuracastClient: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/chat/messages`;

  const accepted = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "🙂".repeat(200) }),
  });
  const tooLong = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "🙂".repeat(201) }),
  });
  const empty = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  const wrongType = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: 42 }),
  });

  assert.equal(accepted.status, 201);
  assert.equal(tooLong.status, 400);
  assert.equal(empty.status, 400);
  assert.equal(wrongType.status, 400);
});

test("chat stores server-derived identity without exposing internal fields", async (t) => {
  const store = tempStore();
  const app = createApp({ cfg: testConfig(), store, azuracastClient: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.25" },
    body: JSON.stringify({ message: "identity", nickname: "admin", voter_hash: "fake", voter_ip: "127.0.0.1" }),
  });
  const body = await response.json();
  const row = store.db.prepare("select voter_hash, voter_ip from chat_messages").get();

  assert.equal(body.message.nickname, "ce7845");
  assert.equal(JSON.stringify(body).includes("voter_hash"), false);
  assert.equal(JSON.stringify(body).includes("voter_ip"), false);
  assert.equal(row.voter_hash.length, 64);
  assert.equal(row.voter_hash.startsWith("ce7845"), true);
  assert.equal(row.voter_ip, "203.0.113.25");
});

test("chat validates history queries on public-prefixed routes", async (t) => {
  const cfg = testConfig();
  cfg.publicBaseUrl = "https://radio.example/votes";
  const app = createApp({ cfg, store: tempStore(), azuracastClient: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const prefixed = await fetch(`${baseUrl}/votes/api/chat/messages`);
  const badAfter = await fetch(`${baseUrl}/votes/api/chat/messages?after=-1`);
  const badLimit = await fetch(`${baseUrl}/votes/api/chat/messages?limit=101`);

  assert.equal(prefixed.status, 200);
  assert.equal(badAfter.status, 400);
  assert.equal(badLimit.status, 400);
});

test("chat posting has a dedicated rate limit", async (t) => {
  const cfg = testConfig();
  cfg.trustProxy = true;
  cfg.chatRateLimitMaxMessages = 1;
  const app = createApp({ cfg, store: tempStore(), azuracastClient: {} });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/chat/messages`;
  const options = {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.30" },
    body: JSON.stringify({ message: "limited" }),
  };

  const first = await fetch(url, options);
  const second = await fetch(url, options);

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
});
