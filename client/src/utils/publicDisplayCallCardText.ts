import type { CSSProperties } from 'react';

/**
 * Per-card call-list typography: one measure → binary-search → paint algorithm.
 * Host 100% = largest title+artist that fits this card’s box (no fake px / maxScale lid).
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
/** Tiny canvas↔DOM slack only — gap between title/artist is a full title line. */
export const CALL_CARD_STACK_PAD_PX = 4;
/** Single canvas↔DOM height slack used by fit + paint clamp. */
export const CALL_CARD_FIT_HEIGHT_SAFETY_PX = 3;

/** Box is the only lid — high enough that short titles can fill a tall card. */
const FIT_MAX_SCALE = 12;
/** Absolute floor — only hit by absurd single-word titles/artists. */
const FIT_MIN_SCALE = 0.22;
/** Smallest line-height multiplier the fitter may apply (~10% tighter). */
const FIT_LINE_HEIGHT_SCALE_MIN = 0.9;

/** Artist px used by fitter + render (hierarchy baked in — no post-fit bump). */
export function callCardArtistPxForScale(titlePx: number, textScale: number): number {
  const fromBase = PUBLIC_DISPLAY_CALL_ARTIST_BASE_PX * textScale;
  const relMin = titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MIN_TITLE_RATIO;
  const relMax = titlePx * PUBLIC_DISPLAY_CALL_ARTIST_MAX_TITLE_RATIO;
  return Math.min(Math.max(fromBase, relMin), relMax);
}

/** Vertical gap between title and artist ≈ one title line (aesthetic breathing room). */
export function callCardTitleArtistGapPx(
  titlePx: number,
  lineHeightScale: number,
  masked: boolean,
  tileScale = 1,
): number {
  return callCardLineHeightEm('title', lineHeightScale, masked, tileScale) * titlePx;
}

/**
 * Render sizes from a per-card fit.
 * Fit must be run with the same hostZoom so title+artist still fit.
 */
export function resolveCallCardFontSizes(opts: {
  textScale: number;
  hostZoom?: number;
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

export type CallCardTypography = {
  /** Scale factor applied to base title/artist sizes (hostZoom multiplies at paint). */
  textScale: number;
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
    titleMaxLines: Math.max(1, fit.titleLines),
    artistMaxLines: opts.hasArtist ? Math.max(0, fit.artistLines) : 0,
    letterBoxScale: 1,
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

/**
 * Line-height em used for fit + paint.
 * Masked: match DOM letter-slot height (cap height × tileScale).
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
  return Math.max(lh, getCallTitleCapMetrics().heightEm * ts * 1.08);
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
  const gap = opts.hasArtist
    ? callCardTitleArtistGapPx(opts.titlePx, opts.lineHeightScale, opts.masked, ts)
    : 0;
  return (
    opts.titleLines * titleLh * opts.titlePx +
    (opts.hasArtist ? opts.artistLines * artistLh * opts.artistPx + gap : 0) +
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
  /** True when a single glyph/tile is wider than the line (cannot fit even alone). */
  overflowsWidth: boolean;
};

/** Width of one masked character slot at fontPx (advance + optional letter-spacing after). */
function maskedCharWidthPx(
  ch: string,
  fontPx: number,
  weight: number,
  fontFamily: string,
  tileScale: number,
  letterSpacingEm: number,
  addSpacingAfter: boolean,
): number {
  const scale = fontPx / FIT_REF_PX;
  let units: number;
  if (/[A-Za-z0-9]/.test(ch)) {
    units = getCallCharAdvanceEm(ch, weight, fontFamily) * FIT_REF_PX * tileScale;
  } else {
    const ctx = getFitCtx();
    if (!ctx) {
      units = CAP_METRICS_FALLBACK.widthEm * FIT_REF_PX * tileScale;
    } else {
      ctx.font = `${weight} ${FIT_REF_PX}px ${fontFamily}`;
      units = ctx.measureText(ch).width;
    }
  }
  if (addSpacingAfter && letterSpacingEm > 0) {
    units += letterSpacingEm * FIT_REF_PX;
  }
  return units * scale;
}

/** Greedy wrap with real measured widths. Masked: break inside words at letter tiles. */
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

  const breakMaskedWord = (word: string) => {
    const chars = Array.from(word);
    if (current > 0) {
      lines += 1;
      current = 0;
    }
    for (let i = 0; i < chars.length; i++) {
      const chW = maskedCharWidthPx(
        chars[i],
        fontPx,
        weight,
        fontFamily,
        tileScale,
        letterSpacingEm,
        i < chars.length - 1,
      );
      const avail = lineWidth();
      if (chW > avail) {
        overflowsWidth = true;
        if (current > 0) {
          lines += 1;
          current = 0;
        }
        current = avail;
        continue;
      }
      if (current > 0 && current + chW > avail) {
        lines += 1;
        current = chW;
      } else {
        current += chW;
      }
    }
  };

  for (const word of trimmed.split(/\s+/)) {
    if (!word) continue;
    const w =
      wordWidthUnits(word, weight, masked, fontFamily, tileScale, letterSpacingEm) * scale;
    const avail = lineWidth();
    if (w > avail) {
      if (masked) {
        // Full kerning — wrap at letter boundaries instead of densifying tiles.
        breakMaskedWord(word);
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
   * Host font % as a multiplier (1 = 100%). Must match resolveCallCardFontSizes
   * so title+artist are fitted as one unit at the size that will actually paint.
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
  textScale: number;
  titleLines: number;
  artistLines: number;
  /** 1 = default leading; down to FIT_LINE_HEIGHT_SCALE_MIN when a squeeze helps. */
  lineHeightScale: number;
  /** Tile densify used for this fit (1 = full). */
  tileScale?: number;
};

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
  const maxScale = opts.maxScale ?? FIT_MAX_SCALE;
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

  const evaluate = (
    s: number,
    lineHeightScale: number,
    ts: number,
  ): { fits: boolean; titleLines: number; artistLines: number; heightPx: number } => {
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
      ts,
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
          ts,
          CALL_CARD_ARTIST_LETTER_SPACING_EM,
          firstLinePx,
        )
      : { lines: 0, overflowsWidth: false };

    const heightPx = callCardStackHeightPx({
      titleLines: Math.max(1, t.lines),
      artistLines: a.lines,
      titlePx,
      artistPx,
      lineHeightScale,
      masked: opts.masked,
      hasArtist,
      tileScale: ts,
    });
    return {
      fits:
        !t.overflowsWidth &&
        !a.overflowsWidth &&
        heightPx <= opts.boxHeightPx - CALL_CARD_FIT_HEIGHT_SAFETY_PX,
      titleLines: Math.max(1, t.lines),
      artistLines: a.lines,
      heightPx,
    };
  };

  const bestScaleAt = (lineHeightScale: number, ts: number): CallCardFitResult => {
    let lo = minScale;
    let hi = maxScale;
    const atMax = evaluate(maxScale, lineHeightScale, ts);
    if (atMax.fits) {
      return {
        textScale: maxScale,
        titleLines: atMax.titleLines,
        artistLines: atMax.artistLines,
        lineHeightScale,
        tileScale: ts,
      };
    }
    let best: CallCardFitResult | null = null;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const r = evaluate(mid, lineHeightScale, ts);
      if (r.fits) {
        best = {
          textScale: mid,
          titleLines: r.titleLines,
          artistLines: r.artistLines,
          lineHeightScale,
          tileScale: ts,
        };
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (best) return best;
    // Nothing fitted — return true min (may still clip); never invent a higher floor.
    const atMin = evaluate(minScale, lineHeightScale, ts);
    return {
      textScale: minScale,
      titleLines: atMin.titleLines,
      artistLines: atMin.artistLines,
      lineHeightScale,
      tileScale: ts,
    };
  };

  const bestAtTile = (ts: number): CallCardFitResult => {
    const atDefault = bestScaleAt(1, ts);
    const atTight = bestScaleAt(FIT_LINE_HEIGHT_SCALE_MIN, ts);
    const defaultFits = evaluate(atDefault.textScale, 1, ts).fits;
    const tightHelpsSize = atTight.textScale > atDefault.textScale * 1.04;
    if (!defaultFits || tightHelpsSize) return atTight;
    return atDefault;
  };

  return bestAtTile(tileScale);
}

/**
 * Per-card max-fill fit at full letter advances (no densify / kerning squash).
 * Masked titles wrap at letter boundaries so horizontal pressure becomes lines,
 * then type grows until title+artist fill the fixed card without spill.
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
