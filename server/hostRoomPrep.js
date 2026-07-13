/**
 * Persist host round prep (event rounds + snapshots) per Tempo account + room — survives browser site-data clears.
 * Requires DATABASE_URL and users table (host JWT maps to users.id).
 */

async function ensureHostRoomPrepTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS host_room_prep (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_id VARCHAR(64) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, room_id)
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_host_room_prep_user_updated ON host_room_prep (user_id, updated_at DESC)`,
  );
  return true;
}

async function getHostRoomPrep(db, userId, roomId) {
  if (!db || userId == null || !roomId) return null;
  const r = await db.query(`SELECT payload, updated_at FROM host_room_prep WHERE user_id = $1 AND room_id = $2`, [
    userId,
    roomId,
  ]);
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return { payload: row.payload, updatedAt: row.updated_at };
}

async function upsertHostRoomPrep(db, userId, roomId, payloadObject) {
  if (!db || userId == null || !roomId) throw new Error('upsertHostRoomPrep: missing db, userId, or roomId');
  const r = await db.query(
    `INSERT INTO host_room_prep (user_id, room_id, payload, updated_at)
     VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, room_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING updated_at`,
    [userId, roomId, JSON.stringify(payloadObject)],
  );
  return r.rows[0].updated_at;
}

async function deleteHostRoomPrep(db, userId, roomId) {
  if (!db || userId == null || !roomId) return false;
  await db.query(`DELETE FROM host_room_prep WHERE user_id = $1 AND room_id = $2`, [userId, roomId]);
  return true;
}

/**
 * Org-owner audit: newest prep row for a room whose owner is in organizationId.
 * Does not change getHostRoomPrep behavior (still keyed by caller user_id).
 */
async function getOrgMemberPrepByRoomId(db, organizationId, roomId) {
  if (!db || organizationId == null || !roomId) return null;
  const r = await db.query(
    `SELECT p.user_id AS user_id, p.payload, p.updated_at,
            u.email AS host_email, u.display_name AS host_display_name
     FROM host_room_prep p
     INNER JOIN users u ON u.id = p.user_id
     WHERE p.room_id = $1
       AND u.organization_id = $2
     ORDER BY p.updated_at DESC
     LIMIT 1`,
    [String(roomId), organizationId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    userId: row.user_id,
    payload: row.payload,
    updatedAt: row.updated_at,
    hostEmail: row.host_email || null,
    hostDisplayName: row.host_display_name || null,
  };
}

module.exports = {
  ensureHostRoomPrepTable,
  getHostRoomPrep,
  upsertHostRoomPrep,
  deleteHostRoomPrep,
  getOrgMemberPrepByRoomId,
};
