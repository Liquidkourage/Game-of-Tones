/**
 * Song title cleaner (CommonJS) — keep in sync with client/src/utils/songTitleCleaner.ts
 * Strips Spotify / streaming metadata junk for bingo readability.
 */

function applyRules(text, rules) {
  return rules.reduce((t, { source, target }) => t.replace(source, target), text);
}

function peelUntilStable(text, step, maxPasses = 6) {
  let cur = text;
  for (let i = 0; i < maxPasses; i++) {
    const next = step(cur).replace(/\s+/g, ' ').trim();
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

const REMASTERED_RULES = [
  { source: /\sLive\s\/\sRemastered/i, target: ' Live' },
  { source: /\s[([].*?Re-?[Mm]aster(?:ed)?.*?[)\]]\s*$/i, target: '' },
  { source: /\s[-–—]\s*\d{4}(\s*[-–—])?\s*.*?Re-?[Mm]aster(?:ed)?.*$/i, target: '' },
  { source: /\s[-–—]\s*Re-?[Mm]aster(?:ed)?.*$/i, target: '' },
  { source: /\s+Re-?[Mm]aster(?:ed)?(?:\s+Version)?(?:\s+\d{4})?\s*$/i, target: '' },
];

const LIVE_RULES = [
  { source: /\s[-–—]\s*Live(\s+.+)?$/i, target: '' },
  { source: /\s[([].*?Live\s+at\s+.*?[)\]]\s*$/i, target: '' },
  { source: /\s[([]Live[)\]]\s*$/i, target: '' },
];

const EXPLICIT_RULES = [
  { source: /\s[([]Explicit(?:\s+Version)?[)\]]/gi, target: '' },
  { source: /\s[([]Clean(?:\s+Version)?[)\]]/gi, target: '' },
  { source: /\s[-–—]\s*Explicit(?:\s+Version)?$/i, target: '' },
  { source: /\s[-–—]\s*Clean(?:\s+Version)?$/i, target: '' },
];

const VERSION_RULES = [
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

const FEATURING_RULES = [
  { source: /\s[([](?:feat\.?|ft\.?|featuring)\s+[^)\]]+[)\]]/gi, target: '' },
  { source: /\s[([]with\s+[^)\]]+[)\]]/gi, target: '' },
  { source: /\s[-–—]\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, target: '' },
  { source: /\s+(?:feat\.?|ft\.?|featuring)\s+[A-Z0-9].*$/i, target: '' },
];

const FROM_SOUNDTRACK_RULES = [
  { source: /\s[([]From\s+[^)\]]+[)\]]\s*$/i, target: '' },
  { source: /\s[([]Music\s+from\s+[^)\]]+[)\]]\s*$/i, target: '' },
  { source: /\s[-–—]\s*From\s+.+$/i, target: '' },
  { source: /\s[-–—]\s*Music\s+from\s+.+$/i, target: '' },
  { source: /\s[([]Original\s+Motion\s+Picture\s+Soundtrack[)\]]\s*$/i, target: '' },
  { source: /\s[([]Soundtrack(?:\s+Version)?[)\]]\s*$/i, target: '' },
  { source: /\s[-–—]\s*Soundtrack(?:\s+Version)?$/i, target: '' },
  { source: /\s[([].*?Official\s+Soundtrack[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([].*?\bFIFA\b[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([].*?\bWorld\s+Cup\b[^)\]]*[)\]]\s*$/i, target: '' },
  { source: /\s[([]The\s+Official\s+\d{4}\s+[^)\]]*Anthem[)\]]\s*$/i, target: '' },
  { source: /\s[([]Official\s+[^)\]]*Anthem[)\]]\s*$/i, target: '' },
];

const MIX_TAG_RULES = [
  { source: /\s[-–—]\s*[A-Za-z0-9][\w./-]*\s*[Mm]ix\s*$/i, target: '' },
  { source: /\s[-–—]\s*(?:Club|Radio|Dance|House|Deep|Extended|Instrumental)\s+[Mm]ix\s*$/i, target: '' },
  { source: /\s[([][A-Za-z0-9][\w./-]*\s*[Mm]ix[)\]]\s*$/i, target: '' },
];

const VIDEO_TAG_RULES = [
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

const YEAR_RULES = [
  { source: /\s[-–—]\s*\d{4}\s*$/i, target: '' },
  { source: /\s[([]\d{4}[)\]]\s*$/i, target: '' },
];

const TRIM_LEFTOVER_RULES = [
  { source: /\(\s*\)/g, target: '' },
  { source: /\[\s*\]/g, target: '' },
  { source: /^[\s\-–—:/|]+/, target: '' },
  { source: /[\s\-–—:/|]+$/, target: '' },
  { source: /\s{2,}/g, target: ' ' },
];

function cleanSongTitle(title) {
  if (!title || typeof title !== 'string') {
    return title;
  }

  let cleaned = title.trim().replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/[\u2013\u2014]/g, '-');

  cleaned = peelUntilStable(cleaned, (s) => {
    let t = s;
    t = applyRules(t, VIDEO_TAG_RULES);
    t = applyRules(t, REMASTERED_RULES);
    t = applyRules(t, LIVE_RULES);
    t = applyRules(t, EXPLICIT_RULES);
    t = applyRules(t, VERSION_RULES);
    t = applyRules(t, MIX_TAG_RULES);
    t = applyRules(t, FEATURING_RULES);
    t = applyRules(t, FROM_SOUNDTRACK_RULES);
    t = applyRules(t, YEAR_RULES);
    t = applyRules(t, TRIM_LEFTOVER_RULES);
    return t;
  });

  cleaned = cleaned.replace(/^\s*-\s*/, '').replace(/\s*-\s*$/, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (cleaned.length < 3) {
    return title.trim();
  }

  return cleaned;
}

module.exports = { cleanSongTitle };
