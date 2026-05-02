'use strict';

/**
 * At finalize-mix, upgrade YouTube Music rows to canonical track title + artist using the
 * **iTunes Search API** (public JSON, no Spotify Web API — avoids Spotify quota on this path).
 *
 * Env:
 * - TEMPO_YT_CATALOG_VERIFY — default true; set 0/false/off to skip
 * - TEMPO_YT_VERIFY_MIN_INTERVAL_MS — ms between requests (default 450, max 5000)
 * - TEMPO_YT_VERIFY_SCORE_MIN — 0–1 match threshold (default 0.5)
 * - TEMPO_YT_VERIFY_SEARCH_LIMIT — iTunes `limit` param (default 8, max 25)
 * - TEMPO_YT_VERIFY_ITUNES_COUNTRY — store country code (default us)
 * - TEMPO_YT_VERIFY_HTTP_UA — optional User-Agent for requests
 */

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
  return 450;
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
 * @param {number} rankIndex — iTunes result order (0 = most relevant)
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
 * @param {string} term
 * @param {number} limit
 * @returns {Promise<{ name: string; artist: string }[]>}
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
  const log = opts.log || ((...a) => console.log('[yt-itunes-verify]', ...a));

  if (!Array.isArray(songList) || songList.length === 0) return songList;

  if (!parseEnvBool(process.env.TEMPO_YT_CATALOG_VERIFY, true)) {
    log('skipped — TEMPO_YT_CATALOG_VERIFY disabled');
    return songList;
  }

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

    /** @type {{ name: string; artist: string }[]} */
    let items;
    try {
      items = await searchItunesTracks(query, searchLimit);
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      const code = e && /** @type {any} */ (e).statusCode;
      if (code === 429 || msg.includes('429')) {
        haltedQuota++;
        log('halted — iTunes rate limit');
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
      upgraded++;
    } else {
      noMatch++;
    }
  }

  if (idToMeta.size === 0) {
    log(`no upgrades (${noMatch} no/low match; ${haltedQuota} rate-limit halt)`);
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
    `upgraded ${upgraded} unique video(s) via iTunes (${idToMeta.size}/${uniqueYts.length}); ${noMatch} heuristic; ${haltedQuota} halted`,
  );
  return out;
}

module.exports = { applyYoutubeCatalogTrackVerification };
