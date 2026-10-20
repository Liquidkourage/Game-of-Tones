const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resetCalls,
  callSong,
  restoreCurrentSong,
  setCalledSongIds,
  setCurrentSong,
  appendCalledSongId,
} = require('./callState');

describe('callState', () => {
  it('resetCalls clears called + current', () => {
    const room = {
      calledSongIds: ['a', 'b'],
      currentSong: { id: 'b', name: 'B', artist: 'X' },
    };
    resetCalls(room);
    assert.deepEqual(room.calledSongIds, []);
    assert.equal(room.currentSong, null);
  });

  it('callSong sets current and appends once', () => {
    const room = { calledSongIds: [], currentSong: null };
    const song = { id: 's1', name: 'One', artist: 'A', explicit: true };
    assert.equal(callSong(room, song).added, true);
    assert.equal(room.currentSong.id, 's1');
    assert.equal(room.currentSong.explicit, true);
    assert.deepEqual(room.calledSongIds, ['s1']);
    assert.ok(room.calledSongIds.includes(room.currentSong.id));
    assert.equal(typeof room.callSequence, 'number');
    assert.ok(room.callSequence >= 1);
    assert.equal(callSong(room, song).added, false);
    assert.deepEqual(room.calledSongIds, ['s1']);
  });

  it('setCalledSongIds replaces the list', () => {
    const room = { calledSongIds: ['x'], callSequence: 0 };
    setCalledSongIds(room, ['a', null, 'b']);
    assert.deepEqual(room.calledSongIds, ['a', 'b']);
    assert.equal(room.callSequence, 1);
  });

  it('setCalledSongIds no-ops without bumping callSequence', () => {
    const room = { calledSongIds: ['a', 'b'], callSequence: 7 };
    setCalledSongIds(room, ['a', 'b']);
    assert.deepEqual(room.calledSongIds, ['a', 'b']);
    assert.equal(room.callSequence, 7);
    setCalledSongIds(room, ['a', null, 'b']);
    assert.deepEqual(room.calledSongIds, ['a', 'b']);
    assert.equal(room.callSequence, 7);
  });

  it('setCurrentSong / restoreCurrentSong', () => {
    const room = { currentSong: null };
    setCurrentSong(room, { id: 'n', name: 'N', artist: 'A', youtubeMusic: true });
    assert.equal(room.currentSong.youtubeMusic, true);
    restoreCurrentSong(room, { id: 'p', name: 'P', artist: 'B' });
    assert.equal(room.currentSong.id, 'p');
    restoreCurrentSong(room, null);
    assert.equal(room.currentSong, null);
  });

  it('appendCalledSongId does not touch currentSong', () => {
    const room = { calledSongIds: [], currentSong: { id: 'cur' } };
    assert.equal(appendCalledSongId(room, 'z'), true);
    assert.equal(room.currentSong.id, 'cur');
    assert.deepEqual(room.calledSongIds, ['z']);
  });
});
