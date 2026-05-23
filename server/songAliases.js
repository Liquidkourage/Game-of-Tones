/**
 * Per-organization display aliases for tracks (title + artist on cards / projector).
 * Requires organizations + users.organization_id.
 */

async function ensureSongAliasesTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS song_display_aliases (
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL,
      display_title TEXT NOT NULL,
      display_artist TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, song_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_song_display_aliases_org
    ON song_display_aliases (organization_id)
  `);
  return true;
}

async function getOrganizationIdForUserId(db, userId) {
  if (!db || userId == null) return null;
  const r = await db.query(
    'SELECT organization_id FROM users WHERE id = $1',
    [userId],
  );
  const orgId = r.rows[0]?.organization_id;
  return orgId != null && Number.isFinite(Number(orgId)) ? Number(orgId) : null;
}

async function listAliasesForOrganization(db, organizationId) {
  if (!db || organizationId == null) return [];
  await ensureSongAliasesTable(db);
  const r = await db.query(
    `SELECT song_id, display_title, display_artist
     FROM song_display_aliases
     WHERE organization_id = $1
     ORDER BY song_id ASC`,
    [organizationId],
  );
  return r.rows.map((row) => ({
    songId: String(row.song_id),
    title: String(row.display_title),
    artist: String(row.display_artist),
  }));
}

async function upsertAlias(db, organizationId, songId, title, artist) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureSongAliasesTable(db);
  const sid = String(songId || '').trim();
  const t = String(title || '').trim();
  const a = String(artist || '').trim();
  if (!sid || !t || !a) throw new Error('songId, title, and artist are required');
  await db.query(
    `INSERT INTO song_display_aliases (organization_id, song_id, display_title, display_artist, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (organization_id, song_id) DO UPDATE SET
       display_title = EXCLUDED.display_title,
       display_artist = EXCLUDED.display_artist,
       updated_at = CURRENT_TIMESTAMP`,
    [organizationId, sid, t, a],
  );
  return { songId: sid, title: t, artist: a };
}

async function deleteAlias(db, organizationId, songId) {
  if (!db) return false;
  await ensureSongAliasesTable(db);
  const sid = String(songId || '').trim();
  if (!sid) return false;
  await db.query(
    'DELETE FROM song_display_aliases WHERE organization_id = $1 AND song_id = $2',
    [organizationId, sid],
  );
  return true;
}

/** Build { [songId]: { title, artist } } for socket responses. */
function aliasesToRecord(rows) {
  const out = {};
  for (const row of rows) {
    if (row?.songId && row.title && row.artist) {
      out[row.songId] = { title: row.title, artist: row.artist };
    }
  }
  return out;
}

module.exports = {
  ensureSongAliasesTable,
  getOrganizationIdForUserId,
  listAliasesForOrganization,
  upsertAlias,
  deleteAlias,
  aliasesToRecord,
};
