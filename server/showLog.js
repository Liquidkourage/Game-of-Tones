/** Throttled routine logs + compact Spotify API errors for live-show production. */

const throttleState = new Map();

function missionCriticalLogsOnly() {
  const v = process.env.MISSION_CRITICAL_LOGS;
  return v === '1' || String(v || '').toLowerCase() === 'true';
}

function spotifyErrorSummary(error) {
  const body = error?.body?.error;
  const message = body?.message || error?.message || String(error);
  const status = body?.status || error?.statusCode || '';
  return status ? `${message} (${status})` : message;
}

/** One-line Spotify API failure in production; full error when DEBUG is set. */
function logSpotifyApiError(label, error) {
  const summary = spotifyErrorSummary(error);
  if (process.env.NODE_ENV === 'production' && !process.env.DEBUG) {
    console.warn(`⚠️ Spotify ${label}: ${summary}`);
    return;
  }
  console.error(`Error ${label}:`, error);
}

/**
 * Log at most once per key per intervalMs. Suppressed repeats are summarized on the next emit.
 * Returns true when the message was logged.
 */
function routineLogThrottled(key, message, logFn, intervalMs = 60_000) {
  if (missionCriticalLogsOnly()) return false;
  const now = Date.now();
  const prev = throttleState.get(key);
  if (prev && now - prev.at < intervalMs) {
    prev.suppressed += 1;
    return false;
  }
  let line = message;
  if (prev?.suppressed > 0) {
    line += ` (+${prev.suppressed} similar suppressed)`;
  }
  logFn(line);
  throttleState.set(key, { at: now, suppressed: 0 });
  return true;
}

module.exports = {
  logSpotifyApiError,
  routineLogThrottled,
  spotifyErrorSummary,
};
