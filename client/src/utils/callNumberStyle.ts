/** How the call/play-order number renders on public display song cards. */
export type CallNumberStyle = 'negative' | 'chip' | 'inline' | 'stripe';

export const DEFAULT_CALL_NUMBER_STYLE: CallNumberStyle = 'negative';

export const CALL_NUMBER_STYLE_OPTIONS: Array<{
  value: CallNumberStyle;
  label: string;
  description: string;
}> = [
  { value: 'negative', label: 'Negative', description: 'Large dark number carved out behind the text' },
  { value: 'chip', label: 'Corner chip', description: 'Bold mint badge in the top-left corner' },
  { value: 'inline', label: 'Inline', description: 'Mint pill before the song title' },
  { value: 'stripe', label: 'Edge stripe', description: 'Bright numbered band on the left edge' },
];

/** Removed styles (ghost/outline) fall back to the closest surviving look. */
const LEGACY_STYLE_MAP: Record<string, CallNumberStyle> = {
  ghost: 'negative',
  outline: 'negative',
};

export function normalizeCallNumberStyle(raw: unknown): CallNumberStyle | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (CALL_NUMBER_STYLE_OPTIONS.some((o) => o.value === s)) return s as CallNumberStyle;
  return LEGACY_STYLE_MAP[s] ?? null;
}
