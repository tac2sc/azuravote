const test = require("node:test");
const assert = require("node:assert/strict");
const { AzuraCastClient } = require("../azuracast");

test("now-playing failure logs sanitized upstream diagnostics", async () => {
  const records = [];
  const logger = {
    error(message, details) {
      records.push({ message, details });
    },
  };
  const config = {
    baseUrl: "https://user:password@azuracast.test/base?token=secret-query",
    stationId: "1",
    stationShortName: "station",
    apiKey: "secret-api-key",
    timeoutMs: 1234,
  };
  const client = new AzuraCastClient(config, async () => ({
    ok: false,
    status: 503,
    async json() { return {}; },
  }), logger);

  const result = await client.getNowPlaying();

  assert.equal(result.ok, false);
  assert.equal(records.length, 1);
  assert.equal(records[0].message, "AzuraCast now-playing lookup failed");
  assert.equal(records[0].details.timeout_ms, 1234);
  assert.equal(records[0].details.attempts[0].status, 503);
  assert.equal(records[0].details.attempts[0].type, "http_error");
  assert.equal(records[0].details.attempts[0].url, "https://azuracast.test/base/api/nowplaying");
  assert.equal(JSON.stringify(records[0]).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(records[0]).includes("password"), false);
  assert.equal(JSON.stringify(records[0]).includes("secret-query"), false);
});


test("successful now-playing lookup does not log an error", async () => {
  const records = [];
  const logger = { error(...args) { records.push(args); } };
  const client = new AzuraCastClient({
    baseUrl: "https://azuracast.test",
    stationId: "1",
    stationShortName: "",
    apiKey: "",
    timeoutMs: 1234,
  }, async () => ({
    ok: true,
    status: 200,
    async json() {
      return { is_online: true, now_playing: { song: { id: "song-1", artist: "Artist", title: "Title" } } };
    },
  }), logger);

  const result = await client.getNowPlaying();

  assert.equal(result.ok, true);
  assert.deepEqual(records, []);
});


test("network failure logs do not expose credentials from error messages", async () => {
  const records = [];
  const logger = { error(message, details) { records.push({ message, details }); } };
  const client = new AzuraCastClient({
    baseUrl: "https://user:password.test",
    stationId: "1",
    stationShortName: "",
    apiKey: "secret-api-key",
    timeoutMs: 1234,
  }, async () => {
    const error = new Error("Authorization: Bearer secret-api-key via https://user:password.test");
    error.cause = { code: "SECRET_API_KEY" };
    throw error;
  }, logger);

  await client.getNowPlaying();

  const logged = JSON.stringify(records);
  assert.equal(logged.includes("secret-api-key"), false);
  assert.equal(logged.includes("password"), false);
  assert.equal(logged.includes("SECRET_API_KEY"), false);
});
