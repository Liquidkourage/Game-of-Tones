/**
 * Client mirror of server/fiveByFifteenAssign.js — keep behavior in sync.
 * Used to preview the final 75 before showing soft title+artist collision confirms.
 */

export function canonicalPlaylistIdForMatch(id: unknown): string {
  const s = String(id ?? '').trim();
  const m = /^spotify:playlist:([a-zA-Z0-9]+)$/i.exec(s);
  if (m) return m[1];
  return s;
}

export function normalizeTrackLabelForDedup(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/^\s*got\s*[-–:]*\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type FiveByFifteenSong = {
  id?: string;
  name?: string;
  artist?: string;
  customSongName?: string;
  customArtistName?: string;
  sourcePlaylistId?: string;
};

export function trackTitleArtistDedupKey(song: FiveByFifteenSong | null | undefined): string | null {
  if (!song) return null;
  const title = normalizeTrackLabelForDedup(String(song.customSongName || song.name || ''));
  const artist = normalizeTrackLabelForDedup(String(song.customArtistName || song.artist || ''));
  if (title && artist) return `${title}\0${artist}`;
  const id = String(song.id || '').trim();
  return id || null;
}

export function dedupeSongsByIdPreserveOrder<T extends FiveByFifteenSong>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of arr) {
    const id = s?.id != null ? String(s.id) : '';
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(s);
    }
  }
  return out;
}

export type FiveByFifteenPlaylist = { id: string; name: string };

export type PerListUnique<T extends FiveByFifteenSong> = {
  id: string;
  name: string;
  songs: T[];
  originalCount?: number;
};

export function buildPerListUnique<T extends FiveByFifteenSong>(
  playlists: FiveByFifteenPlaylist[],
  songOrder: T[],
): PerListUnique<T>[] {
  return playlists.map((pl) => {
    const plCanon = canonicalPlaylistIdForMatch(pl.id);
    const raw = (Array.isArray(songOrder) ? songOrder : []).filter(
      (s) => canonicalPlaylistIdForMatch(s.sourcePlaylistId) === plCanon,
    );
    return { id: pl.id, name: pl.name, songs: dedupeSongsByIdPreserveOrder(raw) };
  });
}

export const FIVE_BY_FIFTEEN_COLUMN_SLOTS = 15;

export function assignGloballyUniqueFiveByFifteenColumns<T extends FiveByFifteenSong>(
  perListUnique: PerListUnique<T>[],
  songOrderExtra: T[] = [],
): { perListGloballyUnique: PerListUnique<T>[]; warnings: string[] } {
  const n = perListUnique.length;
  const columnPools: T[][] = Array.from({ length: n }, () => []);
  const globalSeenIds = new Set<string>();
  const globalSeenSoft = new Set<string>();

  const trackOwners = new Map<string, Set<number>>();
  for (let i = 0; i < n; i++) {
    for (const song of perListUnique[i].songs) {
      const id = song?.id != null ? String(song.id) : '';
      if (!id) continue;
      if (!trackOwners.has(id)) trackOwners.set(id, new Set());
      trackOwners.get(id)!.add(i);
    }
  }

  const tryAdd = (index: number, song: T): boolean => {
    const id = song?.id != null ? String(song.id) : '';
    if (!id || globalSeenIds.has(id)) return false;
    if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) return false;
    const soft = trackTitleArtistDedupKey(song);
    if (soft && globalSeenSoft.has(soft)) return false;
    globalSeenIds.add(id);
    if (soft) globalSeenSoft.add(soft);
    columnPools[index].push(song);
    return true;
  };

  const sourcesForColumn = (index: number): T[] => {
    const canon = canonicalPlaylistIdForMatch(String(perListUnique[index].id));
    const fromPl = dedupeSongsByIdPreserveOrder(perListUnique[index].songs);
    const extra = Array.isArray(songOrderExtra) ? dedupeSongsByIdPreserveOrder(songOrderExtra) : [];
    const merged = [...fromPl];
    for (const s of extra) {
      const id = s?.id != null ? String(s.id) : '';
      if (!id) continue;
      if (canonicalPlaylistIdForMatch(s.sourcePlaylistId) !== canon) continue;
      if (!merged.some((m) => String(m.id) === id)) merged.push(s);
    }
    return merged;
  };

  const isAvailable = (song: T): boolean => {
    const id = song?.id != null ? String(song.id) : '';
    if (!id || globalSeenIds.has(id)) return false;
    const soft = trackTitleArtistDedupKey(song);
    if (soft && globalSeenSoft.has(soft)) return false;
    return true;
  };

  for (let i = 0; i < n; i++) {
    for (const song of perListUnique[i].songs) {
      const id = song?.id != null ? String(song.id) : '';
      const owners = id ? trackOwners.get(id) : undefined;
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
    Array.from({ length: n }, (_, i) => i).filter(
      (i) => columnPools[i].length < FIVE_BY_FIFTEEN_COLUMN_SLOTS,
    );

  const remainingOptions = (index: number) => sourcesForColumn(index).filter(isAvailable).length;

  for (const index of stillNeedy().sort((a, b) => remainingOptions(a) - remainingOptions(b))) {
    for (const song of sourcesForColumn(index)) {
      if (columnPools[index].length >= FIVE_BY_FIFTEEN_COLUMN_SLOTS) break;
      tryAdd(index, song);
    }
  }

  const warnings: string[] = [];
  const perListGloballyUnique = perListUnique.map((pl, index) => {
    const songs = columnPools[index];
    const inPlaylist = Array.isArray(pl.songs) ? pl.songs.length : 0;
    if (songs.length < FIVE_BY_FIFTEEN_COLUMN_SLOTS) {
      const shortage = FIVE_BY_FIFTEEN_COLUMN_SLOTS - songs.length;
      if (inPlaylist < FIVE_BY_FIFTEEN_COLUMN_SLOTS) {
        warnings.push(
          `Playlist "${pl.name}" has only ${inPlaylist} track(s) in the mix (needs 15, short by ${FIVE_BY_FIFTEEN_COLUMN_SLOTS - inPlaylist}). Add more songs to this playlist or refetch.`,
        );
      } else {
        warnings.push(
          `Playlist "${pl.name}" could only get ${songs.length} of 15 globally unique column slots (${inPlaylist} in mix; ${shortage} short). Another column may be using overlapping tracks (same Spotify id or same title+artist) — add a few more unique songs to this playlist on Spotify.`,
        );
      }
    }
    return {
      ...pl,
      songs,
      originalCount: inPlaylist,
    };
  });

  return { perListGloballyUnique, warnings };
}

export function flattenFiveByFifteenColumns<T extends FiveByFifteenSong>(
  perListGloballyUnique: PerListUnique<T>[],
): T[] {
  const picks: T[] = [];
  for (let col = 0; col < perListGloballyUnique.length; col++) {
    picks.push(...perListGloballyUnique[col].songs.slice(0, FIVE_BY_FIFTEEN_COLUMN_SLOTS));
  }
  return picks;
}

/** Final 75 after soft title+artist + id uniqueness (same path as server finalize). */
export function previewFiveByFifteenPool<T extends FiveByFifteenSong>(
  playlists: FiveByFifteenPlaylist[],
  songs: T[],
): T[] {
  if (playlists.length !== 5) return songs;
  const perList = buildPerListUnique(playlists, songs);
  const { perListGloballyUnique } = assignGloballyUniqueFiveByFifteenColumns(perList, songs);
  return flattenFiveByFifteenColumns(perListGloballyUnique);
}
