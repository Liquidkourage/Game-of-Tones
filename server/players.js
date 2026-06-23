/**
 * Persistent player data: browser client_id, room sessions, bingo cards + marks.
 * Requires DATABASE_URL. Gracefully no-ops when db is null.
 */

const MAX_CLIENT_ID_LEN = 128;
const MAX_DISPLAY_NAME_LEN = 120;
const MAX_ROOM_ID_LEN = 64;

function normalizeClientId(raw) {
  const id = String(raw || '').trim();
  if (!id || id.length > MAX_CLIENT_ID_LEN) return null;
  return id;
}

function normalizeDisplayName(raw) {
  const name = String(raw || '').trim();
  if (!name) return 'Player';
  return name.slice(0, MAX_DISPLAY_NAME_LEN);
}

/** Stable round fingerprint from current room playback pool — survives reconnect and server restart. */
function buildRoundTokenFromRoom(room) {
  if (!room?.id) return 'unknown';
  const roundNum = typeof room.round === 'number' && Number.isFinite(room.round) ? room.round : 0;
  const roundPrefix = `${room.id}:r${roundNum}`;
  const playback = Array.isArray(room.playlistSongs) ? room.playlistSongs : [];
  if (playback.length > 0) {
    const head = playback
      .slice(0, 5)
      .map((s) => s?.id)
      .filter(Boolean)
      .join('.');
    return `${roundPrefix}:play:${playback.length}:${head}`;
  }
  const order = Array.isArray(room.finalizedSongOrder) ? room.finalizedSongOrder : [];
  if (order.length > 0) {
    const head = order
      .slice(0, 5)
      .map((s) => (typeof s === 'string' ? s : s?.id))
      .filter(Boolean)
      .join('.');
    return `${roundPrefix}:finalized:${order.length}:${head}`;
  }
  const pool = Array.isArray(room.oneBySeventyFivePool) ? room.oneBySeventyFivePool : [];
  if (pool.length > 0) {
    const head = pool
      .slice(0, 5)
      .map((s) => s?.id)
      .filter(Boolean)
      .join('.');
    return `${roundPrefix}:pool75:${pool.length}:${head}`;
  }
  return `${roundPrefix}:prep:${room.mixFinalized ? '1' : '0'}`;
}

function sanitizePreferences(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (raw.cardFontScale != null && Number.isFinite(Number(raw.cardFontScale))) {
    out.cardFontScale = Number(raw.cardFontScale);
  }
  if (typeof raw.cardTheme === 'string' && raw.cardTheme.trim()) {
    out.cardTheme = raw.cardTheme.trim().slice(0, 40);
  }
  if (raw.cardFontPercent != null && Number.isFinite(Number(raw.cardFontPercent))) {
    out.cardFontPercent = Math.min(200, Math.max(50, Math.round(Number(raw.cardFontPercent))));
  }
  return out;
}

async function ensurePlayerTables(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS tempo_players (
      client_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT 'Player',
      preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS player_room_sessions (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES tempo_players(client_id) ON DELETE CASCADE,
      room_id VARCHAR(64) NOT NULL,
      round_token TEXT NOT NULL DEFAULT '',
      host_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL DEFAULT 'Player',
      in_person BOOLEAN NOT NULL DEFAULT true,
      socket_id TEXT,
      card_json JSONB,
      joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (client_id, room_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_player_room_sessions_room ON player_room_sessions (room_id)
  `);
  await db.query(`
    ALTER TABLE player_room_sessions ADD COLUMN IF NOT EXISTS player_user_id INTEGER
  `);
  return true;
}

async function upsertPlayerProfile(db, { clientId, displayName, preferences, playerUserId }) {
  const cid = normalizeClientId(clientId);
  if (!db || !cid) return null;
  await ensurePlayerTables(db);
  const name = normalizeDisplayName(displayName);
  const prefs = sanitizePreferences(preferences);
  await db.query(
    `INSERT INTO tempo_players (client_id, display_name, preferences, player_user_id, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (client_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       preferences = tempo_players.preferences || EXCLUDED.preferences,
       player_user_id = COALESCE(EXCLUDED.player_user_id, tempo_players.player_user_id),
       updated_at = CURRENT_TIMESTAMP`,
    [cid, name, JSON.stringify(prefs), playerUserId ?? null]
  );
  return cid;
}

async function recordPlayerJoin(db, session) {
  const cid = normalizeClientId(session?.clientId);
  if (!db || !cid || !session?.roomId) return null;
  await upsertPlayerProfile(db, {
    clientId: cid,
    displayName: session.displayName,
    preferences: session.preferences,
    playerUserId: session.playerUserId ?? null,
  });
  await ensurePlayerTables(db);
  const roomId = String(session.roomId).slice(0, MAX_ROOM_ID_LEN);
  const roundToken = String(session.roundToken || buildRoundTokenFromRoom({ id: roomId }) || '').slice(0, 512);
  const name = normalizeDisplayName(session.displayName);
  await db.query(
    `INSERT INTO player_room_sessions
       (client_id, room_id, round_token, host_user_id, organization_id, display_name, in_person, socket_id, player_user_id, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (client_id, room_id) DO UPDATE SET
       round_token = EXCLUDED.round_token,
       host_user_id = COALESCE(EXCLUDED.host_user_id, player_room_sessions.host_user_id),
       organization_id = COALESCE(EXCLUDED.organization_id, player_room_sessions.organization_id),
       display_name = EXCLUDED.display_name,
       in_person = EXCLUDED.in_person,
       socket_id = EXCLUDED.socket_id,
       player_user_id = COALESCE(EXCLUDED.player_user_id, player_room_sessions.player_user_id),
       last_seen_at = CURRENT_TIMESTAMP`,
    [
      cid,
      roomId,
      roundToken,
      session.hostUserId ?? null,
      session.organizationId ?? null,
      name,
      session.inPerson !== false,
      session.socketId ? String(session.socketId) : null,
      session.playerUserId ?? null,
    ]
  );
  return cid;
}

async function savePlayerSession(db, session) {
  const cid = normalizeClientId(session?.clientId);
  if (!db || !cid || !session?.roomId) return false;
  await recordPlayerJoin(db, session);
  if (!session.card) return true;
  const roomId = String(session.roomId).slice(0, MAX_ROOM_ID_LEN);
  const roundToken = String(session.roundToken || '').slice(0, 512);
  await db.query(
    `UPDATE player_room_sessions SET
       card_json = $3::jsonb,
       round_token = $4,
       last_seen_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND room_id = $2`,
    [cid, roomId, JSON.stringify(session.card), roundToken]
  );
  return true;
}

async function loadPlayerSession(db, clientId, roomId, roundToken) {
  const cid = normalizeClientId(clientId);
  if (!db || !cid || !roomId) return null;
  await ensurePlayerTables(db);
  const rid = String(roomId).slice(0, MAX_ROOM_ID_LEN);
  const token = roundToken != null ? String(roundToken) : null;
  const r = await db.query(
    `SELECT client_id, room_id, round_token, display_name, in_person, card_json, joined_at, last_seen_at
     FROM player_room_sessions
     WHERE client_id = $1 AND room_id = $2`,
    [cid, rid]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (token && row.round_token && row.round_token !== token) return null;
  return {
    clientId: row.client_id,
    roomId: row.room_id,
    roundToken: row.round_token,
    displayName: row.display_name,
    inPerson: row.in_person !== false,
    card: row.card_json || null,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function clearRoomSessions(db, roomId) {
  if (!db || !roomId) return;
  await ensurePlayerTables(db);
  await db.query('DELETE FROM player_room_sessions WHERE room_id = $1', [String(roomId).slice(0, MAX_ROOM_ID_LEN)]);
}

async function listRoomSessions(db, roomId, limit = 100) {
  if (!db || !roomId) return [];
  await ensurePlayerTables(db);
  const r = await db.query(
    `SELECT client_id, display_name, in_person, round_token, joined_at, last_seen_at,
            (card_json IS NOT NULL) AS has_card
     FROM player_room_sessions
     WHERE room_id = $1
     ORDER BY last_seen_at DESC
     LIMIT $2`,
    [String(roomId).slice(0, MAX_ROOM_ID_LEN), Math.min(500, Math.max(1, limit))]
  );
  return r.rows;
}

module.exports = {
  ensurePlayerTables,
  buildRoundTokenFromRoom,
  upsertPlayerProfile,
  recordPlayerJoin,
  savePlayerSession,
  loadPlayerSession,
  clearRoomSessions,
  listRoomSessions,
};
