const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    create table if not exists songs (
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
    create table if not exists votes (
      id integer primary key autoincrement,
      song_id integer not null,
      voter_hash text not null,
      vote_value integer not null check (vote_value in (1, -1)),
      created_at text not null,
      updated_at text not null,
      foreign key (song_id) references songs(id) on delete cascade,
      unique(song_id, voter_hash)
    );
    create index if not exists votes_song_id_idx on votes(song_id);
    create index if not exists votes_voter_hash_idx on votes(voter_hash);
    create index if not exists songs_song_key_idx on songs(song_key);
    create index if not exists songs_last_seen_at_idx on songs(last_seen_at);
    create table if not exists song_rotation_rules (
      song_id integer primary key,
      rotation_status text not null,
      blocked_until text,
      updated_at text not null,
      restore_playlist_ids text,
      last_error text,
      foreign key (song_id) references songs(id) on delete cascade
    );
    create table if not exists chat_messages (
      id integer primary key autoincrement,
      voter_hash text not null,
      voter_ip text,
      body text not null check (length(body) between 1 and 200),
      created_at text not null
    );
    create index if not exists chat_messages_voter_hash_idx on chat_messages(voter_hash);
    create index if not exists chat_messages_created_at_idx on chat_messages(created_at);
  `);

  const voterIpColumn = db.prepare("select 1 from pragma_table_info('votes') where name = 'voter_ip'").get();
  if (!voterIpColumn) db.exec("alter table votes add column voter_ip text");
}

function createStore(db) {
  const insertSongStmt = db.prepare(`
    insert or ignore into songs (azuracast_song_id, song_key, artist, title, album, art_url, first_seen_at, last_seen_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateSongStmt = db.prepare(`
    update songs set
      azuracast_song_id = coalesce(?, azuracast_song_id),
      artist = ?,
      title = ?,
      album = ?,
      art_url = ?,
      last_seen_at = ?
    where song_key = ?
  `);
  const getByKeyStmt = db.prepare("select * from songs where song_key = ?");
  const totalsStmt = db.prepare(`
    select
      coalesce(sum(case when vote_value = 1 then 1 else 0 end), 0) as upvotes,
      coalesce(sum(case when vote_value = -1 then 1 else 0 end), 0) as downvotes
    from votes where song_id = ?
  `);
  const myVoteStmt = db.prepare("select vote_value from votes where song_id = ? and voter_hash = ?");
  const insertVoteStmt = db.prepare(`
    insert or ignore into votes (song_id, voter_hash, voter_ip, vote_value, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?)
  `);
  const updateVoteStmt = db.prepare(`
    update votes set vote_value = ?, voter_ip = ?, updated_at = ?
    where song_id = ? and voter_hash = ?
  `);
  const insertChatMessageStmt = db.prepare(`
    insert into chat_messages (voter_hash, voter_ip, body, created_at)
    values (?, ?, ?, ?)
  `);
  const getChatMessageStmt = db.prepare("select * from chat_messages where id = ?");

  function upsertSong(song) {
    const now = new Date().toISOString();
    insertSongStmt.run(
      song.azuracast_song_id,
      song.song_key,
      song.artist,
      song.title,
      song.album,
      song.art_url,
      now,
      now
    );
    updateSongStmt.run(
      song.azuracast_song_id,
      song.artist,
      song.title,
      song.album,
      song.art_url,
      now,
      song.song_key
    );
    return getByKeyStmt.get(song.song_key);
  }

  function getSongByKey(songKey) {
    return getByKeyStmt.get(songKey);
  }

  function voteOnSong(songId, voterHash, voteValue, voterIp = null) {
    if (![1, -1].includes(voteValue)) throw new Error("Invalid vote value");
    const now = new Date().toISOString();
    insertVoteStmt.run(songId, voterHash, voterIp, voteValue, now, now);
    updateVoteStmt.run(voteValue, voterIp, now, songId, voterHash);
  }

  function getVoteTotals(songId, voterHash = "") {
    const totals = totalsStmt.get(songId);
    const mine = voterHash ? myVoteStmt.get(songId, voterHash) : null;
    const upvotes = Number(totals.upvotes || 0);
    const downvotes = Number(totals.downvotes || 0);
    return { upvotes, downvotes, score: upvotes - downvotes, my_vote: mine ? mine.vote_value : null };
  }

  function listRecent(limit) {
    return db.prepare(`
      select s.*, 
        coalesce(sum(case when v.vote_value = 1 then 1 else 0 end), 0) as upvotes,
        coalesce(sum(case when v.vote_value = -1 then 1 else 0 end), 0) as downvotes
      from songs s left join votes v on v.song_id = s.id
      group by s.id order by s.last_seen_at desc limit ?
    `).all(limit).map(withScore);
  }

  function listRanked(limit, direction) {
    const order = direction === "bottom" ? "asc" : "desc";
    return db.prepare(`
      select s.*,
        coalesce(sum(case when v.vote_value = 1 then 1 else 0 end), 0) as upvotes,
        coalesce(sum(case when v.vote_value = -1 then 1 else 0 end), 0) as downvotes,
        coalesce(sum(v.vote_value), 0) as score
      from songs s left join votes v on v.song_id = s.id
      group by s.id order by score ${order}, s.last_seen_at desc limit ?
    `).all(limit).map(withScore);
  }

  function exportRows() {
    return listRanked(100000, "top");
  }

  function createChatMessage(voterHash, voterIp, body) {
    const createdAt = new Date().toISOString();
    const result = insertChatMessageStmt.run(voterHash, voterIp || null, body, createdAt);
    return getChatMessageStmt.get(result.lastInsertRowid);
  }

  function listChatMessages({ after = 0, limit = 50 } = {}) {
    if (after > 0) {
      return db.prepare("select * from chat_messages where id > ? order by id asc limit ?").all(after, limit);
    }
    return db.prepare(`
      select * from (
        select * from chat_messages order by id desc limit ?
      ) order by id asc
    `).all(limit);
  }

  return { db, upsertSong, getSongByKey, voteOnSong, getVoteTotals, listRecent, listRanked, exportRows, createChatMessage, listChatMessages };
}

function withScore(row) {
  const upvotes = Number(row.upvotes || 0);
  const downvotes = Number(row.downvotes || 0);
  return { ...row, upvotes, downvotes, score: Number(row.score ?? upvotes - downvotes) };
}

module.exports = { openDatabase, migrate, createStore };
