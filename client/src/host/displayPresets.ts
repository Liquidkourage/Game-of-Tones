export type HostDisplayPreset = {
  id: string;
  name: string;
  publicDisplayFontSize: number;
  publicDisplayTitleRevealMode: 'letter' | 'track_start' | 'track_end';
  letterRevealIntervalSec: number;
};

const STORAGE_KEY = 'got-host-display-presets-v1';

export function loadDisplayPresets(): HostDisplayPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDisplayPresets(presets: HostDisplayPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
}
