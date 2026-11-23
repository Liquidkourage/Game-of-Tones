const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeKofiUrl,
  sanitizeCommunityChest,
  tipJarPublicPayload,
  DEFAULT_COMMUNITY_CHEST_URL,
} = require('./tips');

describe('Kommunity Chest / Ko-fi tip jar', () => {
  it('normalizes Ko-fi slugs and rejects non-ko-fi hosts', () => {
    assert.equal(sanitizeKofiUrl('kommunitychest'), DEFAULT_COMMUNITY_CHEST_URL);
    assert.equal(sanitizeKofiUrl('https://ko-fi.com/kommunitychest'), DEFAULT_COMMUNITY_CHEST_URL);
    assert.equal(sanitizeKofiUrl('https://venmo.com/x'), '');
  });

  it('exposes community chest alone without host tip rails', () => {
    const pub = tipJarPublicPayload({
      enabled: false,
      communityChest: {
        enabled: true,
        kofiUrl: 'https://ko-fi.com/kommunitychest',
      },
    });
    assert.ok(pub);
    assert.equal(pub.communityChest.enabled, true);
    assert.equal(pub.communityChest.kofiUrl, DEFAULT_COMMUNITY_CHEST_URL);
    assert.equal(pub.cardTipsEnabled, false);
    assert.deepEqual(pub.links, {});
  });

  it('keeps host rails when tip jar enabled alongside chest', () => {
    const pub = tipJarPublicPayload({
      enabled: true,
      links: { venmo: 'https://venmo.com/Host' },
      communityChest: {
        enabled: true,
        kofiUrl: 'kommunitychest',
        membershipUrl: 'https://ko-fi.com/kommunitychest',
      },
    });
    assert.ok(pub.links.venmo);
    assert.ok(pub.communityChest);
    assert.equal(sanitizeCommunityChest({ enabled: true }).kofiUrl, DEFAULT_COMMUNITY_CHEST_URL);
  });
});
