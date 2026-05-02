'use strict';

/**
 * At finalize-mix, upgrade YouTube Music rows to Spotify-catalog title + artist using the Tempo
 * catalog Spotify token (same app as pack reads). Respects pacing between search calls and stops
 * when the catalog client is quarantined after a 429.
 *
 * Env:
 * - TEMPO_YT_CATALOG_VERIFY — default true; set 0/false/off to skip
 * - TEMPO_YT_VERIFY_MIN_INTERVAL_MS — ms between search calls (default 320, max clamped 5000)
 * - TEMPO_YT_VERIFY_SCORE_MIN — 0–1 match threshold (default 0.5)
 */

const catalogSpotify = require('./catalogSpotify');

function parseEnvBool(raw, defaultVal) {
  if (raw == null || String(raw).trim() === '') return defaultVal;
  const s = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return defaultVal;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function getMinIntervalMs() {
  const n = Number(process.env.TEMPO_YT_VERIFY_MIN_INTERVAL_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(5000, Math.floor(n));
  return 320;
}

function getScoreMin() {
  const n = Number(process.env.TEMPO_YT_VERIFY_SCORE_MIN);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.5;
}

function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSetJaccard(a, b) {
  const A = new Set(normalizeForMatch(a).split(' ').filter(Boolean));
  const B = new Set(normalizeForMatch(b).split(' ').filter(Boolean));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/**
 * @param {{ name: string; artist: string; popularity?: number }} track
 * @param {string} expectedTitle
 * @param {string} expectedArtist
 */
function scoreCandidate(track, expectedTitle, expectedArtist) {
  const t = tokenSetJaccard(track.name, expectedTitle);
  const artist = String(expectedArtist || '').trim();
  const a = artist ? tokenSetJaccard(track.artist, artist) : 0;
  const base = artist ? t * 0.55 + a * 0.45 : t * 0.92;
  const pop = (Number(track.popularity) || 0) / 100;
  return clamp(base + pop * 0.07, 0, 1);
}

function sanitizeQueryPart(s) {
  return String(s || '')
    .replace(/["']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 55);
}

function buildSearchQuery(artist, title) {
  const t = sanitizeQueryPart(title);
  const a = sanitizeQueryPart(artist);
  if (!t) return '';
  const combined = a ? `${a} ${t}` : t;
  return combined.slice(0, 96);
}

/**
 * @param {any[]} songList
 * @param {{ log?: (...a: any[]) => void }} [opts]
 * @returns {Promise<any[]>}
 */
async function applyYoutubeCatalogTrackVerification(songList, opts = {}) {
  const log = opts.log || ((...a) => console.log('[yt-catalog-verify]', ...a));

  if (!Array.isArray(songList) || songList.length === 0) return songList;

  if (!catalogSpotify.isCatalogFeatureConfigured()) {
    log('skipped — Tempo catalog Spotify not configured (set TEMPO_CATALOG_SPOTIFY_REFRESH_TOKEN and allowlist)');
    return songList;
  }

  if (!parseEnvBool(process.env.TEMPO_YT_CATALOG_VERIFY, true)) {
    log('skipped — TEMPO_YT_CATALOG_VERIFY disabled');
    return songList;
  }

  let svc;
  try {
    svc = await catalogSpotify.ensureCatalogAccessToken();
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    log('skipped — catalog token:', msg.slice(0, 160));
    return songList;
  }

  const minIv = getMinIntervalMs();
  const scoreMin = getScoreMin();
  const searchLimit = clamp(Number(process.env.TEMPO_YT_VERIFY_SEARCH_LIMIT) || 5, 1, 10);

  /** @type {{ id: string; firstIndex: number }[]} */
  const uniqueYts = [];
  const seen = new Set();
  for (let i = 0; i < songList.length; i++) {
    const s = songList[i];
    if (!s || s.youtubeMusic !== true) continue;
    const id = String(s.id || '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueYts.push({ id, firstIndex: i });
  }

  if (uniqueYts.length === 0) return songList;

  /** @type {Map<string, { name: string; artist: string }>} */
  const idToMeta = new Map();
  let upgraded = 0;
  let noMatch = 0;
  let haltedQuota = 0;

  let lastCallAt = 0;
  const pace = async () => {
    const now = Date.now();
    const wait = lastCallAt + minIv - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  };

  for (const { id, firstIndex } of uniqueYts) {
    if (typeof svc.isQuarantined === 'function' && svc.isQuarantined()) {
      haltedQuota++;
      break;
    }

    const seed = songList[firstIndex];
    const expectedTitle = String(seed.name || '').trim();
    const expectedArtist = String(seed.artist || '').trim();
    if (!expectedTitle) {
      noMatch++;
      continue;
    }

    const query = buildSearchQuery(expectedArtist, expectedTitle);
    if (query.length < 2) {
      noMatch++;
      continue;
    }

    await pace();

    /** @type {any[]} */
    let items;
    try {
      items = await svc.searchTracks(query, searchLimit, 0);
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      if (msg.includes('quarantined') || msg.includes('429')) {
        haltedQuota++;
        log('halted — Spotify rate limit / quarantine');
        break;
      }
      log('search error', id, msg.slice(0, 120));
      noMatch++;
      continue;
    }

    if (!Array.isArray(items) || items.length === 0) {
      noMatch++;
      continue;
    }

    let best = null;
    let bestScore = 0;
    for (const tr of items) {
      const sc = scoreCandidate(tr, expectedTitle, expectedArtist);
      if (sc > bestScore) {
        bestScore = sc;
        best = tr;
      }
    }

    if (best && bestScore >= scoreMin) {
      idToMeta.set(id, { name: best.name, artist: best.artist });
      upgraded++;
    } else {
      noMatch++;
    }
  }

  if (idToMeta.size === 0) {
    log(`no upgrades (${noMatch} no/low match; ${haltedQuota} quota/halt)`);
    return songList;
  }

  const out = songList.map((s) => {
    if (!s || s.youtubeMusic !== true) return s;
    const id = String(s.id || '').trim();
    const meta = idToMeta.get(id);
    if (!meta) return s;
    return {
      ...s,
      name: meta.name,
      artist: meta.artist,
      catalogDisplayVerified: true,
    };
  });

  log(
    `upgraded ${upgraded} unique video(s) (${idToMeta.size}/${uniqueYts.length}); ${noMatch} heuristic kept; ${haltedQuota} halted/quarantine`,
  );
  return out;
}

module.exports = { applyYoutubeCatalogTrackVerification };
