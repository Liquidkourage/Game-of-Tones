/** Shared fixtures for game characterization tests. */

const { FREE_SPACE_SONG_ID } = require('./markedSquare');

/** Build a 5×5 card: song ids `r-c` except center free space. */
function makeGridCard(overrides = {}) {
  const squares = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const position = `${row}-${col}`;
      const isFree = row === 2 && col === 2;
      const base = isFree
        ? {
            position,
            songId: FREE_SPACE_SONG_ID,
            isFreeSpace: true,
            marked: true,
            title: 'FREE',
          }
        : {
            position,
            songId: `song-${position}`,
            isFreeSpace: false,
            marked: false,
            title: `Song ${position}`,
          };
      const over = overrides[position];
      squares.push(over ? { ...base, ...over } : base);
    }
  }
  return { id: 'p1', cardId: 'card-1', squares };
}

function markPositions(card, positions, { played = true } = {}) {
  const set = new Set(positions);
  for (const sq of card.squares) {
    if (!set.has(sq.position)) continue;
    if (sq.isFreeSpace || sq.songId === FREE_SPACE_SONG_ID) {
      sq.marked = true;
      continue;
    }
    sq.marked = true;
    if (!played) {
      // leave songId as-is; caller controls calledSongIds
    }
  }
  return card;
}

function roomWithCalls(pattern, calledSongIds, extra = {}) {
  return {
    pattern,
    calledSongIds: [...calledSongIds],
    ...extra,
  };
}

/** Song ids for every non-free square on the default grid card. */
function allPlayableSongIds(card) {
  return card.squares
    .filter((s) => !(s.isFreeSpace || s.songId === FREE_SPACE_SONG_ID))
    .map((s) => s.songId);
}

module.exports = {
  makeGridCard,
  markPositions,
  roomWithCalls,
  allPlayableSongIds,
};
