'use strict';

/**
 * Persistent cache: YouTube video id + title fingerprint + iTunes country → { name, artist }
 * from a successful iTunes reconciliation. Avoids repeat finalize/network traffic and speeds
 * large pools when the same videos appear again (ephemeral disk still helps long-running nodes).
 *
 * Env:
 * - TEMPO_YT_METADATA_CACHE_PATH — JSON file path (default: ../data/youtube-metadata-cache.json from server/)
 * - TEMPO_YT_METADATA_CACHE_MAX — max entries before pruning oldest (default 28000)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_REL_PATH = path.join('data', 'youtube-metadata-cache.json');

function cacheFilePath() {
  const explicit = String(process.env.TEMPO_YT_METADATA_CACHE_PATH || '').trim();
  if (explicit) return explicit;
  return path.join(__dirname, '..', DEFAULT_REL_PATH);
}

function maxEntries() {
  const n = Number(process.env.TEMPO_YT_METADATA_CACHE_MAX);
  if (Number.isFinite(n) && n >= 1000) return Math.min(200000, Math.floor(n));
  return 28000;
}

/** @type {Map<string, { name: string; artist: string; at: number }>} */
let store = new Map();
let loadAttempted = false;
let saveTimer = null;

function titleFingerprint(rawTitleOrFallback) {
  const h = crypto.createHash('sha256').update(String(rawTitleOrFallback || '')).digest('hex');
  return h.slice(0, 16);
}

function makeKey(videoId, country, fingerprint) {
  return `${String(videoId || '').trim()}|${String(country || 'us').toLowerCase().slice(0, 2)}|${fingerprint}`;
}

function prune() {
  const cap = maxEntries();
  if (store.size <= cap) return;
  const sorted = [...store.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  const drop = store.size - Math.floor(cap * 0.85);
  for (let i = 0; i < drop && i < sorted.length; i++) {
    store.delete(sorted[i][0]);
  }
}

function loadOnceSync() {
  if (loadAttempted) return;
  loadAttempted = true;
  const p = cacheFilePath();
  try {
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    const obj = j && typeof j === 'object' ? j.entries : null;
    if (obj && typeof obj === 'object') {
      const cap = maxEntries();
      const pairs = Object.entries(obj).filter(
        ([, v]) => v && typeof v.name === 'string' && String(v.name).trim() !== '',
      );
      pairs.sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
      const start = Math.max(0, pairs.length - cap);
      for (let i = start; i < pairs.length; i++) {
        const [k, v] = pairs[i];
        store.set(k, {
          name: String(v.name || ''),
          artist: String(v.artist || ''),
          at: Number(v.at) || 0,
        });
      }
    }
  } catch (e) {
    console.warn('[youtube-metadata-cache] load failed:', e && e.message ? e.message : e);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 1500);
}

function flush() {
  const p = cacheFilePath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = Object.fromEntries(store);
    fs.writeFileSync(
      p,
      JSON.stringify({ v: 1, writtenAt: Date.now(), entries: obj }),
      'utf8',
      );
  } catch (e) {
    console.warn('[youtube-metadata-cache] write failed:', e && e.message ? e.message : e);
  }
}

/**
 * @param {string} videoId
 * @param {string} country
 * @param {string} rawTitle — full YouTube snippet title (preferred); else stable fallback string
 */
function getCached(videoId, country, rawTitle) {
  loadOnceSync();
  const fp = titleFingerprint(rawTitle);
  const key = makeKey(videoId, country, fp);
  const row = store.get(key);
  if (!row || !String(row.name || '').trim()) return null;
  return { name: row.name, artist: row.artist || '' };
}

/**
 * @param {string} videoId
 * @param {string} country
 * @param {string} rawTitle
 * @param {string} name
 * @param {string} artist
 */
function setCached(videoId, country, rawTitle, name, artist) {
  loadOnceSync();
  const fp = titleFingerprint(rawTitle);
  const key = makeKey(videoId, country, fp);
  store.set(key, {
    name: String(name || '').trim(),
    artist: String(artist || '').trim(),
    at: Date.now(),
  });
  prune();
  scheduleSave();
}

module.exports = {
  getCached,
  setCached,
  titleFingerprint,
  /** Test / admin */
  _flushSyncForTests: flush,
};
