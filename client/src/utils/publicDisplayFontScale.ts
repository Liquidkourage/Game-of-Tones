/** Reference 1080p landscape projector — host “100%” = optimal at this size. */
const REF_WIDTH = 1920;
const REF_HEIGHT = 1080;

/**
 * Baseline multiplier so call-list titles/artists fit ~5 rows in the call column.
 * Host slider 1.0 × this value = rendered scale on the projector.
 */
export function computeOptimalPublicDisplayFontMultiplier(
  width: number,
  height: number,
): number {
  const w = Math.max(640, width);
  const h = Math.max(480, height);
  /** Playlist title band above call columns (matches compact call-columns-header). */
  const playlistHeaderPx = Math.min(56, Math.max(28, h * 0.042));
  const callRegionH = h * 0.52 - playlistHeaderPx;
  const rowH = Math.max(52, callRegionH / 5);
  /** Letter-reveal tiles are taller than plain lines; 100% host slider should fit one card. */
  const LETTER_REVEAL_LINE_FACTOR = 1.08;
  const targetTitlePx = Math.min(44, Math.max(20, (rowH * 0.42) / LETTER_REVEAL_LINE_FACTOR));
  const fromHeight = targetTitlePx / 32;
  const fromWidth = Math.min(1.35, Math.max(0.8, w / REF_WIDTH));
  const refBlend = Math.min(1.2, Math.max(0.85, (w / REF_WIDTH + h / REF_HEIGHT) / 2));
  return Math.max(0.55, Math.min(1.5, fromHeight * Math.pow(fromWidth, 0.12) * refBlend));
}

/** Effective render multiplier: optimal fit × host percent (1.0 = 100% = best fit). */
export function effectivePublicDisplayFontScale(
  viewportWidth: number,
  viewportHeight: number,
  hostPercentMultiplier: number,
): number {
  const optimal = computeOptimalPublicDisplayFontMultiplier(viewportWidth, viewportHeight);
  const host = Number.isFinite(hostPercentMultiplier) ? hostPercentMultiplier : 1;
  return optimal * Math.max(0.5, Math.min(3, host));
}
