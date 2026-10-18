const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBingoForPattern,
  validateBingoCardGrid,
  normalizeLinesRequiredSrv,
  LINE_PATTERN_MAX_LINES_SRV,
  checkBingoWithPlayedSongs,
} = require('./validateBingo');
const { FREE_SPACE_SONG_ID } = require('./markedSquare');
const { makeGridCard, markPositions, roomWithCalls, allPlayableSongIds } = require('./testHelpers');

function callIdsForPositions(card, positions) {
  const set = new Set(positions);
  return card.squares
    .filter((s) => set.has(s.position) && s.songId !== FREE_SPACE_SONG_ID)
    .map((s) => s.songId);
}

describe('normalizeLinesRequiredSrv', () => {
  it('defaults and clamps to 1…LINE_PATTERN_MAX_LINES_SRV', () => {
    assert.equal(normalizeLinesRequiredSrv(undefined), 1);
    assert.equal(normalizeLinesRequiredSrv('3'), 3);
    assert.equal(normalizeLinesRequiredSrv(0), 1);
    assert.equal(normalizeLinesRequiredSrv(99), LINE_PATTERN_MAX_LINES_SRV);
  });
});

describe('validateBingoCardGrid', () => {
  it('accepts a complete 5×5 grid', () => {
    assert.equal(validateBingoCardGrid(makeGridCard()), true);
  });

  it('rejects wrong square count', () => {
    const card = makeGridCard();
    card.squares.pop();
    assert.equal(validateBingoCardGrid(card), false);
  });
});

describe('validateBingoForPattern — line', () => {
  it('accepts a full row when those songs are called (free space helps middle)', () => {
    const card = makeGridCard();
    const row2 = ['2-0', '2-1', '2-2', '2-3', '2-4'];
    markPositions(card, row2);
    const called = callIdsForPositions(card, row2);
    const result = validateBingoForPattern(card, roomWithCalls('line', called));
    assert.equal(result.valid, true);
    assert.match(result.reason, /Line bingo complete/);
  });

  it('rejects a marked row if songs were not called', () => {
    const card = makeGridCard();
    markPositions(card, ['0-0', '0-1', '0-2', '0-3', '0-4']);
    const result = validateBingoForPattern(card, roomWithCalls('line', []));
    assert.equal(result.valid, false);
  });

  it('includes currentSong defensively even if missing from calledSongIds', () => {
    const card = makeGridCard();
    // Column 0 needs 0-0,1-0,2-0,3-0,4-0 — center of card is 2-2 not 2-0
    const col0 = ['0-0', '1-0', '2-0', '3-0', '4-0'];
    markPositions(card, col0);
    const ids = callIdsForPositions(card, col0);
    const current = ids[ids.length - 1];
    const calledWithoutCurrent = ids.slice(0, -1);
    const result = validateBingoForPattern(
      card,
      roomWithCalls('line', calledWithoutCurrent, {
        currentSong: { id: current, name: 'Now playing' },
      }),
    );
    assert.equal(result.valid, true);
  });

  it('requires N lines when linesRequired > 1', () => {
    const card = makeGridCard();
    const row0 = ['0-0', '0-1', '0-2', '0-3', '0-4'];
    markPositions(card, row0);
    const called = callIdsForPositions(card, row0);
    const need2 = validateBingoForPattern(
      card,
      roomWithCalls('line', called, { linesRequired: 2 }),
    );
    assert.equal(need2.valid, false);
    assert.match(need2.reason, /Need 2/);
  });
});

describe('validateBingoForPattern — named shapes', () => {
  it('four_corners', () => {
    const card = makeGridCard();
    const corners = ['0-0', '0-4', '4-0', '4-4'];
    markPositions(card, corners);
    const called = callIdsForPositions(card, corners);
    assert.equal(validateBingoForPattern(card, roomWithCalls('four_corners', called)).valid, true);
    assert.equal(validateBingoForPattern(card, roomWithCalls('four_corners', [])).valid, false);
  });

  it('x uses both diagonals (center free)', () => {
    const card = makeGridCard();
    const xPos = [];
    for (let i = 0; i < 5; i++) {
      xPos.push(`${i}-${i}`, `${i}-${4 - i}`);
    }
    markPositions(card, xPos);
    const called = callIdsForPositions(card, xPos);
    assert.equal(validateBingoForPattern(card, roomWithCalls('x', called)).valid, true);
  });

  it('t / l / u / plus', () => {
    const shapes = {
      t: ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'],
      l: ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'],
      u: ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'],
      plus: ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'],
    };
    for (const [pattern, positions] of Object.entries(shapes)) {
      const card = makeGridCard();
      markPositions(card, positions);
      const called = callIdsForPositions(card, positions);
      const ok = validateBingoForPattern(card, roomWithCalls(pattern, called));
      assert.equal(ok.valid, true, `${pattern} should win`);
    }
  });

  it('full_card needs all playable songs called and marked', () => {
    const card = makeGridCard();
    const allPos = card.squares.map((s) => s.position);
    markPositions(card, allPos);
    const called = allPlayableSongIds(card);
    assert.equal(validateBingoForPattern(card, roomWithCalls('full_card', called)).valid, true);
    assert.equal(validateBingoForPattern(card, roomWithCalls('blackout', called)).valid, true);
    assert.equal(validateBingoForPattern(card, roomWithCalls('full_card', called.slice(0, 10))).valid, false);
  });

  it('custom mask', () => {
    const card = makeGridCard();
    const mask = ['0-0', '0-1', '1-0'];
    markPositions(card, mask);
    const called = callIdsForPositions(card, mask);
    const room = roomWithCalls('custom', called, {
      customPattern: new Set(mask),
    });
    assert.equal(validateBingoForPattern(card, room).valid, true);
  });

  it('unsupported pattern returns valid:false', () => {
    const card = makeGridCard();
    const result = validateBingoForPattern(card, roomWithCalls('not_a_real_pattern', []));
    assert.equal(result.valid, false);
    assert.match(result.reason, /Unsupported/);
  });
});

describe('checkBingoWithPlayedSongs', () => {
  it('reports completedLineCount', () => {
    const card = makeGridCard();
    const row0 = ['0-0', '0-1', '0-2', '0-3', '0-4'];
    markPositions(card, row0);
    const called = callIdsForPositions(card, row0);
    const r = checkBingoWithPlayedSongs(card, called, 1);
    assert.equal(r.valid, true);
    assert.ok(r.completedLineCount >= 1);
  });
});

describe('free space characterization', () => {
  it('FREE counts toward line even when marked:false (visual toggle)', () => {
    const card = makeGridCard();
    // Middle row: free at 2-2
    const row2 = ['2-0', '2-1', '2-2', '2-3', '2-4'];
    markPositions(card, row2);
    const free = card.squares.find((s) => s.position === '2-2');
    free.marked = false;
    const called = callIdsForPositions(card, row2);
    assert.equal(validateBingoForPattern(card, roomWithCalls('line', called)).valid, true);
  });
});
