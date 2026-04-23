/**
 * Opt-in verbose logging for the host → org → credentials → token → Spotify API pipeline.
 * Enable with TEMPO_SPOTIFY_PIPELINE_LOG=1 (or "true"). Never logs secrets, refresh tokens, or access tokens.
 *
 * For per-request Web API line logs (api.spotify.com paths + status), also set TEMPO_SPOTIFY_LOG_WEBAPI=1
 * (only effective when TEMPO_SPOTIFY_PIPELINE_LOG is on). Can be noisy.
 */

const ENABLED =
  process.env.TEMPO_SPOTIFY_PIPELINE_LOG === '1' || String(process.env.TEMPO_SPOTIFY_PIPELINE_LOG).toLowerCase() === 'true';
const WEBAPI =
  process.env.TEMPO_SPOTIFY_LOG_WEBAPI === '1' || String(process.env.TEMPO_SPOTIFY_LOG_WEBAPI).toLowerCase() === 'true';

function isEnabled() {
  return ENABLED;
}

/** When true, log each _webApiGet to api.spotify.com (path + status). Requires isEnabled() too. */
function isWebApiLogEnabled() {
  return ENABLED && WEBAPI;
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
  log,
  clientIdPrefix,
};
