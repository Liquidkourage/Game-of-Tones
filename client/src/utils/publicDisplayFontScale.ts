/**
 * Host font % is a pure multiplier on per-card fitted sizes.
 * Viewport “optimal” is no longer the primary size driver — call cards binary-search
 * the largest type that fits each card at host 100% (see fitCallCardText).
 */

/** Soft upper seed for binary-search maxScale only (not applied as a global dfs). */
export function computeOptimalPublicDisplayFontMultiplier(
  _width: number,
  _height: number,
): number {
  return 1;
}

/**
 * Host slider only. 1.0 = 100% = per-card fitted size (no viewport inflation).
 */
export function effectivePublicDisplayFontScale(
  _viewportWidth: number,
  _viewportHeight: number,
  hostPercentMultiplier: number,
): number {
  const host = Number.isFinite(hostPercentMultiplier) ? hostPercentMultiplier : 1;
  return Math.max(0.5, Math.min(3, host));
}
