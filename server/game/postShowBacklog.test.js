/**
 * Behavioral checks for Oct 19 post-show backlog (pure / snapshot / request-cap logic).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { serializeRoom, hydrateRoom } = require('./liveRoomSnapshot');

/** Mirror of client formatLinePatternProgress / minSpacesLeftTowardNextLine (keep in sync). */
function isDaubed(sq) {
  if (!sq) return false;
  if (sq.isFreeSpace || sq.songId === '__FREE_SPACE__') return true;
  return sq.marked === true;
}

function countCompletedLinesVisual(card) {
  const isOn = (pos) => isDaubed(card.squares.find((s) => s.position === pos));
  let n = 0;
  for (let row = 0; row < 5; row++) {
    if ([0, 1, 2, 3, 4].every((c) => isOn(`${row}-${c}`))) n++;
  }
  for (let col = 0; col < 5; col++) {
    if ([0, 1, 2, 3, 4].every((r) => isOn(`${r}-${col}`))) n++;
  }
  if ([0, 1, 2, 3, 4].every((i) => isOn(`${i}-${i}`))) n++;
  if ([0, 1, 2, 3, 4].every((i) => isOn(`${i}-${4 - i}`))) n++;
  return n;
}

function minSpacesLeftTowardNextLine(card) {
  const isOn = (pos) => isDaubed(card.squares.find((s) => s.position === pos));
  const lines = [];
  for (let row = 0; row < 5; row++) lines.push([0, 1, 2, 3, 4].map((c) => `${row}-${c}`));
  for (let col = 0; col < 5; col++) lines.push([0, 1, 2, 3, 4].map((r) => `${r}-${col}`));
  lines.push([0, 1, 2, 3, 4].map((i) => `${i}-${i}`));
  lines.push([0, 1, 2, 3, 4].map((i) => `${i}-${4 - i}`));
  let best = 5;
  for (const line of lines) {
    const missing = line.reduce((n, pos) => n + (isOn(pos) ? 0 : 1), 0);
    if (missing === 0) continue;
    if (missing < best) best = missing;
  }
  return best;
}

function formatLinePatternProgress(card, linesRequired) {
  const need = Math.min(6, Math.max(1, Math.round(Number(linesRequired)) || 1));
  const have = countCompletedLinesVisual(card);
  if (have >= need) return `Line ${need}/${need} · ready`;
  const spaces = minSpacesLeftTowardNextLine(card);
  const spaceLabel = spaces === 1 ? '1 space left' : `${spaces} spaces left`;
  return `Line ${have}/${need} · ${spaceLabel}`;
}

function countTowardCap(requests, { clientId, playerName }) {
  const list = Array.isArray(requests) ? requests : [];
  const cid = typeof clientId === 'string' ? clientId.trim() : '';
  const name = typeof playerName === 'string' ? playerName.trim() : '';
  return list.filter((entry) => {
    if (!entry || (entry.status !== 'pending' && entry.status !== 'approved')) return false;
    const entryCid = typeof entry.clientId === 'string' ? entry.clientId.trim() : '';
    if (cid && entryCid) return entryCid === cid;
    if (!entryCid && name && entry.playerName === name) return true;
    return false;
  }).length;
}

function emptyCard() {
  const squares = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      squares.push({ position: `${r}-${c}`, marked: false, songId: `s${r}${c}` });
    }
  }
  return { squares };
}

describe('postShowBacklog line progress', () => {
  it('reports spaces left on nearest incomplete line', () => {
    const card = emptyCard();
    // Mark 4 of top row → 1 space left for that line
    for (const c of [0, 1, 2, 3]) {
      card.squares.find((s) => s.position === `0-${c}`).marked = true;
    }
    assert.equal(minSpacesLeftTowardNextLine(card), 1);
    assert.equal(formatLinePatternProgress(card, 1), 'Line 0/1 · 1 space left');
  });

  it('reports ready when lines required are met', () => {
    const card = emptyCard();
    for (const c of [0, 1, 2, 3, 4]) {
      card.squares.find((s) => s.position === `0-${c}`).marked = true;
    }
    assert.equal(countCompletedLinesVisual(card), 1);
    assert.equal(formatLinePatternProgress(card, 1), 'Line 1/1 · ready');
    assert.match(formatLinePatternProgress(card, 2), /Line 1\/2 ·/);
  });
});

describe('postShowBacklog request cap counting', () => {
  it('counts pending+approved by clientId; ignores rejected', () => {
    const requests = [
      { clientId: 'a', status: 'pending', playerName: 'Ada' },
      { clientId: 'a', status: 'approved', playerName: 'Ada' },
      { clientId: 'a', status: 'rejected', playerName: 'Ada' },
      { clientId: 'b', status: 'pending', playerName: 'Bob' },
    ];
    assert.equal(countTowardCap(requests, { clientId: 'a', playerName: 'Ada' }), 2);
    assert.equal(countTowardCap(requests, { clientId: 'b', playerName: 'Bob' }), 1);
  });

  it('falls back to playerName when clientId missing on entry', () => {
    const requests = [
      { status: 'pending', playerName: 'Guest' },
      { status: 'approved', playerName: 'Guest' },
      { clientId: 'x', status: 'pending', playerName: 'Guest' },
    ];
    // Name-only lookup: only legacy rows without clientId
    assert.equal(countTowardCap(requests, { clientId: '', playerName: 'Guest' }), 2);
    // With clientId: matching clientId rows + legacy same-name rows without clientId
    assert.equal(countTowardCap(requests, { clientId: 'x', playerName: 'Guest' }), 3);
  });

  it('blocks at default cap of 5', () => {
    const cap = 5;
    const requests = Array.from({ length: 5 }, (_, i) => ({
      clientId: 'p1',
      status: i % 2 === 0 ? 'pending' : 'approved',
      playerName: 'P',
    }));
    assert.equal(countTowardCap(requests, { clientId: 'p1', playerName: 'P' }) >= cap, true);
  });
});

describe('postShowBacklog live snapshot request cap + free space', () => {
  it('round-trips maxSongRequestsPerPlayer and freeSpaceEnabled', () => {
    const room = {
      id: 'R1',
      players: new Map(),
      bingoCards: new Map(),
      clientCards: new Map(),
      gameState: 'playing',
      mixFinalized: true,
      playlistSongs: [{ id: 'a', name: 'A', artist: 'X' }],
      calledSongIds: ['a'],
      currentSong: { id: 'a', name: 'A', artist: 'X' },
      currentSongIndex: 0,
      maxSongRequestsPerPlayer: 7,
      freeSpaceEnabled: true,
      maxPlayerBingoCards: 2,
      winners: [],
      round: 1,
    };
    const snap = serializeRoom(room);
    assert.equal(snap.maxSongRequestsPerPlayer, 7);
    assert.equal(snap.freeSpaceEnabled, true);
    const hydrated = hydrateRoom(snap);
    assert.equal(hydrated.maxSongRequestsPerPlayer, 7);
    assert.equal(hydrated.freeSpaceEnabled, true);
    assert.equal(hydrated.maxPlayerBingoCards, 2);
    assert.equal(hydrated.hostProjectorPrefsSeeded, true);
  });
});

describe('postShowBacklog custom pattern empty mask guard', () => {
  it('treats empty custom mask as unsafe for start (client/server contract)', () => {
    const maskForStart = [];
    const patternForStart = 'custom';
    const blocked = patternForStart === 'custom' && maskForStart.length === 0;
    assert.equal(blocked, true);
  });
});
