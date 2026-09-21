import type { CSSProperties } from 'react';

/**
 * Per-card call-list typography: measure → binary-search at host 100% → paint.
 * Fit always runs at hostZoom=1 (max-fill). Host Title size multiplies only at paint
 * via resolveCallCardFontSizes — 100% matches max-fill; ≠100% scales (may overflow).
 */

/** Title size on call cards; artist is intentionally smaller for hierarchy. */
export const PUBLIC_DISPLAY_CALL_TITLE_BASE_PX = 36;
export const PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX = 25;
/** Line-height for title/artist (room for descenders + masked letter tiles). */
export const PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT = 1.34;
export const PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT = 1.28;

/** Artist size as a fraction of the resolved title size (a little smaller than title). */
export const PUBLIC_DISPLAY_CALL_ARTIST_MIN_TITLE_RATIO = 0.68;
export const PUBLIC_DISPLAY_CALL_ARTIST_MAX_TITLE_RATIO = 0.78;

/** Matches `.call-carousel-col*` horizontal padding (border-box). */
export const CALL_CARD_COLUMN_PAD_X_PX = 4;
/** Matches inline / CSS letter-spacing on call title & artist. */
export const CALL_CARD_TITLE_LETTER_SPACING_EM = 0.04;
export const CALL_CARD_ARTIST_LETTER_SPACING_EM = 0.02;

/**
 * Legacy fixed gap — prefer callCardTitleArtistGapPx (one title line).
 * Kept for emergency typography fallback only.
 */
export const CALL_CARD_TITLE_ARTIST_GAP_PX = 4;
/** Tiny canvas↔DOM slack (subpixels only — stack height model must carry the rest). */
export const CALL_CARD_STACK_PAD_PX = 6;
/**
 * Residual pad after honest stack height — keep small so max-fill stays aggressive.
 * Masked multi-line gets a bit more for tile baseline struts.
 */
export const CALL_CARD_FIT_HEIGHT_SAFETY_PX = 8;
export const CALL_CARD_FIT_HEIGHT_SAFETY_MASKED_WRAP_PX = 14;

/** Box is the only lid — high enough that short titles can fill a tall card. */
const FIT_MAX_SCALE = 12;
/** Absolute floor — only hit by absurd single-word titles/artists. */
const FIT_MIN_SCALE = 0.22;
/** Smallest line-height multiplier the fitter may apply (~10% tighter). */
const FIT_LINE_HEIGHT_SCALE_MIN = 0.9;
/** Masked-only: densify letter tiles before accepting an overflowing min scale. */
const FIT_TILE_SCALE_FLOOR = 0.85;

/** Artist px used by fitter + render (hierarchy baked in — no post-fit bump). */
export function callCardArtistPxForScale(titlePx: number, textScale: number): number {
  const fromBase = PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX * textScale;
  const relMin = titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MIN_TITLE_RATIO;
  const relMax = titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MAX_TITLE_RATIO;
  return Math.min(Math.max(fromBase, relMin), relMax);
}

/**
 * Vertical gap between title and artist ≈ one artist line.
 * (A full title-line gap grew with type and shoved artists off the card.)
 */
export function callCardTitleArtistGapPx(
  _titlePx: number,
  lineHeightScale: number,
  masked: boolean,
  tileScale = 1,
  artistPx?: number,
): number {
  const ap =
    Number.isFinite(artistPx) && (artistPx as number) > 0
      ? (artistPx as number)
      : PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX;
  return callCardLineHeightEm('artist', lineHeightScale, masked, tileScale) * ap;
}

/**
 * Render sizes from a per-card fit.
 * Title uses textScale; artist uses artistTextScale when set (title-first max-fill),
 * otherwise the locked title→artist ratio from a single scale.
 */
export function resolveCallCardFontSizes(opts: {
  textScale: number;
  /** Independent artist scale (same units as textScale). Capped to title hierarchy. */
  artistTextScale?: number;
  hostZoom?: number;
}): { titlePx: number; artistPx: number } {
  const zoom = Math.max(
    0.5,
    Math.min(3, Number.isFinite(opts.hostZoom) ? (opts.hostZoom as number) : 1),
  );
  const scale = Number.isFinite(opts.textScale) && opts.textScale > 0 ? opts.textScale : 1;
  const titleUnzoomed = PUBLIC_DISPLAY_CALL_TITLE_BASE_PX * scale;
  const titlePx = Math.round(titleUnzoomed * zoom);

  let artistPx: number;
  if (Number.isFinite(opts.artistTextScale) && (opts.artistTextScale as number) > 0) {
    const aScale = opts.artistTextScale as number;
    const raw = Math.round(PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX * aScale * zoom);
    const maxA = Math.round(titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MAX_TITLE_RATIO);
    const minA = Math.round(titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MIN_TITLE_RATIO * 0.85);
    artistPx = Math.max(1, Math.min(maxA, Math.max(minA, raw)));
  } else {
    artistPx = Math.round(callCardArtistPxForScale(titleUnzoomed, scale) * zoom);
  }
  return { titlePx, artistPx };
}

export type CallCardTypography = {
  /** Scale factor for title (hostZoom multiplies at paint). */
  textScale: number;
  /**
   * Scale for artist when title-first fit ran. Omit to derive artist from textScale ratio.
   */
  artistTextScale?: number;
  titleMaxLines: number;
  artistMaxLines: number;
  /** Scales unrevealed letter-box tiles (em-based). */
  letterBoxScale: number;
  /** When true, call-song-info clamps to the card box. */
  clampContentHeight: boolean;
  /** Full title at clip start/end (plain text, not letter boxes). */
  plainFullTitle?: boolean;
  /**
   * Multiplier on title/artist line-height (1 = default). Fitter may squeeze
   * down to ~0.9 when a slightly tighter stack fits the card better.
   */
  lineHeightScale?: number;
};

/** Uncapped Full Card / blackout (plain titles only) — base × hostZoom, no row lock. */
export function uncappedFullCardTypography(): CallCardTypography {
  return {
    textScale: 1,
    titleMaxLines: 8,
    artistMaxLines: 6,
    letterBoxScale: 1,
    clampContentHeight: false,
    plainFullTitle: true,
  };
}

/** Build paint typography from a successful per-card fit. */
export function typographyFromCallCardFit(
  fit: CallCardFitResult,
  opts: { masked: boolean; plainFullTitle: boolean; hasArtist: boolean },
): CallCardTypography {
  return {
    textScale: fit.textScale,
    artistTextScale: fit.artistTextScale,
    titleMaxLines: Math.max(1, fit.titleLines),
    artistMaxLines: opts.hasArtist ? Math.max(1, fit.artistLines) : 0,
    letterBoxScale: fit.tileScale && fit.tileScale > 0 ? fit.tileScale : 1,
    clampContentHeight: true,
    plainFullTitle: opts.plainFullTitle,
    lineHeightScale: fit.lineHeightScale,
  };
}

/**
 * Emergency when the card box is not measured yet.
 * Prefer fitCallCardTextBest once geometry exists.
 */
export function emergencyCallCardTypography(
  rowHeightPx: number,
  opts: { plainFullTitle: boolean; hasArtist: boolean },
): CallCardTypography {
  const textHeightPx = Math.max(32, rowHeightPx - 14);
  const atUnit =
    2 * PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT * PUBLIC_DISPLAY_CALL_TITLE_BASE_PX +
    (opts.hasArtist
      ? PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT * PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX +
        CALL_CARD_TITLE_ARTIST_GAP_PX
      : 0) +
    CALL_CARD_STACK_PAD_PX;
  const textScale =
    atUnit > 0
      ? Math.max(FIT_MIN_SCALE, Math.min(FIT_MAX_SCALE, (textHeightPx * 0.96) / atUnit))
      : 1;
  return {
    textScale,
    titleMaxLines: 3,
    artistMaxLines: opts.hasArtist ? 2 : 0,
    letterBoxScale: 1,
    clampContentHeight: true,
    plainFullTitle: opts.plainFullTitle,
    lineHeightScale: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Measurement-based fitting (ground truth for call cards)             */
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

/**
 * Fixed-width slot for one letter — same px whether blank or revealed.
 * Inter-slot gap is real margin (CSS letter-spacing does not space inline-flex tiles).
 */
export function callLetterSlotStyle(
  ch: string,
  opts: {
    scale?: number;
    weight?: number;
    fontFamily?: string;
    /** When false, omit trailing gap (last glyph in a segment). Default true. */
    withGap?: boolean;
    letterSpacingEm?: number;
  } = {},
): CSSProperties {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const weight = opts.weight ?? TITLE_FONT_WEIGHT;
  const fontFamily = opts.fontFamily ?? PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY;
  const gapEm =
    (Number.isFinite(opts.letterSpacingEm)
      ? (opts.letterSpacingEm as number)
      : CALL_CARD_TITLE_LETTER_SPACING_EM) * scale;
  // Slightly pad advance so heavy caps (W/M/G) + blank borders don't collide.
  const advEm = getCallCharAdvanceEm(ch, weight, fontFamily) * scale + 0.04 * scale;
  const hEm = getCallTitleCapMetrics().heightEm * scale;
  const withGap = opts.withGap !== false;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${advEm}em`,
    height: `${hEm}em`,
    marginRight: withGap ? `${Math.max(0.05, gapEm)}em` : 0,
    verticalAlign: 'baseline',
    boxSizing: 'border-box',
    flex: '0 0 auto',
  };
}

/**
 * Line-height em used for fit + paint.
 * Masked: budget at least the painted letter-slot height (cap × tileScale) plus a
 * small strut so multi-line tile rows are not underestimated vs DOM.
 */
export function callCardLineHeightEm(
  kind: 'title' | 'artist',
  lineHeightScale: number,
  masked: boolean,
  tileScale = 1,
): number {
  const base =
    kind === 'title'
      ? PUBLIC_DISPLAY_CALL_TITLE_LINE_HEIGHT
      : PUBLIC_DISPLAY_CALL_ARTIST_LINE_HEIGHT;
  const lh = base * lineHeightScale;
  if (!masked) return lh;
  const ts = Number.isFinite(tileScale) && tileScale > 0 ? tileScale : 1;
  // Slot height is cap×ts; 1.18× covers baseline alignment + blank-tile border strut.
  const tileLineEm = getCallTitleCapMetrics().heightEm * ts * 1.18;
  return Math.max(lh, tileLineEm);
}

/** Title+artist stack height — shared by fitter and paint clamp. */
export function callCardStackHeightPx(opts: {
  titleLines: number;
  artistLines: number;
  titlePx: number;
  artistPx: number;
  lineHeightScale: number;
  masked: boolean;
  hasArtist: boolean;
  tileScale?: number;
}): number {
  const ts = opts.tileScale ?? 1;
  const titleLh = callCardLineHeightEm('title', opts.lineHeightScale, opts.masked, ts);
  const artistLh = callCardLineHeightEm('artist', opts.lineHeightScale, opts.masked, ts);
  const artistLines = opts.hasArtist ? Math.max(1, opts.artistLines) : 0;
  const gap = opts.hasArtist
    ? callCardTitleArtistGapPx(
        opts.titlePx,
        opts.lineHeightScale,
        opts.masked,
        ts,
        opts.artistPx,
      )
    : 0;
  return (
    opts.titleLines * titleLh * opts.titlePx +
    (opts.hasArtist ? artistLines * artistLh * opts.artistPx + gap : 0) +
    CALL_CARD_STACK_PAD_PX
  );
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
    // Sum fixed per-char slots + pad (matches callLetterSlotStyle) so fit = paint.
    units = 0;
    const padPx = 0.04 * FIT_REF_PX * ts;
    for (const ch of chars) {
      if (/[A-Za-z0-9]/.test(ch)) {
        units += getCallCharAdvanceEm(ch, weight, fontFamily) * FIT_REF_PX * ts + padPx;
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
  /** True when an unbreakable segment is wider than the line. */
  overflowsWidth: boolean;
};

/** Soft wrap points: spaces, hyphens, dashes, slashes — never mid-letter. */
const CALL_CARD_SOFT_BREAK_RE = /([^\s\-–—/]+|[\-–—/]+|\s+)/g;

/** Split title/artist into unbreakable runs + soft-break glue (hyphen stays with prior run). */
export function callCardWrapSegments(text: string): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const raw = trimmed.match(CALL_CARD_SOFT_BREAK_RE) || [trimmed];
  const out: string[] = [];
  for (const part of raw) {
    if (!part || /^\s+$/.test(part)) {
      out.push(' ');
      continue;
    }
    if (/^[\-–—/]+$/.test(part)) {
      // Keep hyphen/slash glued to the previous segment so we break *after* it.
      if (out.length > 0 && out[out.length - 1] !== ' ') {
        out[out.length - 1] += part;
      } else {
        out.push(part);
      }
      continue;
    }
    out.push(part);
  }
  return out;
}

/** Greedy wrap: break on spaces / hyphens / dashes / slashes only — never mid-letter. */
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

  for (const seg of callCardWrapSegments(trimmed)) {
    if (seg === ' ') {
      // Soft space: only counts if something already on the line.
      if (current > 0) current += spacePx;
      continue;
    }
    const w =
      wordWidthUnits(seg, weight, masked, fontFamily, tileScale, letterSpacingEm) * scale;
    const avail = lineWidth();
    if (w > avail) {
      // Unbreakable segment wider than the line — must shrink type (no letter split).
      overflowsWidth = true;
      if (current > 0) lines += 1;
      current = avail;
      continue;
    }
    if (current === 0) {
      current = w;
    } else if (current + w <= avail) {
      current += w;
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
   * Ignored by the fitter (always fits at 100%). Host Title size is applied only
   * at paint via resolveCallCardFontSizes / callCardLineStyles.
   * @deprecated Pass hostZoom only at paint — kept so old call sites stay harmless.
   */
  hostZoom?: number;
  /** Letter-tile mode (title reveal "by letter"). */
  masked: boolean;
  /**
   * Multiplier on masked letter-tile advance (1 = full cap width).
   */
  tileScale?: number;
  /** First-line width after reserving both call-number float notches. */
  firstLineWidthPx?: number;
  /** Smallest acceptable scale before we give up and let it clip. */
  minScale?: number;
  /** Largest scale to try (default 12 — box is the real lid). */
  maxScale?: number;
};

export type CallCardFitResult = {
  /** Title scale (max-fill). */
  textScale: number;
  /** Artist scale (max under title hierarchy + remaining box). */
  artistTextScale?: number;
  titleLines: number;
  artistLines: number;
  /** 1 = default leading; down to FIT_LINE_HEIGHT_SCALE_MIN when a squeeze helps. */
  lineHeightScale: number;
  /** Tile densify used for this fit (1 = full). */
  tileScale?: number;
  /** False when the chosen scale still overflows the box — DOM backoff should shrink further. */
  fits: boolean;
};

/**
 * Title-first max-fill: grow title as large as the card allows (reserving artist band),
 * then grow artist as large as remaining space allows under title>artist hierarchy.
 * Prevents a long single-line artist from punishing a short title.
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
  // Always fit at 100% — hostZoom multiplies only at paint (Title size failsafe).
  const hostZoom = 1;
  const minScale = opts.minScale ?? FIT_MIN_SCALE;
  const maxScale = opts.maxScale ?? FIT_MAX_SCALE;
  const titleText = formatCallCardTitle((title || '').trim() || 'Unknown');
  const artistText = formatCallCardArtist((artist || '').trim());
  const hasArtist = artistText.length > 0;

  const effWidthPx = Math.max(8, opts.boxWidthPx - 2);
  const firstLinePx = Math.max(
    8,
    (opts.firstLineWidthPx && opts.firstLineWidthPx > 0
      ? opts.firstLineWidthPx
      : opts.boxWidthPx) - 2,
  );

  const safetyFor = (titleLines: number) =>
    opts.masked && titleLines >= 2
      ? CALL_CARD_FIT_HEIGHT_SAFETY_MASKED_WRAP_PX
      : CALL_CARD_FIT_HEIGHT_SAFETY_PX;

  const measureTitle = (titlePx: number, ts: number) =>
    measuredWrapLines(
      titleText,
      titlePx,
      TITLE_FONT_WEIGHT,
      opts.masked,
      effWidthPx,
      PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY,
      ts,
      CALL_CARD_TITLE_LETTER_SPACING_EM,
      firstLinePx,
    );

  const measureArtist = (artistPx: number, ts: number) =>
    measuredWrapLines(
      artistText,
      artistPx,
      ARTIST_FONT_WEIGHT,
      opts.masked,
      effWidthPx,
      PUBLIC_DISPLAY_CALL_ARTIST_FONT_FAMILY,
      ts,
      CALL_CARD_ARTIST_LETTER_SPACING_EM,
      firstLinePx,
    );

  const bestAtLh = (lineHeightScale: number, ts: number): CallCardFitResult => {
    // --- Phase 1: maximize title (reserve ≥1 artist line at min hierarchy ratio) ---
    const titleFitsAt = (s: number): { ok: boolean; titleLines: number; titleH: number; titlePx: number } => {
      const { titlePx } = resolveCallCardFontSizes({ textScale: s, hostZoom });
      const t = measureTitle(titlePx, ts);
      const titleLines = Math.max(1, t.lines);
      const titleLh = callCardLineHeightEm('title', lineHeightScale, opts.masked, ts);
      const titleH = titleLines * titleLh * titlePx;
      if (t.overflowsWidth) return { ok: false, titleLines, titleH, titlePx };
      if (!hasArtist) {
        const safety = safetyFor(titleLines);
        return {
          ok: titleH + CALL_CARD_STACK_PAD_PX <= opts.boxHeightPx - safety,
          titleLines,
          titleH,
          titlePx,
        };
      }
      const reserveArtistPx = Math.max(1, Math.round(titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MIN_TITLE_RATIO));
      const artistLh = callCardLineHeightEm('artist', lineHeightScale, opts.masked, ts);
      const gap = callCardTitleArtistGapPx(titlePx, lineHeightScale, opts.masked, ts, reserveArtistPx);
      const reserveH = artistLh * reserveArtistPx + gap;
      const safety = safetyFor(titleLines);
      return {
        ok: titleH + reserveH + CALL_CARD_STACK_PAD_PX <= opts.boxHeightPx - safety,
        titleLines,
        titleH,
        titlePx,
      };
    };

    let lo = minScale;
    let hi = maxScale;
    let bestTitle = minScale;
    let bestTitleMeta = titleFitsAt(minScale);
    if (titleFitsAt(maxScale).ok) {
      bestTitle = maxScale;
      bestTitleMeta = titleFitsAt(maxScale);
    } else {
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        const r = titleFitsAt(mid);
        if (r.ok) {
          bestTitle = mid;
          bestTitleMeta = r;
          lo = mid;
        } else {
          hi = mid;
        }
      }
    }

    const titlePx = bestTitleMeta.titlePx;
    const titleLines = bestTitleMeta.titleLines;
    const titleH = bestTitleMeta.titleH;
    const titleOk = bestTitleMeta.ok;

    if (!hasArtist) {
      return {
        textScale: bestTitle,
        titleLines,
        artistLines: 0,
        lineHeightScale,
        tileScale: ts,
        fits: titleOk,
      };
    }

    // --- Phase 2: maximize artist in remaining height, under title hierarchy ---
    const safety = safetyFor(titleLines);
    const remainingH = Math.max(
      0,
      opts.boxHeightPx - safety - titleH - CALL_CARD_STACK_PAD_PX,
    );
    const maxArtistPx = Math.max(1, Math.round(titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MAX_TITLE_RATIO));
    // artistTextScale such that ARTIST_BASE * scale * zoom ≈ maxArtistPx
    const artistScaleForPx = (px: number) =>
      Math.max(minScale, px / (PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX * hostZoom));

    const artistFitsAt = (
      aScale: number,
    ): { ok: boolean; artistLines: number; artistPx: number } => {
      const { artistPx } = resolveCallCardFontSizes({
        textScale: bestTitle,
        artistTextScale: aScale,
        hostZoom,
      });
      const capped = Math.min(artistPx, maxArtistPx);
      const a = measureArtist(capped, ts);
      const artistLines = Math.max(1, a.lines);
      if (a.overflowsWidth) return { ok: false, artistLines, artistPx: capped };
      const gap = callCardTitleArtistGapPx(titlePx, lineHeightScale, opts.masked, ts, capped);
      const artistLh = callCardLineHeightEm('artist', lineHeightScale, opts.masked, ts);
      const artistH = artistLines * artistLh * capped + gap;
      return { ok: artistH <= remainingH, artistLines, artistPx: capped };
    };

    const maxAScale = artistScaleForPx(maxArtistPx);
    let aLo = minScale;
    let aHi = Math.max(minScale, maxAScale);
    let bestArtistScale = minScale;
    let bestArtistMeta = artistFitsAt(minScale);
    if (artistFitsAt(aHi).ok) {
      bestArtistScale = aHi;
      bestArtistMeta = artistFitsAt(aHi);
    } else {
      for (let i = 0; i < 16; i++) {
        const mid = (aLo + aHi) / 2;
        const r = artistFitsAt(mid);
        if (r.ok) {
          bestArtistScale = mid;
          bestArtistMeta = r;
          aLo = mid;
        } else {
          aHi = mid;
        }
      }
    }

    return {
      textScale: bestTitle,
      artistTextScale: bestArtistScale,
      titleLines,
      artistLines: bestArtistMeta.artistLines,
      lineHeightScale,
      tileScale: ts,
      fits: titleOk && bestArtistMeta.ok,
    };
  };

  const atDefault = bestAtLh(1, tileScale);
  const atTight = bestAtLh(FIT_LINE_HEIGHT_SCALE_MIN, tileScale);
  if (atDefault.fits && atTight.fits) {
    return atTight.textScale > atDefault.textScale * 1.04 ? atTight : atDefault;
  }
  if (atTight.fits) return atTight;
  if (atDefault.fits) return atDefault;
  return atTight.textScale >= atDefault.textScale ? atTight : atDefault;
}

/**
 * Per-card max-fill fit. Soft wraps on spaces/hyphens/dashes/slashes only — never mid-letter.
 * Masked multi-line: try full tiles first, then slight densify so long titles still fit without clip.
 */
export function fitCallCardTextBest(
  title: string,
  artist: string,
  opts: Omit<CallCardFitOpts, 'tileScale'>,
): CallCardFitResult | null {
  if (!opts.masked) {
    return fitCallCardText(title, artist, { ...opts, tileScale: 1 });
  }

  // Score at hostZoom=1 (same as fit) — paint applies host Title size separately.
  const tileCandidates = [1, 0.92, FIT_TILE_SCALE_FLOOR];
  let best: CallCardFitResult | null = null;
  let bestScore = -1;

  for (const ts of tileCandidates) {
    const fit = fitCallCardText(title, artist, { ...opts, tileScale: ts });
    if (!fit) continue;
    const titlePx = PUBLIC_DISPLAY_CALL_TITLE_BASE_PX * fit.textScale;
    const score = (fit.fits ? 1e9 : 0) + titlePx * (fit.tileScale ?? ts);
    if (score > bestScore) {
      bestScore = score;
      best = fit;
    }
    if (fit.fits && ts === 1) break;
  }

  return best;
}

/** Bingo pattern / winner grid cells (vmin-based sizes get a scale multiplier). */
export function computeBingoCellTextScale(title: string, artist: string): number {
  const total = (title || '').length + (artist || '').length;
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
