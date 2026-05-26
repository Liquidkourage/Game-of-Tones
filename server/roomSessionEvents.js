/**
 * Durable room/session event ledger.
 * Used as a base for operational timelines, recaps, reporting, and support tooling.
 */

async function ensureRoomSessionEventsTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS room_session_events (
      id BIGSERIAL PRIMARY KEY,
      room_id VARCHAR(64) NOT NULL,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_room_session_events_room_created
     ON room_session_events (room_id, created_at DESC)`,
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_room_session_events_owner_created
     ON room_session_events (owner_user_id, created_at DESC)`,
  );
  return true;
}

function sanitizeEventPayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function mapRoomSessionEvent(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    ownerUserId: row.owner_user_id ?? null,
    organizationId: row.organization_id ?? null,
    eventType: row.event_type,
    payload: sanitizeEventPayload(row.payload),
    createdAt: row.created_at,
  };
}

async function appendRoomSessionEvent(
  db,
  { roomId, ownerUserId = null, organizationId = null, eventType, payload = {}, createdAt = null },
) {
  if (!db || !roomId || !eventType) return null;
  await ensureRoomSessionEventsTable(db);
  const r = await db.query(
    `INSERT INTO room_session_events (
       room_id,
       owner_user_id,
       organization_id,
       event_type,
       payload,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, CURRENT_TIMESTAMP))
     RETURNING id, room_id, owner_user_id, organization_id, event_type, payload, created_at`,
    [
      String(roomId).trim(),
      ownerUserId != null ? Number(ownerUserId) : null,
      organizationId != null ? Number(organizationId) : null,
      String(eventType).trim(),
      JSON.stringify(sanitizeEventPayload(payload)),
      createdAt,
    ],
  );
  return mapRoomSessionEvent(r.rows[0]);
}

async function listRoomSessionEvents(db, { roomId, ownerUserId = null, limit = 100 }) {
  if (!db || !roomId) return [];
  await ensureRoomSessionEventsTable(db);
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  const r = await db.query(
    `SELECT id, room_id, owner_user_id, organization_id, event_type, payload, created_at
     FROM room_session_events
     WHERE room_id = $1
       AND ($2::int IS NULL OR owner_user_id = $2)
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [String(roomId).trim(), ownerUserId != null ? Number(ownerUserId) : null, lim],
  );
  return r.rows.map(mapRoomSessionEvent);
}

module.exports = {
  ensureRoomSessionEventsTable,
  appendRoomSessionEvent,
  listRoomSessionEvents,
};
