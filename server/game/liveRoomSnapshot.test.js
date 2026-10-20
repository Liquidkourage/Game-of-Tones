const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { serializeRoom, hydrateRoom, shouldPersistRoom } = require('./liveRoomSnapshot');

function sampleRoom() {
  return {
    id: 'ROOM1',
    organizationId: 'DEFAULT',
    ownerUserId: 42,
    host: 'socket-host',
    hostClientId: 'host-cid',
    players: new Map([
      [
        'sock-p1',
        {
          id: 'sock-p1',
          name: 'Ada',
          clientId: 'cid-ada',
          isHost: false,
          inPerson: true,
          hasBingo: false,
          hasOfficialBingoWin: false,
          disqualifiedCardIds: [],
        },
      ],
      [
        'sock-host',
        { id: 'sock-host', name: 'Host', isHost: true, clientId: 'host-cid' },
      ],
    ]),
    bingoCards: new Map([
      [
        'sock-p1',
        {
          cardId: 'c1',
          squares: [{ position: '0-0', songId: 's1', marked: true }],
        },
      ],
    ]),
    clientCards: new Map(),
    gameState: 'playing',
    mixFinalized: true,
    playlistSongs: [
      { id: 'a', name: 'A', artist: 'X' },
      { id: 'b', name: 'B', artist: 'Y' },
      { id: 'c', name: 'C', artist: 'Z' },
    ],
    calledSongIds: ['a', 'b'],
    currentSong: { id: 'b', name: 'B', artist: 'Y' },
    currentSongIndex: 1,
    pattern: 'line',
    linesRequired: 1,
    customPattern: new Set(['0-0', '1-1']),
    winners: [],
    round: 2,
    snippetLength: 30,
    randomStarts: 'early',
  };
}

describe('liveRoomSnapshot', () => {
  it('serializeRoom drops socket keys and preserves call board + play order', () => {
    const snap = serializeRoom(sampleRoom());
    assert.equal(snap.id, 'ROOM1');
    assert.deepEqual(snap.calledSongIds, ['a', 'b']);
    assert.equal(snap.currentSong.id, 'b');
    assert.equal(snap.currentSongIndex, 1);
    assert.equal(snap.playlistSongs.length, 3);
    assert.deepEqual(snap.customPattern.sort(), ['0-0', '1-1']);
    assert.equal(snap.playersByClientId.length, 1);
    assert.equal(snap.playersByClientId[0].clientId, 'cid-ada');
    assert.ok(snap.cardsByClientId['cid-ada']);
    assert.equal(snap.needsHostResume, true);
    assert.equal(snap.host, undefined);
  });

  it('hydrateRoom restores Set + clientCards and flags needsHostResume', () => {
    const snap = serializeRoom(sampleRoom());
    const room = hydrateRoom(snap);
    assert.ok(room);
    assert.equal(room.host, null);
    assert.ok(room.customPattern instanceof Set);
    assert.ok(room.customPattern.has('0-0'));
    assert.equal(room.calledSongIds.length, 2);
    assert.equal(room.playlistSongs[0].id, 'a');
    assert.equal(room.needsHostResume, true);
    assert.equal(room.gameState, 'paused'); // mid-round → paused for host resume
    assert.ok(room.clientCards.has('cid-ada'));
    assert.equal(room.players.size, 0);
    assert.equal(room.hostProjectorPrefsSeeded, true);
    assert.equal(room.restoredFromLiveSnapshot, true);
  });

  it('round-trip keeps bingo validation inputs aligned', () => {
    const snap = serializeRoom(sampleRoom());
    const room = hydrateRoom(snap);
    assert.equal(room.currentSong.id, 'b');
    assert.ok(room.calledSongIds.includes(room.currentSong.id));
    assert.equal(room.playlistSongs[room.currentSongIndex].id, 'b');
  });

  it('shouldPersistRoom skips empty waiting lobbies', () => {
    assert.equal(
      shouldPersistRoom({ id: 'x', gameState: 'waiting', playlistSongs: [], calledSongIds: [] }),
      false,
    );
    assert.equal(shouldPersistRoom(sampleRoom()), true);
  });
});
