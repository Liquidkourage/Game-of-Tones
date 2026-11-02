const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalPlaylistIdForMatch,
  trackTitleArtistDedupKey,
  dedupeSongsByIdPreserveOrder,
  buildPerListUnique,
  assignGloballyUniqueFiveByFifteenColumns,
  flattenFiveByFifteenColumns,
  FIVE_BY_FIFTEEN_COLUMN_SLOTS,
} = require('./fiveByFifteenAssign');

function song(id, sourcePlaylistId, name = id, artist = 'Artist') {
  return { id, name, artist, sourcePlaylistId };
}

describe('fiveByFifteenAssign', () => {
  it('canonicalPlaylistIdForMatch strips spotify:playlist: prefix', () => {
    assert.equal(canonicalPlaylistIdForMatch('spotify:playlist:AbCdEfGhIjKlMnOpQrStUv'), 'AbCdEfGhIjKlMnOpQrStUv');
    assert.equal(canonicalPlaylistIdForMatch('plainId'), 'plainId');
  });

  it('trackTitleArtistDedupKey normalizes title+artist', () => {
    assert.equal(
      trackTitleArtistDedupKey({
        id: 'a',
        name: 'No One Knows!',
        artist: 'Queens of the Stone Age',
      }),
      trackTitleArtistDedupKey({
        id: 'b',
        name: 'no one knows',
        artist: 'Queens Of The Stone Age',
      }),
    );
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
        songOrder.push(song(`c${col}-s${i}`, `p${col}`, `Song ${col}-${i}`, `Artist ${col}`));
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

  it('prefers alternate tracks when title+artist collide across playlists with different ids', () => {
    const playlists = [
      { id: 'p0', name: 'GoT X The Y' },
      { id: 'p1', name: 'GoT With Special Guests' },
      { id: 'p2', name: 'C' },
      { id: 'p3', name: 'D' },
      { id: 'p4', name: 'E' },
    ];
    const songOrder = [];
    // Two remasters of the same song on p0 and p1
    songOrder.push(song('id-qotsa-a', 'p0', 'No One Knows', 'Queens of the Stone Age'));
    songOrder.push(song('id-qotsa-b', 'p1', 'No One Knows', 'Queens of the Stone Age'));
    // Enough unique fillers so both columns can reach 15 without needing both remasters
    for (let i = 0; i < 20; i++) {
      songOrder.push(song(`p0-fill-${i}`, 'p0', `Fill A ${i}`, 'Artist A'));
    }
    for (let i = 0; i < 20; i++) {
      songOrder.push(song(`p1-fill-${i}`, 'p1', `Fill B ${i}`, 'Artist B'));
    }
    for (let col = 2; col < 5; col++) {
      for (let i = 0; i < 20; i++) {
        songOrder.push(song(`c${col}-s${i}`, `p${col}`, `Song ${col}-${i}`, `Artist ${col}`));
      }
    }

    const perList = buildPerListUnique(playlists, songOrder);
    const { perListGloballyUnique, warnings } = assignGloballyUniqueFiveByFifteenColumns(
      perList,
      songOrder,
    );
    assert.equal(warnings.length, 0);
    const flat = flattenFiveByFifteenColumns(perListGloballyUnique);
    assert.equal(flat.length, 75);

    const qotsaIds = flat.filter((s) => /no one knows/i.test(s.name)).map((s) => s.id);
    assert.equal(qotsaIds.length, 1, 'only one No One Knows version in the 75');

    const softKeys = flat.map((s) => trackTitleArtistDedupKey(s)).filter(Boolean);
    assert.equal(new Set(softKeys).size, softKeys.length, 'no soft title+artist duplicates in pool');
  });
});
