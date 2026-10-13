/**
 * Rolling estimate of outgoing Spotify *Web API* (api.spotify.com) request volume
 * to protect the app from being rate-banned. Paired with recording in:
 *  - each spotify-web-api-node method call (except auth/token/redirect helpers)
 *  - _webApiGet / _webApiRequest / _transferPlaybackDirect in spotify.js
 *
 * TEMPO_SPOTIFY_FAILSAFE=1|true|on  — opt-in: soft-quarantine hosts on the hottest developer
 *   Client ID when estimate ≥ threshold (tokens/caches preserved; not every tenant)
 * TEMPO_SPOTIFY_FAILSAFE_30S_MAX=N  — trip when estimate in the last 30s ≥ N (default 220)
 * TEMPO_SPOTIFY_FAILSAFE_TRIP_COOLDOWN_MS — min ms between automatic trips (default 5m)
 * TEMPO_SPOTIFY_METER=0 — disable counting (failsafe never trips; GET estimate stays 0)
 * Does not count accounts.spotify.com (token refresh / code exchange); only api.spotify.com traffic.
 *
 * Do not pass access tokens, refresh tokens, client secrets, or auth codes into recordEvent.
 */

const WINDOW_30S_MS = 30_000;
const WINDOW_5M_MS = 5 * 60_000;
const WINDOW_60M_MS = 60 * 60_000;
const MAX_EVENTS = 25_000;
const COOLDOWN_DEFAULT_MS = 5 * 60 * 1000;

/** @typedef {{
 *   t: number,
 *   clientIdPrefix?: string,
 *   hostUserId?: string,
 *   method?: string,
 *   path?: string,
 *   label?: string,
 *   category?: string,
 *   status?: number,
 *   retryAfterSec?: number|null,
 *   errorMessage?: string|null,
 *   errorReason?: string|null,
 * }} MeterEvent */

/** @type {MeterEvent[]} */
let events = [];
let lastTripAt = 0;
let failsafeHandler = null;

function isFailsafeEnabled() {
  const v = process.env.TEMPO_SPOTIFY_FAILSAFE;
  return v === '1' || String(v).toLowerCase() === 'true' || v === 'on';
}

function isMeterCounting() {
  const v = process.env.TEMPO_SPOTIFY_METER;
  if (v === '0' || String(v).toLowerCase() === 'false' || v === 'off') return false;
  return true;
}

function getThreshold() {
  const n = parseInt(process.env.TEMPO_SPOTIFY_FAILSAFE_30S_MAX || '220', 10);
  return Number.isFinite(n) && n > 0 ? n : 220;
}

function getTripCooldownMs() {
  const n = parseInt(process.env.TEMPO_SPOTIFY_FAILSAFE_TRIP_COOLDOWN_MS || String(COOLDOWN_DEFAULT_MS), 10);
  return Number.isFinite(n) && n >= 10_000 ? n : COOLDOWN_DEFAULT_MS;
}

function prune() {
  const t = Date.now() - WINDOW_60M_MS;
  while (events.length && events[0].t < t) events.shift();
}

function countSince(msAgo) {
  if (!isMeterCounting()) return 0;
  prune();
  const t = Date.now() - msAgo;
  let n = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].t < t) break;
    n += 1;
  }
  return n;
}

function getEstimateLast30s() {
  return countSince(WINDOW_30S_MS);
}

function getEstimateLast5m() {
  return countSince(WINDOW_5M_MS);
}

function getEstimateLast60m() {
  return countSince(WINDOW_60M_MS);
}

/**
 * Dominant developer app (by request count) in the last 30s.
 * @returns {{ clientIdPrefix: string|null, count: number }}
 */
function getDominantClientIdLast30s() {
  if (!isMeterCounting()) return { clientIdPrefix: null, count: 0 };
  prune();
  const t = Date.now() - WINDOW_30S_MS;
  /** @type {Map<string, number>} */
  const by = new Map();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.t < t) break;
    const k = e.clientIdPrefix && String(e.clientIdPrefix).trim() ? String(e.clientIdPrefix) : 'unknown';
    by.set(k, (by.get(k) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [k, n] of by) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return { clientIdPrefix: best === 'unknown' ? null : best, count: bestN };
}

/**
 * Counts per clientIdPrefix in a window (for admin diagnostics).
 * @param {number} msAgo
 */
function countsByClientId(msAgo) {
  prune();
  const t = Date.now() - msAgo;
  /** @type {Record<string, number>} */
  const out = {};
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.t < t) break;
    const k = e.clientIdPrefix && String(e.clientIdPrefix).trim() ? String(e.clientIdPrefix) : 'unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Top labels in a window (admin diagnostics).
 * @param {number} msAgo
 * @param {number} [limit=12]
 */
function topLabels(msAgo, limit = 12) {
  prune();
  const t = Date.now() - msAgo;
  /** @type {Map<string, number>} */
  const by = new Map();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.t < t) break;
    const k = e.label && String(e.label).trim() ? String(e.label) : 'unlabeled';
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([label, count]) => ({ label, count }));
}

function sanitizePath(path) {
  if (path == null) return undefined;
  const s = String(path).split('?')[0];
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

/**
 * @param {Partial<MeterEvent> & { n?: number }} detail
 */
function recordEvent(detail) {
  if (!isMeterCounting()) return;
  const add = Math.max(1, Math.min(1_000, Math.floor(detail && detail.n != null ? detail.n : 1)));
  const now = Date.now();
  const base = {
    t: now,
    clientIdPrefix:
      detail && detail.clientIdPrefix != null ? String(detail.clientIdPrefix).slice(0, 16) : undefined,
    hostUserId: detail && detail.hostUserId != null ? String(detail.hostUserId).slice(0, 32) : undefined,
    method: detail && detail.method != null ? String(detail.method).slice(0, 12) : undefined,
    path: detail ? sanitizePath(detail.path) : undefined,
    label: detail && detail.label != null ? String(detail.label).slice(0, 80) : undefined,
    category: detail && detail.category != null ? String(detail.category).slice(0, 32) : undefined,
    status: detail && detail.status != null && Number.isFinite(Number(detail.status))
      ? Number(detail.status)
      : undefined,
    retryAfterSec:
      detail && detail.retryAfterSec != null && Number.isFinite(Number(detail.retryAfterSec))
        ? Number(detail.retryAfterSec)
        : null,
    errorMessage:
      detail && detail.errorMessage != null
        ? String(detail.errorMessage).slice(0, 200)
        : null,
    errorReason:
      detail && detail.errorReason != null ? String(detail.errorReason).slice(0, 80) : null,
  };
  for (let i = 0; i < add; i += 1) {
    events.push({ ...base });
  }
  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS);
  }
  prune();

  maybeTripFailsafe(now);
}

/**
 * Backward-compatible counter (no metadata). Prefer recordEvent from call sites.
 * @param {number} [n=1]
 */
function record(n) {
  recordEvent({ n });
}

function maybeTripFailsafe(now) {
  if (!isFailsafeEnabled() || !failsafeHandler) return;
  const count30s = getEstimateLast30s();
  if (count30s < getThreshold()) return;
  if (now - lastTripAt < getTripCooldownMs()) return;
  lastTripAt = now;
  const dominant = getDominantClientIdLast30s();
  const info = {
    count30s,
    max: getThreshold(),
    dominantClientIdPrefix: dominant.clientIdPrefix,
    dominantCount30s: dominant.count,
    byClientId30s: countsByClientId(WINDOW_30S_MS),
    estimate5m: getEstimateLast5m(),
    estimate60m: getEstimateLast60m(),
  };
  try {
    const r = failsafeHandler(info);
    if (r && typeof r.then === 'function') {
      r.catch((e) => console.error('spotifyWebApiMeter failsafe handler (async) error:', e));
    }
  } catch (e) {
    console.error('spotifyWebApiMeter failsafe handler error:', e);
  }
}

function setFailsafeHandler(h) {
  failsafeHandler = typeof h === 'function' ? h : null;
}

/** Admin / diagnostics snapshot — no secrets. */
function getDiagnostics() {
  prune();
  return {
    windowMs30s: WINDOW_30S_MS,
    windowMs5m: WINDOW_5M_MS,
    windowMs60m: WINDOW_60M_MS,
    estimate30s: getEstimateLast30s(),
    estimate5m: getEstimateLast5m(),
    estimate60m: getEstimateLast60m(),
    threshold: getThreshold(),
    failsafeEnabled: isFailsafeEnabled(),
    meterCounting: isMeterCounting(),
    byClientId30s: countsByClientId(WINDOW_30S_MS),
    byClientId5m: countsByClientId(WINDOW_5M_MS),
    topLabels30s: topLabels(WINDOW_30S_MS),
    topLabels5m: topLabels(WINDOW_5M_MS),
    dominantClientId30s: getDominantClientIdLast30s(),
    quotaExceeded30s: countEventsMatching(WINDOW_30S_MS, (e) => {
      const r = (e.errorReason || '').toUpperCase();
      const m = (e.errorMessage || '').toUpperCase();
      return r === 'QUOTA_EXCEEDED' || m.includes('QUOTA');
    }),
    http429Last30s: countEventsMatching(WINDOW_30S_MS, (e) => e.status === 429),
  };
}

function countEventsMatching(msAgo, pred) {
  prune();
  const t = Date.now() - msAgo;
  let n = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.t < t) break;
    if (pred(e)) n += 1;
  }
  return n;
}

/** Test helper — clears in-memory meter state. */
function _resetForTests() {
  events = [];
  lastTripAt = 0;
}

module.exports = {
  isFailsafeEnabled,
  isMeterCounting,
  getThreshold,
  getTripCooldownMs,
  getEstimateLast30s,
  getEstimateLast5m,
  getEstimateLast60m,
  getDominantClientIdLast30s,
  getDiagnostics,
  record,
  recordEvent,
  setFailsafeHandler,
  _resetForTests,
  WINDOW_30S_MS,
  WINDOW_5M_MS,
  WINDOW_60M_MS,
};
