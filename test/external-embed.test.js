const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { createPublicPlayerAdapter } = require("../public/player-adapter");

const embedSource = fs.readFileSync(path.join(__dirname, "..", "public", "embed.js"), "utf8");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

function playerFixture(fetchImpl, startupMetadata) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body class="page-station-public-player">
    <div id="public-radio-player"><section class="player-panel">
      <div class="now-playing-main"></div>
      <select aria-label="Stream"><option>Main / MP3</option><option>External / MP3</option></select>
      <div class="radio-player-widget"></div>
    </section></div>
  </body></html>`, { url: "https://radio.example/public/station", runScripts: "outside-only" });
  const panel = dom.window.document.querySelector(".player-panel");
  panel.getBoundingClientRect = () => ({ left: 10, top: 10, right: 650, bottom: 260, width: 640, height: 250 });
  dom.window.AZSV_CONFIG = { apiBase: "https://radio.example/votes/api/" };
  dom.window.AzuraVotePublicPlayerAdapter = { createPublicPlayerAdapter };
  dom.window.AZURAVOTE_EXTERNAL_METADATA = startupMetadata;
  dom.window.fetch = fetchImpl;
  const intervals = [];
  dom.window.setInterval = (callback, milliseconds) => {
    intervals.push({ callback, milliseconds });
    return intervals.length;
  };
  dom.window.clearInterval = () => {};
  dom.window.eval(embedSource);
  return { dom, intervals };
}

function publish(dom, detail) {
  dom.window.AZURAVOTE_EXTERNAL_METADATA = detail;
  dom.window.dispatchEvent(new dom.window.CustomEvent("azuravote:external-metadata", { detail }));
}

function voteOverlay(dom) {
  return dom.window.document.getElementById("azsv-song-vote-overlay");
}

test("embed resolves startup external metadata once, displays existing totals, and isolates main polling", async () => {
  const calls = [];
  const metadata = { active: true, source: "loops-radio", available: true, artist: "Artist", title: "External" };
  const fixture = playerFixture(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/config")) return response({ hidePublicDownvotes: false });
    if (String(url).endsWith("/external-now-playing")) {
      return response({ ok: true, song: { song_key: "meta:artist::external" }, votes: { upvotes: 7, downvotes: 2, score: 5, my_vote: 1 } });
    }
    if (String(url).endsWith("/now-playing")) {
      return response({ stream_active: true, song: { song_key: "az:main" }, votes: { upvotes: 99, downvotes: 0, my_vote: null } });
    }
    return response({ songs: [] });
  }, metadata);
  await flush();
  await flush();

  const overlay = voteOverlay(fixture.dom);
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.querySelector("[data-upvotes]").textContent, "7");
  assert.equal(overlay.querySelector("[data-downvotes]").textContent, "2");
  assert.equal(calls.filter((call) => call.url.endsWith("/external-now-playing")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/now-playing")).length, 0);
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith("/external-now-playing")).options.body), { artist: "Artist", title: "External" });

  publish(fixture.dom, metadata);
  const mainPoll = fixture.intervals.find((entry) => entry.milliseconds === 15000);
  mainPoll.callback();
  await flush();
  assert.equal(calls.filter((call) => call.url.endsWith("/external-now-playing")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/now-playing")).length, 0);
  assert.equal(overlay.querySelector("[data-upvotes]").textContent, "7");
});

test("embed rejects stale external resolver responses and disables voting when metadata becomes unavailable", async () => {
  const requests = new Map();
  const fixture = playerFixture(async (url, options = {}) => {
    if (String(url).endsWith("/config")) return response({ hidePublicDownvotes: false });
    if (String(url).endsWith("/now-playing")) return response({ stream_active: true, song: { song_key: "az:main" }, votes: { upvotes: 1, downvotes: 0, my_vote: null } });
    if (String(url).endsWith("/external-now-playing")) {
      const body = JSON.parse(options.body);
      const pending = deferred();
      requests.set(body.title, pending);
      return pending.promise;
    }
    return response({ songs: [] });
  }, { active: false });
  await flush();
  await flush();

  publish(fixture.dom, { active: true, source: "loops-radio", available: true, artist: "Artist", title: "First" });
  publish(fixture.dom, { active: true, source: "loops-radio", available: true, artist: "Artist", title: "Second" });
  requests.get("Second").resolve(response({ ok: true, song: { song_key: "meta:artist::second" }, votes: { upvotes: 5, downvotes: 0, score: 5, my_vote: null } }));
  await flush();
  requests.get("First").resolve(response({ ok: true, song: { song_key: "meta:artist::first" }, votes: { upvotes: 1, downvotes: 0, score: 1, my_vote: null } }));
  await flush();

  const overlay = voteOverlay(fixture.dom);
  assert.equal(overlay.querySelector("[data-upvotes]").textContent, "5");
  publish(fixture.dom, { active: true, source: "loops-radio", available: false });
  assert.equal(overlay.hidden, true);
});

test("late vote response cannot overwrite totals after the active external song changes", async () => {
  const voteResponse = deferred();
  const voteRequests = [];
  const fixture = playerFixture(async (url, options = {}) => {
    if (String(url).endsWith("/config")) return response({ hidePublicDownvotes: false });
    if (String(url).endsWith("/now-playing")) return response({ stream_active: true, song: { song_key: "az:main" }, votes: { upvotes: 1, downvotes: 0, my_vote: null } });
    if (String(url).endsWith("/external-now-playing")) {
      const body = JSON.parse(options.body);
      const first = body.title === "First";
      return response({
        ok: true,
        song: { song_key: first ? "meta:artist::first" : "meta:artist::second" },
        votes: { upvotes: first ? 3 : 6, downvotes: 0, score: first ? 3 : 6, my_vote: null },
      });
    }
    if (String(url).endsWith("/vote")) {
      voteRequests.push(JSON.parse(options.body));
      return voteResponse.promise;
    }
    return response({ songs: [] });
  }, { active: false });
  await flush();
  await flush();

  publish(fixture.dom, { active: true, source: "loops-radio", available: true, artist: "Artist", title: "First" });
  await flush();
  const overlay = voteOverlay(fixture.dom);
  assert.equal(overlay.querySelector("[data-upvotes]").textContent, "3");

  overlay.querySelector("[data-vote='1']").click();
  await flush();
  assert.deepEqual(voteRequests, [{ song_key: "meta:artist::first", vote: 1 }]);

  publish(fixture.dom, { active: true, source: "yoga-chill", available: true, artist: "Artist", title: "Second" });
  await flush();
  assert.equal(overlay.querySelector("[data-upvotes]").textContent, "6");

  voteResponse.resolve(response({
    ok: true,
    stream_active: true,
    song: { song_key: "meta:artist::first" },
    votes: { upvotes: 4, downvotes: 0, score: 4, my_vote: 1 },
  }));
  await flush();
  await flush();

  assert.equal(overlay.querySelector("[data-upvotes]").textContent, "6");
});

test("embed restores main-stream voting immediately after external mode ends", async () => {
  let mainLoads = 0;
  const fixture = playerFixture(async (url) => {
    if (String(url).endsWith("/config")) return response({ hidePublicDownvotes: false });
    if (String(url).endsWith("/now-playing")) {
      mainLoads += 1;
      return response({ stream_active: true, song: { song_key: "az:main" }, votes: { upvotes: mainLoads === 1 ? 1 : 8, downvotes: 1, my_vote: null } });
    }
    if (String(url).endsWith("/external-now-playing")) {
      return response({ ok: true, song: { song_key: "meta:artist::external" }, votes: { upvotes: 3, downvotes: 0, score: 3, my_vote: null } });
    }
    return response({ songs: [] });
  }, { active: false });
  await flush();
  await flush();
  assert.equal(voteOverlay(fixture.dom).querySelector("[data-upvotes]").textContent, "1");

  publish(fixture.dom, { active: true, source: "loops-radio", available: true, artist: "Artist", title: "External" });
  await flush();
  assert.equal(voteOverlay(fixture.dom).querySelector("[data-upvotes]").textContent, "3");

  publish(fixture.dom, { active: false });
  await flush();
  assert.equal(mainLoads, 2);
  assert.equal(voteOverlay(fixture.dom).hidden, false);
  assert.equal(voteOverlay(fixture.dom).querySelector("[data-upvotes]").textContent, "8");
});
