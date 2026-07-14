const crypto = require("crypto");

function getClientIp(req) {
  const forwardedFor = req.headers?.["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstForwardedIp = String(forwardedIp || "").split(",")[0].trim();
  if (firstForwardedIp) return firstForwardedIp;

  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

  return req.ip || req.socket?.remoteAddress || "";
}

function getVoterHash(req, secret) {
  return crypto.createHmac("sha256", secret).update(getClientIp(req)).digest("hex");
}

function sanitizeSong(row) {
  if (!row) return null;
  return {
    id: row.id,
    song_key: row.song_key,
    azuracast_song_id: row.azuracast_song_id,
    artist: row.artist,
    title: row.title,
    album: row.album,
    art_url: row.art_url,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
  };
}

function createVotingService(store, azuracastClient) {
  async function currentSong() {
    const result = await azuracastClient.getNowPlaying();
    if (!result.ok) return result;
    if (result.streamActive === false) {
      return { ok: true, streamActive: false, song: null, normalized: result.song };
    }
    const row = store.upsertSong(result.song);
    return { ok: true, streamActive: true, song: row, normalized: result.song };
  }

  async function submitVote({ songKey, voteValue, voterHash, voterIp }) {
    if (![1, -1].includes(voteValue)) {
      const error = new Error("Vote must be 1 or -1");
      error.status = 400;
      throw error;
    }

    const current = await currentSong();
    if (!current.ok) {
      const error = new Error(current.error || "Unable to load current song");
      error.status = 503;
      throw error;
    }
    if (current.streamActive === false) {
      const error = new Error("Main stream is not active");
      error.status = 409;
      throw error;
    }

    let song = songKey ? store.getSongByKey(songKey) : null;
    if (!song) {
      if (songKey && current.song.song_key !== songKey) {
        const error = new Error("Unknown song");
        error.status = 404;
        throw error;
      }
      song = current.song;
    }

    store.voteOnSong(song.id, voterHash, voteValue, voterIp);
    return { song, votes: store.getVoteTotals(song.id, voterHash), streamActive: true };
  }

  return { currentSong, submitVote };
}

module.exports = { createVotingService, getClientIp, getVoterHash, sanitizeSong };
