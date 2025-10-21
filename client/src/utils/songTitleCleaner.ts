/**
 * Automatic Song Title Cleaning Utility
 * Removes technical metadata and non-essential words from Spotify song titles
 * to make them more player-friendly for Game of Tones
 */

export interface CleanTitleOptions {
  removeRemastered?: boolean;
  removeLive?: boolean;
  removeExplicit?: boolean;
  removeVersions?: boolean;
  removeYears?: boolean;
  removeParenthetical?: boolean;
  removeDashes?: boolean;
}

const DEFAULT_OPTIONS: CleanTitleOptions = {
  removeRemastered: true,
  removeLive: true,
  removeExplicit: true,
  removeVersions: true,
  removeYears: true,
  removeParenthetical: true,
  removeDashes: true
};

/**
 * Cleans a song title by removing technical metadata and non-essential additions
 */
export function cleanSongTitle(title: string, options: CleanTitleOptions = DEFAULT_OPTIONS): string {
  if (!title || typeof title !== 'string') {
    return title;
  }

  let cleaned = title.trim();

  // Remove remastered versions
  if (options.removeRemastered) {
    cleaned = cleaned.replace(/\s*-\s*remastered\s*\d*\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(remastered\s*\d*\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\[remastered\s*\d*\]\s*$/i, '');
    cleaned = cleaned.replace(/\s*remastered\s*\d*\s*$/i, '');
  }

  // Remove live versions
  if (options.removeLive) {
    cleaned = cleaned.replace(/\s*-\s*live\s*at\s*[^)]*\)?\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(live\s*at\s*[^)]*\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\[live\s*at\s*[^\]]*\]\s*$/i, '');
    cleaned = cleaned.replace(/\s*live\s*at\s*[^)]*\)?\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*live\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(live\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\[live\]\s*$/i, '');
  }

  // Remove explicit/clean versions
  if (options.removeExplicit) {
    cleaned = cleaned.replace(/\s*-\s*explicit\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*clean\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(explicit\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(clean\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\[explicit\]\s*$/i, '');
    cleaned = cleaned.replace(/\s*\[clean\]\s*$/i, '');
  }

  // Remove version indicators
  if (options.removeVersions) {
    cleaned = cleaned.replace(/\s*-\s*single\s*version\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*radio\s*edit\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*album\s*version\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*extended\s*version\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*short\s*version\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*instrumental\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*acoustic\s*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*studio\s*version\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(single\s*version\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(radio\s*edit\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(album\s*version\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(extended\s*version\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(instrumental\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(acoustic\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(studio\s*version\)\s*$/i, '');
  }

  // Remove years (standalone or in parentheses)
  if (options.removeYears) {
    cleaned = cleaned.replace(/\s*-\s*\d{4}\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(\d{4}\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\[\d{4}\]\s*$/i, '');
  }

  // Remove parenthetical content (but be careful not to remove important info)
  if (options.removeParenthetical) {
    // Remove common parenthetical additions
    cleaned = cleaned.replace(/\s*\(feat\.?\s*[^)]*\)\s*$/i, ''); // feat. artist
    cleaned = cleaned.replace(/\s*\(featuring\s*[^)]*\)\s*$/i, ''); // featuring artist
    cleaned = cleaned.replace(/\s*\(with\s*[^)]*\)\s*$/i, ''); // with artist
    cleaned = cleaned.replace(/\s*\(from\s*[^)]*\)\s*$/i, ''); // from album/movie
    cleaned = cleaned.replace(/\s*\(soundtrack\s*version\)\s*$/i, ''); // soundtrack version
    cleaned = cleaned.replace(/\s*\(original\s*motion\s*picture\s*soundtrack\)\s*$/i, ''); // movie soundtrack
  }

  // Remove leading/trailing dashes and clean up spacing
  if (options.removeDashes) {
    cleaned = cleaned.replace(/^\s*-\s*/, ''); // Remove leading dash
    cleaned = cleaned.replace(/\s*-\s*$/, ''); // Remove trailing dash
  }

  // Clean up multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If we've cleaned too much and left nothing meaningful, return original
  if (cleaned.length < 3) {
    return title.trim();
  }

  return cleaned;
}

/**
 * Get a preview of what a cleaned title would look like
 */
export function previewCleanTitle(title: string, options: CleanTitleOptions = DEFAULT_OPTIONS): {
  original: string;
  cleaned: string;
  changes: string[];
} {
  const original = title.trim();
  const cleaned = cleanSongTitle(title, options);
  
  const changes: string[] = [];
  if (original !== cleaned) {
    changes.push(`"${original}" → "${cleaned}"`);
  }
  
  return {
    original,
    cleaned,
    changes
  };
}

/**
 * Batch clean multiple song titles
 */
export function cleanSongTitles(titles: string[], options: CleanTitleOptions = DEFAULT_OPTIONS): string[] {
  return titles.map(title => cleanSongTitle(title, options));
}

/**
 * Clean a song object's title property
 */
export function cleanSongObject(song: any, options: CleanTitleOptions = DEFAULT_OPTIONS): any {
  if (!song || typeof song !== 'object') {
    return song;
  }
  
  return {
    ...song,
    name: cleanSongTitle(song.name, options),
    // Also clean any other title fields that might exist
    title: song.title ? cleanSongTitle(song.title, options) : song.title,
    displayName: song.displayName ? cleanSongTitle(song.displayName, options) : song.displayName
  };
}

// Export commonly used patterns for reference
export const COMMON_PATTERNS = {
  REMASTERED: /remastered\s*\d*/i,
  LIVE: /live\s*at\s*[^)]*\)?/i,
  EXPLICIT: /explicit|clean/i,
  VERSIONS: /single\s*version|radio\s*edit|album\s*version|extended\s*version|instrumental|acoustic|studio\s*version/i,
  YEARS: /\d{4}/,
  FEATURING: /feat\.?\s*[^)]*|featuring\s*[^)]*|with\s*[^)]*/i
} as const;
