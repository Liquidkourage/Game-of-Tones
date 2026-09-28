/**
 * Org-scoped host assets shared by every host in the organization:
 * custom bingo patterns, combined (composite) recipes, and Spotify playlist refs.
 * Complements per-user host_room_prep so co-hosts can reuse each other's library.
 */

const MAX_CUSTOM_PATTERNS = 200;
const MAX_COMPOSITE_PATTERNS = 100;
const MAX_PLAYLIST_REFS = 300;

function sanitizeCustomPatternRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 80) : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  if (!id || !name) return null;
  const positions = Array.isArray(raw.positions)
    ? raw.positions.filter((p) => typeof p === 'string' && /^[0-4]-[0-4]$/.test(p)).slice(0, 25)
    : [];
  if (positions.length === 0) return null;
  return {
    id,
    name,
    positions,
    matchReverse: raw.matchReverse === true,
    matchAllowRotation: raw.matchAllowRotation === true,
    matchAllowMirror: raw.matchAllowMirror === true,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
}

function sanitizeCompositePatternRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 80) : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  if (!id || !name) return null;
  if (!raw.spec || typeof raw.spec !== 'object') return null;
  return {
    id,
    name,
    spec: raw.spec,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
}

function sanitizePlaylistRefRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : '';
  if (!id || id.startsWith('__')) return null;
  // Spotify playlist ids are 22-char base62; allow longer for future providers but cap.
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return null;
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 200)
      : 'Shared playlist';
  const tracks =
    typeof raw.tracks === 'number' && Number.isFinite(raw.tracks) && raw.tracks >= 0
      ? Math.min(10000, Math.floor(raw.tracks))
      : 0;
  return {
    id,
    name,
    tracks,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

function mergeById(existing, incoming, sanitize, max) {
  const map = new Map();
  for (const row of existing) {
    const s = sanitize(row);
    if (s) map.set(s.id, s);
  }
  for (const row of incoming) {
    const s = sanitize(row);
    if (s) map.set(s.id, s);
  }
  return Array.from(map.values())
    .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0))
    .slice(0, max);
}

async function ensureOrgHostSharedAssetsTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS org_host_shared_assets (
      organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      custom_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
      composite_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
      playlist_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return true;
}

async function getOrgHostSharedAssets(db, organizationId) {
  if (!db || organizationId == null) return null;
  await ensureOrgHostSharedAssetsTable(db);
  const r = await db.query(
    `SELECT custom_patterns, composite_patterns, playlist_refs, updated_at
     FROM org_host_shared_assets WHERE organization_id = $1`,
    [organizationId],
  );
  if (r.rows.length === 0) {
    return {
      customPatterns: [],
      compositePatterns: [],
      playlistRefs: [],
      updatedAt: null,
    };
  }
  const row = r.rows[0];
  return {
    customPatterns: Array.isArray(row.custom_patterns) ? row.custom_patterns : [],
    compositePatterns: Array.isArray(row.composite_patterns) ? row.composite_patterns : [],
    playlistRefs: Array.isArray(row.playlist_refs) ? row.playlist_refs : [],
    updatedAt: row.updated_at,
  };
}

/**
 * Merge incoming lists into the org row (by id). Omitted keys leave that field unchanged.
 */
async function mergeOrgHostSharedAssets(db, organizationId, patch) {
  if (!db || organizationId == null) throw new Error('mergeOrgHostSharedAssets: missing db or organizationId');
  await ensureOrgHostSharedAssetsTable(db);
  const current = await getOrgHostSharedAssets(db, organizationId);

  const customPatterns =
    patch && Array.isArray(patch.customPatterns)
      ? mergeById(current.customPatterns, patch.customPatterns, sanitizeCustomPatternRow, MAX_CUSTOM_PATTERNS)
      : current.customPatterns.map(sanitizeCustomPatternRow).filter(Boolean).slice(0, MAX_CUSTOM_PATTERNS);

  const compositePatterns =
    patch && Array.isArray(patch.compositePatterns)
      ? mergeById(
          current.compositePatterns,
          patch.compositePatterns,
          sanitizeCompositePatternRow,
          MAX_COMPOSITE_PATTERNS,
        )
      : current.compositePatterns.map(sanitizeCompositePatternRow).filter(Boolean).slice(0, MAX_COMPOSITE_PATTERNS);

  const playlistRefs =
    patch && Array.isArray(patch.playlistRefs)
      ? mergeById(current.playlistRefs, patch.playlistRefs, sanitizePlaylistRefRow, MAX_PLAYLIST_REFS)
      : current.playlistRefs.map(sanitizePlaylistRefRow).filter(Boolean).slice(0, MAX_PLAYLIST_REFS);

  const r = await db.query(
    `INSERT INTO org_host_shared_assets
       (organization_id, custom_patterns, composite_patterns, playlist_refs, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (organization_id) DO UPDATE SET
       custom_patterns = EXCLUDED.custom_patterns,
       composite_patterns = EXCLUDED.composite_patterns,
       playlist_refs = EXCLUDED.playlist_refs,
       updated_at = CURRENT_TIMESTAMP
     RETURNING updated_at`,
    [
      organizationId,
      JSON.stringify(customPatterns),
      JSON.stringify(compositePatterns),
      JSON.stringify(playlistRefs),
    ],
  );
  return {
    customPatterns,
    compositePatterns,
    playlistRefs,
    updatedAt: r.rows[0].updated_at,
  };
}

/**
 * Replace entire lists when provided (used when a host deletes a pattern and pushes the full library).
 */
async function replaceOrgHostSharedAssets(db, organizationId, patch) {
  if (!db || organizationId == null) throw new Error('replaceOrgHostSharedAssets: missing db or organizationId');
  await ensureOrgHostSharedAssetsTable(db);
  const current = await getOrgHostSharedAssets(db, organizationId);

  const customPatterns = Array.isArray(patch?.customPatterns)
    ? patch.customPatterns.map(sanitizeCustomPatternRow).filter(Boolean).slice(0, MAX_CUSTOM_PATTERNS)
    : current.customPatterns.map(sanitizeCustomPatternRow).filter(Boolean).slice(0, MAX_CUSTOM_PATTERNS);

  const compositePatterns = Array.isArray(patch?.compositePatterns)
    ? patch.compositePatterns.map(sanitizeCompositePatternRow).filter(Boolean).slice(0, MAX_COMPOSITE_PATTERNS)
    : current.compositePatterns
        .map(sanitizeCompositePatternRow)
        .filter(Boolean)
        .slice(0, MAX_COMPOSITE_PATTERNS);

  const playlistRefs = Array.isArray(patch?.playlistRefs)
    ? patch.playlistRefs.map(sanitizePlaylistRefRow).filter(Boolean).slice(0, MAX_PLAYLIST_REFS)
    : current.playlistRefs.map(sanitizePlaylistRefRow).filter(Boolean).slice(0, MAX_PLAYLIST_REFS);

  const r = await db.query(
    `INSERT INTO org_host_shared_assets
       (organization_id, custom_patterns, composite_patterns, playlist_refs, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (organization_id) DO UPDATE SET
       custom_patterns = EXCLUDED.custom_patterns,
       composite_patterns = EXCLUDED.composite_patterns,
       playlist_refs = EXCLUDED.playlist_refs,
       updated_at = CURRENT_TIMESTAMP
     RETURNING updated_at`,
    [
      organizationId,
      JSON.stringify(customPatterns),
      JSON.stringify(compositePatterns),
      JSON.stringify(playlistRefs),
    ],
  );
  return {
    customPatterns,
    compositePatterns,
    playlistRefs,
    updatedAt: r.rows[0].updated_at,
  };
}

/** Extract playlist id/name pairs from cloud prep rounds for org shelf. */
function playlistRefsFromPrepRounds(rounds) {
  if (!Array.isArray(rounds)) return [];
  const out = [];
  for (const round of rounds) {
    if (!round || typeof round !== 'object') continue;
    const ids = Array.isArray(round.playlistIds) ? round.playlistIds : [];
    const names = Array.isArray(round.playlistNames) ? round.playlistNames : [];
    for (let i = 0; i < ids.length; i++) {
      const id = typeof ids[i] === 'string' ? ids[i].trim() : '';
      if (!id || id.startsWith('__')) continue;
      const name = typeof names[i] === 'string' && names[i].trim() ? names[i].trim() : 'Shared playlist';
      out.push({ id, name, tracks: 0, updatedAt: Date.now() });
    }
  }
  return out;
}

module.exports = {
  ensureOrgHostSharedAssetsTable,
  getOrgHostSharedAssets,
  mergeOrgHostSharedAssets,
  replaceOrgHostSharedAssets,
  playlistRefsFromPrepRounds,
  sanitizeCustomPatternRow,
  sanitizeCompositePatternRow,
  sanitizePlaylistRefRow,
};
