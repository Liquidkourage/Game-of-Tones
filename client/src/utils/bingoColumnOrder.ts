/** B–O column order for 5×15 mode (left-to-right on cards and projector). */
export const BINGO_COLUMN_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

export type BingoColumnLetter = (typeof BINGO_COLUMN_LETTERS)[number];

/** 0 = B … 4 = O; null when the name does not look like a stem/column playlist. */
export function detectBingoColumnIndex(playlistName: string): number | null {
  const raw = (playlistName || '').trim();
  if (!raw) return null;

  const candidates = [
    raw.replace(/^GoT\s*[-–:]*\s*/i, '').trim(),
    raw,
  ].filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i);

  for (const name of candidates) {
    const idx = matchBingoColumnInName(name);
    if (idx != null) return idx;
  }
  return null;
}

function matchBingoColumnInName(name: string): number | null {
  for (let i = 0; i < BINGO_COLUMN_LETTERS.length; i++) {
    const letter = BINGO_COLUMN_LETTERS[i];
    if (new RegExp(`^${letter}(\\s|[-–:]|$)`, 'i').test(name)) return i;
    if (new RegExp(`^${letter}\\s+`, 'i').test(name)) return i;
  }

  const lower = name.toLowerCase();
  for (let i = 0; i < BINGO_COLUMN_LETTERS.length; i++) {
    const letter = BINGO_COLUMN_LETTERS[i];
    const l = letter.toLowerCase();
    if (new RegExp(`\\b${l}\\s*column\\b`, 'i').test(lower)) return i;
    if (new RegExp(`\\bcolumn\\s*${l}\\b`, 'i').test(lower)) return i;
  }

  const first = name.split(/\s+/)[0];
  if (first && first.length === 1) {
    const idx = BINGO_COLUMN_LETTERS.indexOf(first.toUpperCase() as BingoColumnLetter);
    if (idx >= 0) return idx;
  }

  return null;
}

export function bingoColumnLetterForPlaylistName(playlistName: string): BingoColumnLetter | null {
  const idx = detectBingoColumnIndex(playlistName);
  return idx == null ? null : BINGO_COLUMN_LETTERS[idx];
}

/** Stable sort: B, I, N, G, O stems first; unrecognized playlists keep relative order at the end. */
export function sortIdsByBingoColumnOrder(
  playlistIds: string[],
  nameForId: (id: string) => string,
): string[] {
  if (playlistIds.length <= 1) return [...playlistIds];

  const tagged: { id: string; col: number | null; ord: number }[] = playlistIds.map((id, ord) => ({
    id,
    col: detectBingoColumnIndex(nameForId(id)),
    ord,
  }));

  tagged.sort((a, b) => {
    if (a.col != null && b.col != null) return a.col - b.col || a.ord - b.ord;
    if (a.col != null) return -1;
    if (b.col != null) return 1;
    return a.ord - b.ord;
  });

  return tagged.map((t) => t.id);
}

/** Remap an index after moving one item in an array from → to. */
export function remapIndexAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to) {
    if (index > from && index <= to) return index - 1;
  } else if (from > to) {
    if (index >= to && index < from) return index + 1;
  }
  return index;
}
