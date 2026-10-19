'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { roomStateSafeForPlayers } = require('./roomStateForPlayers');

describe('roomStateSafeForPlayers', () => {
  it('nulls call identity and strips reveal / winner / request leaks', () => {
    const safe = roomStateSafeForPlayers({
      pattern: 'line',
      currentSong: { id: 'abc', name: 'Secret Title' },
      playedSongs: [{ id: 'x' }],
      playedSongIds: ['x'],
      totalPlayedCount: 3,
      currentSongIndex: 2,
      totalSongs: 75,
      publicDisplayRevealState: { letters: ['A'] },
      lastDisplayWinner: { name: 'Pat' },
      publicDisplayFontSize: 2,
      publicDisplayCallListMode: 'auto',
      letterRevealIntervalSec: 1,
      publicDisplayTitleRevealMode: 'letters',
      publicDisplayLetterRevealToast: true,
      playerFeedback: [{ message: 'hi' }],
      songRequests: [{ title: 'req' }],
      playlists: [{ id: 'p' }],
      selectedDeviceId: 'dev',
      winners: [{ name: 'Pat' }],
      roundWinners: [{ playerName: 'Pat' }],
      bingoCardsReady: true,
    });
    assert.equal(safe.pattern, 'line');
    assert.equal(safe.bingoCardsReady, true);
    assert.equal(safe.currentSong, null);
    assert.deepEqual(safe.playedSongs, []);
    assert.deepEqual(safe.playedSongIds, []);
    assert.equal(safe.totalPlayedCount, 0);
    assert.equal(safe.currentSongIndex, 0);
    assert.equal(safe.totalSongs, undefined);
    assert.equal('publicDisplayRevealState' in safe, false);
    assert.equal('lastDisplayWinner' in safe, false);
    assert.equal('winners' in safe, false);
    assert.equal('roundWinners' in safe, false);
    assert.equal('songRequests' in safe, false);
    assert.equal('playlists' in safe, false);
    assert.equal('selectedDeviceId' in safe, false);
  });

  it('passes through nullish payload', () => {
    assert.equal(roomStateSafeForPlayers(null), null);
    assert.equal(roomStateSafeForPlayers(undefined), undefined);
  });
});
