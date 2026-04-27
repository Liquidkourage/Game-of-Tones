/**
 * Opt-in verbose logging for the host → org → credentials → token → Spotify API pipeline.
 * Enable with TEMPO_SPOTIFY_PIPELINE_LOG=1 (or "true"). Never logs secrets, refresh tokens, or access tokens.
 *
 * For per-request Web API line logs (api.spotify.com paths + status), also set TEMPO_SPOTIFY_LOG_WEBAPI=1
 * (only effective when TEMPO_SPOTIFY_PIPELINE_LOG is on). Can be noisy.
 *
 * TEMPO_SPOTIFY_LOG_WEBAPI_OK=1|true  — also log 2xx web_api_response lines (default: only non-2xx, still noisy but useful)
 * TEMPO_SPOTIFY_LOG_API_REQUEST=0|off  — do not log api_spotify_request (method+path) on each /api/spotify/* hit
 */

const ENABLED =
  process.env.TEMPO_SPOTIFY_PIPELINE_LOG === '1' || String(process.env.TEMPO_SPOTIFY_PIPELINE_LOG).toLowerCase() === 'true';
const WEBAPI =
  process.env.TEMPO_SPOTIFY_LOG_WEBAPI === '1' || String(process.env.TEMPO_SPOTIFY_LOG_WEBAPI).toLowerCase() === 'true';

let lastQuarantine429PipelineLogAt = 0;
const QUARANTINE_429_LOG_THROTTLE_MS = 5_000;

function isEnabled() {
  return ENABLED;
}

/** When true, log each _webApiGet to api.spotify.com (path + status). Requires isEnabled() too. */
function isWebApiLogEnabled() {
  return ENABLED && WEBAPI;
}

/** Log 2xx web_api_response lines (default false when WEBAPI is on — set TEMPO_SPOTIFY_LOG_WEBAPI_OK=1 for full peephole). */
function isWebApiLogOkStatusEnabled() {
  const v = process.env.TEMPO_SPOTIFY_LOG_WEBAPI_OK;
  return v === '1' || String(v).toLowerCase() === 'true' || v === 'on';
}

/**
 * @param {number} statusCode
 */
function shouldLogWebApiResponseStatus(statusCode) {
  if (!isWebApiLogEnabled()) return false;
  const sc = Number(statusCode);
  if (!Number.isFinite(sc)) return true;
  if (sc >= 200 && sc < 300) {
    return isWebApiLogOkStatusEnabled();
  }
  return true;
}

function shouldLogQuarantine429ToPipeline() {
  if (!isEnabled()) return true;
  const now = Date.now();
  if (now - lastQuarantine429PipelineLogAt < QUARANTINE_429_LOG_THROTTLE_MS) {
    return false;
  }
  lastQuarantine429PipelineLogAt = now;
  return true;
}

function isApiRequestLogEnabled() {
  const v = process.env.TEMPO_SPOTIFY_LOG_API_REQUEST;
  if (v === '0' || String(v).toLowerCase() === 'false' || v === 'off') {
    return false;
  }
  return true;
}

function clientIdPrefix(id) {
  if (id == null || id === '') return 'unset';
  return String(id).replace(/\s/g, '').slice(0, 8);
}

/**
 * @param {string} event
 * @param {Record<string, string | number | boolean | null | undefined>} [fields] — values are coerced; no secrets
 */
function log(event, fields) {
  if (!ENABLED) return;
  const parts = [`[Spotify pipeline]`, `event=${event}`];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const val =
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
          ? v === null
            ? 'null'
            : String(v)
          : JSON.stringify(v);
      parts.push(`${k}=${val}`);
    }
  }
  console.log(parts.join(' '));
}

module.exports = {
  isEnabled,
  isWebApiLogEnabled,
  isWebApiLogOkStatusEnabled,
  shouldLogWebApiResponseStatus,
  shouldLogQuarantine429ToPipeline,
  isApiRequestLogEnabled,
  log,
  clientIdPrefix,
};
