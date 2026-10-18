const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalPlaylistIdForMatch,
  dedupeSongsByIdPreserveOrder,
  buildPerListUnique,
  assignGloballyUniqueFiveByFifteenColumns,
  flattenFiveByFifteenColumns,
  FIVE_BY_FIFTEEN_COLUMN_SLOTS,
} = require('./fiveByFifteenAssign');

function song(id, sourcePlaylistId) {
  return { id, name: id, sourcePlaylistId };
}

describe('fiveByFifteenAssign', () => {
  it('canonicalPlaylistIdForMatch strips spotify:playlist: prefix', () => {
    assert.equal(canonicalPlaylistIdForMatch('spotify:playlist:AbCdEfGhIjKlMnOpQrStUv'), 'AbCdEfGhIjKlMnOpQrStUv');
    assert.equal(canonicalPlaylistIdForMatch('plainId'), 'plainId');
  });

  it('dedupeSongsByIdPreserveOrder keeps first occurrence', () => {
    const out = dedupeSongsByIdPreserveOrder([
      song('a', 'p1'),
      song('b', 'p1'),
      song('a', 'p1'),
    ]);
    assert.deepEqual(
      out.map((s) => s.id),
      ['a', 'b'],
    );
  });

  it('assignGloballyUniqueFiveByFifteenColumns yields 15 unique per column, no cross-column id reuse', () => {
    const playlists = [
      { id: 'p0', name: 'A' },
      { id: 'p1', name: 'B' },
      { id: 'p2', name: 'C' },
      { id: 'p3', name: 'D' },
      { id: 'p4', name: 'E' },
    ];
    const songOrder = [];
    for (let col = 0; col < 5; col++) {
      for (let i = 0; i < 20; i++) {
        songOrder.push(song(`c${col}-s${i}`, `p${col}`));
      }
    }
    const perList = buildPerListUnique(playlists, songOrder);
    const { perListGloballyUnique, warnings } = assignGloballyUniqueFiveByFifteenColumns(
      perList,
      songOrder,
    );
    assert.equal(perListGloballyUnique.length, 5);
    assert.ok(Array.isArray(warnings));
    const allIds = [];
    for (const col of perListGloballyUnique) {
      assert.equal(col.songs.length, FIVE_BY_FIFTEEN_COLUMN_SLOTS);
      allIds.push(...col.songs.map((s) => s.id));
    }
    assert.equal(new Set(allIds).size, allIds.length, 'all 75 ids globally unique');
    const flat = flattenFiveByFifteenColumns(perListGloballyUnique);
    assert.equal(flat.length, 75);
  });
});
