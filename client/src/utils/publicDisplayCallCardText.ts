import type { CSSProperties } from 'react';

/**
 * Per-card typography for public display call rows / bingo cells.
 * Prefer wrapping + optional smaller type over ellipsis (line-clamp).
 */

/** Title size on call cards; artist is intentionally smaller for hierarchy. */
export const PUBLIC_DISPLAY_CALL_TITLE_BASE_PX = 32;
export const PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX = 22;

/** ~how many letter-box characters fit per row in a call column at auto-fit. */
const MASKED_CHARS_PER_LINE_TITLE = 11;
const MASKED_CHARS_PER_LINE_ARTIST = 13;
/** Target visible text rows inside one call card (title + artist combined). */
const CALL_CARD_TOTAL_LINE_BUDGET = 4;

export type CallCardTypography = {
  /** Scale factor applied to base title/artist sizes (1 = host display % only). */
  textScale: number;
  dense: boolean;
  titleMaxLines: number;
  artistMaxLines: number;
  /** Scales unrevealed letter-box tiles (em-based). */
  letterBoxScale: number;
};

function combinedLength(title: string, artist: string): number {
  return (title || '').length + (artist || '').length;
}

/** Estimate wrapped lines for nowrap-per-word masked layout. */
export function estimateMaskedWrapLines(text: string, charsPerLine: number): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  let lines = 1;
  let current = 0;
  for (const word of trimmed.split(/\s+/)) {
    const w = word.length;
    if (w === 0) continue;
    if (current === 0) {
      current = w;
      continue;
    }
    if (current + 1 + w <= charsPerLine) {
      current += 1 + w;
    } else {
      lines += 1;
      current = w;
    }
  }
  return lines;
}

/**
 * Shrink type on text-heavy call cards so more fits before hard clip (no …).
 */
export function computeCallCardTypography(
  title: string,
  artist: string,
  opts: { fullCard: boolean; masked?: boolean },
): CallCardTypography {
  if (opts.fullCard) {
    return {
      textScale: 1,
      dense: false,
      titleMaxLines: 8,
      artistMaxLines: 6,
      letterBoxScale: 1,
    };
  }

  const tLen = (title || '').length;
  const aLen = (artist || '').length;
  const total = tLen + aLen;
  const hasArtist = !!(artist || '').trim();

  let textScale = 1;
  if (total > 58) textScale = 0.84;
  else if (total > 44) textScale = 0.9;
  else if (total > 30) textScale = 0.94;

  if (tLen > 48) textScale = Math.min(textScale, 0.82);
  if (aLen > 36) textScale = Math.min(textScale, 0.86);

  let titleMaxLines = 3;
  let artistMaxLines = hasArtist ? 2 : 0;

  if (opts.masked) {
    const tLines = estimateMaskedWrapLines(title, MASKED_CHARS_PER_LINE_TITLE);
    const aLines = hasArtist ? estimateMaskedWrapLines(artist, MASKED_CHARS_PER_LINE_ARTIST) : 0;
    const totalLines = tLines + aLines;

    if (totalLines >= 6) textScale = Math.min(textScale, 0.76);
    else if (totalLines >= 5) textScale = Math.min(textScale, 0.82);
    else if (totalLines >= 4) textScale = Math.min(textScale, 0.88);
    else if (totalLines >= 3) textScale = Math.min(textScale, 0.93);

    if (totalLines > CALL_CARD_TOTAL_LINE_BUDGET) {
      const fit = CALL_CARD_TOTAL_LINE_BUDGET / totalLines;
      textScale = Math.min(textScale, Math.max(0.7, fit));
    }

    titleMaxLines = Math.min(Math.max(tLines, 1), 3);
    const titleBudget = Math.min(titleMaxLines, 2);
    artistMaxLines = hasArtist
      ? Math.min(Math.max(aLines, 1), Math.max(1, CALL_CARD_TOTAL_LINE_BUDGET - titleBudget))
      : 0;
  } else {
    const dense = textScale < 0.97;
    titleMaxLines = dense ? 4 : 3;
    artistMaxLines = hasArtist ? (dense ? 3 : 2) : 0;
  }

  const dense = textScale < 0.97 || (opts.masked === true && titleMaxLines + artistMaxLines >= 4);
  const letterBoxScale = opts.masked === true ? Math.min(1, textScale * (dense ? 0.96 : 1)) : 1;

  return { textScale, dense, titleMaxLines, artistMaxLines, letterBoxScale };
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

/** Unrevealed letter tile style; scales with parent font-size via em. */
export function unrevealedLetterBoxStyle(scale = 1): CSSProperties {
  return {
    display: 'inline-block',
    width: `${0.56 * scale}em`,
    height: `${0.74 * scale}em`,
    border: '0.06em solid rgba(255, 255, 255, 0.42)',
    borderRadius: '0.09em',
    verticalAlign: '0.02em',
    margin: '0 0.035em',
    boxSizing: 'border-box',
    background: 'rgba(255, 255, 255, 0.05)',
  };
}
