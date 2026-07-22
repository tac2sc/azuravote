const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "..", "azuracast", "custom_js_for_public_pages.js"), "utf8");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function bridgeFixture(initialUrl, fetchImpl) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="now-playing-title">Main title</div>
    <div class="now-playing-artist">Main artist</div>
    <audio></audio>
  </body></html>`, { url: "https://radio.example/public/station", runScripts: "outside-only" });
  const audio = dom.window.document.querySelector("audio");
  let audioUrl = initialUrl;
  Object.defineProperty(audio, "currentSrc", { configurable: true, get: () => audioUrl });
  Object.defineProperty(audio, "paused", { configurable: true, get: () => false });
  Object.defineProperty(audio, "ended", { configurable: true, get: () => false });
  dom.window.fetch = fetchImpl;
  dom.window.setTimeout = (callback) => { callback(); return 1; };
  dom.window.clearTimeout = () => {};
  dom.window.setInterval = () => 1;
  dom.window.clearInterval = () => {};
  const events = [];
  dom.window.addEventListener("azuravote:external-metadata", (event) => events.push(event.detail));
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return {
    dom,
    audio,
    events,
    setAudioUrl(value) { audioUrl = value; },
    sync() { audio.dispatchEvent(new dom.window.Event("playing", { bubbles: true })); },
  };
}

test("custom public JS publishes valid external metadata and stores a startup snapshot", async () => {
  const fixture = bridgeFixture("https://progressive.ozelip.com/7670/stream", async () => ({
    ok: true,
    async text() { return " External Artist  -  External Title "; },
  }));
  await flush();

  const expected = { active: true, source: "loops-radio", available: true, artist: "External Artist", title: "External Title" };
  assert.deepEqual(plain(fixture.events.at(-1)), expected);
  assert.deepEqual(plain(fixture.dom.window.AZURAVOTE_EXTERNAL_METADATA), expected);
  assert.equal(fixture.dom.window.document.querySelector(".now-playing-artist").textContent, "External Artist");
  assert.equal(fixture.dom.window.document.querySelector(".now-playing-title").textContent, "External Title");
  assert.equal(fixture.dom.window.document.querySelector("script").src, "https://radio.example/votes/embed.js?v=10");
});

test("custom public JS publishes unavailable metadata for empty and failed responses", async () => {
  let mode = "empty";
  const fixture = bridgeFixture("https://progressive.ozelip.com/7670/stream", async () => {
    if (mode === "failure") throw new Error("metadata failed");
    return { ok: true, async text() { return "   "; } };
  });
  await flush();

  assert.deepEqual(plain(fixture.events.at(-1)), { active: true, source: "loops-radio", available: false });

  mode = "failure";
  fixture.sync();
  await flush();
  assert.deepEqual(plain(fixture.events.at(-1)), { active: true, source: "loops-radio", available: false });
  assert.deepEqual(plain(fixture.dom.window.AZURAVOTE_EXTERNAL_METADATA), plain(fixture.events.at(-1)));
});

test("custom public JS identifies source switches and immediately publishes inactive on main-stream return", async () => {
  const fixture = bridgeFixture("https://progressive.ozelip.com/7670/stream", async (url) => ({
    ok: true,
    async text() { return String(url).includes("yogachill") ? "Yoga Artist - Yoga Title" : "Loops Artist - Loops Title"; },
  }));
  await flush();

  fixture.setAudioUrl("https://radio4.vip-radios.fm:18027/live");
  fixture.sync();
  await flush();
  assert.deepEqual(plain(fixture.events.at(-1)), { active: true, source: "yoga-chill", available: true, artist: "Yoga Artist", title: "Yoga Title" });

  fixture.setAudioUrl("https://radio.example/radio.mp3");
  fixture.sync();
  assert.deepEqual(plain(fixture.events.at(-1)), { active: false });
  assert.deepEqual(plain(fixture.dom.window.AZURAVOTE_EXTERNAL_METADATA), { active: false });
});
