/**
 * Host-only Apple Music integration (MusicKit developer token + music-user-token library APIs).
 * Playback is host-browser MusicKit JS (wired separately); this module signs JWTs and fetches library.
 *
 * Env:
 *   APPLE_MUSIC_TEAM_ID
 *   APPLE_MUSIC_KEY_ID
 *   APPLE_MUSIC_PRIVATE_KEY  (PEM; use \n for newlines) OR APPLE_MUSIC_PRIVATE_KEY_PATH
 */

'use strict';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const APPLE_MUSIC_API = 'https://api.music.apple.com';
/** Developer tokens may live up to ~6 months; we refresh hourly for safety. */
const DEVELOPER_TOKEN_TTL_SEC = 60 * 60;

/** @type {Map<number, { musicUserToken: string }>} */
const userTokenStore = new Map();

let cachedPrivateKey = null;
let cachedDeveloperToken = null;
let cachedDeveloperTokenExpMs = 0;

function teamId() {
  return (process.env.APPLE_MUSIC_TEAM_ID || '').trim();
}

function keyId() {
  return (process.env.APPLE_MUSIC_KEY_ID || '').trim();
}

function loadPrivateKeyPem() {
  if (cachedPrivateKey) return cachedPrivateKey;
  const raw = (process.env.APPLE_MUSIC_PRIVATE_KEY || '').trim();
  if (raw) {
    cachedPrivateKey = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : raw.replace(/\\n/g, '\n');
    return cachedPrivateKey;
  }
  const keyPath = (process.env.APPLE_MUSIC_PRIVATE_KEY_PATH || '').trim();
  if (keyPath) {
    const resolved = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
    cachedPrivateKey = fs.readFileSync(resolved, 'utf8');
    return cachedPrivateKey;
  }
  return '';
}

function isConfigured() {
  return !!(teamId() && keyId() && loadPrivateKeyPem());
}

/**
 * ES256 JWT for MusicKit / Apple Music API (developer token).
 * @returns {string}
 */
function getDeveloperToken() {
  if (!isConfigured()) {
    const err = new Error('Apple Music is not configured on the server');
    /** @type {any} */ (err).statusCode = 503;
    throw err;
  }
  const now = Date.now();
  if (cachedDeveloperToken && now < cachedDeveloperTokenExpMs - 60_000) {
    return cachedDeveloperToken;
  }
  const pem = loadPrivateKeyPem();
  const token = jwt.sign({}, pem, {
    algorithm: 'ES256',
    expiresIn: DEVELOPER_TOKEN_TTL_SEC,
    issuer: teamId(),
    header: {
      alg: 'ES256',
      kid: keyId(),
    },
  });
  cachedDeveloperToken = token;
  cachedDeveloperTokenExpMs = now + DEVELOPER_TOKEN_TTL_SEC * 1000;
  return token;
}

/**
 * @param {number} hostUserId
 * @param {string} musicUserToken
 */
function setMusicUserToken(hostUserId, musicUserToken) {
  const t = String(musicUserToken || '').trim();
  if (!t) {
    const err = new Error('Missing music user token');
    /** @type {any} */ (err).statusCode = 400;
    throw err;
  }
  userTokenStore.set(hostUserId, { musicUserToken: t });
}

/**
 * @param {number} hostUserId
 */
function hasCredentials(hostUserId) {
  const row = userTokenStore.get(hostUserId);
  return !!(row && row.musicUserToken);
}

/**
 * @param {number} hostUserId
 */
function getMusicUserToken(hostUserId) {
  return userTokenStore.get(hostUserId)?.musicUserToken || null;
}

/**
 * @param {number} hostUserId
 */
function clearHost(hostUserId) {
  userTokenStore.delete(hostUserId);
}

/**
 * @param {string} pathAndQuery e.g. /v1/me/library/playlists?limit=100
 * @param {string} musicUserToken
 */
async function appleMusicFetch(pathAndQuery, musicUserToken) {
  const developerToken = getDeveloperToken();
  const url = pathAndQuery.startsWith('http')
    ? pathAndQuery
    : `${APPLE_MUSIC_API}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${developerToken}`,
      'Music-User-Token': musicUserToken,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(
      (body && body.errors && body.errors[0] && body.errors[0].detail) ||
        `Apple Music API ${res.status}`,
    );
    /** @type {any} */ (err).statusCode = res.status === 401 || res.status === 403 ? 401 : res.status;
    /** @type {any} */ (err).body = body;
    throw err;
  }
  return body;
}

function catalogIdFromLibrarySong(resource) {
  if (!resource || typeof resource !== 'object') return '';
  const attrs = resource.attributes || {};
  const playParams = attrs.playParams || {};
  if (typeof playParams.catalogId === 'string' && playParams.catalogId.trim()) {
    return playParams.catalogId.trim();
  }
  // Non-library catalog songs sometimes put the catalog id in playParams.id
  if (
    playParams.isLibrary !== true &&
    typeof playParams.id === 'string' &&
    playParams.id.trim() &&
    !String(playParams.id).startsWith('i.')
  ) {
    return playParams.id.trim();
  }
  const catalogRel = resource.relationships?.catalog?.data;
  if (Array.isArray(catalogRel) && catalogRel[0] && typeof catalogRel[0].id === 'string') {
    return catalogRel[0].id.trim();
  }
  return '';
}

function artworkUrlFromAttributes(attrs) {
  const art = attrs && attrs.artwork;
  if (!art || typeof art.url !== 'string') return null;
  const w = art.width || 300;
  const h = art.height || 300;
  return art.url.replace('{w}', String(w)).replace('{h}', String(h));
}

/**
 * @param {number} hostUserId
 */
async function listMyPlaylists(hostUserId) {
  const musicUserToken = getMusicUserToken(hostUserId);
  if (!musicUserToken) {
    const err = new Error('Apple Music not connected for this host');
    /** @type {any} */ (err).statusCode = 401;
    throw err;
  }

  const out = [];
  let next = '/v1/me/library/playlists?limit=100';
  while (next) {
    const data = await appleMusicFetch(next, musicUserToken);
    const items = Array.isArray(data?.data) ? data.data : [];
    for (const it of items) {
      const attrs = it.attributes || {};
      const desc =
        typeof attrs.description === 'string'
          ? attrs.description
          : attrs.description?.standard || '';
      out.push({
        id: it.id,
        title: attrs.name || '',
        description: desc || '',
        itemCount:
          attrs.trackCount != null && Number.isFinite(Number(attrs.trackCount))
            ? Number(attrs.trackCount)
            : null,
        artworkUrl: artworkUrlFromAttributes(attrs),
      });
    }
    const n = data?.next;
    if (typeof n === 'string' && n.trim()) {
      next = n.startsWith('http') ? n : n;
    } else {
      next = '';
    }
  }
  return out;
}

/**
 * Playlist items as host song rows (`appleMusic: true`). Uses catalog song id for MusicKit playback.
 * @param {number} hostUserId
 * @param {string} playlistId
 * @param {{ playlistName?: string }} [options]
 */
async function listPlaylistItems(hostUserId, playlistId, options = {}) {
  const musicUserToken = getMusicUserToken(hostUserId);
  if (!musicUserToken) {
    const err = new Error('Apple Music not connected for this host');
    /** @type {any} */ (err).statusCode = 401;
    throw err;
  }

  const pid = String(playlistId || '').trim();
  if (!pid) {
    const err = new Error('Missing playlist id');
    /** @type {any} */ (err).statusCode = 400;
    throw err;
  }

  const playlistName =
    options.playlistName != null && String(options.playlistName).trim() !== ''
      ? String(options.playlistName).trim()
      : '';

  const tracks = [];
  let next = `/v1/me/library/playlists/${encodeURIComponent(pid)}/tracks?limit=100&include=catalog`;
  while (next) {
    const data = await appleMusicFetch(next, musicUserToken);
    const items = Array.isArray(data?.data) ? data.data : [];
    for (const it of items) {
      const type = String(it.type || '');
      if (!type.includes('song')) continue;
      const catalogId = catalogIdFromLibrarySong(it);
      if (!catalogId) continue;
      const attrs = it.attributes || {};
      const durationMs =
        attrs.durationInMillis != null && Number.isFinite(Number(attrs.durationInMillis))
          ? Number(attrs.durationInMillis)
          : undefined;
      tracks.push({
        id: catalogId,
        name: String(attrs.name || '').trim() || 'Unknown',
        artist: String(attrs.artistName || '').trim(),
        ...(durationMs != null ? { duration_ms: durationMs } : {}),
        explicit: attrs.contentRating === 'explicit',
        artworkUrl: artworkUrlFromAttributes(attrs),
        appleMusic: true,
        sourcePlaylistId: pid,
        ...(playlistName ? { sourcePlaylistName: playlistName } : {}),
      });
    }
    const n = data?.next;
    if (typeof n === 'string' && n.trim()) {
      next = n.startsWith('http') ? n : n;
    } else {
      next = '';
    }
  }
  return tracks;
}

module.exports = {
  isConfigured,
  getDeveloperToken,
  setMusicUserToken,
  hasCredentials,
  getMusicUserToken,
  clearHost,
  listMyPlaylists,
  listPlaylistItems,
};
