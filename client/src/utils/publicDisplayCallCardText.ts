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
  /** Full title at clip start/end (plain text, not letter boxes). */
  plainFullTitle?: boolean;
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
    titleMaxLines = Math.min(Math.max(tLines, 1), 3);
    artistMaxLines = hasArtist ? Math.min(Math.max(aLines, 1), 2) : 0;
    if (tLines + aLines >= 5) textScale = Math.min(textScale, 0.82);
    else if (tLines + aLines >= 4) textScale = Math.min(textScale, 0.88);
    else if (tLines + aLines >= 3) textScale = Math.min(textScale, 0.92);
    if (tLen > 0 && tLen <= 14) textScale = Math.min(textScale, 0.72);
    else if (tLen > 0 && tLen <= 22) textScale = Math.min(textScale, 0.82);
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
  return Math.min(typo.textScale, Math.max(0.55, Math.min(1, rowCap)));
}

/* ------------------------------------------------------------------ */
/* Measurement-based fitting (ground truth for call cards)             */
/*                                                                     */
/* The char-count heuristics above guess wrap points; on long titles / */
/* artists / single words the guess is wrong and the card hard-clips.  */
/* These helpers measure real glyph widths (canvas measureText with    */
/* the display font) against the card's actual pixel box and binary-   */
/* search the largest scale where everything truly fits.               */
/* ------------------------------------------------------------------ */

const FIT_FONT_FAMILY =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif";
/** Reference px for cached measurements; widths scale linearly with font size. */
const FIT_REF_PX = 100;
/** Unrevealed letter tile width incl. margins (0.56em + 2×0.04em). */
const MASKED_TILE_EM = 0.64;
const TITLE_FONT_WEIGHT = 900;
const ARTIST_FONT_WEIGHT = 800;
/** Gap between title and artist blocks (callCardLineStyles artist marginTop). */
const TITLE_ARTIST_GAP_PX = 4;
/** callCardLineStyles paddingBottom on clamped cards (title 3 + artist 4). */
const CLAMPED_LINE_PADDING_PX = 7;
/** Vertical safety so descenders / rounding never kiss the clip edge. */
const FIT_HEIGHT_SAFETY_PX = 3;
/** Absolute floor — only hit by absurd single-word titles/artists (e.g. 30+ char words). */
const FIT_MIN_SCALE = 0.22;

let fitCtxCached: CanvasRenderingContext2D | null | undefined;
function getFitCtx(): CanvasRenderingContext2D | null {
  if (fitCtxCached !== undefined) return fitCtxCached;
  try {
    fitCtxCached = document.createElement('canvas').getContext('2d');
  } catch {
    fitCtxCached = null;
  }
  return fitCtxCached ?? null;
}

const wordUnitsCache = new Map<string, number>();

/** Pre-webfont measurements use the fallback font (too narrow) — key them separately. */
function fontsLoadedFlag(): string {
  try {
    return (document as any).fonts?.status === 'loaded' ? '1' : '0';
  } catch {
    return '0';
  }
}

/** Width of one word at FIT_REF_PX (cached). Masked = worst of tile vs revealed glyph per char. */
function wordWidthUnits(word: string, weight: number, masked: boolean): number {
  const key = `${fontsLoadedFlag()}|${masked ? 'm' : 'p'}|${weight}|${word}`;
  const hit = wordUnitsCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = getFitCtx();
  let units: number;
  if (!ctx) {
    units = word.length * (masked ? MASKED_TILE_EM * FIT_REF_PX : 0.6 * FIT_REF_PX);
  } else {
    ctx.font = `${weight} ${FIT_REF_PX}px ${FIT_FONT_FAMILY}`;
    if (masked) {
      units = 0;
      for (const ch of Array.from(word)) {
        const glyph = ctx.measureText(ch).width;
        units += /[A-Za-z0-9]/.test(ch)
          ? Math.max(MASKED_TILE_EM * FIT_REF_PX, glyph)
          : glyph;
      }
    } else {
      units = ctx.measureText(word).width;
    }
  }
  if (wordUnitsCache.size > 4000) wordUnitsCache.clear();
  wordUnitsCache.set(key, units);
  return units;
}

function spaceWidthUnits(weight: number): number {
  return wordWidthUnits('\u00a0', weight, false) || 0.28 * FIT_REF_PX;
}

type MeasuredWrap = {
  lines: number;
  /** True when a word cannot fit a line even alone (masked words never mid-break). */
  overflowsWidth: boolean;
};

/** Greedy word wrap with real measured widths at the given font size. */
function measuredWrapLines(
  text: string,
  fontPx: number,
  weight: number,
  masked: boolean,
  maxWidthPx: number,
): MeasuredWrap {
  const trimmed = (text || '').trim();
  if (!trimmed || maxWidthPx <= 0 || fontPx <= 0) return { lines: 0, overflowsWidth: false };
  const scale = fontPx / FIT_REF_PX;
  const spacePx = spaceWidthUnits(weight) * scale;
  let lines = 1;
  let current = 0;
  let overflowsWidth = false;
  for (const word of trimmed.split(/\s+/)) {
    if (!word) continue;
    const w = wordWidthUnits(word, weight, masked) * scale;
    if (w > maxWidthPx) {
      if (masked && Array.from(word).length <= 18) {
        // Letter tiles render in a nowrap span — the word cannot break, only shrink.
        // (Monster words >18 chars are rendered breakable, so they fall through.)
        overflowsWidth = true;
        if (current > 0) lines += 1;
        current = maxWidthPx; // occupies a full line
        continue;
      }
      // Plain text has overflow-wrap:anywhere — the word splits across lines.
      if (current > 0) lines += 1;
      const chunks = Math.max(1, Math.ceil(w / maxWidthPx));
      lines += chunks - 1;
      current = w - (chunks - 1) * maxWidthPx;
      continue;
    }
    if (current === 0) {
      current = w;
    } else if (current + spacePx + w <= maxWidthPx) {
      current += spacePx + w;
    } else {
      lines += 1;
      current = w;
    }
  }
  return { lines, overflowsWidth };
}

export type CallCardFitOpts = {
  /** Available text width inside the card (after card + stripe padding). */
  boxWidthPx: number;
  /** Available text height inside the card (after vertical padding). */
  boxHeightPx: number;
  displayFontScale: number;
  /** Letter-tile mode (title reveal "by letter"). */
  masked: boolean;
  /** Hard px ceilings from row-height fractions (optional). */
  titleCapPx?: number;
  artistCapPx?: number;
  /** Smallest acceptable scale before we give up and let it clip. */
  minScale?: number;
};

export type CallCardFitResult = {
  textScale: number;
  titleLines: number;
  artistLines: number;
};

/**
 * Largest textScale (≤1) where the full title + artist measurably fit inside the
 * card box — real wraps, real glyph widths, no ellipsis, no clipping.
 */
export function fitCallCardText(
  title: string,
  artist: string,
  opts: CallCardFitOpts,
): CallCardFitResult | null {
  const dfs = opts.displayFontScale > 0 ? opts.displayFontScale : 1;
  if (opts.boxWidthPx <= 8 || opts.boxHeightPx <= 8) return null;
  const minScale = opts.minScale ?? FIT_MIN_SCALE;
  const titleText = (title || '').trim() || 'Unknown';
  const artistText = (artist || '').trim();
  const hasArtist = artistText.length > 0;

  // Small slack absorbs canvas-vs-DOM kerning/subpixel differences.
  const effWidthPx = opts.boxWidthPx - 2;
  const evaluate = (
    s: number,
  ): { fits: boolean; titleLines: number; artistLines: number } => {
    let titlePx = PUBLIC_DISPLAY_CALL_TITLE_BASE_PX * dfs * s;
    if (opts.titleCapPx && opts.titleCapPx > 0) titlePx = Math.min(titlePx, opts.titleCapPx);
    let artistPx = PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX * dfs * s;
    if (opts.artistCapPx && opts.artistCapPx > 0) artistPx = Math.min(artistPx, opts.artistCapPx);

    const t = measuredWrapLines(titleText, titlePx, TITLE_FONT_WEIGHT, opts.masked, effWidthPx);
    const a = hasArtist
      ? measuredWrapLines(artistText, artistPx, ARTIST_FONT_WEIGHT, opts.masked, effWidthPx)
      : { lines: 0, overflowsWidth: false };

    const heightPx =
      t.lines * PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT * titlePx +
      (hasArtist
        ? a.lines * PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT * artistPx + TITLE_ARTIST_GAP_PX
        : 0) +
      CLAMPED_LINE_PADDING_PX;
    return {
      fits:
        !t.overflowsWidth &&
        !a.overflowsWidth &&
        heightPx <= opts.boxHeightPx - FIT_HEIGHT_SAFETY_PX,
      titleLines: Math.max(1, t.lines),
      artistLines: a.lines,
    };
  };

  let lo = minScale;
  let hi = 1;
  const atFull = evaluate(1);
  if (atFull.fits) return { textScale: 1, titleLines: atFull.titleLines, artistLines: atFull.artistLines };
  let best: CallCardFitResult | null = null;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    const r = evaluate(mid);
    if (r.fits) {
      best = { textScale: mid, titleLines: r.titleLines, artistLines: r.artistLines };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  if (best) return best;
  const atMin = evaluate(minScale);
  return { textScale: minScale, titleLines: atMin.titleLines, artistLines: atMin.artistLines };
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
