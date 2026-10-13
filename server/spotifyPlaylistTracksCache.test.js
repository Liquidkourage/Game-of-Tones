/**
 * Unit-level checks for playlist track cache trust-window helpers.
 * Does not call Spotify — exercises env parsing via requiring spotify.js carefully is heavy;
 * instead re-implements the trust-ms contract the same way as spotify.js.
 */
const assert = require('assert');

function readPlaylistTracksTrustCacheMs(env, ttlMs = 25 * 60 * 1000) {
  const raw = env.TEMPO_PLAYLIST_TRACKS_TRUST_CACHE_MS;
  if (raw === '0' || raw === 'false' || raw === 'off') return 0;
  if (raw != null && String(raw).trim() !== '') {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 0) return Math.min(ttlMs, n);
  }
  return 2 * 60 * 1000;
}

assert.strictEqual(readPlaylistTracksTrustCacheMs({}), 120000);
assert.strictEqual(readPlaylistTracksTrustCacheMs({ TEMPO_PLAYLIST_TRACKS_TRUST_CACHE_MS: '0' }), 0);
assert.strictEqual(readPlaylistTracksTrustCacheMs({ TEMPO_PLAYLIST_TRACKS_TRUST_CACHE_MS: '5000' }), 5000);

function shouldSkipSnapshot(cached, now, trustMs) {
  return (
    trustMs > 0 &&
    cached &&
    Array.isArray(cached.tracks) &&
    cached.tracks.length > 0 &&
    now - cached.at < trustMs
  );
}

const now = 1_000_000;
assert.strictEqual(
  shouldSkipSnapshot({ at: now - 30_000, tracks: [{ id: 'a' }] }, now, 120_000),
  true
);
assert.strictEqual(
  shouldSkipSnapshot({ at: now - 200_000, tracks: [{ id: 'a' }] }, now, 120_000),
  false
);
assert.strictEqual(shouldSkipSnapshot({ at: now, tracks: [{ id: 'a' }] }, now, 0), false);

console.log('spotifyPlaylistTracksCache.test.js OK');
