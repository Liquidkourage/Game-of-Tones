const Hypher = require('hypher');
const englishPatterns = require('hyphenation.en-us');

const SOFT_HYPHEN = '\u00AD';
const LONG_WORD_RE = /\b[A-Za-z]{8,}\b/g;
const hyphenator = new Hypher(englishPatterns);
const hyphenationCache = new Map<string, string>();

function hyphenateWord(word: string): string {
  const cached = hyphenationCache.get(word);
  if (cached) return cached;
  const parts = hyphenator.hyphenate(word);
  const hyphenated =
    Array.isArray(parts) && parts.length > 1 ? parts.join(SOFT_HYPHEN) : word;
  hyphenationCache.set(word, hyphenated);
  return hyphenated;
}

export function softHyphenateLongWords(text: string): string {
  return String(text || '').replace(LONG_WORD_RE, (word) => hyphenateWord(word));
}

export function stripSoftHyphens(text: string): string {
  return String(text || '').replace(/\u00AD/g, '');
}
