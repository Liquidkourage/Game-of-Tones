/**
 * Automatic Song Title Cleaning Utility
 * Strips Spotify / streaming metadata junk so bingo cards & projector stay readable.
 *
 * Keeps meaningful subtitles (e.g. "Theme from X", "Animal (Fuck Like A Beast)",
 * "(Good Ol' Boys)") — only removes known technical / featuring / edition tags.
 */

export interface CleanTitleOptions {
  removeRemastered?: boolean;
  removeLive?: boolean;
  removeExplicit?: boolean;
  removeVersions?: boolean;
  removeYears?: boolean;
  removeParenthetical?: boolean;
  removeDashes?: boolean;
  removeFeaturing?: boolean;
  removeVideoTags?: boolean;
}

const DEFAULT_OPTIONS: CleanTitleOptions = {
  removeRemastered: true,
  removeLive: true,
  removeExplicit: true,
  removeVersions: true,
  removeYears: true,
  removeParenthetical: true,
  removeDashes: true,
  removeFeaturing: true,
  removeVideoTags: true,
};

type FilterRule = { source: RegExp; target: string };

function applyRules(text: string, rules: FilterRule[]): string {
  return rules.reduce((t, { source, target }) => t.replace(source, target), text);
}

/** Peel stacked suffixes until stable (e.g. feat + remaster + from). */
function peelUntilStable(text: string, step: (s: string) => string, maxPasses = 6): string {
  let cur = text;
  for (let i = 0; i < maxPasses; i++) {
    const next = step(cur).replace(/\s+/g, ' ').trim();
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

const REMASTERED_RULES: FilterRule[] = [
  // Ticket To Ride - Live / Remastered
  { source: /\sLive\s\/\sRemastered/i, target: ' Live' },
  // (Remastered) / (Remastered 2009) / [Deluxe Remaster] / (2011 Remaster)
  { source: /\s[([].*?Re-?[Mm]aster(?:ed)?.*?[)\]]\s*$/i, target: '' },
  // - 2011 - Remaster / - 2006 Remaster / - 2001 Digital Remaster
  { source: /\s[-–—]\s*\d{4}(\s*[-–—])?\s*.*?Re-?[Mm]aster(?:ed)?.*$/i, target: '' },
  // - Remastered / - Remastered 2012 / - Remastered Version
  { source: /\s[-–—]\s*Re-?[Mm]aster(?:ed)?.*$/i, target: '' },
  // trailing bare remastered
  { source: /\s+Re-?[Mm]aster(?:ed)?(?:\s+Version)?(?:\s+\d{4})?\s*$/i, target: '' },
];

const LIVE_RULES: FilterRule[] = [
  { source: /\s[-–—]\s*Live(\s+.+)?$/i, target: '' },
  { source: /\s[([].*?Live\s+at\s+.*?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Live[)\]]\s*$/i, target: '' },
];

const EXPLICIT_RULES: FilterRule[] = [
  { source: /\s[([]Explicit(?:\s+Version)?[)\]]/gi, target: '' },
  { source: /\s[([]Clean(?:\s+Version)?[)\]]/gi, target: '' },
  { source: /\s[-–—]\s*Explicit(?:\s+Version)?$/i, target: '' },
  { source: /\s[-–—]\s*Clean(?:\s+Version)?$/i, target: '' },
];

const VERSION_RULES: FilterRule[] = [
  { source: /\s[([]Album Version[)\]]\s*$/i, target: '' },
  { source: /\s[([]Single Version[)\]]\s*$/i, target: '' },
  { source: /\s[([]Radio Edit[)\]]\s*$/i, target: '' },
  { source: /\s[([]Radio Version[)\]]\s*$/i, target: '' },
  { source: /\s[([]Extended(?:\s+Version)?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Short(?:\s+Version)?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Instrumental[)\]]\s*$/i, target: '' },
  { source: /\s[([]Acoustic(?:\s+Version)?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Studio Version[)\]]\s*$/i, target: '' },
  { source: /\s[([]Mono(?:\s+Version)?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Stereo(?:\s+Version)?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Edit[)\]]\s*$/i, target: '' },
  { source: /\s[([]Re-?recorded[)\]]\s*$/i, target: '' },
  { source: /\s[([]Bonus Track(?:\s+Edition)?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Deluxe(?:\s+Edition)?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Super\s+Deluxe[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([]Expanded[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([]\d+(?:st|nd|rd|th)\s+Anniversary[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([]Anniversary(?:\s+Edition)?[)\]]\s*$/i, target: '' },
  { source: /\s[-–—]\s*Album Version$/i, target: '' },
  { source: /\s[-–—]\s*Single Version$/i, target: '' },
  { source: /\s[-–—]\s*Radio Edit$/i, target: '' },
  { source: /\s[-–—]\s*Radio Version$/i, target: '' },
  { source: /\s[-–—]\s*Extended(?:\s+Version)?$/i, target: '' },
  { source: /\s[-–—]\s*Short(?:\s+Version)?$/i, target: '' },
  { source: /\s[-–—]\s*Instrumental$/i, target: '' },
  { source: /\s[-–—]\s*Acoustic(?:\s+Version)?$/i, target: '' },
  { source: /\s[-–—]\s*Studio Version$/i, target: '' },
  { source: /\s[-–—]\s*Mono(?:\s+Version)?$/i, target: '' },
  { source: /\s[-–—]\s*Stereo(?:\s+Version)?$/i, target: '' },
  { source: /\s[-–—]\s*Deluxe(?:\s+Edition)?$/i, target: '' },
  { source: /\s[-–—]\s*Super\s+Deluxe(?:\s+Edition)?$/i, target: '' },
  { source: /\s[-–—]\s*Expanded(?:\s+Edition)?$/i, target: '' },
  { source: /\s[-–—]\s*Anniversary(?:\s+Edition)?$/i, target: '' },
  { source: /\s[-–—]\s*Bonus Track$/i, target: '' },
  { source: /\s[-–—]\s*Original(?:\s+Version)?(?:\s+\d{4})?$/i, target: '' },
];

/** Featuring — strip anywhere it's tagged; keep core title. */
const FEATURING_RULES: FilterRule[] = [
  { source: /\s[([](?:feat\.?|ft\.?|featuring)\s+[^)\]]+[)\]]/gi, target: '' },
  { source: /\s[([]with\s+[^)\]]+[)\]]/gi, target: '' },
  { source: /\s[-–—]\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, target: '' },
  // Song feat. Artist (no parens) — only when clearly a suffix
  { source: /\s+(?:feat\.?|ft\.?|featuring)\s+[A-Z0-9].*$/i, target: '' },
];

/** Soundtrack / "from the movie" suffixes — not "Theme from X" mid-title. */
const FROM_SOUNDTRACK_RULES: FilterRule[] = [
  { source: /\s[([]From\s+[^)\]]+[)\]]\s*$/i, target: '' },
  { source: /\s[([]Music\s+from\s+[^)\]]+[)\]]\s*$/i, target: '' },
  { source: /\s[-–—]\s*From\s+.+$/i, target: '' },
  { source: /\s[-–—]\s*Music\s+from\s+.+$/i, target: '' },
  { source: /\s[([]Original\s+Motion\s+Picture\s+Soundtrack[)\]]\s*$/i, target: '' },
  { source: /\s[([]Soundtrack(?:\s+Version)?[)\]]\s*$/i, target: '' },
  { source: /\s[-–—]\s*Soundtrack(?:\s+Version)?$/i, target: '' },
  // FIFA / World Cup / official event anthem packaging (keep real bilingual subtitles)
  { source: /\s[([].*?Official\s+Soundtrack[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([].*?\bFIFA\b[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([].*?\bWorld\s+Cup\b[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([]The\s+Official\s+\d{4}\s+[^)\]]*Anthem[)\]]\s*$/i, target: '' },
  { source: /\s[([]Official\s+[^)\]]*Anthem[)\]]\s*$/i, target: '' },
];

/** Trailing mix tags: - K-Mix, - Club Mix, (Radio Mix) — not core titles. */
const MIX_TAG_RULES: FilterRule[] = [
  { source: /\s[-–—]\s*[A-Za-z0-9][\w./-]*\s*[Mm]ix\s*$/i, target: '' },
  { source: /\s[-–—]\s*(?:Club|Radio|Dance|House|Deep|Extended|Instrumental)\s+[Mm]ix\s*$/i, target: '' },
  { source: /\s[([][A-Za-z0-9][\w./-]*\s*[Mm]ix[)\]]\s*$/i, target: '' },
];

const VIDEO_TAG_RULES: FilterRule[] = [
  { source: /\s*[([]\s*official\s+(?:music\s+)?(?:lyric\s+)?video[^)\]]*[)\]]/gi, target: '' },
  { source: /\s*[([]\s*official\s+audio[^)\]]*[)\]]/gi, target: '' },
  { source: /\s*[([]\s*(?:music|lyric|lyrics)\s+video[^)\]]*[)\]]/gi, target: '' },
  { source: /\s*[([]\s*visualizer[^)\]]*[)\]]/gi, target: '' },
  { source: /\s*[([]\s*(?:HD|HQ|4K|UHD)\s*[)\]]/gi, target: '' },
  { source: /\s*[([]\s*official\s*[)\]]/gi, target: '' },
  { source: /\s[-–—]\s*Official\s+(?:Music\s+)?(?:Lyric\s+)?Video.*$/i, target: '' },
  { source: /\s[-–—]\s*Official\s+Audio.*$/i, target: '' },
  { source: /\s*\bofficial\s+(?:music\s+)?(?:lyric\s+)?video\b\s*/gi, target: ' ' },
];

const YEAR_RULES: FilterRule[] = [
  { source: /\s[-–—]\s*\d{4}\s*$/i, target: '' },
  { source: /\s[([]\d{4}[)\]]\s*$/i, target: '' },
];

const TRIM_LEFTOVER_RULES: FilterRule[] = [
  { source: /\(\s*\)/g, target: '' },
  { source: /\[\s*\]/g, target: '' },
  { source: /^[\s\-–—:/|]+/, target: '' },
  { source: /[\s\-–—:/|]+$/, target: '' },
  { source: /\s{2,}/g, target: ' ' },
];

/**
 * Cleans a song title by removing technical metadata and non-essential additions
 */
export function cleanSongTitle(title: string, options: CleanTitleOptions = DEFAULT_OPTIONS): string {
  if (!title || typeof title !== 'string') {
    return title;
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  let cleaned = title.trim().replace(/\s+/g, ' ');
  // Normalize fancy dashes used by Spotify
  cleaned = cleaned.replace(/[\u2013\u2014]/g, '-');

  cleaned = peelUntilStable(cleaned, (s) => {
    let t = s;
    if (opts.removeVideoTags) t = applyRules(t, VIDEO_TAG_RULES);
    if (opts.removeRemastered) t = applyRules(t, REMASTERED_RULES);
    if (opts.removeLive) t = applyRules(t, LIVE_RULES);
    if (opts.removeExplicit) t = applyRules(t, EXPLICIT_RULES);
    if (opts.removeVersions) {
      t = applyRules(t, VERSION_RULES);
      t = applyRules(t, MIX_TAG_RULES);
    }
    if (opts.removeFeaturing) t = applyRules(t, FEATURING_RULES);
    if (opts.removeParenthetical) t = applyRules(t, FROM_SOUNDTRACK_RULES);
    if (opts.removeYears) t = applyRules(t, YEAR_RULES);
    t = applyRules(t, TRIM_LEFTOVER_RULES);
    return t;
  });

  if (opts.removeDashes) {
    cleaned = cleaned.replace(/^\s*-\s*/, '').replace(/\s*-\s*$/, '');
  }

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
export function previewCleanTitle(
  title: string,
  options: CleanTitleOptions = DEFAULT_OPTIONS,
): {
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
    changes,
  };
}

/**
 * Batch clean multiple song titles
 */
export function cleanSongTitles(
  titles: string[],
  options: CleanTitleOptions = DEFAULT_OPTIONS,
): string[] {
  return titles.map((title) => cleanSongTitle(title, options));
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
    title: song.title ? cleanSongTitle(song.title, options) : song.title,
    displayName: song.displayName ? cleanSongTitle(song.displayName, options) : song.displayName,
  };
}

export const COMMON_PATTERNS = {
  REMASTERED: /remastered\s*\d*/i,
  LIVE: /live\s*at\s*[^)]*\)?/i,
  EXPLICIT: /explicit|clean/i,
  VERSIONS: /single\s*version|radio\s*edit|album\s*version|extended\s*version|instrumental|acoustic|studio\s*version/i,
  YEARS: /\d{4}/,
  FEATURING: /feat\.?\s*[^)]*|featuring\s*[^)]*|with\s*[^)]*/i,
} as const;
