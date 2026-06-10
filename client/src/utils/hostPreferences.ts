import {
  normalizePublicDisplayTitleRevealMode,
  type PublicDisplayTitleRevealMode,
} from './publicDisplayTitleReveal';

export type HostPreferencesV1 = {
  v: 1;
  snippetLength: number;
  randomStarts: 'none' | 'early' | 'random';
  publicDisplayFontSize: number;
  publicDisplayTitleRevealMode: PublicDisplayTitleRevealMode;
  letterRevealIntervalSec: number;
  publicDisplayLetterRevealToast: boolean;
  freeSpaceEnabled: boolean;
  venueSpotifyJamMode: boolean;
  /** Comma-separated title flags that mark this host's curated playlists (library picks toggle). */
  playlistTitleFlags: string;
};

export const DEFAULT_PLAYLIST_TITLE_FLAGS = 'GoT, Game of Tones';

const STORAGE_PREFIX = 'got-host-prefs-v1';

function storageKey(hostId: string | number): string {
  return `${STORAGE_PREFIX}:${String(hostId)}`;
}

export function defaultHostPreferences(): HostPreferencesV1 {
  return {
    v: 1,
    snippetLength: 30,
    randomStarts: 'none',
    publicDisplayFontSize: 1,
    publicDisplayTitleRevealMode: 'letter',
    letterRevealIntervalSec: 15,
    publicDisplayLetterRevealToast: true,
    freeSpaceEnabled: false,
    venueSpotifyJamMode: false,
    playlistTitleFlags: DEFAULT_PLAYLIST_TITLE_FLAGS,
  };
}

export function loadHostPreferences(
  hostId: string | number | null | undefined,
): Partial<HostPreferencesV1> {
  if (hostId == null || String(hostId).trim() === '') return {};
  try {
    const raw = localStorage.getItem(storageKey(hostId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<HostPreferencesV1>;
    if (parsed.v !== 1) return {};
    return {
      snippetLength:
        typeof parsed.snippetLength === 'number'
          ? Math.min(60, Math.max(5, Math.round(parsed.snippetLength)))
          : undefined,
      randomStarts:
        parsed.randomStarts === 'none' ||
        parsed.randomStarts === 'early' ||
        parsed.randomStarts === 'random'
          ? parsed.randomStarts
          : undefined,
      publicDisplayFontSize:
        typeof parsed.publicDisplayFontSize === 'number'
          ? Math.min(3, Math.max(0.5, parsed.publicDisplayFontSize))
          : undefined,
      publicDisplayTitleRevealMode: parsed.publicDisplayTitleRevealMode
        ? normalizePublicDisplayTitleRevealMode(parsed.publicDisplayTitleRevealMode)
        : undefined,
      letterRevealIntervalSec:
        typeof parsed.letterRevealIntervalSec === 'number'
          ? Math.min(120, Math.max(5, Math.round(parsed.letterRevealIntervalSec)))
          : undefined,
      publicDisplayLetterRevealToast:
        typeof parsed.publicDisplayLetterRevealToast === 'boolean'
          ? parsed.publicDisplayLetterRevealToast
          : undefined,
      freeSpaceEnabled:
        typeof parsed.freeSpaceEnabled === 'boolean' ? parsed.freeSpaceEnabled : undefined,
      venueSpotifyJamMode:
        typeof parsed.venueSpotifyJamMode === 'boolean' ? parsed.venueSpotifyJamMode : undefined,
      playlistTitleFlags:
        typeof parsed.playlistTitleFlags === 'string'
          ? parsed.playlistTitleFlags.slice(0, 200)
          : undefined,
    };
  } catch {
    return {};
  }
}

export function saveHostPreferences(
  hostId: string | number | null | undefined,
  prefs: Partial<HostPreferencesV1>,
): void {
  if (hostId == null || String(hostId).trim() === '') return;
  const prev = { ...defaultHostPreferences(), ...loadHostPreferences(hostId), ...prefs, v: 1 as const };
  try {
    localStorage.setItem(storageKey(hostId), JSON.stringify(prev));
  } catch {
    /* ignore quota */
  }
}
