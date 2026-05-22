/**
 * Per-card typography for public display call rows / bingo cells.
 * Prefer wrapping + optional smaller type over ellipsis (line-clamp).
 */

/** Title size on call cards; artist is intentionally smaller for hierarchy. */
export const PUBLIC_DISPLAY_CALL_TITLE_BASE_PX = 32;
export const PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX = 22;

export type CallCardTypography = {
  /** Scale factor applied to base title/artist sizes (1 = host display % only). */
  textScale: number;
  dense: boolean;
  titleMaxLines: number;
  artistMaxLines: number;
};

function combinedLength(title: string, artist: string): number {
  return (title || '').length + (artist || '').length;
}

/**
 * Shrink type on text-heavy call cards so more fits before hard clip (no …).
 */
export function computeCallCardTypography(
  title: string,
  artist: string,
  opts: { fullCard: boolean },
): CallCardTypography {
  if (opts.fullCard) {
    return { textScale: 1, dense: false, titleMaxLines: 8, artistMaxLines: 6 };
  }

  const tLen = (title || '').length;
  const aLen = (artist || '').length;
  const total = tLen + aLen;

  let textScale = 1;
  if (total > 58) textScale = 0.84;
  else if (total > 44) textScale = 0.9;
  else if (total > 30) textScale = 0.94;

  if (tLen > 48) textScale = Math.min(textScale, 0.82);
  if (aLen > 36) textScale = Math.min(textScale, 0.86);

  const dense = textScale < 0.97;
  const titleMaxLines = dense ? 4 : 3;
  const artistMaxLines = dense ? 4 : 3;

  return { textScale, dense, titleMaxLines, artistMaxLines };
}

/** Bingo pattern / winner grid cells (vmin-based sizes get a scale multiplier). */
export function computeBingoCellTextScale(title: string, artist: string): number {
  const total = combinedLength(title, artist);
  const tLen = (title || '').length;
  if (total > 55 || tLen > 38) return 0.78;
  if (total > 40 || tLen > 28) return 0.86;
  if (total > 28) return 0.92;
  return 1;
}

export function maxHeightEm(lineHeight: number, lines: number): string {
  return `calc(${lineHeight}em * ${lines})`;
}
