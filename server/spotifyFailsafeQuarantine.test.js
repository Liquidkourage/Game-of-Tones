/**
 * Traffic failsafe must soft-quarantine without clearing tokens (contract test).
 */
const assert = require('assert');
const SpotifyService = require('./spotify.js');

const svc = new SpotifyService();
assert.strictEqual(typeof svc.applyTrafficBurstQuarantine, 'function');
assert.strictEqual(svc.isQuarantined(), false);

svc.applyTrafficBurstQuarantine(30_000, 'tempo_failsafe_burst');
assert.strictEqual(svc.isQuarantined(), true);
assert.ok(svc.getQuarantineRemainingSec() > 0);
assert.ok(svc.getQuarantineRemainingSec() <= 30);
assert.strictEqual(svc._quarantineSource, 'tempo_failsafe_burst');
assert.ok(svc._last429Incident);
assert.strictEqual(svc._last429Incident.spotifyErrorReason, 'TEMPO_TRAFFIC_BURST');

svc.clearRateLimitQuarantine();
assert.strictEqual(svc.isQuarantined(), false);

console.log('spotifyFailsafeQuarantine.test.js OK');
