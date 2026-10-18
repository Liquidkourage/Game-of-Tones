/** Free-space + mark validity helpers (pure). */
const FREE_SPACE_SONG_ID = '__FREE_SPACE__';

function isFreeBingoSquare(square) {
  return !!(square && (square.isFreeSpace || square.songId === FREE_SPACE_SONG_ID));
}

/** FREE always counts for wins even if the player toggled the visual daub off for fun. */
function isMarkedSquareValidPlayed(square, playedSongIds) {
  if (!square) return false;
  if (isFreeBingoSquare(square)) return true;
  return !!(square.marked && Array.isArray(playedSongIds) && playedSongIds.includes(square.songId));
}

module.exports = {
  FREE_SPACE_SONG_ID,
  isFreeBingoSquare,
  isMarkedSquareValidPlayed,
};
