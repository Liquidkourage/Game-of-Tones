/**
 * Named per-room timer registry (engineering feedback #9).
 * Scheduling the same name replaces the previous timer.
 */

const byRoom = new Map();

function roomMap(roomId) {
  const id = String(roomId || '');
  if (!id) return null;
  let m = byRoom.get(id);
  if (!m) {
    m = new Map();
    byRoom.set(id, m);
  }
  return m;
}

function clear(roomId, name) {
  const m = byRoom.get(String(roomId || ''));
  if (!m) return false;
  const t = m.get(name);
  if (!t) return false;
  clearTimeout(t);
  m.delete(name);
  if (m.size === 0) byRoom.delete(String(roomId));
  return true;
}

function clearAll(roomId) {
  const id = String(roomId || '');
  const m = byRoom.get(id);
  if (!m) return 0;
  let n = 0;
  for (const t of m.values()) {
    clearTimeout(t);
    n += 1;
  }
  byRoom.delete(id);
  return n;
}

/**
 * @param {string} roomId
 * @param {string} name
 * @param {number} ms
 * @param {() => void} fn
 * @param {{ callSequence?: number, getRoom?: (id: string) => any, requirePlaying?: boolean }} [guard]
 */
function schedule(roomId, name, ms, fn, guard = {}) {
  const m = roomMap(roomId);
  if (!m) return;
  clear(roomId, name);
  const seq = guard.callSequence;
  const getRoom = guard.getRoom;
  const requirePlaying = guard.requirePlaying !== false && typeof seq === 'number';
  const timerId = setTimeout(() => {
    m.delete(name);
    if (m.size === 0) byRoom.delete(String(roomId));
    if (requirePlaying && typeof getRoom === 'function') {
      const room = getRoom(roomId);
      if (!room || room.gameState !== 'playing') return;
      if (typeof seq === 'number' && (room.callSequence || 0) !== seq) return;
    }
    try {
      fn();
    } catch (e) {
      console.error(`playbackTimers ${roomId}/${name}:`, e?.message || e);
    }
  }, Math.max(0, Number(ms) || 0));
  m.set(name, timerId);
}

/** Test helper */
function _resetForTests() {
  for (const id of [...byRoom.keys()]) clearAll(id);
}

module.exports = {
  schedule,
  clear,
  clearAll,
  _resetForTests,
};
