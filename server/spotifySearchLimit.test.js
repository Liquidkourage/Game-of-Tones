/**
 * Development Mode Spotify Search allows at most 10 results per request.
 * Replacement UI must paginate (offset 0 + 10) to reach 20 distinct tracks.
 */
const assert = require('assert');
const SpotifyService = require('./spotify.js');

assert.strictEqual(SpotifyService.SPOTIFY_SEARCH_LIMIT_MAX, 10);
assert.strictEqual(SpotifyService.clampSearchLimit(20), 10);
assert.strictEqual(SpotifyService.clampSearchLimit(10), 10);
assert.strictEqual(SpotifyService.clampSearchLimit(5), 5);
assert.strictEqual(SpotifyService.normalizeSearchOffset(10), 10);
assert.strictEqual(SpotifyService.normalizeSearchOffset(-1), 0);

/** Mirrors SongReplacementModal pagination contract. */
function replacementSearchPages() {
  return [
    { limit: SpotifyService.clampSearchLimit(10), offset: SpotifyService.normalizeSearchOffset(0) },
    { limit: SpotifyService.clampSearchLimit(10), offset: SpotifyService.normalizeSearchOffset(10) },
  ];
}

const pages = replacementSearchPages();
assert.deepStrictEqual(pages, [
  { limit: 10, offset: 0 },
  { limit: 10, offset: 10 },
]);

/** Simulate two pages of distinct ids → 20 after merge. */
function mergeSearchPages(page0, page1) {
  const byId = new Map();
  for (const t of [...page0, ...page1]) {
    if (t && t.id) byId.set(t.id, t);
  }
  return Array.from(byId.values()).slice(0, 20);
}
const p0 = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }));
const p1 = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}` }));
assert.strictEqual(mergeSearchPages(p0, p1).length, 20);

console.log('spotifySearchLimit.test.js OK');
