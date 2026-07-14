import {
  normalizePublicDisplayTitleRevealMode,
  type PublicDisplayTitleRevealMode,
} from './publicDisplayTitleReveal';

export type BingoWinPolicy = 'any_round' | 'one_win';

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
  /** Five column letters shown on cards / call list headers (e.g. BINGO, TEMPO, TONES). */
  bingoColumnLetters: string;
  /** How many bingo cards each player is dealt at round start (1–3). Default 1. */
  maxPlayerBingoCards: number;
  /**
   * any_round — each Start Game, players can win officially again.
   * one_win — only one official (pausing) win per player per event; later pattern completes
   * get acknowledgment without pausing the round (same shape as hybrid online bingo).
   */
  bingoWinPolicy: BingoWinPolicy;
};

/** Clamp host cards-per-player to 1–3. */
export function normalizeMaxPlayerBingoCards(raw: unknown, fallback = 1): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(3, Math.max(1, n));
}

export function normalizeBingoWinPolicy(raw: unknown, fallback: BingoWinPolicy = 'any_round'): BingoWinPolicy {
  return raw === 'one_win' || raw === 'any_round' ? raw : fallback;
}

export const DEFAULT_PLAYLIST_TITLE_FLAGS = 'GoT, Game of Tones';
export const DEFAULT_BINGO_COLUMN_LETTERS = 'BINGO';

/** Uppercase A–Z/0–9 only, exactly 5 characters — otherwise null (caller falls back to BINGO). */
export function normalizeBingoColumnLetters(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return cleaned.length === 5 ? cleaned : null;
}

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
    bingoColumnLetters: DEFAULT_BINGO_COLUMN_LETTERS,
    maxPlayerBingoCards: 1,
    bingoWinPolicy: 'any_round',
  };
}

/** Validate/clamp a raw preferences object (from localStorage or the server) field by field. */
export function sanitizeHostPreferences(raw: unknown): Partial<HostPreferencesV1> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const parsed = raw as Partial<HostPreferencesV1>;
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
      bingoColumnLetters: normalizeBingoColumnLetters(parsed.bingoColumnLetters) ?? undefined,
      maxPlayerBingoCards:
        parsed.maxPlayerBingoCards != null
          ? normalizeMaxPlayerBingoCards(parsed.maxPlayerBingoCards, 1)
          : undefined,
      bingoWinPolicy:
        parsed.bingoWinPolicy === 'one_win' || parsed.bingoWinPolicy === 'any_round'
          ? parsed.bingoWinPolicy
          : undefined,
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
    return sanitizeHostPreferences(parsed);
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
