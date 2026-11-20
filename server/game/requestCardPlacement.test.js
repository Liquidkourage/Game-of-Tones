const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatRequestedByLabel,
  buildRequestAttributionBySongId,
  applyRequestAttributionToSong,
  approvedRequestSongsForPlayer,
  ensurePlayerRequestSongsOnPick,
} = require('./requestCardPlacement');

describe('formatRequestedByLabel', () => {
  it('formats one, two, and many names', () => {
    assert.equal(formatRequestedByLabel(['Alice']), 'Alice');
    assert.equal(formatRequestedByLabel(['Alice', 'Bob']), 'Alice & Bob');
    assert.equal(formatRequestedByLabel(['Alice', 'Bob', 'Cara']), 'Alice, Bob & Cara');
  });

  it('dedupes case-insensitively', () => {
    assert.equal(formatRequestedByLabel(['Alice', 'alice', 'Bob']), 'Alice & Bob');
  });
});

describe('buildRequestAttributionBySongId + apply', () => {
  it('aggregates approved requesters per song id', () => {
    const map = buildRequestAttributionBySongId([
      {
        status: 'approved',
        playerName: 'Alice',
        clientId: 'c1',
        resolvedSong: { id: 's1', name: 'A', artist: 'X' },
      },
      {
        status: 'approved',
        playerName: 'Bob',
        clientId: 'c2',
        resolvedSong: { id: 's1', name: 'A', artist: 'X' },
      },
      {
        status: 'pending',
        playerName: 'Cara',
        resolvedSong: { id: 's2', name: 'B', artist: 'Y' },
      },
    ]);
    const song = applyRequestAttributionToSong({ id: 's1', name: 'A', artist: 'X' }, map);
    assert.equal(song.requestedBy, 'Alice & Bob');
    assert.deepEqual(song.requestedByNames, ['Alice', 'Bob']);
    const other = applyRequestAttributionToSong({ id: 's2', name: 'B', artist: 'Y' }, map);
    assert.equal(other.requestedBy, undefined);
  });
});

describe('approvedRequestSongsForPlayer + ensurePlayerRequestSongsOnPick', () => {
  const pool = [
    { id: 'a', name: 'A', artist: '1' },
    { id: 'b', name: 'B', artist: '2' },
    { id: 'c', name: 'C', artist: '3' },
    { id: 'd', name: 'D', artist: '4' },
    { id: 'e', name: 'E', artist: '5' },
  ];
  const poolById = new Map(pool.map((s) => [s.id, s]));

  it('matches player by clientId and only approved songs in pool', () => {
    const mine = approvedRequestSongsForPlayer(
      [
        {
          status: 'approved',
          clientId: 'p1',
          playerName: 'Pat',
          resolvedSong: { id: 'c', name: 'C', artist: '3' },
        },
        {
          status: 'approved',
          clientId: 'other',
          playerName: 'Other',
          resolvedSong: { id: 'a', name: 'A', artist: '1' },
        },
        {
          status: 'approved',
          clientId: 'p1',
          playerName: 'Pat',
          resolvedSong: { id: 'missing', name: 'Z', artist: '9' },
        },
      ],
      { clientId: 'p1', name: 'Pat' },
      poolById,
    );
    assert.deepEqual(
      mine.map((s) => s.id),
      ['c'],
    );
  });

  it('swaps request songs onto the card when missing', () => {
    const pick = ensurePlayerRequestSongsOnPick(
      [
        { id: 'a', name: 'A', artist: '1' },
        { id: 'b', name: 'B', artist: '2' },
        { id: 'd', name: 'D', artist: '4' },
      ],
      [
        { id: 'c', name: 'C', artist: '3' },
        { id: 'e', name: 'E', artist: '5' },
      ],
      3,
    );
    const ids = new Set(pick.map((s) => s.id));
    assert.equal(pick.length, 3);
    assert.ok(ids.has('c'));
    assert.ok(ids.has('e'));
  });

  it('keeps already-present request songs', () => {
    const pick = ensurePlayerRequestSongsOnPick(
      [
        { id: 'c', name: 'C', artist: '3' },
        { id: 'a', name: 'A', artist: '1' },
        { id: 'b', name: 'B', artist: '2' },
      ],
      [{ id: 'c', name: 'C', artist: '3' }],
      3,
    );
    assert.deepEqual(
      pick.map((s) => s.id),
      ['c', 'a', 'b'],
    );
  });
});
