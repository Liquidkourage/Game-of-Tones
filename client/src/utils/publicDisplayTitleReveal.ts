export type PublicDisplayTitleRevealMode = 'letter' | 'track_start' | 'track_end';

/** Matches server `publicDisplayTitleRevealMode` values. */
export function normalizePublicDisplayTitleRevealMode(raw: unknown): PublicDisplayTitleRevealMode {
  const m = String(raw ?? '').toLowerCase().replace(/-/g, '_');
  if (m === 'track_start' || m === 'beginning' || m === 'start') return 'track_start';
  if (m === 'track_end' || m === 'end') return 'track_end';
  return 'letter';
}
