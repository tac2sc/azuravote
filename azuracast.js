//added abort id not mainStreamActive()

function cleanPart(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function normalizeText(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || ["unknown", "n/a", "na", "-", "null", "undefined"].includes(text.toLowerCase())) {
    return "";
  }
  return text;
}

function keyText(value) {
  return normalizeText(value).toLowerCase();
}

function splitSongText(text) {
  const cleaned = normalizeText(text);
  if (!cleaned) return { artist: "", title: "" };
  const match = cleaned.match(/^(.+?)\s+-\s+(.+)$/);
  if (match) return { artist: normalizeText(match[1]), title: normalizeText(match[2]) };
  return { artist: "", title: cleaned };
}

function booleanFromStatus(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const text = normalizeText(value).toLowerCase();
  if (["online", "active", "up", "running", "playing", "true", "yes", "1"].includes(text)) return true;
  if (["offline", "inactive", "down", "stopped", "false", "no", "0"].includes(text)) return false;
  return null;
}

function firstKnownBoolean(values) {
  for (const value of values) {
    const result = booleanFromStatus(value);
    if (result !== null) return result;
  }
  return null;
}

function mainStreamActive(raw) {
  if (!raw || typeof raw !== "object") return true;
  const direct = firstKnownBoolean([
    raw.is_online,
    raw.online,
    raw.isOnline,
    raw.is_streaming,
    raw.isStreaming,
    raw.status,
    raw.station?.is_online,
    raw.station?.online,
    raw.station?.status,
    raw.stream?.is_active,
    raw.stream?.is_online,
    raw.stream?.online,
    raw.stream?.status,
  ]);
  if (direct !== null) return direct;

  const streams = raw.mounts || raw.streams || raw.station?.mounts || raw.station?.streams || raw.station?.mount_points;
  if (Array.isArray(streams) && streams.length) {
    const main = streams.find((stream) => stream && (stream.is_default || stream.default || stream.name === "/radio.mp3" || stream.path === "/radio.mp3")) || streams[0];
    const streamStatus = firstKnownBoolean([
      main?.is_active,
      main?.is_online,
      main?.online,
      main?.connected,
      main?.status,
    ]);
    if (streamStatus !== null) return streamStatus;
  }

  return true;
}

function getCurrentSongPayload(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw.now_playing && raw.now_playing.song) return raw.now_playing.song;
  if (raw.song && typeof raw.song === "object") return raw.song;
  if (raw.current_song && typeof raw.current_song === "object") return raw.current_song;
  return raw;
}

function normalizeSong(raw) {
  const payload = getCurrentSongPayload(raw);
  const songText = normalizeText(payload.text || payload.title || raw?.now_playing?.song?.text);
  const split = splitSongText(songText);
  const artist = normalizeText(payload.artist) || split.artist || "Unknown artist";
  const title = normalizeText(payload.title) || split.title || songText || "Unknown song";
  const azuracastSongId = normalizeText(payload.id || payload.song_id || payload.unique_id || payload.custom_fields?.id) || null;
  const album = normalizeText(payload.album) || null;
  const artUrl = normalizeText(payload.art || payload.art_url || payload.album_art || payload.thumbnail) || null;
  const playedAt = Number(raw?.now_playing?.played_at || raw?.played_at || payload.played_at) || null;
  const duration = Number(payload.duration || raw?.now_playing?.duration || raw?.duration) || null;
  const fallbackKey = `${keyText(artist)}::${keyText(title)}`.replace(/^::|::$/g, "");
  const songKey = azuracastSongId ? `az:${azuracastSongId}` : `meta:${fallbackKey || keyText(songText) || "unknown-song"}`;

  return {
    azuracast_song_id: azuracastSongId,
    song_key: songKey,
    artist,
    title,
    album,
    art_url: artUrl,
    played_at: playedAt,
    duration,
    raw,
  };
}

class AzuraCastClient {
  constructor(config, fetchImpl = global.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  endpointCandidates() {
    const { stationId, stationShortName } = this.config;
    const ids = [stationId, stationShortName].filter(Boolean).map(cleanPart);
    const candidates = ["/api/nowplaying"];
    for (const id of ids) candidates.push(`/api/nowplaying/${encodeURIComponent(id)}`);
    for (const id of ids) candidates.push(`/api/station/${encodeURIComponent(id)}/status`);
    return [...new Set(candidates)];
  }

  async fetchJson(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs || 5000);
    try {
      const headers = { accept: "application/json" };
      if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
      const response = await this.fetch(`${this.config.baseUrl}${path}`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`AzuraCast returned HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  selectStationFromNowPlaying(data) {
    if (!Array.isArray(data)) return data;
    const { stationId, stationShortName } = this.config;
    return data.find((item) => {
      const station = item.station || {};
      return String(station.id || "") === String(stationId || "") ||
        String(station.shortcode || station.short_name || station.name || "") === String(stationShortName || "");
    }) || data[0] || null;
  }

  async getNowPlaying() {
    const errors = [];
    for (const path of this.endpointCandidates()) {
      try {
        const data = await this.fetchJson(path);
        const selected = path === "/api/nowplaying" ? this.selectStationFromNowPlaying(data) : data;
        if (!selected) throw new Error("No station now-playing data returned");
        
        const streamActive = mainStreamActive(selected);
        if (streamActive === false) {
//          throw new Error("Aborted: Stream is currently offline");
	  return { ok: true, streamActive: false, song: null, source: path };
        }

        return { ok: true, song: normalizeSong(selected), streamActive: true, source: path };
      } catch (error) {
        errors.push({ path, message: error.name === "AbortError" ? "Request timed out" : error.message });
      }
    }
    return { ok: false, error: "Unable to load current song", details: errors };
  }
}

module.exports = { AzuraCastClient, normalizeSong, normalizeText, mainStreamActive };
