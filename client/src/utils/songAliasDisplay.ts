import { cleanSongTitle } from './songTitleCleaner';

export type SongAlias = { title: string; artist: string };
export type SongAliases = Record<string, SongAlias>;

export function hasSongAlias(aliases: SongAliases, songId: string): boolean {
  const a = aliases[songId];
  return !!(a?.title?.trim() && a?.artist?.trim());
}

export function displayTitleForSong(
  songId: string,
  fallbackTitle: string,
  aliases: SongAliases,
): string {
  const a = aliases[songId];
  if (a?.title?.trim()) return a.title.trim();
  return cleanSongTitle(fallbackTitle);
}

export function displayArtistForSong(
  songId: string,
  fallbackArtist: string,
  aliases: SongAliases,
): string {
  const a = aliases[songId];
  if (a?.artist?.trim()) return a.artist.trim();
  return String(fallbackArtist || '').trim();
}

export function patchSquaresWithAlias<T extends { songId: string; customSongName?: string; customArtistName?: string; songName?: string }>(
  squares: T[],
  songId: string,
  title: string,
  artist: string,
): T[] {
  return squares.map((sq) =>
    sq.songId === songId ? { ...sq, customSongName: title, customArtistName: artist } : sq,
  );
}

export function patchSquaresClearAlias<T extends { songId: string; customSongName?: string; customArtistName?: string; songName?: string }>(
  squares: T[],
  songId: string,
): T[] {
  return squares.map((sq) => {
    if (sq.songId !== songId) return sq;
    const next = { ...sq, customSongName: cleanSongTitle(sq.songName || '') };
    delete next.customArtistName;
    return next;
  });
}
