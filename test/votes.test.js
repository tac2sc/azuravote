const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { normalizeSong, mainStreamActive } = require("../azuracast");
const { openDatabase, createStore } = require("../db");
const { getVoterHash } = require("../votes");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azsv-"));
  const db = openDatabase(path.join(dir, "votes.sqlite"));
  return createStore(db);
}

test("song key normalization prefers AzuraCast song id", () => {
  const song = normalizeSong({ now_playing: { song: { id: "abc123", artist: " Artist ", title: " Title " } } });
  assert.equal(song.song_key, "az:abc123");
  assert.equal(song.artist, "Artist");
  assert.equal(song.title, "Title");
});

test("song key falls back to normalized artist and title", () => {
  const song = normalizeSong({ now_playing: { song: { artist: "  THE  BAND ", title: " A  Song " } } });
  assert.equal(song.song_key, "meta:the band::a song");
});


test("main stream active uses AzuraCast online flag", () => {
  assert.equal(mainStreamActive({ is_online: true }), true);
  assert.equal(mainStreamActive({ is_online: false }), false);
});

test("main stream active uses first mount when no direct flag exists", () => {
  assert.equal(mainStreamActive({ mounts: [{ is_active: false }, { is_active: true }] }), false);
  assert.equal(mainStreamActive({ mounts: [{ status: "online" }] }), true);
});
test("voter hash ignores user-agent", () => {
  const reqA = { ip: "203.0.113.10", get: () => "Browser A" };
  const reqB = { ip: "203.0.113.10", get: () => "curl/8" };
  assert.equal(getVoterHash(reqA, "secret"), getVoterHash(reqB, "secret"));
});

test("one vote per listener per song", () => {
  const store = tempStore();
  const song = store.upsertSong(normalizeSong({ song: { artist: "A", title: "B" } }));
  store.voteOnSong(song.id, "listener", 1);
  store.voteOnSong(song.id, "listener", 1);
  assert.deepEqual(store.getVoteTotals(song.id, "listener"), { upvotes: 1, downvotes: 0, score: 1, my_vote: 1 });
});

test("changing vote updates existing row", () => {
  const store = tempStore();
  const song = store.upsertSong(normalizeSong({ song: { artist: "A", title: "B" } }));
  store.voteOnSong(song.id, "listener", 1);
  store.voteOnSong(song.id, "listener", -1);
  assert.deepEqual(store.getVoteTotals(song.id, "listener"), { upvotes: 0, downvotes: 1, score: -1, my_vote: -1 });
});

test("vote totals are correct for multiple listeners", () => {
  const store = tempStore();
  const song = store.upsertSong(normalizeSong({ song: { artist: "A", title: "B" } }));
  store.voteOnSong(song.id, "one", 1);
  store.voteOnSong(song.id, "two", 1);
  store.voteOnSong(song.id, "three", -1);
  assert.deepEqual(store.getVoteTotals(song.id, "one"), { upvotes: 2, downvotes: 1, score: 1, my_vote: 1 });
});

test("invalid vote value is rejected", () => {
  const store = tempStore();
  const song = store.upsertSong(normalizeSong({ song: { artist: "A", title: "B" } }));
  assert.throws(() => store.voteOnSong(song.id, "listener", 0), /Invalid vote value/);
});
