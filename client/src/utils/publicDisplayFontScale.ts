/**
 * Host font % is a multiplier passed into per-card fit (and render).
 * Call cards binary-search the largest type where title+artist both fit at that zoom.
 * Host 100% = that max size (no separate px ceiling that undercuts the fit).
 */

/** Soft upper seed for binary-search maxScale only (not applied as a global dfs). */
export function computeOptimalPublicDisplayFontMultiplier(
  _width: number,
  _height: number,
): number {
  return 1;
}

/**
 * Host slider only. 1.0 = 100% = per-card fitted size at this zoom.
 */
export function effectivePublicDisplayFontScale(
  _viewportWidth: number,
  _viewportHeight: number,
  hostPercentMultiplier: number,
): number {
  const host = Number.isFinite(hostPercentMultiplier) ? hostPercentMultiplier : 1;
  return Math.max(0.5, Math.min(3, host));
}
