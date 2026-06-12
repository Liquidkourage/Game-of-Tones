/** How the call/play-order number renders on public display song cards. */
export type CallNumberStyle =
  | 'negative'
  | 'ghost'
  | 'outline'
  | 'chip'
  | 'inline'
  | 'stripe';

export const DEFAULT_CALL_NUMBER_STYLE: CallNumberStyle = 'negative';

export const CALL_NUMBER_STYLE_OPTIONS: Array<{
  value: CallNumberStyle;
  label: string;
  description: string;
}> = [
  { value: 'negative', label: 'Negative', description: 'Dark number centered behind the text' },
  { value: 'ghost', label: 'Ghost', description: 'Soft mint number centered behind the text' },
  { value: 'outline', label: 'Outline', description: 'Hollow mint number behind the text' },
  { value: 'chip', label: 'Corner chip', description: 'Small solid badge in the top-left corner' },
  { value: 'inline', label: 'Inline', description: 'Number before the song title' },
  { value: 'stripe', label: 'Edge stripe', description: 'Slim numbered band on the left edge' },
];

export function normalizeCallNumberStyle(raw: unknown): CallNumberStyle | null {
  const s = String(raw ?? '').trim().toLowerCase();
  return (CALL_NUMBER_STYLE_OPTIONS.some((o) => o.value === s)
    ? (s as CallNumberStyle)
    : null);
}
