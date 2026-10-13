const assert = require('assert');
const meter = require('./spotifyWebApiMeter');

meter._resetForTests();

meter.recordEvent({
  clientIdPrefix: 'aaaa1111',
  hostUserId: '1',
  method: 'GET',
  path: '/v1/me/playlists',
  label: 'getUserPlaylists',
  category: 'preparation',
  status: 200,
});
meter.recordEvent({
  clientIdPrefix: 'aaaa1111',
  label: 'getPlaylistItems',
  status: 429,
  errorReason: 'QUOTA_EXCEEDED',
  errorMessage: 'API rate limit exceeded',
  retryAfterSec: 60,
});
meter.recordEvent({
  clientIdPrefix: 'bbbb2222',
  label: 'startPlayback',
  category: 'playback',
  status: 200,
});

assert.strictEqual(meter.getEstimateLast30s(), 3);
assert.strictEqual(meter.getDominantClientIdLast30s().clientIdPrefix, 'aaaa1111');
const diag = meter.getDiagnostics();
assert.ok(diag.quotaExceeded30s >= 1);
assert.ok(diag.http429Last30s >= 1);
assert.ok(diag.byClientId30s.aaaa1111 >= 2);
assert.ok(diag.estimate5m >= 3);

meter._resetForTests();
console.log('spotifyWebApiMeter.test.js OK');
