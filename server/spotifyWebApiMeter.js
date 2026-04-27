/**
 * Rolling estimate of outgoing Spotify *Web API* (api.spotify.com) request volume
 * to protect the app from being rate-banned. Paired with recording in:
 *  - each spotify-web-api-node method call (except auth/token/redirect helpers)
 *  - _webApiGet, _transferPlaybackDirect in spotify.js
 *
 * TEMPO_SPOTIFY_FAILSAFE=1|true|on  — opt-in: auto-disconnect all host sessions when estimate ≥ threshold
 * TEMPO_SPOTIFY_FAILSAFE_30S_MAX=N  — trip when estimate in the last 30s ≥ N (default 220)
 * TEMPO_SPOTIFY_FAILSAFE_TRIP_COOLDOWN_MS — min ms between automatic trips (default 5m)
 * TEMPO_SPOTIFY_METER=0 — disable counting (failsafe never trips; GET estimate stays 0)
 * Does not count accounts.spotify.com (token refresh / code exchange); only api.spotify.com traffic.
 */

const WINDOW_MS = 30_000;
const MAX_STAMPS = 20_000;
const COOLDOWN_DEFAULT_MS = 5 * 60 * 1000;

let stamps = [];
let lastTripAt = 0;
let failsafeHandler = null;

/** Failsafe trip (clear tokens + socket notify) when threshold exceeded. */
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
  const t = Date.now() - WINDOW_MS;
  while (stamps.length && stamps[0] < t) stamps.shift();
}

function getEstimateLast30s() {
  if (!isMeterCounting()) return 0;
  prune();
  return stamps.length;
}

/**
 * @param {number} [n=1]
 */
function record(n) {
  if (!isMeterCounting()) return;
  const add = Math.max(1, Math.min(1_000, Math.floor(n || 1)));
  const now = Date.now();
  for (let i = 0; i < add; i += 1) {
    stamps.push(now);
  }
  if (stamps.length > MAX_STAMPS) {
    stamps = stamps.slice(-MAX_STAMPS);
  }
  prune();

  if (!isFailsafeEnabled() || !failsafeHandler) return;
  if (stamps.length < getThreshold()) return;
  if (now - lastTripAt < getTripCooldownMs()) return;
  lastTripAt = now;
  const info = { count30s: stamps.length, max: getThreshold() };
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

module.exports = {
  isFailsafeEnabled,
  isMeterCounting,
  getThreshold,
  getTripCooldownMs,
  getEstimateLast30s,
  record,
  setFailsafeHandler,
};
