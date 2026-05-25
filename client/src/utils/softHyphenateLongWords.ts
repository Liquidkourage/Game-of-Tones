const { hyphenateSync } = require('hyphen/en-us');
const { isWord } = require('fast-is-english-word');

const SOFT_HYPHEN = '\u00AD';
const LONG_WORD_RE = /\b[A-Za-z]{8,}\b/g;
const hyphenationCache = new Map<string, string>();
const COMPOUND_MIN_WORD_LENGTH = 9;
const COMPOUND_MIN_PART_LENGTH = 4;

function splitCompoundWord(word: string): string {
  if (word.length < COMPOUND_MIN_WORD_LENGTH) return word;
  const lower = word.toLowerCase();
  let bestSplitIndex = -1;
  let bestScore = -1;

  for (
    let splitIndex = COMPOUND_MIN_PART_LENGTH;
    splitIndex <= lower.length - COMPOUND_MIN_PART_LENGTH;
    splitIndex += 1
  ) {
    const left = lower.slice(0, splitIndex);
    const right = lower.slice(splitIndex);
    if (!isWord(left) || !isWord(right)) continue;

    const balancePenalty = Math.abs(left.length - right.length);
    const score = left.length + right.length - balancePenalty * 0.35;
    if (score > bestScore) {
      bestScore = score;
      bestSplitIndex = splitIndex;
    }
  }

  if (bestSplitIndex === -1) return word;
  return `${word.slice(0, bestSplitIndex)}${SOFT_HYPHEN}${word.slice(bestSplitIndex)}`;
}

function hyphenateWord(word: string): string {
  const cached = hyphenationCache.get(word);
  if (cached) return cached;
  const hyphenated = hyphenateSync(word);
  const resolved = hyphenated.includes(SOFT_HYPHEN) ? hyphenated : splitCompoundWord(word);
  hyphenationCache.set(word, resolved);
  return resolved;
}

export function softHyphenateLongWords(text: string): string {
  return String(text || '').replace(LONG_WORD_RE, (word) => hyphenateWord(word));
}

export function stripSoftHyphens(text: string): string {
  return String(text || '').replace(/\u00AD/g, '');
}
