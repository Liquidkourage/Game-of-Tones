/**
 * Estimates the bingo-track pool the server will use for 1×75 / 5×15 mixes so the host UI
 * does not list songs that those geometries exclude — without requiring finalize first.
 * Mirrors server/fiveByFifteenAssign.js.
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

function crossDedupFivePlaylistColumns(
  perListUnique: PerListColumn[],
  songOrderExtra: PoolSongLike[] = [],
): {
  globallyUnique: PerListColumn[];
  insufficientWarnings: string[];
} {
  const n = perListUnique.length;
  const columnPools: PoolSongLike[][] = Array.from({ length: n }, () => []);
  const globalSeen = new Set<string>();

  const trackOwners = new Map<string, Set<number>>();
  for (let i = 0; i < n; i++) {
    for (const song of perListUnique[i].songs) {
      if (!song?.id) continue;
      if (!trackOwners.has(song.id)) trackOwners.set(song.id, new Set());
      trackOwners.get(song.id)!.add(i);
    }
  }

  const tryAdd = (index: number, song: PoolSongLike) => {
    if (!song?.id || globalSeen.has(song.id)) return false;
    if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) return false;
    globalSeen.add(song.id);
    columnPools[index].push(song);
    return true;
  };

  const sourcesForColumn = (index: number) => {
    const canon = canonicalPlaylistIdForMatch(String(perListUnique[index].id));
    const fromPl = dedupePreserve(perListUnique[index].songs);
    const extra = dedupePreserve(songOrderExtra);
    const merged = [...fromPl];
    for (const s of extra) {
      if (!s?.id) continue;
      if (canonicalPlaylistIdForMatch(String(s.sourcePlaylistId || '')) !== canon) continue;
      if (!merged.some((m) => m.id === s.id)) merged.push(s);
    }
    return merged;
  };

  for (let i = 0; i < n; i++) {
    for (const song of perListUnique[i].songs) {
      const owners = trackOwners.get(song.id);
      if (owners && owners.size === 1) tryAdd(i, song);
    }
  }

  let progressed = true;
  while (progressed) {
    progressed = false;
    const needy = Array.from({ length: n }, (_, i) => i)
      .filter((i) => columnPools[i].length < FIVE_BY_FIFTEEN_COLUMN_SLOTS)
      .sort((a, b) => columnPools[a].length - columnPools[b].length);
    for (const index of needy) {
      for (const song of sourcesForColumn(index)) {
        if (tryAdd(index, song)) {
          progressed = true;
          if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) break;
        }
      }
    }
  }

  const stillNeedy = () =>
    Array.from({ length: n }, (_, i) => i).filter((i) => columnPools[i].length < FIVE_BY_FIFTEEN_COLUMN_SLOTS);

  const remainingOptions = (index: number) =>
    sourcesForColumn(index).filter((s) => s?.id && !globalSeen.has(s.id)).length;

  for (const index of stillNeedy().sort((a, b) => remainingOptions(a) - remainingOptions(b))) {
    for (const song of sourcesForColumn(index)) {
      if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) break;
      tryAdd(index, song);
    }
  }

  const insufficientWarnings: string[] = [];
  const globallyUnique = perListUnique.map((pl, index) => {
    const songs = columnPools[index];
    const inPlaylist = pl.songs.length;
    if (songs.length < FIVE_BY_FIFTEEN_COLUMN_SLOTS) {
      const shortage = FIVE_BY_FIFTEEN_COLUMN_SLOTS - songs.length;
      if (inPlaylist < FIVE_BY_FIFTEEN_COLUMN_SLOTS) {
        insufficientWarnings.push(
          `Playlist "${pl.name || pl.id}" has only ${inPlaylist} track(s) in the mix (needs 15, short by ${FIVE_BY_FIFTEEN_COLUMN_SLOTS - inPlaylist}). Add more songs to this playlist or refetch.`,
        );
      } else {
        insufficientWarnings.push(
          `Playlist "${pl.name || pl.id}" could only get ${songs.length} of 15 globally unique column slots (${inPlaylist} in mix; ${shortage} short). Another column may be using overlapping tracks — add a few more unique songs to this playlist on Spotify.`,
        );
      }
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
