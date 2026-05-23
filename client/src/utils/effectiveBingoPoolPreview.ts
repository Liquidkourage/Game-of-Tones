/**
 * Estimates the bingo-track pool the server will use for 1×75 / 5×15 mixes so the host UI
 * does not list songs that those geometries exclude — without requiring finalize first.
 * Mirrors server/index.js generateBingoCards grouping/dedup rules closely (no shuffle — stable picks).
 */

export type PoolSongLike = {
  id: string;
  name?: string;
  artist?: string;
  explicit?: boolean;
  youtubeMusic?: boolean;
  sourcePlaylistId?: string;
  sourcePlaylistName?: string;
};

/** Normalize Spotify URIs so `spotify:playlist:abc` matches bare `abc`. */
export function canonicalPlaylistIdForMatch(id: string): string {
  const s = String(id).trim();
  const m = /^spotify:playlist:([a-zA-Z0-9]+)$/i.exec(s);
  if (m) return m[1];
  return s;
}

type PerListColumn = { id: string; name?: string; songs: PoolSongLike[] };

function dedupePreserve(arr: PoolSongLike[]): PoolSongLike[] {
  const seen = new Set<string>();
  const out: PoolSongLike[] = [];
  for (const s of arr) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

function buildPerListUnique(
  playlists: Array<{ id: string; name?: string }>,
  allSongs: PoolSongLike[],
): PerListColumn[] {
  return playlists.map((pl) => {
    const plCanon = canonicalPlaylistIdForMatch(String(pl.id));
    const raw = allSongs.filter(
      (s) => canonicalPlaylistIdForMatch(String(s.sourcePlaylistId || '')) === plCanon,
    );
    return { id: pl.id, name: pl.name, songs: dedupePreserve(raw) };
  });
}

const FIVE_BY_FIFTEEN_COLUMN_SLOTS = 15;

/**
 * Same cross-playlist pass as server `assignGloballyUniqueFiveByFifteenColumns`.
 * Smallest playlists claim shared tracks first; backfill from full host song list.
 */
function crossDedupFivePlaylistColumns(
  perListUnique: PerListColumn[],
  songOrderExtra: PoolSongLike[] = [],
): {
  globallyUnique: PerListColumn[];
  insufficientWarnings: string[];
} {
  const n = perListUnique.length;
  const columnPools: PoolSongLike[][] = Array.from({ length: n }, () => []);
  const claimOrder = perListUnique
    .map((pl, index) => ({ index, size: pl.songs.length }))
    .sort((a, b) => a.size - b.size || a.index - b.index);

  const globalSeen = new Set<string>();
  for (const { index } of claimOrder) {
    for (const song of perListUnique[index].songs) {
      if (!song?.id || globalSeen.has(song.id)) continue;
      globalSeen.add(song.id);
      columnPools[index].push(song);
    }
  }

  const extra = dedupePreserve(songOrderExtra);
  for (let index = 0; index < n; index++) {
    if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) continue;
    const canon = canonicalPlaylistIdForMatch(String(perListUnique[index].id));
    const inCol = new Set(columnPools[index].map((s) => s.id));
    for (const song of extra) {
      if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) break;
      if (!song?.id || globalSeen.has(song.id) || inCol.has(song.id)) continue;
      if (canonicalPlaylistIdForMatch(String(song.sourcePlaylistId || '')) !== canon) continue;
      globalSeen.add(song.id);
      inCol.add(song.id);
      columnPools[index].push(song);
    }
  }

  const insufficientWarnings: string[] = [];
  const globallyUnique = perListUnique.map((pl, index) => {
    const songs = columnPools[index];
    if (songs.length < FIVE_BY_FIFTEEN_COLUMN_SLOTS) {
      const shortage = FIVE_BY_FIFTEEN_COLUMN_SLOTS - songs.length;
      insufficientWarnings.push(
        `Playlist "${pl.name || pl.id}" only has ${songs.length} unique songs after deduplication and replacement (needs 15, short by ${shortage})`,
      );
    }
    return { ...pl, songs };
  });

  return { globallyUnique, insufficientWarnings };
}

/** Non-empty iff this five-playlist mix cannot satisfy 5×15 after cross-playlist dedup (matches server). */
export function compute5x15InsufficientWarnings(
  playlists: Array<{ id: string; name?: string }>,
  allSongs: PoolSongLike[],
): string[] {
  if (!Array.isArray(playlists) || playlists.length !== 5 || !Array.isArray(allSongs)) return [];
  const perListUnique = buildPerListUnique(playlists, allSongs);
  return crossDedupFivePlaylistColumns(perListUnique, allSongs).insufficientWarnings;
}

export function computeEffectiveBingoPoolPreview(
  playlists: Array<{ id: string; name?: string }>,
  allSongs: PoolSongLike[],
): { pool: PoolSongLike[]; mode: '1x75' | '5x15' | 'fallback' } {
  if (!Array.isArray(playlists) || playlists.length === 0 || !Array.isArray(allSongs) || allSongs.length === 0) {
    return { pool: allSongs || [], mode: 'fallback' };
  }

  const perListUnique = buildPerListUnique(playlists, allSongs);

  let perListGloballyUnique = perListUnique;

  if (perListUnique.length === 5) {
    const { globallyUnique, insufficientWarnings } = crossDedupFivePlaylistColumns(perListUnique, allSongs);
    perListGloballyUnique = globallyUnique;
    if (insufficientWarnings.length > 0) {
      const map = new Map<string, PoolSongLike>();
      for (const s of allSongs) {
        if (s?.id && !map.has(s.id)) map.set(s.id, s);
      }
      return { pool: Array.from(map.values()), mode: 'fallback' };
    }
  }

  if (perListGloballyUnique.length === 1 && perListGloballyUnique[0].songs.length >= 75) {
    const allowed = new Set(perListGloballyUnique[0].songs.map((s) => s.id));
    const ordered = dedupePreserve(allSongs.filter((s) => allowed.has(s.id))).slice(0, 75);
    return { pool: ordered, mode: '1x75' };
  }

  if (perListGloballyUnique.length === 5 && perListGloballyUnique.every((pl) => pl.songs.length >= 15)) {
    const picks: PoolSongLike[] = [];
    for (let col = 0; col < 5; col++) {
      picks.push(...perListGloballyUnique[col].songs.slice(0, 15));
    }
    return { pool: picks, mode: '5x15' };
  }

  const map = new Map<string, PoolSongLike>();
  for (const pl of perListGloballyUnique) {
    for (const s of pl.songs) {
      if (!map.has(s.id)) map.set(s.id, s);
    }
  }
  return { pool: Array.from(map.values()), mode: 'fallback' };
}

/** Songs that belong on cards / saved round / playback for this mix geometry (≤75 for 1×75 / 5×15). */
export function effectiveBingoPoolSongsForMix(
  playlists: Array<{ id: string; name?: string }>,
  songs: PoolSongLike[],
): { songs: PoolSongLike[]; mode: '1x75' | '5x15' | 'fallback' } {
  const { pool, mode } = computeEffectiveBingoPoolPreview(playlists, songs);
  return { songs: pool, mode };
}
