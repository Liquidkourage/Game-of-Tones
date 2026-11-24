const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const SpotifyService = require('./spotify');

const { isAudibleNearEarlyStart, playbackItemMatchesTrackId } = SpotifyService;

describe('isAudibleNearEarlyStart', () => {
  it('rejects previous track still playing near the new Early ms', () => {
    const state = {
      is_playing: true,
      progress_ms: 36629,
      item: { id: 'oldTrackAAAAAAAAAAAAAA' },
    };
    assert.equal(
      isAudibleNearEarlyStart(state, 15952, { trackId: 'newTrackBBBBBBBBBBBBBB' }),
      false,
    );
  });

  it('accepts called track mid-Early (incl. linked_from)', () => {
    const state = {
      is_playing: true,
      progress_ms: 20000,
      item: { id: 'marketIdCCCCCCCCCCCCCC', linked_from: { id: 'calledTrackDDDDDDDDDD' } },
    };
    assert.equal(
      isAudibleNearEarlyStart(state, 18000, { trackId: 'calledTrackDDDDDDDDDD' }),
      true,
    );
    assert.equal(
      playbackItemMatchesTrackId(state.item, 'calledTrackDDDDDDDDDD'),
      true,
    );
  });

  it('does not guess when item is none', () => {
    const state = { is_playing: true, progress_ms: 20000, item: null };
    assert.equal(isAudibleNearEarlyStart(state, 18000, { trackId: 'anyTrackEEEEEEEEEEEE' }), false);
  });
});
