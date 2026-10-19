/**
 * Persist mid-show room snapshots to Postgres (`live_rooms`).
 * Gracefully no-ops when db is null (local file-only mode).
 */

const DEFAULT_MAX_AGE_HOURS = 12;

async function ensureLiveRoomsTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS live_rooms (
      room_id VARCHAR(64) PRIMARY KEY,
      org_id TEXT,
      owner_user_id INTEGER,
      game_state TEXT,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_live_rooms_updated_at ON live_rooms (updated_at DESC)
  `);
  return true;
}

async function upsertLiveRoom(db, roomId, state, meta = {}) {
  if (!db || !roomId || !state) return false;
  try {
    await db.query(
      `
      INSERT INTO live_rooms (room_id, org_id, owner_user_id, game_state, state, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (room_id) DO UPDATE SET
        org_id = EXCLUDED.org_id,
        owner_user_id = EXCLUDED.owner_user_id,
        game_state = EXCLUDED.game_state,
        state = EXCLUDED.state,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        String(roomId).slice(0, 64),
        meta.orgId != null ? String(meta.orgId) : null,
        meta.ownerUserId != null && Number.isFinite(Number(meta.ownerUserId))
          ? Number(meta.ownerUserId)
          : null,
        meta.gameState != null ? String(meta.gameState).slice(0, 64) : null,
        JSON.stringify(state),
      ],
    );
    return true;
  } catch (e) {
    console.error('upsertLiveRoom failed:', e?.message || e);
    return false;
  }
}

async function loadLiveRoom(db, roomId) {
  if (!db || !roomId) return null;
  try {
    const { rows } = await db.query(
      `SELECT room_id, org_id, owner_user_id, game_state, state, updated_at
       FROM live_rooms WHERE room_id = $1`,
      [String(roomId).slice(0, 64)],
    );
    return rows[0] || null;
  } catch (e) {
    console.error('loadLiveRoom failed:', e?.message || e);
    return null;
  }
}

/**
 * Load recent non-ended snapshots for boot hydrate.
 * @param {number} [maxAgeHours]
 */
async function listRecentLiveRooms(db, maxAgeHours = DEFAULT_MAX_AGE_HOURS) {
  if (!db) return [];
  const hours = Number.isFinite(Number(maxAgeHours)) ? Math.max(1, Number(maxAgeHours)) : DEFAULT_MAX_AGE_HOURS;
  try {
    const { rows } = await db.query(
      `
      SELECT room_id, org_id, owner_user_id, game_state, state, updated_at
      FROM live_rooms
      WHERE updated_at > NOW() - ($1::text || ' hours')::interval
        AND COALESCE(game_state, '') <> 'ended'
      ORDER BY updated_at DESC
      `,
      [String(hours)],
    );
    return rows || [];
  } catch (e) {
    console.error('listRecentLiveRooms failed:', e?.message || e);
    return [];
  }
}

async function deleteLiveRoom(db, roomId) {
  if (!db || !roomId) return false;
  try {
    await db.query(`DELETE FROM live_rooms WHERE room_id = $1`, [String(roomId).slice(0, 64)]);
    return true;
  } catch (e) {
    console.error('deleteLiveRoom failed:', e?.message || e);
    return false;
  }
}

module.exports = {
  DEFAULT_MAX_AGE_HOURS,
  ensureLiveRoomsTable,
  upsertLiveRoom,
  loadLiveRoom,
  listRecentLiveRooms,
  deleteLiveRoom,
};
