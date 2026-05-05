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

export function computeEffectiveBingoPoolPreview(
  playlists: Array<{ id: string; name?: string }>,
  allSongs: PoolSongLike[],
): { pool: PoolSongLike[]; mode: '1x75' | '5x15' | 'fallback' } {
  if (!Array.isArray(playlists) || playlists.length === 0 || !Array.isArray(allSongs) || allSongs.length === 0) {
    return { pool: allSongs || [], mode: 'fallback' };
  }

  const perListUnique = playlists.map((pl) => {
    const raw = allSongs.filter((s) => String(s.sourcePlaylistId || '') === String(pl.id));
    return { id: pl.id, name: pl.name, songs: dedupePreserve(raw) };
  });

  let perListGloballyUnique = perListUnique;

  if (perListUnique.length === 5) {
    const globalSeen = new Set<string>();
    const warnings: string[] = [];

    perListGloballyUnique = perListUnique.map((pl) => {
      const uniqueSongs: PoolSongLike[] = [];
      const duplicatesFound: PoolSongLike[] = [];

      for (const song of pl.songs) {
        if (!globalSeen.has(song.id)) {
          globalSeen.add(song.id);
          uniqueSongs.push(song);
        } else {
          duplicatesFound.push(song);
        }
      }

      if (duplicatesFound.length > 0 && uniqueSongs.length < 15) {
        const needed = 15 - uniqueSongs.length;
        let replacementsAdded = 0;
        const inUnique = new Set(uniqueSongs.map((s) => s.id));
        for (const song of pl.songs) {
          if (replacementsAdded >= needed) break;
          const isDup = duplicatesFound.some((d) => d.id === song.id);
          if (!inUnique.has(song.id) && !isDup && !globalSeen.has(song.id)) {
            globalSeen.add(song.id);
            uniqueSongs.push(song);
            inUnique.add(song.id);
            replacementsAdded++;
          }
        }
      }

      if (uniqueSongs.length < 15) {
        warnings.push(pl.name || pl.id);
      }

      return { ...pl, songs: uniqueSongs };
    });

    if (warnings.length > 0) {
      perListGloballyUnique = perListUnique;
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
