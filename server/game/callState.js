/**
 * Single writer for room call state: `calledSongIds` + `currentSong`.
 * All mutations of those fields should go through this module.
 */

function ensureCalledList(room) {
  if (!room) return [];
  if (!Array.isArray(room.calledSongIds)) room.calledSongIds = [];
  return room.calledSongIds;
}

function normalizeCurrentSong(song) {
  if (!song || !song.id) return null;
  return {
    id: song.id,
    name: song.name,
    artist: song.artist,
    explicit: song.explicit === true,
    ...(song.youtubeMusic === true ? { youtubeMusic: true } : {}),
    ...(song.appleMusic === true ? { appleMusic: true } : {}),
  };
}

/** Clear call log + now-playing. Does not touch currentSongIndex / timers. */
function resetCalls(room) {
  if (!room) return;
  room.calledSongIds = [];
  room.currentSong = null;
}

/** Replace the entire called list (e.g. play-order prefix sync). */
function setCalledSongIds(room, ids) {
  if (!room) return;
  room.calledSongIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  room.callSequence = (room.callSequence || 0) + 1;
}

/** Set or clear currentSong only (bump / undo / display). */
function setCurrentSong(room, songOrNull) {
  if (!room) return;
  room.currentSong = songOrNull ? normalizeCurrentSong(songOrNull) : null;
}

/**
 * Call a song: set currentSong and ensure its id is in calledSongIds.
 * @returns {{ added: boolean }}
 */
function callSong(room, song) {
  if (!room || !song?.id) return { added: false };
  setCurrentSong(room, song);
  ensureCalledList(room);
  const added = !room.calledSongIds.includes(song.id);
  if (added) room.calledSongIds.push(song.id);
  room.callSequence = (room.callSequence || 0) + 1;
  return { added, callSequence: room.callSequence };
}

/** Append a called id without changing currentSong. */
function appendCalledSongId(room, songId) {
  if (!room || !songId) return false;
  ensureCalledList(room);
  if (room.calledSongIds.includes(songId)) return false;
  room.calledSongIds.push(songId);
  return true;
}

/** Undo / restore previous now-playing snapshot. */
function restoreCurrentSong(room, previousSong) {
  if (!room) return;
  room.currentSong = previousSong ? normalizeCurrentSong(previousSong) : null;
}

module.exports = {
  ensureCalledList,
  normalizeCurrentSong,
  resetCalls,
  setCalledSongIds,
  setCurrentSong,
  callSong,
  appendCalledSongId,
  restoreCurrentSong,
};
