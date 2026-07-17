const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { createPublicPlayerAdapter } = require("../public/player-adapter");

function playerFixture() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body class="page-station-public-player">
    <div id="public-radio-player">
      <section class="player-panel">
        <div class="now-playing-main"></div>
        <select aria-label="Stream">
          <option>Main / MP3</option>
          <option>Backup / AAC</option>
        </select>
        <div class="radio-player-widget"></div>
      </section>
    </div>
  </body></html>`, { url: "https://radio.example/public/station", runScripts: "outside-only" });
  const panel = dom.window.document.querySelector(".player-panel");
  panel.getBoundingClientRect = () => ({ left: 10, top: 10, right: 650, bottom: 260, width: 640, height: 250 });
  return dom;
}

test("adapter installs one collapsed Chat control on the station player", () => {
  const dom = playerFixture();
  const adapter = createPublicPlayerAdapter({ window: dom.window, document: dom.window.document });
  const snapshots = [];

  const toggles = [];
  adapter.install({ onChatToggle(open) { toggles.push(open); } });
  adapter.observe((snapshot) => snapshots.push(snapshot));
  adapter.install({});

  const chatControls = dom.window.document.querySelectorAll("#azsv-chat-link");
  const chatPanel = dom.window.document.getElementById("azsv-chat-panel");
  assert.equal(chatControls.length, 1);
  assert.equal(chatControls[0].getAttribute("aria-expanded"), "false");
  assert.equal(chatPanel.hidden, true);
  assert.deepEqual(snapshots.at(-1), {
    pageKind: "station-player",
    playerPresent: true,
    mainStreamSelected: true,
    layout: "desktop",
  });
  chatControls[0].click();
  assert.deepEqual(toggles, [true]);

  adapter.dispose();
});

test("adapter removes native UI when the station player disappears", async () => {
  const dom = playerFixture();
  const adapter = createPublicPlayerAdapter({ window: dom.window, document: dom.window.document });
  adapter.install({});

  dom.window.document.getElementById("public-radio-player").remove();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(dom.window.document.getElementById("azsv-player-controls"), null);
  assert.equal(dom.window.document.getElementById("azsv-chat-panel"), null);

  dom.window.document.body.insertAdjacentHTML("beforeend", "<div id='public-radio-player'><section class='replacement-panel'><div class='radio-player-widget'></div></section></div>");
  dom.window.document.querySelector(".replacement-panel").getBoundingClientRect = () => ({ left: 20, top: 20, right: 620, bottom: 250, width: 600, height: 230 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll("#azsv-player-controls").length, 1);
  assert.equal(dom.window.document.querySelectorAll("#azsv-chat-panel").length, 1);

  adapter.dispose();
  dom.window.document.querySelector(".replacement-panel").appendChild(dom.window.document.createElement("div"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dom.window.document.getElementById("azsv-player-controls"), null);
});

test("adapter renders chat as plain text and forwards chat actions", () => {
  const dom = playerFixture();
  dom.window.document.querySelector(".now-playing-main").getBoundingClientRect = () => ({ left: 136, top: 40, right: 536, bottom: 80, width: 400, height: 40 });
  dom.window.document.querySelector(".radio-player-widget").getBoundingClientRect = () => ({ left: 136, top: 160, right: 536, bottom: 180, width: 400, height: 20 });
  const events = [];
  const adapter = createPublicPlayerAdapter({ window: dom.window, document: dom.window.document });
  adapter.install({
    onChatToggle(open) { events.push(["toggle", open]); },
    onChatSubmit(message) { events.push(["submit", message]); },
  });

  adapter.render({
    voting: { visible: true, upvotes: 2, downvotes: 1, myVote: null },
    chat: {
      visible: true,
      open: true,
      nickname: "a1b2c3",
      messages: [
        { id: 7, nickname: "d4e5f6", body: "<img src=x onerror=alert(1)>", created_at: new Date(2026, 6, 17, 10, 0).toISOString() },
        { id: 8, nickname: "a1b2c3", body: "Newest", created_at: new Date(2026, 6, 17, 10, 5).toISOString() },
      ],
      pending: false,
      error: "",
    },
  });

  const panel = dom.window.document.getElementById("azsv-chat-panel");
  const postingAs = panel.querySelector("[data-posting-as]").parentElement;
  const form = panel.querySelector("form");
  const messages = panel.querySelector("[data-chat-messages]");
  assert.equal(panel.hidden, false);
  assert.equal(dom.window.document.getElementById("azsv-chat-link").getAttribute("aria-expanded"), "true");
  assert.equal(panel.querySelector("[data-chat-nickname]").textContent, "a1b2c3");
  assert.equal(postingAs.nextElementSibling, form);
  assert.equal(form.nextElementSibling, messages);
  assert.equal(panel.querySelector("[data-message-id='7'] [data-chat-body]").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(panel.querySelector("img"), null);
  assert.deepEqual(Array.from(panel.querySelectorAll(".azsv-chat-message")).map((message) => message.dataset.messageId), ["8", "7"]);
  assert.equal(panel.querySelector(".azsv-chat-message [data-chat-timestamp]").textContent, "07.17 10:05");
  assert.equal(panel.querySelector(".azsv-chat-message [data-chat-timestamp]").className, "azsv-chat-timestamp");
  assert.match(dom.window.document.getElementById("azsv-player-adapter-style").textContent, /\.azsv-chat-message\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(dom.window.document.getElementById("azsv-player-adapter-style").textContent, /#azsv-chat-panel form\{margin:10px 0 8px\}#azsv-chat-panel input\{padding:4px\}#azsv-chat-panel \[data-chat-submit\]\{padding:4px 9px/);
  assert.equal(dom.window.document.getElementById("azsv-song-vote-overlay").style.top, "143px");

  const input = panel.querySelector("[data-chat-input]");
  input.value = "Hello back";
  panel.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  panel.querySelector("[data-chat-close]").click();
  assert.deepEqual(events, [["submit", "Hello back"], ["toggle", false]]);

  adapter.dispose();
});

test("adapter renders structured, safe ratings rows", () => {
  const dom = playerFixture();
  const adapter = createPublicPlayerAdapter({ window: dom.window, document: dom.window.document });
  adapter.install({});

  adapter.render({
    ratings: {
      visible: true,
      open: true,
      sections: [{
        title: "Top rated",
        songs: [{
          title: "A very long <strong>title</strong> that must not run into the vote totals",
          artist: "Artist name",
          upvotes: 12,
          downvotes: 3,
        }],
      }],
    },
  });

  const panel = dom.window.document.getElementById("azsv-ratings-panel");
  const row = panel.querySelector(".azsv-ratings-row");
  assert.equal(panel.querySelector(".azsv-ratings-title").textContent, "Song ratings");
  assert.equal(panel.querySelector(".azsv-ratings-close").getAttribute("aria-label"), "Close ratings");
  assert.equal(row.querySelector(".azsv-ratings-main").textContent, "A very long <strong>title</strong> that must not run into the vote totals");
  assert.equal(row.querySelector(".azsv-ratings-sub").textContent, "Artist name");
  assert.equal(row.querySelector(".azsv-rating-up").textContent, "+12");
  assert.equal(row.querySelector(".azsv-rating-down").textContent, "-3");
  assert.equal(row.querySelector("strong strong"), null);
  assert.match(dom.window.document.getElementById("azsv-player-adapter-style").textContent, /grid-template-columns:minmax\(0,1fr\) auto/);

  adapter.render({ ratings: { visible: true, open: true, hideDownvotes: true, sections: [{ title: "Top rated", songs: [{ title: "Title", artist: "Artist", upvotes: 1, downvotes: 1 }] }] } });
  assert.equal(panel.querySelector(".azsv-rating-down"), null);

  adapter.dispose();
});

test("adapter reports secondary-stream selection while keeping station chat available", () => {
  const dom = playerFixture();
  const adapter = createPublicPlayerAdapter({ window: dom.window, document: dom.window.document });
  const snapshots = [];
  adapter.install({});
  adapter.observe((snapshot) => snapshots.push(snapshot));
  adapter.render({
    voting: { visible: true, upvotes: 4, downvotes: 1, myVote: 1 },
    ratings: { visible: true, open: false },
    chat: { visible: true, open: false, messages: [] },
  });

  const select = dom.window.document.querySelector("select");
  select.selectedIndex = 1;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  adapter.render({
    voting: { visible: false },
    ratings: { visible: false, open: false },
    chat: { visible: true, open: false, messages: [] },
  });

  assert.equal(snapshots.at(-1).mainStreamSelected, false);
  assert.equal(dom.window.document.getElementById("azsv-song-vote-overlay").hidden, true);
  assert.equal(dom.window.document.getElementById("azsv-ratings-link").hidden, true);
  assert.equal(dom.window.document.getElementById("azsv-chat-link").hidden, false);

  adapter.dispose();
  assert.equal(dom.window.document.getElementById("azsv-player-controls"), null);
  assert.equal(dom.window.document.getElementById("azsv-chat-panel"), null);
});

test("adapter preserves the standalone voting fallback outside AzuraCast public pages", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body><main></main></body></html>", { url: "https://site.example/listen" });
  const adapter = createPublicPlayerAdapter({
    window: dom.window,
    document: dom.window.document,
    config: { widgetUrl: "https://radio.example/votes/widget" },
  });

  adapter.install({});

  const widget = dom.window.document.getElementById("azsv-song-vote-widget");
  assert.equal(widget.querySelector("iframe").src, "https://radio.example/votes/widget");
  adapter.dispose();
  assert.equal(dom.window.document.getElementById("azsv-song-vote-widget"), null);
});

test("adapter classifies and positions a portrait mobile player", () => {
  const dom = playerFixture();
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 844 });
  dom.window.matchMedia = () => ({ matches: true });
  const adapter = createPublicPlayerAdapter({ window: dom.window, document: dom.window.document });
  let currentSnapshot;

  adapter.install({});
  adapter.observe((snapshot) => { currentSnapshot = snapshot; });

  assert.equal(currentSnapshot.layout, "mobile");
  assert.equal(dom.window.document.getElementById("azsv-song-vote-overlay").classList.contains("azsv-mobile"), true);
  assert.equal(dom.window.document.getElementById("azsv-chat-panel").style.left, "14px");
  adapter.dispose();
});

test("public embed loads chat on open, posts, and stops polling on close", async () => {
  const dom = playerFixture();
  const calls = [];
  const intervals = new Map();
  const cleared = [];
  let nextIntervalId = 0;
  dom.window.AZSV_CONFIG = {
    apiBase: "https://radio.example/votes/api/",
    widgetUrl: "https://radio.example/votes/widget",
  };
  dom.window.AzuraVotePublicPlayerAdapter = { createPublicPlayerAdapter };
  dom.window.setInterval = (callback, milliseconds) => {
    const id = ++nextIntervalId;
    intervals.set(id, { callback, milliseconds });
    return id;
  };
  dom.window.clearInterval = (id) => {
    cleared.push(id);
    intervals.delete(id);
  };
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    let body;
    if (String(url).endsWith("/config")) body = { hidePublicDownvotes: false };
    else if (String(url).endsWith("/now-playing")) body = { stream_active: true, song: { song_key: "song-1" }, votes: { upvotes: 2, downvotes: 0, my_vote: null } };
    else if (String(url).includes("/chat/messages?") ) body = { ok: true, nickname: "a1b2c3", messages: [{ id: 1, nickname: "d4e5f6", body: "Welcome", created_at: "2026-07-17T10:00:00.000Z" }], latest_id: 1 };
    else if (String(url).endsWith("/chat/messages") && options.method === "POST") body = { ok: true, message: { id: 2, nickname: "a1b2c3", body: "Hello", created_at: "2026-07-17T10:01:00.000Z" } };
    else body = { songs: [] };
    return { ok: true, status: options.method === "POST" ? 201 : 200, async json() { return body; } };
  };

  const source = fs.readFileSync(path.join(__dirname, "..", "public", "embed.js"), "utf8");
  dom.window.eval(source);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  dom.window.document.getElementById("azsv-chat-link").click();
  await new Promise((resolve) => setImmediate(resolve));
  const panel = dom.window.document.getElementById("azsv-chat-panel");
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector("[data-chat-nickname]").textContent, "a1b2c3");
  assert.equal(panel.querySelector("[data-chat-body]").textContent, "Welcome");
  assert.equal(Array.from(intervals.values()).some((entry) => entry.milliseconds === 5000), true);

  const incrementalPoll = Array.from(intervals.values()).find((entry) => entry.milliseconds === 5000);
  incrementalPoll.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some((call) => call.url.endsWith("/chat/messages?after=1&limit=100")), true);

  panel.querySelector("[data-chat-input]").value = "Hello";
  panel.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some((call) => call.options.method === "POST" && call.url.endsWith("/chat/messages")), true);
  assert.equal(panel.textContent.includes("Hello"), true);
  assert.equal(panel.querySelector("[data-chat-input]").value, "");

  const chatIntervalId = Array.from(intervals.entries()).find((entry) => entry[1].milliseconds === 5000)[0];
  panel.querySelector("[data-chat-close]").click();
  assert.equal(cleared.includes(chatIntervalId), true);
  assert.equal(panel.hidden, true);

  dom.window.dispatchEvent(new dom.window.Event("beforeunload"));
  assert.equal(intervals.size, 0);
  assert.equal(dom.window.document.getElementById("azsv-player-controls"), null);
});
