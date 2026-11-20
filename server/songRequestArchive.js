/**
 * Durable log of every audience/host song request received — survives room clears.
 * Separate from room_song_requests (live moderation queue).
 */

async function ensureSongRequestArchiveTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS song_request_archive (
      id BIGSERIAL PRIMARY KEY,
      request_id VARCHAR(160) NOT NULL,
      room_id VARCHAR(64) NOT NULL,
      organization_id INTEGER,
      host_user_id INTEGER,
      player_name VARCHAR(120),
      client_id VARCHAR(128),
      title VARCHAR(120) NOT NULL,
      artist VARCHAR(120) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      from_host BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_song JSONB,
      submitted_at TIMESTAMPTZ NOT NULL,
      moderated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (room_id, request_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS song_request_archive_submitted_at_idx
      ON song_request_archive (submitted_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS song_request_archive_org_submitted_idx
      ON song_request_archive (organization_id, submitted_at DESC)
  `);
  return true;
}

function archiveRowFromRequest(room, request) {
  if (!request || typeof request !== 'object') return null;
  const requestId = typeof request.id === 'string' ? request.id.trim() : '';
  const title =
    typeof request.title === 'string' ? request.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const submittedAt = Number(request.submittedAt);
  if (!requestId || !title || !Number.isFinite(submittedAt)) return null;
  const status =
    request.status === 'approved' || request.status === 'rejected' ? request.status : 'pending';
  const artist =
    typeof request.artist === 'string'
      ? request.artist.replace(/\s+/g, ' ').trim().slice(0, 120)
      : '';
  const moderatedAt = Number(request.moderatedAt);
  const clientId =
    typeof request.clientId === 'string' && request.clientId.trim()
      ? request.clientId.trim().slice(0, 128)
      : null;
  const resolvedSong =
    request.resolvedSong && typeof request.resolvedSong === 'object' ? request.resolvedSong : null;
  const orgId = room?.dbOrganizationId != null ? Number(room.dbOrganizationId) : null;
  const hostUserId = room?.ownerUserId != null ? Number(room.ownerUserId) : null;
  return {
    requestId,
    roomId: room?.id != null ? String(room.id) : '',
    organizationId: Number.isFinite(orgId) ? orgId : null,
    hostUserId: Number.isFinite(hostUserId) ? hostUserId : null,
    playerName:
      typeof request.playerName === 'string' && request.playerName.trim()
        ? request.playerName.trim().slice(0, 120)
        : 'Player',
    clientId,
    title,
    artist,
    status,
    fromHost: request.fromHost === true,
    resolvedSong,
    submittedAt: new Date(submittedAt),
    moderatedAt: Number.isFinite(moderatedAt) ? new Date(moderatedAt) : null,
  };
}

async function recordSongRequestReceived(db, room, request) {
  if (!db) return false;
  const row = archiveRowFromRequest(room, request);
  if (!row || !row.roomId) return false;
  await db.query(
    `INSERT INTO song_request_archive (
       request_id, room_id, organization_id, host_user_id, player_name, client_id,
       title, artist, status, from_host, resolved_song, submitted_at, moderated_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11::jsonb, $12, $13, CURRENT_TIMESTAMP
     )
     ON CONFLICT (room_id, request_id) DO UPDATE SET
       player_name = EXCLUDED.player_name,
       client_id = COALESCE(EXCLUDED.client_id, song_request_archive.client_id),
       title = EXCLUDED.title,
       artist = EXCLUDED.artist,
       status = EXCLUDED.status,
       from_host = EXCLUDED.from_host,
       resolved_song = COALESCE(EXCLUDED.resolved_song, song_request_archive.resolved_song),
       moderated_at = COALESCE(EXCLUDED.moderated_at, song_request_archive.moderated_at),
       organization_id = COALESCE(EXCLUDED.organization_id, song_request_archive.organization_id),
       host_user_id = COALESCE(EXCLUDED.host_user_id, song_request_archive.host_user_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      row.requestId,
      row.roomId,
      row.organizationId,
      row.hostUserId,
      row.playerName,
      row.clientId,
      row.title,
      row.artist,
      row.status,
      row.fromHost,
      row.resolvedSong ? JSON.stringify(row.resolvedSong) : null,
      row.submittedAt,
      row.moderatedAt,
    ],
  );
  return true;
}

async function updateSongRequestArchive(db, room, request) {
  return recordSongRequestReceived(db, room, request);
}

module.exports = {
  ensureSongRequestArchiveTable,
  archiveRowFromRequest,
  recordSongRequestReceived,
  updateSongRequestArchive,
};
