const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const { normalizeSong, mainStreamActive } = require("../azuracast");
const { openDatabase, migrate, createStore } = require("../db");
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

test("chat migration is additive and idempotent for an existing voting database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azsv-legacy-"));
  const db = new Database(path.join(dir, "votes.sqlite"));
  db.exec(`
    create table songs (
      id integer primary key autoincrement,
      azuracast_song_id text,
      song_key text not null unique,
      artist text not null,
      title text not null,
      album text,
      art_url text,
      first_seen_at text not null,
      last_seen_at text not null
    );
    create table votes (
      id integer primary key autoincrement,
      song_id integer not null,
      voter_hash text not null,
      vote_value integer not null check (vote_value in (1, -1)),
      created_at text not null,
      updated_at text not null,
      unique(song_id, voter_hash)
    );
    insert into songs (song_key, artist, title, first_seen_at, last_seen_at)
      values ('legacy', 'Artist', 'Title', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    insert into votes (song_id, voter_hash, vote_value, created_at, updated_at)
      values (1, 'listener', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);

  migrate(db);
  migrate(db);

  assert.equal(db.prepare("select count(*) as count from votes").get().count, 1);
  assert.deepEqual(
    db.prepare("select name from pragma_table_info('chat_messages') order by cid").all().map((row) => row.name),
    ["id", "voter_hash", "voter_ip", "body", "created_at"]
  );
  assert.deepEqual(
    db.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'chat_messages' and name like 'chat_messages_%' order by name").all().map((row) => row.name),
    ["chat_messages_created_at_idx", "chat_messages_voter_hash_idx"]
  );
  db.close();
});
