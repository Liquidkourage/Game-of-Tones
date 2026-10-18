const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  FREE_SPACE_SONG_ID,
  isFreeBingoSquare,
  isMarkedSquareValidPlayed,
} = require('./markedSquare');

describe('markedSquare helpers', () => {
  it('identifies free space by flag or sentinel id', () => {
    assert.equal(isFreeBingoSquare({ isFreeSpace: true, songId: 'x' }), true);
    assert.equal(isFreeBingoSquare({ songId: FREE_SPACE_SONG_ID }), true);
    assert.equal(isFreeBingoSquare({ songId: 'song-1-2', marked: true }), false);
    assert.equal(isFreeBingoSquare(null), false);
  });

  it('FREE always counts as valid even if visually unmarked', () => {
    assert.equal(
      isMarkedSquareValidPlayed(
        { songId: FREE_SPACE_SONG_ID, isFreeSpace: true, marked: false },
        [],
      ),
      true,
    );
  });

  it('non-free requires marked AND song in played list', () => {
    const sq = { songId: 'a', marked: true };
    assert.equal(isMarkedSquareValidPlayed(sq, ['a']), true);
    assert.equal(isMarkedSquareValidPlayed(sq, ['b']), false);
    assert.equal(isMarkedSquareValidPlayed({ songId: 'a', marked: false }, ['a']), false);
  });
});
