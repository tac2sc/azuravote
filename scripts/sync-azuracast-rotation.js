#!/usr/bin/env node
require("dotenv").config();

const Database = require("better-sqlite3");
const { config } = require("../config");
const { migrate } = require("../db");
const { normalizeText } = require("../azuracast");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const verbose = args.has("--verbose") || args.has("-v");

const highThreshold = intEnv("ROTATION_HIGH_SCORE", 2);
const lowThreshold = intEnv("ROTATION_LOW_SCORE", -2);
const blockDays = intEnv("ROTATION_BLOCK_DAYS", 7);
const highPlaylistId = process.env.AZURACAST_HIGH_PLAYLIST_ID || "";
const lowPlaylistId = process.env.AZURACAST_LOW_PLAYLIST_ID || "";
const station = cleanPart(config.azuracast.stationId || config.azuracast.stationShortName);

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}


function cleanPart(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function keyText(value) {
  return normalizeText(value).toLowerCase();
}

function mediaText(media) {
  return normalizeText(media.text || media.title || media.name || [media.artist, media.title].filter(Boolean).join(" - "));
}

function songLabel(song) {
  return `${song.artist || "Unknown artist"} - ${song.title || "Unknown song"}`;
}

function mediaLabel(media) {
  return mediaText(media) || media.path || media.unique_id || media.id || "unknown media";
}

function mediaId(media) {
  return media.unique_id || media.id || media.media_id || media.song_id || "";
}

function playlistId(value) {
  if (value && typeof value === "object") return String(value.id || value.playlist_id || value.value || "");
  return String(value || "");
}

function getMediaPlaylistIds(media) {
  const source = Array.isArray(media.playlists)
    ? media.playlists
    : Array.isArray(media.playlist_ids)
      ? media.playlist_ids
      : [];
  return source.map(playlistId).filter(Boolean);
}

function playlistPayloadIds(ids) {
  return ids.map((id) => /^\d+$/.test(String(id)) ? Number(id) : String(id));
}

function playlistPayloadObjects(ids) {
  return playlistPayloadIds(ids).map((id) => ({ id }));
}

function matchMedia(song, mediaList) {
  const azId = normalizeText(song.azuracast_song_id);
  if (azId) {
    const exact = mediaList.find((media) => [media.song_id, media.unique_id, media.id].some((value) => normalizeText(value) === azId));
    if (exact) return exact;
  }

  const artist = keyText(song.artist);
  const title = keyText(song.title);
  return mediaList.find((media) => {
    const mediaArtist = keyText(media.artist);
    const mediaTitle = keyText(media.title);
    if (mediaArtist && mediaTitle && mediaArtist === artist && mediaTitle === title) return true;
    const text = keyText(mediaText(media));
    return text && artist && title && text.includes(artist) && text.includes(title);
  }) || null;
}

function ensureRotationTable(db) {
  db.exec(`
    create table if not exists song_rotation_rules (
      song_id integer primary key,
      rotation_status text not null,
      blocked_until text,
      updated_at text not null,
      restore_playlist_ids text,
      last_error text,
      foreign key (song_id) references songs(id) on delete cascade
    );
  `);
  const columns = db.prepare("pragma table_info(song_rotation_rules)").all().map((column) => column.name);
  if (!columns.includes("restore_playlist_ids")) {
    db.exec("alter table song_rotation_rules add column restore_playlist_ids text");
  }
}

function getScoredSongs(db) {
  return db.prepare(`
    select s.*,
      coalesce(sum(case when v.vote_value = 1 then 1 else 0 end), 0) as upvotes,
      coalesce(sum(case when v.vote_value = -1 then 1 else 0 end), 0) as downvotes,
      coalesce(sum(v.vote_value), 0) as score
    from songs s left join votes v on v.song_id = s.id
    group by s.id
    having score >= ? or score <= ?
    order by score desc, s.last_seen_at desc
  `).all(highThreshold, lowThreshold);
}

function getRule(db, songId) {
  return db.prepare("select * from song_rotation_rules where song_id = ?").get(songId);
}

function saveRule(db, song, status, blockedUntil = null, error = null, restorePlaylistIds = null) {
  db.prepare(`
    insert into song_rotation_rules (song_id, rotation_status, blocked_until, updated_at, restore_playlist_ids, last_error)
    values (?, ?, ?, ?, ?, ?)
    on conflict(song_id) do update set
      rotation_status = excluded.rotation_status,
      blocked_until = excluded.blocked_until,
      updated_at = excluded.updated_at,
      restore_playlist_ids = excluded.restore_playlist_ids,
      last_error = excluded.last_error
  `).run(song.id, status, blockedUntil, nowIso(), restorePlaylistIds ? JSON.stringify(restorePlaylistIds) : null, error);
}

async function azFetch(path, options = {}) {
  if (!config.azuracast.baseUrl) throw new Error("AZURACAST_BASE_URL is required");
  if (!config.azuracast.apiKey) throw new Error("AZURACAST_API_KEY is required for playlist/media sync");

  const url = `${config.azuracast.baseUrl}${path}`;
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${config.azuracast.apiKey}`,
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  if (verbose) console.log(`${options.method || "GET"} ${url}`);
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const error = new Error(`AzuraCast HTTP ${response.status} for ${path}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function unwrapRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.files)) return data.files;
  return [];
}

async function listMedia() {
  const stationPath = encodeURIComponent(station);
  const paths = [
    `/api/station/${stationPath}/files`,
    `/api/station/${stationPath}/files/list`,
  ];
  const errors = [];
  for (const path of paths) {
    try {
      const rows = unwrapRows(await azFetch(path));
      if (rows.length || path === paths[paths.length - 1]) return rows;
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
    }
  }
  throw new Error(`Unable to list AzuraCast media files. Tried: ${errors.join("; ")}`);
}

async function updateMediaPlaylists(media, playlistIds) {
  const id = mediaId(media);
  if (!id) throw new Error(`No AzuraCast media id for ${mediaLabel(media)}`);
  const stationPath = encodeURIComponent(station);
  const idPath = encodeURIComponent(id);
  const path = `/api/station/${stationPath}/file/${idPath}`;
  const ids = playlistPayloadIds(playlistIds);
  const playlistObjects = playlistPayloadObjects(playlistIds);
  const attempts = [
    { method: "PUT", body: { playlists: ids } },
    { method: "PUT", body: { playlist_ids: ids } },
    { method: "PUT", body: { playlists: playlistObjects } },
    { method: "PATCH", body: { playlists: ids } },
    { method: "PATCH", body: { playlist_ids: ids } },
    { method: "PATCH", body: { playlists: playlistObjects } },
  ];

  if (!apply) {
    console.log(`[dry-run] PUT ${path}`);
    console.log(`[dry-run] playlists=${ids.join(",") || "(none)"}`);
    return;
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      await azFetch(path, { method: attempt.method, body: JSON.stringify(attempt.body) });
      return;
    } catch (error) {
      errors.push(`${attempt.method} ${Object.keys(attempt.body).join("/")}: ${error.message}`);
      if (verbose && error.body) console.log(error.body);
    }
  }
  throw new Error(`Unable to update AzuraCast playlists for ${mediaLabel(media)}. Tried: ${errors.join("; ")}`);
}

function unique(values) {
  return [...new Set(values.map(String).filter(Boolean))];
}

async function processSong(db, song, media) {
  const current = getMediaPlaylistIds(media);
  const existingRule = getRule(db, song.id);
  const score = Number(song.score || 0);
  const label = songLabel(song);

  if (score >= highThreshold) {
    if (!highPlaylistId) {
      console.log(`[skip] ${label}: score ${score}, AZURACAST_HIGH_PLAYLIST_ID is not set`);
      return;
    }
    const next = unique([...current, highPlaylistId]);
    console.log(`[high] ${label}: score ${score}, add to playlist ${highPlaylistId}`);
    await updateMediaPlaylists(media, next);
    saveRule(db, song, "high_rotation", null, null);
    return;
  }

  if (score <= lowThreshold) {
    if (!lowPlaylistId) {
      console.log(`[skip] ${label}: score ${score}, AZURACAST_LOW_PLAYLIST_ID is not set`);
      return;
    }

    const activeBlock = existingRule?.rotation_status === "blocked"
      && existingRule.blocked_until
      && new Date(existingRule.blocked_until) > new Date();
    const removeIds = highPlaylistId ? [highPlaylistId] : [];
    const hasLowPlaylist = current.includes(String(lowPlaylistId));
    const hasRemovedPlaylist = current.some((id) => removeIds.includes(String(id)));
    const blockedUntil = activeBlock ? existingRule.blocked_until : addDaysIso(blockDays);

    if (activeBlock && hasLowPlaylist && !hasRemovedPlaylist) {
      console.log(`[skip] ${label}: already blocked until ${existingRule.blocked_until}`);
      return;
    }

    const next = unique([...current.filter((id) => !removeIds.includes(String(id))), lowPlaylistId]);
    const action = activeBlock ? "repair block" : "block";
    console.log(`[${action}] ${label}: score ${score}, add to low playlist ${lowPlaylistId}, blocked until ${blockedUntil}`);
    await updateMediaPlaylists(media, next);
    saveRule(db, song, "blocked", blockedUntil, null, [lowPlaylistId]);
  }
}

async function main() {
  if (!station) throw new Error("AZURACAST_STATION_ID or AZURACAST_STATION_SHORT_NAME is required");

  const db = new Database(config.databasePath);
  db.pragma("foreign_keys = ON");
  migrate(db);
  ensureRotationTable(db);

  const songs = getScoredSongs(db);
  console.log(`rotation sync: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`rules: high >= ${highThreshold}, low <= ${lowThreshold}, block ${blockDays} days`);
  console.log(`candidate songs: ${songs.length}`);
  if (!songs.length) return;

  const mediaList = await listMedia();
  console.log(`azuracast media files: ${mediaList.length}`);

  for (const song of songs) {
    const media = matchMedia(song, mediaList);
    if (!media) {
      const message = "No matching AzuraCast media file";
      console.log(`[missing] ${songLabel(song)}: ${message}`);
      saveRule(db, song, "unmatched", null, message);
      continue;
    }
    try {
      await processSong(db, song, media);
    } catch (error) {
      console.log(`[error] ${songLabel(song)}: ${error.message}`);
      if (verbose && error.body) console.log(error.body);
      saveRule(db, song, "error", null, error.message);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  if (verbose && error.stack) console.error(error.stack);
  process.exitCode = 1;
});
