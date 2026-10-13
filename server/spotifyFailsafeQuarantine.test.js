/**
 * Distinguishes PROACTIVE traffic-burst protection from ACTUAL Spotify HTTP 429 quarantine.
 */
const assert = require('assert');
const SpotifyService = require('./spotify.js');

async function expectReject(promise, codeOrIncludes) {
  let threw = false;
  try {
    await promise;
  } catch (e) {
    threw = true;
    if (typeof codeOrIncludes === 'string') {
      assert.ok(
        e.code === codeOrIncludes || String(e.message || '').includes(codeOrIncludes),
        `expected ${codeOrIncludes}, got code=${e.code} msg=${e.message}`
      );
    }
  }
  assert.strictEqual(threw, true);
}

async function main() {
  // --- 1) Internal traffic spike must NOT interrupt healthy live playback ---
  const live = new SpotifyService({ clientId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', clientSecret: 'secretsecretsecretsecretsecre12' });
  assert.strictEqual(live.isQuarantined(), false);
  live.applyTrafficBurstQuarantine(60_000, 'tempo_failsafe_burst');
  assert.strictEqual(live.isQuarantined(), false, 'proactive protection must not set isQuarantined()');
  assert.strictEqual(live.isNonEssentialSuppressed(), true);
  assert.strictEqual(live.getNonEssentialSuppressionInfo().blocksPlayback, false);
  // Essential playback callers must still pass _ensureCanCallWebApi (token check aside).
  live.accessToken = 'test-token';
  live.tokenExpirationTime = Date.now() + 3_600_000;
  await live._ensureCanCallWebApi('startPlayback');
  await live._ensureCanCallWebApi('pausePlayback');
  await live._ensureCanCallWebApi('transferPlayback');
  await live._ensureCanCallWebApi('seekToPosition');
  await live._ensureCanCallWebApi('getUserDevices');

  // --- 2) Nonessential traffic suppressed during spike ---
  await expectReject(live._ensureCanCallWebApi('getUserPlaylists'), 'traffic_burst_nonessential_suppressed');
  await expectReject(live._ensureCanCallWebApi('getPlaylistTracks'), 'traffic_burst_nonessential_suppressed');
  await expectReject(live._ensureCanCallWebApi('searchTracks'), 'traffic_burst_nonessential_suppressed');
  assert.strictEqual(live.isNonEssentialTrafficBlocked(), true);

  live.clearNonEssentialSuppression();
  assert.strictEqual(live.isNonEssentialSuppressed(), false);
  await live._ensureCanCallWebApi('getUserPlaylists');

  // --- 3) Real Spotify 429 + Retry-After blocks essential playback ---
  const hard = new SpotifyService({ clientId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', clientSecret: 'secretsecretsecretsecretsecre12' });
  hard.accessToken = 'test-token';
  hard.tokenExpirationTime = Date.now() + 3_600_000;
  hard.applyRateLimitQuarantine(
    {
      statusCode: 429,
      headers: { 'retry-after': '90' },
      body: { error: { status: 429, message: 'Too many requests', reason: 'RATE_LIMITED' } },
    },
    'getUserPlaylists',
    { httpMethod: 'GET', httpPath: '/v1/me/playlists' }
  );
  assert.strictEqual(hard.isQuarantined(), true);
  assert.ok(hard.getQuarantineRemainingSec() > 0);
  assert.ok(hard.getQuarantineRemainingSec() <= 90);
  assert.strictEqual(hard._quarantineSpotifyRetryAfterSec, 90);
  assert.ok(hard._last429Incident);
  assert.strictEqual(hard._last429Incident.spotifyErrorReason, 'RATE_LIMITED');
  await expectReject(hard._ensureCanCallWebApi('startPlayback'), 'Spotify API quarantined');
  await expectReject(hard._ensureCanCallWebApi('getUserPlaylists'), 'spotify_quarantine');

  // --- 4) Different developer applications remain isolated ---
  const appA = new SpotifyService({
    clientId: '11111111111111111111111111111111',
    clientSecret: 'secretsecretsecretsecretsecre12',
  });
  const appB = new SpotifyService({
    clientId: '22222222222222222222222222222222',
    clientSecret: 'secretsecretsecretsecretsecre12',
  });
  appA.accessToken = 'a';
  appA.tokenExpirationTime = Date.now() + 3_600_000;
  appB.accessToken = 'b';
  appB.tokenExpirationTime = Date.now() + 3_600_000;
  assert.notStrictEqual(appA._pipelineClientIdPrefix, appB._pipelineClientIdPrefix);

  appA.applyTrafficBurstQuarantine(45_000, 'tempo_failsafe_burst');
  assert.strictEqual(appA.isNonEssentialSuppressed(), true);
  assert.strictEqual(appB.isNonEssentialSuppressed(), false);
  assert.strictEqual(appB.isQuarantined(), false);
  await appB._ensureCanCallWebApi('startPlayback');
  await appB._ensureCanCallWebApi('getUserPlaylists');
  await expectReject(appA._ensureCanCallWebApi('getUserPlaylists'), 'traffic_burst_nonessential_suppressed');
  await appA._ensureCanCallWebApi('startPlayback');

  // Real 429 on B must not flip A's quarantine (A only has nonessential suppress).
  appB.applyRateLimitQuarantine(
    {
      statusCode: 429,
      headers: { 'retry-after': '30' },
      body: { error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } },
    },
    'startPlayback'
  );
  assert.strictEqual(appB.isQuarantined(), true);
  assert.strictEqual(appB._last429Incident.quotaExceeded, true);
  assert.strictEqual(appA.isQuarantined(), false);
  await appA._ensureCanCallWebApi('startPlayback');

  console.log('spotifyFailsafeQuarantine.test.js OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
