import { stripSoftHyphens } from './softHyphenateLongWords';
import { youtubeBingoSquareDisplay } from './youtubeTrackDisplay';

/** Normalize display titles so “Never Again” collisions match across casing/spacing. */
export function normalizePlayerCardTitleKey(title: string): string {
  return stripSoftHyphens(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

type CollisionSquare = {
  position: string;
  songId: string;
  songName: string;
  customSongName?: string;
  customArtistName?: string;
  artistName: string;
  marked?: boolean;
  youtubeMusic?: boolean;
  isFreeSpace?: boolean;
};

/**
 * Positions on one player card that share a display title with at least one
 * other non-free square (different song ids). Those cells should show artist
 * even in title-only / compact layout.
 */
export function playerCardTitleCollisionPositions(
  squares: CollisionSquare[] | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!squares || squares.length === 0) return out;

  const byTitle = new Map<string, { position: string; songId: string }[]>();
  for (const square of squares) {
    if (square.isFreeSpace || square.songId === '__FREE_SPACE__') continue;
    const { title } = youtubeBingoSquareDisplay(square);
    const key = normalizePlayerCardTitleKey(title);
    if (!key) continue;
    const list = byTitle.get(key);
    const entry = { position: square.position, songId: String(square.songId) };
    if (list) list.push(entry);
    else byTitle.set(key, [entry]);
  }

  for (const entries of Array.from(byTitle.values())) {
    if (entries.length < 2) continue;
    for (const e of entries) out.add(e.position);
  }
  return out;
}
