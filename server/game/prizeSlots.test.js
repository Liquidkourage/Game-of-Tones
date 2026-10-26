const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePrizeSlots,
  matchOpenPrizeSlots,
  filterMatchedSlotsByPolicy,
  markPrizeSlotsClaimed,
  openPrizeSlots,
  checkOrientedLines,
} = require('./prizeSlots');
const { FREE_SPACE_SONG_ID } = require('./markedSquare');

function makeCard(markedPositions, songByPos = {}) {
  const squares = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const position = `${r}-${c}`;
      const isFree = r === 2 && c === 2;
      const songId = isFree
        ? FREE_SPACE_SONG_ID
        : songByPos[position] || `song-${position}`;
      squares.push({
        position,
        songId,
        marked: isFree || markedPositions.includes(position),
        isFreeSpace: isFree,
      });
    }
  }
  return { size: 5, squares, cardId: 'card-1' };
}

function calledFromMarks(card) {
  return card.squares.filter((s) => s.marked && !s.isFreeSpace).map((s) => s.songId);
}

describe('normalizePrizeSlots', () => {
  it('caps and defaults labels', () => {
    const slots = normalizePrizeSlots([
      { pattern: 'line_row' },
      { pattern: 'line_col', label: ' Col win ' },
      { pattern: 'nope' },
    ]);
    assert.equal(slots.length, 3);
    assert.equal(slots[0].pattern, 'line_row');
    assert.equal(slots[0].label, 'First row');
    assert.equal(slots[1].label, 'Col win');
    assert.equal(slots[2].pattern, 'line');
  });
});

describe('line_row / line_col', () => {
  it('row-only matches a completed row, not a column alone', () => {
    const rowCard = makeCard(['0-0', '0-1', '0-2', '0-3', '0-4']);
    const played = calledFromMarks(rowCard);
    const rowOk = checkOrientedLines(rowCard, played, 1, 'row');
    const colFail = checkOrientedLines(rowCard, played, 1, 'col');
    assert.equal(rowOk.valid, true);
    assert.equal(colFail.valid, false);
  });

  it('column-only matches a completed column', () => {
    const colCard = makeCard(['0-0', '1-0', '2-0', '3-0', '4-0']);
    // center free is 2-2, column 0 needs 2-0 marked
    const played = calledFromMarks(colCard);
    const colOk = checkOrientedLines(colCard, played, 1, 'col');
    assert.equal(colOk.valid, true);
  });
});

describe('matchOpenPrizeSlots + policy', () => {
  it('matches both row and col slots when both complete', () => {
    // Full first row + first column (corner shared)
    const card = makeCard(['0-0', '0-1', '0-2', '0-3', '0-4', '1-0', '2-0', '3-0', '4-0']);
    const room = {
      calledSongIds: calledFromMarks(card),
      prizeSlots: normalizePrizeSlots([
        { id: 'a', pattern: 'line_row', label: 'Row' },
        { id: 'b', pattern: 'line_col', label: 'Col' },
      ]),
      multiSlotWinPolicy: 'multi_slot_any',
    };
    const matched = matchOpenPrizeSlots(card, room);
    assert.equal(matched.length, 2);
    assert.deepEqual(
      matched.map((m) => m.slot.id),
      ['a', 'b'],
    );
  });

  it('one_per_player blocks a second claim after a slot is taken', () => {
    const card = makeCard(['0-0', '0-1', '0-2', '0-3', '0-4']);
    const room = {
      calledSongIds: calledFromMarks(card),
      multiSlotWinPolicy: 'multi_slot_one_per_player',
      prizeSlots: normalizePrizeSlots([
        { id: 'a', pattern: 'line_row', label: 'Row' },
        { id: 'b', pattern: 'four_corners', label: 'Corners' },
      ]),
    };
    room.prizeSlots[0].claimedBy = {
      playerId: 'sock1',
      participantId: 'p1',
      playerName: 'Jay',
      cardId: 'card-1',
      at: Date.now(),
    };
    const raw = matchOpenPrizeSlots(card, room);
    // row already claimed — only open slots considered; row card won't match corners
    assert.equal(raw.length, 0);
    const filtered = filterMatchedSlotsByPolicy(
      [{ slot: room.prizeSlots[1], validation: { valid: true } }],
      room,
      { id: 'sock1', participantId: 'p1' },
      'card-2',
    );
    assert.equal(filtered.length, 0);
  });

  it('markPrizeSlotsClaimed awards open matched ids only', () => {
    const room = {
      prizeSlots: normalizePrizeSlots([
        { id: 'a', pattern: 'line_row', label: 'Row' },
        { id: 'b', pattern: 'line_col', label: 'Col' },
      ]),
    };
    const awarded = markPrizeSlotsClaimed(room, ['a', 'b'], {
      playerId: 's1',
      playerName: 'A',
      cardId: 'c1',
    });
    assert.equal(awarded.length, 2);
    assert.equal(openPrizeSlots(room).length, 0);
  });
});
