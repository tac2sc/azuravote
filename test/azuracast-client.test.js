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
    baseUrl: "https://user:password@azuracast.test",
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
  assert.equal(records[0].details.attempts[0].url, "https://azuracast.test/api/nowplaying");
  assert.equal(JSON.stringify(records[0]).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(records[0]).includes("password"), false);
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
