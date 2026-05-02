'use strict';

/**
 * Finalize-mix: reconcile YouTube videos to stable track title + artist for bingo.
 *
 * Strategy (learnings: Spotify quota lockouts, iTunes rate limits, 75+ row pools):
 * 1) **Heuristic** — Data API `snippet.title` parsed (never channel) in `youtubeMusic.js`; each row carries `youtubeRawTitle`.
 * 2) **Disk cache** — `youtubeMetadataCache.js` keys `videoId + country + titleFingerprint` → last good iTunes hit; avoids repeat traffic across finalizes.
 * 3) **iTunes Search only** — no Spotify Web API; one GET per *uncached* unique video, paced; one backoff retry on 429.
 *
 * Env:
 * - TEMPO_YT_CATALOG_VERIFY — default on; 0/false/off to skip remote (cache still read if useful — skipped when verify off entirely)
 * - TEMPO_YT_VERIFY_MIN_INTERVAL_MS — default 400
 * - TEMPO_YT_VERIFY_SCORE_MIN — default 0.5
 * - TEMPO_YT_VERIFY_SEARCH_LIMIT — default 8, max 25
 * - TEMPO_YT_VERIFY_ITUNES_COUNTRY — default us
 * - TEMPO_YT_VERIFY_HTTP_UA — optional
 */

const { parseYoutubeVideoTitleForDisplay } = require('./youtubeTrackDisplayParse');
const metadataCache = require('./youtubeMetadataCache');

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
  return 400;
}

function getScoreMin() {
  const n = Number(process.env.TEMPO_YT_VERIFY_SCORE_MIN);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.5;
}

function getItunesCountry() {
  const c = String(process.env.TEMPO_YT_VERIFY_ITUNES_COUNTRY || 'us')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return c || 'us';
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
 * @param {{ name: string; artist: string }} track
 * @param {string} expectedTitle
 * @param {string} expectedArtist
 * @param {number} rankIndex
 */
function scoreCandidate(track, expectedTitle, expectedArtist, rankIndex = 0) {
  const t = tokenSetJaccard(track.name, expectedTitle);
  const artist = String(expectedArtist || '').trim();
  const a = artist ? tokenSetJaccard(track.artist, artist) : 0;
  const base = artist ? t * 0.55 + a * 0.45 : t * 0.92;
  const rankBoost = Math.max(0, 0.035 - Math.min(rankIndex, 4) * 0.008);
  return clamp(base + rankBoost, 0, 1);
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
 * Prefer parsing **full** YouTube title line; fallback to stored heuristic fields.
 * @param {any} seed
 */
function expectedFieldsFromSeed(seed) {
  const raw = String(seed.youtubeRawTitle || '').trim();
  if (raw) {
    const p = parseYoutubeVideoTitleForDisplay(raw);
    return {
      expectedTitle: (p.title || raw).trim(),
      expectedArtist: (p.artist || '').trim(),
      cacheRawFingerprintSource: raw,
    };
  }
  return {
    expectedTitle: String(seed.name || '').trim(),
    expectedArtist: String(seed.artist || '').trim(),
    cacheRawFingerprintSource: `${String(seed.name || '')}\0${String(seed.artist || '')}`,
  };
}

/**
 * @param {string} term
 * @param {number} limit
 */
async function searchItunesTracks(term, limit) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', term);
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('country', getItunesCountry());

  const ua =
    String(process.env.TEMPO_YT_VERIFY_HTTP_UA || '').trim() ||
    'TempoMusicBingo/1.0 (finalize-metadata; +https://github.com/Liquidkourage/Game-of-Tones)';

  const r = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': ua,
    },
  });

  if (r.status === 429) {
    const err = new Error('iTunes rate limited (429)');
    /** @type {any} */ (err).statusCode = 429;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`iTunes HTTP ${r.status}`);
    /** @type {any} */ (err).statusCode = r.status;
    throw err;
  }

  const body = await r.json();
  const results = Array.isArray(body.results) ? body.results : [];
  const out = [];
  for (let i = 0; i < results.length && out.length < limit; i++) {
    const row = results[i];
    const name = String(row.trackName || '').trim();
    const artist = String(row.artistName || '').trim();
    if (name) out.push({ name, artist });
  }
  return out;
}

/**
 * @param {any[]} songList
 * @param {{ log?: (...a: any[]) => void }} [opts]
 * @returns {Promise<any[]>}
 */
async function applyYoutubeCatalogTrackVerification(songList, opts = {}) {
  const log = opts.log || ((...a) => console.log('[yt-reconcile]', ...a));

  if (!Array.isArray(songList) || songList.length === 0) return songList;

  if (!parseEnvBool(process.env.TEMPO_YT_CATALOG_VERIFY, true)) {
    log('skipped — TEMPO_YT_CATALOG_VERIFY disabled');
    return songList;
  }

  const country = getItunesCountry();
  const minIv = getMinIntervalMs();
  const scoreMin = getScoreMin();
  const searchLimit = clamp(Number(process.env.TEMPO_YT_VERIFY_SEARCH_LIMIT) || 8, 1, 25);

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
  let cacheHits = 0;
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
    const seed = songList[firstIndex];
    const { expectedTitle, expectedArtist, cacheRawFingerprintSource } = expectedFieldsFromSeed(seed);

    if (!expectedTitle) {
      noMatch++;
      continue;
    }

    const cached = metadataCache.getCached(id, country, cacheRawFingerprintSource);
    if (cached && cached.name) {
      idToMeta.set(id, { name: cached.name, artist: cached.artist || '' });
      cacheHits++;
      continue;
    }

    const query = buildSearchQuery(expectedArtist, expectedTitle);
    if (query.length < 2) {
      noMatch++;
      continue;
    }

    await pace();

    /** @type {{ name: string; artist: string }[]} */
    let items;
    let attempt = 0;
    for (;;) {
      try {
        items = await searchItunesTracks(query, searchLimit);
        break;
      } catch (e) {
        const msg = e && e.message ? String(e.message) : String(e);
        const code = e && /** @type {any} */ (e).statusCode;
        if (code === 429 && attempt < 1) {
          attempt++;
          log('iTunes 429 — single backoff 12s then retry once');
          await new Promise((r) => setTimeout(r, 12000));
          lastCallAt = Date.now();
          continue;
        }
        if (code === 429 || msg.includes('429')) {
          haltedQuota++;
          log('halted — iTunes rate limit after retry');
        } else {
          log('search error', id, msg.slice(0, 120));
          noMatch++;
        }
        items = null;
        break;
      }
    }

    if (!items) {
      if (haltedQuota) break;
      continue;
    }

    if (items.length === 0) {
      noMatch++;
      continue;
    }

    let best = null;
    let bestScore = 0;
    for (let ri = 0; ri < items.length; ri++) {
      const tr = items[ri];
      const sc = scoreCandidate(tr, expectedTitle, expectedArtist, ri);
      if (sc > bestScore) {
        bestScore = sc;
        best = tr;
      }
    }

    if (best && bestScore >= scoreMin) {
      idToMeta.set(id, { name: best.name, artist: best.artist });
      metadataCache.setCached(id, country, cacheRawFingerprintSource, best.name, best.artist);
      upgraded++;
    } else {
      noMatch++;
    }
  }

  if (idToMeta.size === 0) {
    log(`no upgrades — ${noMatch} no/low match; ${cacheHits} cache miss; ${haltedQuota} rate-limit halt`);
    return songList;
  }

  const out = songList.map((s) => {
    if (!s || s.youtubeMusic !== true) return s;
    const sid = String(s.id || '').trim();
    const meta = idToMeta.get(sid);
    if (!meta) return s;
    return {
      ...s,
      name: meta.name,
      artist: meta.artist,
      catalogDisplayVerified: true,
    };
  });

  log(
    `reconciled ${idToMeta.size} unique video(s): ${upgraded} iTunes, ${cacheHits} cache, ${noMatch} heuristic, ${haltedQuota} halted`,
  );
  return out;
}

module.exports = { applyYoutubeCatalogTrackVerification };
