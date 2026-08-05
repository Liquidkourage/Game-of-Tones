/**
 * Persist room-level audience song requests (Requests meta-round queue).
 * Survives server restarts when DATABASE_URL is set. Memory-only when db is null.
 */

const MAX_ROOM_SONG_REQUESTS = 500;

async function ensureRoomSongRequestsTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS room_song_requests (
      room_id VARCHAR(64) PRIMARY KEY,
      requests JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return true;
}

function sanitizeResolvedSong(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 200) : '';
  const artist = typeof raw.artist === 'string' ? raw.artist.trim().slice(0, 200) : '';
  if (!id || !name || !artist) return undefined;
  const duration = Number(raw.duration);
  return {
    id,
    name,
    artist,
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...(raw.explicit === true ? { explicit: true } : {}),
  };
}

function sanitizeSongRequestEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const submittedAt = Number(raw.submittedAt);
  const status =
    raw.status === 'approved' || raw.status === 'rejected' ? raw.status : 'pending';
  if (!id || !title || !Number.isFinite(submittedAt)) return null;
  const resolvedSong = sanitizeResolvedSong(raw.resolvedSong);
  const moderatedAt = Number(raw.moderatedAt);
  return {
    id,
    playerName:
      typeof raw.playerName === 'string' && raw.playerName.trim()
        ? raw.playerName.trim().slice(0, 120)
        : 'Player',
    title,
    artist:
      typeof raw.artist === 'string' ? raw.artist.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
    submittedAt,
    status,
    ...(Number.isFinite(moderatedAt) ? { moderatedAt } : {}),
    ...(resolvedSong ? { resolvedSong } : {}),
  };
}

function normalizeRequestsList(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const entry of rows) {
    const sanitized = sanitizeSongRequestEntry(entry);
    if (sanitized) out.push(sanitized);
  }
  return out.slice(-MAX_ROOM_SONG_REQUESTS);
}

async function loadRequests(db, roomId) {
  if (!db || !roomId) return [];
  const r = await db.query(`SELECT requests FROM room_song_requests WHERE room_id = $1`, [
    String(roomId),
  ]);
  if (r.rows.length === 0) return [];
  return normalizeRequestsList(r.rows[0].requests);
}

async function saveRequests(db, roomId, requests) {
  if (!db || !roomId) return false;
  const normalized = normalizeRequestsList(requests);
  await db.query(
    `INSERT INTO room_song_requests (room_id, requests, updated_at)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (room_id) DO UPDATE SET
       requests = EXCLUDED.requests,
       updated_at = CURRENT_TIMESTAMP`,
    [String(roomId), JSON.stringify(normalized)],
  );
  return true;
}

async function clearRequests(db, roomId) {
  if (!db || !roomId) return false;
  await db.query(`DELETE FROM room_song_requests WHERE room_id = $1`, [String(roomId)]);
  return true;
}

module.exports = {
  MAX_ROOM_SONG_REQUESTS,
  ensureRoomSongRequestsTable,
  normalizeRequestsList,
  loadRequests,
  saveRequests,
  clearRequests,
};
