import type { CSSProperties } from 'react';

/**
 * Per-card typography for public display call rows / bingo cells.
 * Prefer wrapping + optional smaller type over ellipsis (line-clamp).
 */

/** Title size on call cards; artist is intentionally smaller for hierarchy. */
export const PUBLIC_DISPLAY_CALL_TITLE_BASE_PX = 36;
export const PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX = 25;
/** Line-height for title/artist (room for descenders + masked letter tiles). */
export const PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT = 1.34;
export const PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT = 1.28;
/** Slack added to call-song-info max-height budget so glyphs are not clipped. */
export const PUBLIC_DISPLAY_CALL_TEXT_DESCENDER_PAD_PX = 10;

/** ~how many letter-box characters fit per row in a narrow 5×15 call column. */
const MASKED_CHARS_PER_LINE_TITLE = 9;
const MASKED_CHARS_PER_LINE_ARTIST = 11;
/** Plain revealed text wraps wider in the same column. */
const PLAIN_CHARS_PER_LINE_TITLE = 17;
const PLAIN_CHARS_PER_LINE_ARTIST = 22;
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
  /** When true, call-song-info uses a computed max-height (masked tiles only). */
  clampContentHeight: boolean;
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
      clampContentHeight: false,
    };
  }

  const tLen = (title || '').length;
  const aLen = (artist || '').length;
  const total = tLen + aLen;
  const hasArtist = !!(artist || '').trim();

  let textScale = 1;
  if (total > 64) textScale = 0.88;
  else if (total > 50) textScale = 0.93;
  else if (total > 36) textScale = 0.97;

  if (tLen > 52) textScale = Math.min(textScale, 0.78);
  else if (tLen > 42) textScale = Math.min(textScale, 0.84);
  if (aLen > 40) textScale = Math.min(textScale, 0.88);

  let titleMaxLines = 3;
  let artistMaxLines = hasArtist ? 2 : 0;

  if (opts.masked) {
    const tLines = estimateMaskedWrapLines(title, MASKED_CHARS_PER_LINE_TITLE);
    /** Letter tiles are wider than plain chars — budget extra lines for short titles like "Big Balls". */
    const tileLines = tLen > 0 ? Math.ceil(tLen / 7) : 0;
    const aLines = hasArtist ? estimateMaskedWrapLines(artist, MASKED_CHARS_PER_LINE_ARTIST) : 0;
    const totalLines = Math.max(tLines, tileLines) + aLines;

    if (totalLines >= 6) textScale = Math.min(textScale, 0.84);
    else if (totalLines >= 5) textScale = Math.min(textScale, 0.9);
    else if (totalLines >= 4) textScale = Math.min(textScale, 0.94);
    else if (totalLines >= 3) textScale = Math.min(textScale, 0.97);

    if (totalLines > CALL_CARD_TOTAL_LINE_BUDGET) {
      const fit = CALL_CARD_TOTAL_LINE_BUDGET / totalLines;
      textScale = Math.min(textScale, Math.max(0.52, fit));
    }

    if (tLen > 0 && tLen <= 14) textScale = Math.min(textScale, 0.72);
    else if (tLen > 0 && tLen <= 22) textScale = Math.min(textScale, 0.82);

    titleMaxLines = Math.min(Math.max(tLines, tileLines, tLen > 0 && tLen <= 20 ? 2 : 1), 5);
    const titleBudget = Math.min(titleMaxLines, 2);
    artistMaxLines = hasArtist
      ? Math.min(Math.max(aLines, 1), Math.max(1, CALL_CARD_TOTAL_LINE_BUDGET - titleBudget))
      : 0;
  } else {
    const tLines = estimateMaskedWrapLines(title, PLAIN_CHARS_PER_LINE_TITLE);
    const aLines = hasArtist ? estimateMaskedWrapLines(artist, PLAIN_CHARS_PER_LINE_ARTIST) : 0;
    titleMaxLines = Math.min(Math.max(tLines, 1), 4);
    artistMaxLines = hasArtist ? Math.min(Math.max(aLines, 1), 4) : 0;
    if (tLines + aLines >= 5) textScale = Math.min(textScale, 0.88);
    else if (tLines + aLines >= 4) textScale = Math.min(textScale, 0.93);
  }

  const dense = textScale < 0.97 || (opts.masked === true && titleMaxLines + artistMaxLines >= 4);
  /** Tiles use em on the title line — keep at 1 so boxes match revealed letter size. */
  const letterBoxScale = 1;
  const clampContentHeight = opts.masked === true;

  return { textScale, dense, titleMaxLines, artistMaxLines, letterBoxScale, clampContentHeight };
}

/** One typography profile for the whole call board so card-to-card type does not jump. */
export function unifyCallListTypography(typographies: CallCardTypography[]): CallCardTypography {
  if (typographies.length === 0) {
    return {
      textScale: 1,
      dense: false,
      titleMaxLines: 3,
      artistMaxLines: 2,
      letterBoxScale: 1,
      clampContentHeight: true,
    };
  }
  return {
    /** Row-height cap picks size; keep char-based shrink off the shared board scale. */
    textScale: 1,
    dense: typographies.some((t) => t.dense),
    titleMaxLines: Math.max(...typographies.map((t) => t.titleMaxLines)),
    artistMaxLines: Math.max(...typographies.map((t) => t.artistMaxLines)),
    letterBoxScale: 1,
    clampContentHeight: typographies.some((t) => t.clampContentHeight),
  };
}

/** Shrink textScale so this card's title+artist fit inside one measured 5×15 row. */
export function capCallCardTextScaleForRow(
  typo: CallCardTypography,
  rowHeightPx: number,
  displayFontScale: number,
): number {
  if (rowHeightPx <= 0 || displayFontScale <= 0) return typo.textScale;
  const textHeightPx = Math.max(32, rowHeightPx - 14);
  const atUnitScale =
    typo.titleMaxLines * PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT * PUBLIC_DISPLAY_CALL_TITLE_BASE_PX +
    typo.artistMaxLines * PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT * PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX;
  if (atUnitScale <= 0) return typo.textScale;
  const rowCap =
    ((textHeightPx - PUBLIC_DISPLAY_CALL_TEXT_DESCENDER_PAD_PX) * 0.96) /
    (atUnitScale * displayFontScale);
  return Math.min(typo.textScale, Math.max(0.55, rowCap));
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
    height: `${0.8 * scale}em`,
    border: '0.06em solid rgba(255, 255, 255, 0.42)',
    borderRadius: '0.09em',
    verticalAlign: '-0.08em',
    margin: '0 0.04em',
    boxSizing: 'border-box',
    background: 'rgba(255, 255, 255, 0.05)',
  };
}
