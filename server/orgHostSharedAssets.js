/**
 * Org-scoped host assets shared by every host in the organization:
 * custom bingo patterns, combined (composite) recipes, and Spotify playlist refs.
 * Complements per-user host_room_prep so co-hosts can reuse each other's library.
 */

const crypto = require('crypto');

const MAX_CUSTOM_PATTERNS = 200;
const MAX_COMPOSITE_PATTERNS = 100;
const MAX_PLAYLIST_REFS = 300;

function contentHash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function sanitizeMaskPositions(raw) {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((p) => typeof p === 'string' && /^[0-4]-[0-4]$/.test(p))),
  ]
    .sort()
    .slice(0, 25);
}

/** Stable fingerprint so harvest does not duplicate a library row that already has a human name. */
function customPatternFingerprint(row) {
  const s = sanitizeCustomPatternRow(row);
  if (!s) return '';
  return contentHash({
    positions: [...s.positions].sort(),
    matchReverse: !!s.matchReverse,
    matchAllowRotation: !!s.matchAllowRotation,
    matchAllowMirror: !!s.matchAllowMirror,
  });
}

function compositePatternFingerprint(row) {
  const s = sanitizeCompositePatternRow(row);
  if (!s) return '';
  return contentHash(s.spec);
}

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

/** Prefer higher track counts + newer timestamps so a later tracks:0 harvest cannot wipe a real count. */
function mergePlaylistRefsById(existing, incoming, max) {
  const map = new Map();
  const put = (row) => {
    const s = sanitizePlaylistRefRow(row);
    if (!s) return;
    const prev = map.get(s.id);
    if (!prev) {
      map.set(s.id, s);
      return;
    }
    const tracks = Math.max(prev.tracks || 0, s.tracks || 0);
    const name =
      s.name && s.name !== 'Shared playlist'
        ? s.name
        : prev.name && prev.name !== 'Shared playlist'
          ? prev.name
          : s.name || prev.name;
    const updatedAt = Math.max(prev.updatedAt || 0, s.updatedAt || 0);
    map.set(s.id, { id: s.id, name, tracks, updatedAt });
  };
  for (const row of existing) put(row);
  for (const row of incoming) put(row);
  return Array.from(map.values())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
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
      ? mergePlaylistRefsById(current.playlistRefs, patch.playlistRefs, MAX_PLAYLIST_REFS)
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

/**
 * Count songs per sourcePlaylistId from a round's saved mix (and leftover recap when present).
 * Used so org shelf rows show real counts instead of silent 0.
 */
function trackCountsByPlaylistIdFromRound(round) {
  const counts = new Map();
  const bump = (rawId) => {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || id.startsWith('__')) return;
    counts.set(id, (counts.get(id) || 0) + 1);
  };
  const songs = Array.isArray(round?.savedMixSnapshot?.songs) ? round.savedMixSnapshot.songs : [];
  for (const song of songs) {
    bump(song?.sourcePlaylistId);
  }
  const leftovers = Array.isArray(round?.playRecap?.leftoverSongs) ? round.playRecap.leftoverSongs : [];
  for (const song of leftovers) {
    // Leftover pool remaps sourcePlaylistId to __leftovers__; prefer origin Spotify id when present.
    const origin =
      song?.spotifyContextPlaylistId ||
      song?.originPlaylistId ||
      (typeof song?.sourcePlaylistId === 'string' && !String(song.sourcePlaylistId).startsWith('__')
        ? song.sourcePlaylistId
        : null);
    bump(origin);
  }
  return counts;
}

/** Extract playlist id/name/track-count refs from cloud prep rounds for org shelf. */
function playlistRefsFromPrepRounds(rounds) {
  if (!Array.isArray(rounds)) return [];
  const byId = new Map();
  for (const round of rounds) {
    if (!round || typeof round !== 'object') continue;
    const ids = Array.isArray(round.playlistIds) ? round.playlistIds : [];
    const names = Array.isArray(round.playlistNames) ? round.playlistNames : [];
    const snapshotCounts = trackCountsByPlaylistIdFromRound(round);
    const updatedAt =
      typeof round.savedMixSnapshot?.savedAt === 'number' && Number.isFinite(round.savedMixSnapshot.savedAt)
        ? round.savedMixSnapshot.savedAt
        : Date.now();
    for (let i = 0; i < ids.length; i++) {
      const id = typeof ids[i] === 'string' ? ids[i].trim() : '';
      if (!id || id.startsWith('__')) continue;
      const name = typeof names[i] === 'string' && names[i].trim() ? names[i].trim() : 'Shared playlist';
      const tracks = snapshotCounts.get(id) || 0;
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, { id, name, tracks, updatedAt });
        continue;
      }
      byId.set(id, {
        id,
        name: name !== 'Shared playlist' ? name : prev.name,
        tracks: Math.max(prev.tracks || 0, tracks),
        updatedAt: Math.max(prev.updatedAt || 0, updatedAt),
      });
    }
    // Also surface playlists that appear only via snapshot songs (no playlistIds row).
    for (const [id, tracks] of snapshotCounts.entries()) {
      if (byId.has(id)) {
        const prev = byId.get(id);
        if (tracks > (prev.tracks || 0)) {
          byId.set(id, { ...prev, tracks });
        }
        continue;
      }
      byId.set(id, { id, name: 'Shared playlist', tracks, updatedAt });
    }
  }
  return Array.from(byId.values());
}

/**
 * Origin Spotify playlist id for a prep song (mix snapshot or leftover remapped to __leftovers__).
 */
function prepSongOriginPlaylistId(song) {
  if (!song || typeof song !== 'object') return '';
  const origin =
    (typeof song.spotifyContextPlaylistId === 'string' && song.spotifyContextPlaylistId.trim()) ||
    (typeof song.originPlaylistId === 'string' && song.originPlaylistId.trim()) ||
    (typeof song.sourcePlaylistId === 'string' &&
    !String(song.sourcePlaylistId).startsWith('__')
      ? song.sourcePlaylistId.trim()
      : '');
  return origin || '';
}

/**
 * Build a deduped song list for one Spotify playlist id from org member prep snapshots.
 * Prefer the longest snapshot (closest to a full playlist inventory).
 * Includes leftover pool songs when their origin playlist id matches.
 */
function songsForPlaylistFromPrepRounds(rounds, playlistId) {
  const pid = typeof playlistId === 'string' ? playlistId.trim() : '';
  if (!pid || pid.startsWith('__') || !Array.isArray(rounds)) return [];
  let best = [];
  for (const round of rounds) {
    if (!round || typeof round !== 'object') continue;
    const songs = Array.isArray(round.savedMixSnapshot?.songs) ? round.savedMixSnapshot.songs : [];
    const leftovers = Array.isArray(round.playRecap?.leftoverSongs)
      ? round.playRecap.leftoverSongs
      : [];
    const matched = [];
    const seen = new Set();
    for (const song of [...songs, ...leftovers]) {
      if (prepSongOriginPlaylistId(song) !== pid) continue;
      const sid = song?.id != null ? String(song.id) : '';
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      matched.push(song);
    }
    if (matched.length > best.length) best = matched;
  }
  return best;
}

/**
 * Load the fullest prep snapshot song list for a playlist across every org member's cloud prep.
 */
async function loadOrgPrepPlaylistTracks(db, organizationId, playlistId) {
  if (!db || organizationId == null) return [];
  const pid = typeof playlistId === 'string' ? playlistId.trim() : '';
  if (!pid || pid.startsWith('__')) return [];
  const r = await db.query(
    `SELECT p.payload
     FROM host_room_prep p
     INNER JOIN users u ON u.id = p.user_id
     WHERE u.organization_id = $1
        OR u.id = (SELECT owner_user_id FROM organizations WHERE id = $1)`,
    [organizationId],
  );
  let best = [];
  for (const row of r.rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
    const songs = songsForPlaylistFromPrepRounds(rounds, pid);
    if (songs.length > best.length) best = songs;
  }
  return best;
}

/**
 * Site admin / creator only: fullest prep snapshot for a playlist across *any* host's cloud prep.
 * Uses stored snapshots only — never another host's Spotify token.
 */
async function loadAnyHostPrepPlaylistTracks(db, playlistId) {
  if (!db) return [];
  const pid = typeof playlistId === 'string' ? playlistId.trim() : '';
  if (!pid || pid.startsWith('__')) return [];
  const r = await db.query(`SELECT payload FROM host_room_prep`);
  let best = [];
  for (const row of r.rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
    const songs = songsForPlaylistFromPrepRounds(rounds, pid);
    if (songs.length > best.length) best = songs;
  }
  return best;
}

/**
 * Rebuild named library rows from round prep when a sub-host applied a custom/combined
 * pattern. Prep stores full cells / composite recipes (not localStorage-only ids).
 */
function patternsFromPrepRounds(rounds) {
  if (!Array.isArray(rounds)) return { customPatterns: [], compositePatterns: [] };
  const customByFp = new Map();
  const compositeByFp = new Map();

  const pushCustom = (partial, createdAt) => {
    const row = sanitizeCustomPatternRow({
      ...partial,
      createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    });
    if (!row) return;
    const fp = customPatternFingerprint(row);
    if (!fp) return;
    const prev = customByFp.get(fp);
    if (!prev || (row.createdAt || 0) >= (prev.createdAt || 0)) customByFp.set(fp, row);
  };

  const pushComposite = (partial, createdAt) => {
    const row = sanitizeCompositePatternRow({
      ...partial,
      createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    });
    if (!row) return;
    const fp = compositePatternFingerprint(row);
    if (!fp) return;
    const prev = compositeByFp.get(fp);
    if (!prev || (row.createdAt || 0) >= (prev.createdAt || 0)) compositeByFp.set(fp, row);
  };

  for (const round of rounds) {
    if (!round || typeof round !== 'object') continue;
    const roundName =
      typeof round.name === 'string' && round.name.trim()
        ? round.name.trim().slice(0, 60)
        : 'Team round';
    const createdAt =
      typeof round.savedMixSnapshot?.savedAt === 'number' && Number.isFinite(round.savedMixSnapshot.savedAt)
        ? round.savedMixSnapshot.savedAt
        : typeof round.startedAt === 'number' && Number.isFinite(round.startedAt)
          ? round.startedAt
          : 0;

    const mask = sanitizeMaskPositions(round.customPatternMask);
    if (mask.length > 0) {
      pushCustom(
        {
          id: `prep_custom_${contentHash({
            positions: mask,
            matchReverse: round.customMatchReverse === true,
            matchAllowRotation: round.customMatchAllowRotation === true,
            matchAllowMirror: round.customMatchAllowMirror === true,
          })}`,
          name: `${roundName} (custom)`.slice(0, 80),
          positions: mask,
          matchReverse: round.customMatchReverse === true,
          matchAllowRotation: round.customMatchAllowRotation === true,
          matchAllowMirror: round.customMatchAllowMirror === true,
        },
        createdAt,
      );
    }

    const specRaw = round.patternComposite;
    if (specRaw && typeof specRaw === 'object') {
      const op = specRaw.op === 'and' || specRaw.op === 'or' ? specRaw.op : null;
      const clauses = Array.isArray(specRaw.clauses) ? specRaw.clauses : [];
      if (op && clauses.length > 0) {
        const normalizedClauses = [];
        for (const c of clauses) {
          if (!c || typeof c !== 'object') continue;
          if (c.kind === 'preset' && typeof c.preset === 'string') {
            normalizedClauses.push({
              kind: 'preset',
              preset: c.preset === 'blackout' ? 'full_card' : c.preset,
              ...(typeof c.linesRequired === 'number' ? { linesRequired: c.linesRequired } : {}),
              ...(c.matchAllowRotation === true ? { matchAllowRotation: true } : {}),
              ...(c.matchAllowMirror === true ? { matchAllowMirror: true } : {}),
            });
          } else if (c.kind === 'mask') {
            const positions = sanitizeMaskPositions(c.positions);
            if (positions.length === 0) continue;
            normalizedClauses.push({
              kind: 'mask',
              positions,
              ...(c.matchAllowRotation === true ? { matchAllowRotation: true } : {}),
              ...(c.matchAllowMirror === true ? { matchAllowMirror: true } : {}),
            });
            // Painted sub-shapes also become Saved shape entries.
            pushCustom(
              {
                id: `prep_custom_${contentHash({
                  positions,
                  matchReverse: false,
                  matchAllowRotation: c.matchAllowRotation === true,
                  matchAllowMirror: c.matchAllowMirror === true,
                })}`,
                name: `${roundName} (shape)`.slice(0, 80),
                positions,
                matchAllowRotation: c.matchAllowRotation === true,
                matchAllowMirror: c.matchAllowMirror === true,
              },
              createdAt,
            );
          }
        }
        if (normalizedClauses.length > 0) {
          const spec = { op, clauses: normalizedClauses };
          pushComposite(
            {
              id: `prep_composite_${contentHash(spec)}`,
              name: `${roundName} (combined)`.slice(0, 80),
              spec,
            },
            createdAt,
          );
        }
      }
    }
  }

  return {
    customPatterns: Array.from(customByFp.values()),
    compositePatterns: Array.from(compositeByFp.values()),
  };
}

/**
 * Collect playlist refs from every org member's (and owner's) cloud prep.
 * Used to backfill the org shelf when hosts saved rounds before shared-assets existed.
 */
async function collectPlaylistRefsFromOrgMemberPrep(db, organizationId) {
  if (!db || organizationId == null) return [];
  const r = await db.query(
    `SELECT p.payload
     FROM host_room_prep p
     INNER JOIN users u ON u.id = p.user_id
     WHERE u.organization_id = $1
        OR u.id = (SELECT owner_user_id FROM organizations WHERE id = $1)`,
    [organizationId],
  );
  const out = [];
  for (const row of r.rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
    out.push(...playlistRefsFromPrepRounds(rounds));
  }
  return out;
}

/**
 * Collect custom + combined pattern defs embedded in org teammate room prep.
 */
async function collectPatternsFromOrgMemberPrep(db, organizationId) {
  if (!db || organizationId == null) {
    return { customPatterns: [], compositePatterns: [] };
  }
  const r = await db.query(
    `SELECT p.payload
     FROM host_room_prep p
     INNER JOIN users u ON u.id = p.user_id
     WHERE u.organization_id = $1
        OR u.id = (SELECT owner_user_id FROM organizations WHERE id = $1)`,
    [organizationId],
  );
  const customByFp = new Map();
  const compositeByFp = new Map();
  for (const row of r.rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
    const harvested = patternsFromPrepRounds(rounds);
    for (const p of harvested.customPatterns) {
      const fp = customPatternFingerprint(p);
      if (!fp) continue;
      const prev = customByFp.get(fp);
      if (!prev || (p.createdAt || 0) >= (prev.createdAt || 0)) customByFp.set(fp, p);
    }
    for (const p of harvested.compositePatterns) {
      const fp = compositePatternFingerprint(p);
      if (!fp) continue;
      const prev = compositeByFp.get(fp);
      if (!prev || (p.createdAt || 0) >= (prev.createdAt || 0)) compositeByFp.set(fp, p);
    }
  }
  return {
    customPatterns: Array.from(customByFp.values()),
    compositePatterns: Array.from(compositeByFp.values()),
  };
}

/**
 * Drop harvested rows whose shape/recipe already exists on the shelf (any id / human name).
 */
function filterNovelPrepPatterns(existingAssets, harvested) {
  const existingCustomFp = new Set(
    (existingAssets?.customPatterns || []).map(customPatternFingerprint).filter(Boolean),
  );
  const existingCompositeFp = new Set(
    (existingAssets?.compositePatterns || []).map(compositePatternFingerprint).filter(Boolean),
  );
  return {
    customPatterns: (harvested.customPatterns || []).filter((p) => {
      const fp = customPatternFingerprint(p);
      return fp && !existingCustomFp.has(fp);
    }),
    compositePatterns: (harvested.compositePatterns || []).filter((p) => {
      const fp = compositePatternFingerprint(p);
      return fp && !existingCompositeFp.has(fp);
    }),
  };
}

/**
 * Ensure org shelf playlist refs include anything already saved in teammate room prep.
 * Persists a merge when new refs are found so subsequent GETs stay cheap.
 */
async function ensureOrgPlaylistRefsFromPrep(db, organizationId) {
  if (!db || organizationId == null) return null;
  return ensureOrgAssetsFromPrep(db, organizationId);
}

/**
 * Merge playlist refs + novel pattern defs from one prep payload into the org shelf
 * (used when a host saves room prep — no need to wait for a later shared-assets GET).
 */
async function shareAssetsFromPrepRounds(db, organizationId, rounds) {
  if (!db || organizationId == null || !Array.isArray(rounds)) return null;
  const current = await getOrgHostSharedAssets(db, organizationId);
  const refs = playlistRefsFromPrepRounds(rounds);
  const novel = filterNovelPrepPatterns(current, patternsFromPrepRounds(rounds));
  const patch = {};
  if (refs.length > 0) patch.playlistRefs = refs;
  if (novel.customPatterns.length > 0) patch.customPatterns = novel.customPatterns;
  if (novel.compositePatterns.length > 0) patch.compositePatterns = novel.compositePatterns;
  if (Object.keys(patch).length === 0) return current;
  return mergeOrgHostSharedAssets(db, organizationId, patch);
}

/**
 * Backfill org shelf from teammate cloud prep: playlist refs + embedded custom/combined patterns.
 * Jay (or any org host) gets Saved shape / recipe entries without the sub-host reopening Host.
 */
async function ensureOrgAssetsFromPrep(db, organizationId) {
  if (!db || organizationId == null) return null;
  const [playlistRefs, harvestedPatterns, current] = await Promise.all([
    collectPlaylistRefsFromOrgMemberPrep(db, organizationId),
    collectPatternsFromOrgMemberPrep(db, organizationId),
    getOrgHostSharedAssets(db, organizationId),
  ]);
  const novel = filterNovelPrepPatterns(current, harvestedPatterns);
  const hasPlaylists = playlistRefs.length > 0;
  const hasPatterns = novel.customPatterns.length > 0 || novel.compositePatterns.length > 0;
  if (!hasPlaylists && !hasPatterns) return current;
  return mergeOrgHostSharedAssets(db, organizationId, {
    ...(hasPlaylists ? { playlistRefs } : {}),
    ...(novel.customPatterns.length > 0 ? { customPatterns: novel.customPatterns } : {}),
    ...(novel.compositePatterns.length > 0 ? { compositePatterns: novel.compositePatterns } : {}),
  });
}

module.exports = {
  ensureOrgHostSharedAssetsTable,
  getOrgHostSharedAssets,
  mergeOrgHostSharedAssets,
  replaceOrgHostSharedAssets,
  playlistRefsFromPrepRounds,
  patternsFromPrepRounds,
  collectPlaylistRefsFromOrgMemberPrep,
  collectPatternsFromOrgMemberPrep,
  ensureOrgPlaylistRefsFromPrep,
  ensureOrgAssetsFromPrep,
  shareAssetsFromPrepRounds,
  loadOrgPrepPlaylistTracks,
  loadAnyHostPrepPlaylistTracks,
  songsForPlaylistFromPrepRounds,
  sanitizeCustomPatternRow,
  sanitizeCompositePatternRow,
  sanitizePlaylistRefRow,
  mergePlaylistRefsById,
};
