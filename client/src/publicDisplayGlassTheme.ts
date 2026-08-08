/**
 * Public display palette — 5 neon colors only (void, ink, violet, mint, snow).
 * All gradients and glows derive from these via alpha blends.
 */

export type PublicDisplayTheme = 'dark' | 'light';

export const DISPLAY_THEME_STORAGE_KEY = 'public_display_theme';

export const pdPalette = {
  void: '#0a0a14',
  ink: '#16122a',
  violet: '#8b5cf6',
  mint: '#00ff88',
  snow: '#e8e6ff',
} as const;

/** Outdoor / bright-room projector variant — dark text on pale glass. */
export const pdPaletteLight = {
  void: '#f4f6fb',
  ink: '#e4e9f4',
  violet: '#6d28d9',
  mint: '#059669',
  snow: '#0f172a',
} as const;

const violetRgb = '139, 92, 246';
const mintRgb = '0, 255, 136';
const violetRgbLight = '109, 40, 217';
const mintRgbLight = '5, 150, 105';

function buildPdGlass(
  palette: typeof pdPalette | typeof pdPaletteLight,
  violet: string,
  mint: string,
  panelInk: string,
) {
  return {
    void: palette.void,
    ink: palette.ink,
    violet: palette.violet,
    mint: palette.mint,
    snow: palette.snow,
    pageBg: `linear-gradient(155deg, ${palette.void} 0%, ${palette.ink} 48%, ${palette.void} 100%)`,
    pageBgConnect: `linear-gradient(155deg, ${palette.void} 0%, ${palette.ink} 55%, ${palette.void} 100%)`,
    glassPanel: `linear-gradient(145deg, rgba(${violet}, 0.22) 0%, rgba(${violet}, 0.08) 42%, ${panelInk} 100%)`,
    glassPanelStrong: `linear-gradient(165deg, rgba(${violet}, 0.32) 0%, rgba(${violet}, 0.12) 40%, ${panelInk} 100%)`,
    borderViolet: `rgba(${violet}, 0.55)`,
    borderMint: `rgba(${mint}, 0.65)`,
    borderMintStrong: `rgba(${mint}, 0.85)`,
    glowViolet: `0 0 40px rgba(${violet}, 0.35)`,
    glowMint: `0 0 36px rgba(${mint}, 0.3)`,
    shadowGlass: `0 12px 40px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(${mint}, 0.12)`,
    titleGradient: `linear-gradient(90deg, ${palette.mint} 0%, ${palette.violet} 42%, ${palette.snow} 50%, ${palette.violet} 58%, ${palette.mint} 100%)`,
  } as const;
}

export const pdGlass = buildPdGlass(pdPalette, violetRgb, mintRgb, 'rgba(10, 10, 20, 0.72)');
export const pdGlassLight = buildPdGlass(
  pdPaletteLight,
  violetRgbLight,
  mintRgbLight,
  'rgba(255, 255, 255, 0.88)',
);

export function readStoredDisplayTheme(): PublicDisplayTheme {
  try {
    const stored = localStorage.getItem(DISPLAY_THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function glassForDisplayTheme(theme: PublicDisplayTheme) {
  return theme === 'light' ? pdGlassLight : pdGlass;
}
