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

/**
 * Legacy soft ceilings — do NOT clamp fitted call-card sizes with these.
 * Clamping at 56/40px made host 100% look tiny while 140% raised the ceiling
 * and then clipped artists. Fit owns the size; hostZoom is part of the fit.
 */
export const PUBLIC_DISPLAY_CALL_TITLE_MAX_PX = 56;
export const PUBLIC_DISPLAY_CALL_ARTIST_MAX_PX = 40;
/** Artist size as a fraction of the resolved title size (readable hierarchy). */
export const PUBLIC_DISPLAY_CALL_ARTIST_MIN_TITLE_RATIO = 0.62;
export const PUBLIC_DISPLAY_CALL_ARTIST_MAX_TITLE_RATIO = 0.8;

/** Matches `.call-carousel-col*` horizontal padding (border-box). */
export const CALL_CARD_COLUMN_PAD_X_PX = 4;
/** Matches inline / CSS letter-spacing on call title & artist. */
export const CALL_CARD_TITLE_LETTER_SPACING_EM = 0.04;
export const CALL_CARD_ARTIST_LETTER_SPACING_EM = 0.02;

/** Artist px used by fitter + render (hierarchy baked in — no post-fit bump). */
export function callCardArtistPxForScale(titlePx: number, textScale: number): number {
  const fromBase = PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX * textScale;
  const relMin = titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MIN_TITLE_RATIO;
  const relMax = titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MAX_TITLE_RATIO;
  return Math.min(Math.max(fromBase, relMin), relMax);
}

/**
 * Render sizes from a per-card fit.
 * `textScale` is relative to TITLE/ARTIST base px; hostZoom multiplies.
 * Fit must be run with the same hostZoom so title+artist still fit.
 */
export function resolveCallCardFontSizes(opts: {
  textScale: number;
  /** @deprecated Ignored — use hostZoom. */
  displayFontScale?: number;
  hostZoom?: number;
  rowPx?: number;
  plainFullTitle?: boolean;
  masked?: boolean;
}): { titlePx: number; artistPx: number } {
  const zoom = Math.max(
    0.5,
    Math.min(3, Number.isFinite(opts.hostZoom) ? (opts.hostZoom as number) : 1),
  );
  const scale = Number.isFinite(opts.textScale) && opts.textScale > 0 ? opts.textScale : 1;

  const titleUnzoomed = PUBLIC_DISPLAY_CALL_TITLE_BASE_PX * scale;
  const artistUnzoomed = callCardArtistPxForScale(titleUnzoomed, scale);
  return {
    titlePx: Math.round(titleUnzoomed * zoom),
    artistPx: Math.round(artistUnzoomed * zoom),
  };
}

/** ~how many letter-box characters fit per row in a narrow 5×15 call column. */
const MASKED_CHARS_PER_LINE_TITLE = 12;
const MASKED_CHARS_PER_LINE_ARTIST = 12;
/** Plain revealed text wraps wider in the same column (narrow ALL CAPS titles). */
const PLAIN_CHARS_PER_LINE_TITLE = 22;
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
  /**
   * Multiplier on title/artist line-height (1 = default). Fitter may squeeze
   * down to ~0.9 when a slightly tighter stack fits the card better.
   */
  lineHeightScale?: number;
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

    // Only shrink when the line budget is clearly exceeded — never shrink short
    // titles "because they're short" (that left empty card space on the projector).
    if (totalLines > CALL_CARD_TOTAL_LINE_BUDGET) {
      const fit = CALL_CARD_TOTAL_LINE_BUDGET / totalLines;
      textScale = Math.min(textScale, Math.max(0.52, fit));
    } else if (totalLines >= 6) textScale = Math.min(textScale, 0.9);
    else if (totalLines >= 5) textScale = Math.min(textScale, 0.95);

    titleMaxLines = Math.min(Math.max(tLines, tileLines, 2), 5);
    const titleBudget = Math.min(titleMaxLines, 3);
    artistMaxLines = hasArtist
      ? Math.min(Math.max(aLines, 1), Math.max(1, CALL_CARD_TOTAL_LINE_BUDGET - titleBudget + 1))
      : 0;
  } else {
    const tLines = estimateMaskedWrapLines(title, PLAIN_CHARS_PER_LINE_TITLE);
    const aLines = hasArtist ? estimateMaskedWrapLines(artist, PLAIN_CHARS_PER_LINE_ARTIST) : 0;
    titleMaxLines = Math.min(Math.max(tLines, 1), 4);
    artistMaxLines = hasArtist ? Math.min(Math.max(aLines, 1), 2) : 0;
    if (tLines + aLines >= 6) textScale = Math.min(textScale, 0.88);
    else if (tLines + aLines >= 5) textScale = Math.min(textScale, 0.93);
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
    lineHeightScale: Math.min(...typographies.map((t) => t.lineHeightScale ?? 1)),
  };
}

/** Grow/shrink textScale so title+artist fill one measured row (may exceed 1). */
export function capCallCardTextScaleForRow(
  typo: CallCardTypography,
  rowHeightPx: number,
  displayFontScale: number,
): number {
  if (rowHeightPx <= 0 || displayFontScale <= 0) return typo.textScale;
  const textHeightPx = Math.max(32, rowHeightPx - 14);
  const lhScale = typo.lineHeightScale ?? 1;
  const atUnitScale =
    typo.titleMaxLines *
      PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT *
      lhScale *
      PUBLIC_DISPLAY_CALL_TITLE_BASE_PX +
    typo.artistMaxLines *
      PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT *
      lhScale *
      PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX;
  if (atUnitScale <= 0) return typo.textScale;
  const rowCap =
    ((textHeightPx - PUBLIC_DISPLAY_CALL_TEXT_DESCENDER_PAD_PX) * 0.96) /
    (atUnitScale * displayFontScale);
  return Math.max(0.55, Math.min(2.2, rowCap));
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

/** Call-card titles (Jeopardy-board style): condensed caps. */
export const PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY =
  "'Archivo Narrow', 'Arial Narrow', 'Helvetica Condensed', sans-serif";
/** Artists use the same condensed face + ALL CAPS; titles stay heavier weight. */
export const PUBLIC_DISPLAY_CALL_ARTIST_FONT_FAMILY =
  "'Archivo Narrow', 'Arial Narrow', 'Helvetica Condensed', sans-serif";
/** Reference px for cached measurements; widths scale linearly with font size. */
const FIT_REF_PX = 100;
const TITLE_FONT_WEIGHT = 700;
const ARTIST_FONT_WEIGHT = 800;

/** Display + fit titles as ALL CAPS (Jeopardy-board readability). */
export function formatCallCardTitle(title: string): string {
  return (title || '').toLocaleUpperCase();
}

/** Artists match titles: ALL CAPS on the public call board. */
export function formatCallCardArtist(artist: string): string {
  return (artist || '').toLocaleUpperCase();
}

/**
 * Cap-letter metrics for Archivo Narrow titles — used so unrevealed tiles
 * match real capital glyphs as closely as possible (width ≈ letter, height ≈ cap).
 */
export type CallTitleCapMetrics = {
  /** Average A–Z advance width in em (of font-size). */
  widthEm: number;
  /** Cap height from 'H' ascent in em. */
  heightEm: number;
  /** Horizontal margin each side (em). */
  marginXEm: number;
  /** Full advance per masked letter incl. side margins (em). */
  advanceEm: number;
};

/** Fallback when canvas / fonts unavailable (Archivo Narrow-ish condensed caps). */
const CAP_METRICS_FALLBACK: CallTitleCapMetrics = {
  widthEm: 0.5,
  heightEm: 0.72,
  marginXEm: 0,
  advanceEm: 0.5,
};

let capMetricsCache: { key: string; value: CallTitleCapMetrics } | null = null;
const charAdvanceCache = new Map<string, number>();

/**
 * Advance width of one capital/digit in em — used for both blank tiles and revealed
 * letters so a reveal never changes word length in px.
 */
export function getCallCharAdvanceEm(
  ch: string,
  weight: number = TITLE_FONT_WEIGHT,
  fontFamily: string = PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY,
): number {
  const u = (ch || '').toUpperCase();
  const key = `${fontsLoadedFlag()}|${weight}|${fontFamily}|${u}`;
  const hit = charAdvanceCache.get(key);
  if (hit !== undefined) return hit;

  const ctx = getFitCtx();
  let em: number;
  if (!ctx || !u) {
    em = CAP_METRICS_FALLBACK.widthEm;
  } else {
    ctx.font = `${weight} ${FIT_REF_PX}px ${fontFamily}`;
    const w = ctx.measureText(u).width;
    // Floor so "I" / "1" blanks stay visible; still char-specific so W≠I.
    em = Math.min(1.1, Math.max(0.28, w / FIT_REF_PX));
  }
  if (charAdvanceCache.size > 500) charAdvanceCache.clear();
  charAdvanceCache.set(key, em);
  return em;
}

/**
 * Cap-height metrics for blank tile visuals (height only — width is per-character).
 */
export function getCallTitleCapMetrics(): CallTitleCapMetrics {
  const key = fontsLoadedFlag();
  if (capMetricsCache?.key === key) return capMetricsCache.value;

  const ctx = getFitCtx();
  if (!ctx) {
    capMetricsCache = { key, value: CAP_METRICS_FALLBACK };
    return CAP_METRICS_FALLBACK;
  }

  ctx.font = `${TITLE_FONT_WEIGHT} ${FIT_REF_PX}px ${PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY}`;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (const ch of alphabet) {
    sum += ctx.measureText(ch).width;
  }
  const avgWidthPx = sum / alphabet.length;
  const hMetrics = ctx.measureText('H');
  const ascent =
    typeof hMetrics.actualBoundingBoxAscent === 'number' && hMetrics.actualBoundingBoxAscent > 0
      ? hMetrics.actualBoundingBoxAscent
      : FIT_REF_PX * 0.72;

  const widthEm = avgWidthPx / FIT_REF_PX;
  const heightEm = ascent / FIT_REF_PX;
  const value: CallTitleCapMetrics = {
    widthEm: Math.min(0.68, Math.max(0.34, widthEm)),
    heightEm: Math.min(0.85, Math.max(0.62, heightEm)),
    marginXEm: 0,
    advanceEm: widthEm,
  };
  capMetricsCache = { key, value };
  return value;
}

/** Fixed-width slot for one letter — same px whether blank or revealed. */
export function callLetterSlotStyle(
  ch: string,
  opts: { scale?: number; weight?: number; fontFamily?: string } = {},
): CSSProperties {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const weight = opts.weight ?? TITLE_FONT_WEIGHT;
  const fontFamily = opts.fontFamily ?? PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY;
  const advEm = getCallCharAdvanceEm(ch, weight, fontFamily) * scale;
  const hEm = getCallTitleCapMetrics().heightEm * scale;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${advEm}em`,
    height: `${hEm}em`,
    verticalAlign: 'baseline',
    boxSizing: 'border-box',
  };
}
/** Gap between title and artist blocks (callCardLineStyles artist marginTop). */
const TITLE_ARTIST_GAP_PX = 4;
/** callCardLineStyles paddingBottom on clamped cards (title 3 + artist 4). */
const CLAMPED_LINE_PADDING_PX = 7;
/** Vertical safety — small DOM/canvas slack only (was over-padding and starving 100%). */
const FIT_HEIGHT_SAFETY_PX = 6;
const FIT_HEIGHT_SAFETY_MASKED_PX = 8;
/** Absolute floor — only hit by absurd single-word titles/artists (e.g. 30+ char words). */
const FIT_MIN_SCALE = 0.22;

/** Line-height em used for fit + clamp — letter tiles are taller than plain lh. */
export function callCardLineHeightEm(
  kind: 'title' | 'artist',
  lineHeightScale: number,
  masked: boolean,
): number {
  const base =
    kind === 'title'
      ? PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT
      : PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT;
  const lh = base * lineHeightScale;
  if (!masked) return lh;
  return Math.max(lh, getCallTitleCapMetrics().heightEm * 1.08);
}

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

/**
 * Width of one word at FIT_REF_PX (cached).
 * Masked uses per-char slot advances (same as revealed) so fit matches stable DOM slots.
 */
function wordWidthUnits(
  word: string,
  weight: number,
  masked: boolean,
  fontFamily: string,
  tileScale = 1,
  letterSpacingEm = 0,
): number {
  const ts = Number.isFinite(tileScale) && tileScale > 0 ? tileScale : 1;
  const ls = Number.isFinite(letterSpacingEm) && letterSpacingEm > 0 ? letterSpacingEm : 0;
  const key = `${fontsLoadedFlag()}|${masked ? 'm' : 'p'}|${ts.toFixed(2)}|${ls.toFixed(3)}|${weight}|${fontFamily}|${word}`;
  const hit = wordUnitsCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = getFitCtx();
  const chars = Array.from(word);
  let units: number;
  if (!ctx) {
    units = chars.length * CAP_METRICS_FALLBACK.widthEm * FIT_REF_PX * ts;
  } else if (masked) {
    // Sum fixed per-char slots (identical whether blank or revealed).
    units = 0;
    for (const ch of chars) {
      if (/[A-Za-z0-9]/.test(ch)) {
        units += getCallCharAdvanceEm(ch, weight, fontFamily) * FIT_REF_PX * ts;
      } else {
        ctx.font = `${weight} ${FIT_REF_PX}px ${fontFamily}`;
        units += ctx.measureText(ch).width;
      }
    }
  } else {
    ctx.font = `${weight} ${FIT_REF_PX}px ${fontFamily}`;
    units = ctx.measureText(word).width;
  }
  // CSS letter-spacing applies between glyphs / inline-block slots.
  if (ls > 0 && chars.length > 1) {
    units += ls * (chars.length - 1) * FIT_REF_PX;
  }
  if (wordUnitsCache.size > 4000) wordUnitsCache.clear();
  wordUnitsCache.set(key, units);
  return units;
}

function spaceWidthUnits(weight: number, fontFamily: string): number {
  return wordWidthUnits('\u00a0', weight, false, fontFamily) || 0.28 * FIT_REF_PX;
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
  fontFamily: string,
  tileScale = 1,
  letterSpacingEm = 0,
  /** Narrower first line (call-number float notches). */
  firstLineMaxWidthPx?: number,
): MeasuredWrap {
  const trimmed = (text || '').trim();
  if (!trimmed || maxWidthPx <= 0 || fontPx <= 0) return { lines: 0, overflowsWidth: false };
  const scale = fontPx / FIT_REF_PX;
  const spacePx = spaceWidthUnits(weight, fontFamily) * scale;
  const firstW =
    firstLineMaxWidthPx && firstLineMaxWidthPx > 0
      ? Math.min(firstLineMaxWidthPx, maxWidthPx)
      : maxWidthPx;
  let lines = 1;
  let current = 0;
  let overflowsWidth = false;
  const lineWidth = () => (lines === 1 ? firstW : maxWidthPx);
  for (const word of trimmed.split(/\s+/)) {
    if (!word) continue;
    const w =
      wordWidthUnits(word, weight, masked, fontFamily, tileScale, letterSpacingEm) * scale;
    const avail = lineWidth();
    if (w > avail) {
      if (masked && Array.from(word).length <= 18) {
        // Letter tiles render in a nowrap span — the word cannot break, only shrink.
        overflowsWidth = true;
        if (current > 0) lines += 1;
        current = lineWidth();
        continue;
      }
      // Plain text has overflow-wrap:anywhere — the word splits across lines.
      if (current > 0) lines += 1;
      const chunks = Math.max(1, Math.ceil(w / lineWidth()));
      lines += chunks - 1;
      current = w - (chunks - 1) * lineWidth();
      continue;
    }
    if (current === 0) {
      current = w;
    } else if (current + spacePx + w <= avail) {
      current += spacePx + w;
    } else {
      lines += 1;
      current = w;
    }
  }
  return { lines, overflowsWidth };
}

export type CallCardFitOpts = {
  /** Full text width inside the card (after card + column padding) — lines after the first. */
  boxWidthPx: number;
  /** Available text height inside the card (after vertical padding). */
  boxHeightPx: number;
  /**
   * @deprecated Use hostZoom — fit evaluates the same zoom used at render.
   */
  displayFontScale?: number;
  /**
   * Host font % as a multiplier (1 = 100%). Must match resolveCallCardFontSizes
   * so title+artist are fitted as one unit at the size that will actually paint.
   */
  hostZoom?: number;
  /** Letter-tile mode (title reveal "by letter"). */
  masked: boolean;
  /**
   * Multiplier on masked letter-tile advance (1 = full cap width).
   * Prefer trying denser tiles via fitCallCardTextBest rather than a hard floor.
   */
  tileScale?: number;
  /** First-line width after reserving both call-number float notches. */
  firstLineWidthPx?: number;
  /** Smallest acceptable scale before we give up and let it clip. */
  minScale?: number;
  /** Largest scale to try so short titles can fill empty card space (default 2.8). */
  maxScale?: number;
};

export type CallCardFitResult = {
  textScale: number;
  titleLines: number;
  artistLines: number;
  /** 1 = default leading; down to FIT_LINE_HEIGHT_SCALE_MIN when a squeeze helps. */
  lineHeightScale: number;
  /** Tile densify used for this fit (1 = full). */
  tileScale?: number;
};

/** Smallest line-height multiplier the fitter may apply (~10% tighter). */
const FIT_LINE_HEIGHT_SCALE_MIN = 0.9;

/**
 * Largest textScale where title + artist measurably fit the card box at hostZoom.
 * Host 100% (zoom=1) = biggest combined size that does not spill.
 */
export function fitCallCardText(
  title: string,
  artist: string,
  opts: CallCardFitOpts,
): CallCardFitResult | null {
  if (opts.boxWidthPx <= 8 || opts.boxHeightPx <= 8) return null;
  const tileScale =
    Number.isFinite(opts.tileScale) && (opts.tileScale as number) > 0
      ? (opts.tileScale as number)
      : 1;
  const hostZoom = Math.max(
    0.5,
    Math.min(3, Number.isFinite(opts.hostZoom) ? (opts.hostZoom as number) : 1),
  );
  const minScale = opts.minScale ?? FIT_MIN_SCALE;
  const maxScale = opts.maxScale ?? 2.8;
  const titleText = formatCallCardTitle((title || '').trim() || 'Unknown');
  const artistText = formatCallCardArtist((artist || '').trim());
  const hasArtist = artistText.length > 0;

  // Small slack absorbs canvas-vs-DOM kerning/subpixel differences.
  const effWidthPx = Math.max(8, opts.boxWidthPx - 2);
  const firstLinePx = Math.max(
    8,
    (opts.firstLineWidthPx && opts.firstLineWidthPx > 0
      ? opts.firstLineWidthPx
      : opts.boxWidthPx) - 2,
  );

  const heightSafety = opts.masked ? FIT_HEIGHT_SAFETY_MASKED_PX : FIT_HEIGHT_SAFETY_PX;

  const evaluate = (
    s: number,
    lineHeightScale: number,
  ): { fits: boolean; titleLines: number; artistLines: number } => {
    // Evaluate at the same zoomed px that resolveCallCardFontSizes will paint.
    const titlePx = PUBLIC_DISPLAY_CALL_TITLE_BASE_PX * s * hostZoom;
    const artistPx = callCardArtistPxForScale(PUBLIC_DISPLAY_CALL_TITLE_BASE_PX * s, s) * hostZoom;

    const t = measuredWrapLines(
      titleText,
      titlePx,
      TITLE_FONT_WEIGHT,
      opts.masked,
      effWidthPx,
      PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY,
      tileScale,
      CALL_CARD_TITLE_LETTER_SPACING_EM,
      firstLinePx,
    );
    const a = hasArtist
      ? measuredWrapLines(
          artistText,
          artistPx,
          ARTIST_FONT_WEIGHT,
          opts.masked,
          effWidthPx,
          PUBLIC_DISPLAY_CALL_ARTIST_FONT_FAMILY,
          tileScale,
          CALL_CARD_ARTIST_LETTER_SPACING_EM,
          firstLinePx,
        )
      : { lines: 0, overflowsWidth: false };

    const titleLh = callCardLineHeightEm('title', lineHeightScale, opts.masked);
    const artistLh = callCardLineHeightEm('artist', lineHeightScale, opts.masked);
    const heightPx =
      t.lines * titleLh * titlePx +
      (hasArtist ? a.lines * artistLh * artistPx + TITLE_ARTIST_GAP_PX : 0) +
      CLAMPED_LINE_PADDING_PX;
    return {
      fits:
        !t.overflowsWidth &&
        !a.overflowsWidth &&
        heightPx <= opts.boxHeightPx - heightSafety,
      titleLines: Math.max(1, t.lines),
      artistLines: a.lines,
    };
  };

  const bestScaleAt = (lineHeightScale: number): CallCardFitResult => {
    let lo = minScale;
    let hi = maxScale;
    const atMax = evaluate(maxScale, lineHeightScale);
    if (atMax.fits) {
      return {
        textScale: maxScale,
        titleLines: atMax.titleLines,
        artistLines: atMax.artistLines,
        lineHeightScale,
        tileScale,
      };
    }
    let best: CallCardFitResult | null = null;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const r = evaluate(mid, lineHeightScale);
      if (r.fits) {
        best = {
          textScale: mid,
          titleLines: r.titleLines,
          artistLines: r.artistLines,
          lineHeightScale,
          tileScale,
        };
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (best) return best;
    // Nothing fitted — return true min (may still clip); never invent a higher floor.
    const atMin = evaluate(minScale, lineHeightScale);
    return {
      textScale: minScale,
      titleLines: atMin.titleLines,
      artistLines: atMin.artistLines,
      lineHeightScale,
      tileScale,
    };
  };

  const atDefault = bestScaleAt(1);
  const atTight = bestScaleAt(FIT_LINE_HEIGHT_SCALE_MIN);
  const defaultFits = evaluate(atDefault.textScale, 1).fits;
  const tightHelpsSize = atTight.textScale > atDefault.textScale * 1.04;
  if (!defaultFits || tightHelpsSize) {
    return atTight;
  }
  return atDefault;
}

/**
 * Per-card fit. Letter slots are per-character (stable on reveal), so tileScale
 * stays 1 — densifying blanks would desync fit from DOM width.
 */
export function fitCallCardTextBest(
  title: string,
  artist: string,
  opts: Omit<CallCardFitOpts, 'tileScale'>,
): CallCardFitResult | null {
  return fitCallCardText(title, artist, { ...opts, tileScale: 1 });
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

/**
 * @deprecated Prefer callLetterSlotStyle — average-width blanks shift words on reveal.
 */
export function unrevealedLetterBoxStyle(scale = 1): CSSProperties {
  return {
    ...callLetterSlotStyle('H', { scale }),
    border: `${0.04 * scale}em solid rgba(255, 255, 255, 0.5)`,
    borderRadius: `${0.055 * scale}em`,
    background: 'rgba(255, 255, 255, 0.08)',
  };
}

/** Empty blank that fills a fixed per-character slot (width set by parent). */
export function unrevealedLetterFillStyle(scale = 1): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    height: '100%',
    border: `${0.04 * scale}em solid rgba(255, 255, 255, 0.5)`,
    borderRadius: `${0.055 * scale}em`,
    boxSizing: 'border-box',
    background: 'rgba(255, 255, 255, 0.08)',
  };
}
