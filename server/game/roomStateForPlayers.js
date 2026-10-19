'use strict';

/**
 * Strip currently-playing / call-list / reveal payloads from room-state for player phones.
 * Players need pattern + board chrome only — not song IDs for auto-mark scripts.
 * (Asymmetric clients forever.)
 */
function roomStateSafeForPlayers(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const safe = { ...payload };
  safe.currentSong = null;
  safe.playedSongs = [];
  safe.playedSongIds = [];
  safe.totalPlayedCount = 0;
  safe.currentSongIndex = 0;
  safe.totalSongs = undefined;
  // Projector letter-reveal / winner overlays are not needed on phones and can leak titles.
  delete safe.publicDisplayRevealState;
  delete safe.lastDisplayWinner;
  delete safe.publicDisplayFontSize;
  delete safe.publicDisplayCallListMode;
  delete safe.letterRevealIntervalSec;
  delete safe.publicDisplayTitleRevealMode;
  delete safe.publicDisplayLetterRevealToast;
  delete safe.playerFeedback;
  delete safe.songRequests;
  delete safe.playlists;
  delete safe.selectedDeviceId;
  delete safe.winners;
  delete safe.roundWinners;
  return safe;
}

module.exports = {
  roomStateSafeForPlayers,
};
