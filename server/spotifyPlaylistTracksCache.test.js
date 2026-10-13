/**
 * Playlist track cache trust window + forceRefresh + concurrent single-flight.
 */
const assert = require('assert');
const SpotifyService = require('./spotify.js');

const { resolvePlaylistTracksCacheAction, PLAYLIST_TRACKS_CACHE_TTL_MS } = SpotifyService;

assert.strictEqual(typeof resolvePlaylistTracksCacheAction, 'function');
assert.ok(PLAYLIST_TRACKS_CACHE_TTL_MS >= 60_000);

const now = 1_000_000;
const fresh = { at: now - 30_000, tracks: [{ id: 'old' }], snapshotId: 'snap-a' };
const trustMs = 120_000;

assert.strictEqual(
  resolvePlaylistTracksCacheAction({
    forceRefresh: true,
    cached: fresh,
    now,
    trustMs,
    snapshotId: null,
    snapshotUpstream5xx: false,
    ttlMs: PLAYLIST_TRACKS_CACHE_TTL_MS,
  }),
  'force_miss'
);

assert.strictEqual(
  resolvePlaylistTracksCacheAction({
    forceRefresh: false,
    cached: null,
    now,
    trustMs,
    snapshotId: null,
    snapshotUpstream5xx: false,
    ttlMs: PLAYLIST_TRACKS_CACHE_TTL_MS,
  }),
  'fetch'
);

assert.strictEqual(
  resolvePlaylistTracksCacheAction({
    forceRefresh: false,
    cached: fresh,
    now,
    trustMs,
    snapshotId: null,
    snapshotUpstream5xx: false,
    ttlMs: PLAYLIST_TRACKS_CACHE_TTL_MS,
  }),
  'trust_cache'
);

assert.strictEqual(
  resolvePlaylistTracksCacheAction({
    forceRefresh: false,
    cached: { ...fresh, at: now - 180_000 },
    now,
    trustMs: 0,
    snapshotId: 'snap-b',
    snapshotUpstream5xx: false,
    ttlMs: PLAYLIST_TRACKS_CACHE_TTL_MS,
  }),
  'fetch',
  'changed snapshot after trust window must refetch'
);

assert.strictEqual(
  resolvePlaylistTracksCacheAction({
    forceRefresh: false,
    cached: { ...fresh, at: now - 180_000 },
    now,
    trustMs: 0,
    snapshotId: 'snap-a',
    snapshotUpstream5xx: false,
    ttlMs: PLAYLIST_TRACKS_CACHE_TTL_MS,
  }),
  'snapshot_match'
);

function simulateForceThenDecide(cacheMap, playlistId, nowTs) {
  cacheMap.delete(playlistId);
  const cached = cacheMap.get(playlistId) || null;
  return resolvePlaylistTracksCacheAction({
    forceRefresh: true,
    cached,
    now: nowTs,
    trustMs: 120_000,
    snapshotId: null,
    snapshotUpstream5xx: false,
    ttlMs: PLAYLIST_TRACKS_CACHE_TTL_MS,
  });
}
const map = new Map();
map.set('pl1', { at: now, tracks: [{ id: 'x' }], snapshotId: 's1' });
assert.strictEqual(simulateForceThenDecide(map, 'pl1', now), 'force_miss');
assert.strictEqual(map.has('pl1'), false);

async function singleFlightDemo(inflight, key, workFactory) {
  if (inflight.has(key)) return inflight.get(key);
  const work = workFactory();
  inflight.set(key, work);
  const cleanup = () => {
    if (inflight.get(key) === work) inflight.delete(key);
  };
  work.then(cleanup, cleanup);
  return work;
}

async function main() {
  let upstreamCalls = 0;
  const inflight = new Map();
  const factory = () =>
    new Promise((resolve) => {
      upstreamCalls += 1;
      setTimeout(() => resolve({ tracks: [{ id: '1' }] }), 20);
    });

  const [a, b, c] = await Promise.all([
    singleFlightDemo(inflight, 'pl', factory),
    singleFlightDemo(inflight, 'pl', factory),
    singleFlightDemo(inflight, 'pl', factory),
  ]);
  assert.strictEqual(upstreamCalls, 1);
  assert.strictEqual(a.tracks[0].id, '1');
  assert.strictEqual(b.tracks[0].id, '1');
  assert.strictEqual(c.tracks[0].id, '1');

  let forcedCalls = 0;
  async function getTracks(force) {
    const key = 'plF';
    const run = () =>
      new Promise((resolve) => {
        forcedCalls += 1;
        setTimeout(() => resolve(forcedCalls), 10);
      });
    if (!force && inflight.has(key)) return inflight.get(key);
    const work = run();
    if (!force) {
      inflight.set(key, work);
      const cleanup = () => {
        if (inflight.get(key) === work) inflight.delete(key);
      };
      work.then(cleanup, cleanup);
    }
    return work;
  }
  inflight.clear();
  await Promise.all([getTracks(true), getTracks(true)]);
  assert.strictEqual(forcedCalls, 2, 'forceRefresh must not coalesce — each Refresh hits upstream');

  console.log('spotifyPlaylistTracksCache.test.js OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
