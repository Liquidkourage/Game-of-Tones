/**
 * Public display palette — 5 neon colors only (void, ink, violet, mint, snow).
 * All gradients and glows derive from these via alpha blends.
 */

export const pdPalette = {
  void: '#0a0a14',
  ink: '#16122a',
  violet: '#8b5cf6',
  mint: '#00ff88',
  snow: '#e8e6ff',
} as const;

const violetRgb = '139, 92, 246';
const mintRgb = '0, 255, 136';

export const pdGlass = {
  void: pdPalette.void,
  ink: pdPalette.ink,
  violet: pdPalette.violet,
  mint: pdPalette.mint,
  snow: pdPalette.snow,
  pageBg: `linear-gradient(155deg, ${pdPalette.void} 0%, ${pdPalette.ink} 48%, ${pdPalette.void} 100%)`,
  pageBgConnect: `linear-gradient(155deg, ${pdPalette.void} 0%, ${pdPalette.ink} 55%, ${pdPalette.void} 100%)`,
  glassPanel: `linear-gradient(145deg, rgba(${violetRgb}, 0.28) 0%, rgba(${violetRgb}, 0.08) 42%, rgba(10, 10, 20, 0.72) 100%)`,
  glassPanelStrong: `linear-gradient(165deg, rgba(${violetRgb}, 0.38) 0%, rgba(${violetRgb}, 0.12) 40%, rgba(10, 10, 20, 0.92) 100%)`,
  borderViolet: `rgba(${violetRgb}, 0.55)`,
  borderMint: `rgba(${mintRgb}, 0.65)`,
  borderMintStrong: `rgba(${mintRgb}, 0.85)`,
  glowViolet: `0 0 40px rgba(${violetRgb}, 0.45)`,
  glowMint: `0 0 36px rgba(${mintRgb}, 0.4)`,
  shadowGlass: `0 12px 40px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(${mintRgb}, 0.12)`,
  titleGradient: `linear-gradient(90deg, ${pdPalette.mint} 0%, ${pdPalette.violet} 42%, ${pdPalette.snow} 50%, ${pdPalette.violet} 58%, ${pdPalette.mint} 100%)`,
  thumbViolet: `linear-gradient(135deg, rgba(${violetRgb}, 0.95) 0%, rgba(${violetRgb}, 0.35) 55%, rgba(${mintRgb}, 0.15) 100%)`,
  thumbMint: `linear-gradient(135deg, rgba(${mintRgb}, 0.55) 0%, rgba(${violetRgb}, 0.75) 100%)`,
} as const;

export function callThumbBackground(seed: number): string {
  return seed % 2 === 0 ? pdGlass.thumbViolet : pdGlass.thumbMint;
}
