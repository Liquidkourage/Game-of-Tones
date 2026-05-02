'use strict';

/**
 * Derive Spotify-like track title + performer name from YouTube Data API `snippet.title` only.
 * Upload channel (videoOwnerChannelTitle) is intentionally ignored — hosts want artist/title from
 * the title line, not "VEVO" / auto-generated Topic channels.
 *
 * Keep in sync with client/src/utils/youtubeTrackDisplay.ts (same algorithm).
 */

/**
 * Strip trailing promotional / format noise common on music uploads (before dash/pipe splits).
 * Conservative: only suffix patterns, repeated until stable.
 * @param {string} rawTitle
 * @returns {string}
 */
function preprocessYoutubeVideoTitleLine(rawTitle) {
  let s = String(rawTitle || '').trim();
  if (!s) return s;
  for (let iter = 0; iter < 8; iter++) {
    const before = s;
    // " | Official Video", " | Lyrics", etc.
    s = s.replace(
      /\s+(\||\u007c|\uff5c)\s*(official[^|]*|lyrics?[^|]*|lyric\s*video[^|]*|audio[^|]*|music\s*video[^|]*|mv\b[^|]*|video\b[^|]*)\s*$/i,
      '',
    );
    s = s.replace(/\s+\/\s*(official[^/]*|lyrics?[^/]*|audio[^/]*)\s*$/i, '');
    // Trailing (Official Video) or [Lyric Video]
    s = s.replace(
      /\s*[\(\[]\s*(official|lyric|lyrics?|audio\s*only|music\s*video|\bmv\b)\b[^)\]]*[\)\]]\s*$/i,
      '',
    );
    // Japanese 「MV」 / 【歌詞】 style trailers
    s = s.replace(/\s*【[^】]{0,48}】\s*$/u, '');
    s = s.replace(/\s*「[^」]{0,48}」\s*$/u, '');
    // " HD" / " | 4K" at end
    s = s.replace(/\s+(\||\u007c)\s*(HD|4K|HQ)(\s*video)?\s*$/i, '');
    s = s.replace(/\s+\(?\s*HD\s*\)?\s*$/i, '');
    // Trailing fan uploader / channel suffixes on title line
    s = s.replace(/\s*[•·]\s*top\s*pop\s*$/i, '');
    s = s.replace(/\s*[\(\[]\s*with\s+lyrics\s*[\)\]]\s*$/i, '');
    if (s === before) break;
  }
  return s.trim();
}

function tokenCount(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** e.g. "VILLAGE PEOPLE" — ALL CAPS band line followed by track — "ARTIST - TITLE - EXTRA". */
function isAllCapsArtistPrefix(seg) {
  const s = String(seg || '').trim();
  if (s.length < 4) return false;
  const letters = s.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 4) return false;
  return s === s.toUpperCase();
}

/** Parenthetical is a version/edit, not a performer name — "Bad Girls (12" Version)". */
function isParenVersionOrEditTag(inner) {
  const x = String(inner || '').trim();
  if (!x) return true;
  if (/\b(version|remix|rm\b|re-?master|mix|edit|mono|stereo|live|acoustic|hq|extended)\b/i.test(x)) return true;
  if (/^\d{1,2}["'″]?\s*(version)?$/i.test(x)) return true;
  if (/^\d{4}\s*(\([^)]*\))?$/i.test(x)) return true;
  if (/\(RM\)|\bR\.?M\.?\b/i.test(x)) return true;
  return false;
}

/**
 * Common single-token performer names on YouTube as "Artist - Title". Paired with titleFirstOrder:
 * skip title-first swap when the left chunk is likely already the artist (avoids Nelly/Boston/DMX reversals).
 */
const SINGLE_WORD_ARTIST_TITLE_LEFT_HINTS = new Set(
  (`abba aerosmith aqua boston cher chic chicago drake eminem europe enya journey kansas kiss ` +
    `lorde ludacris moby muse nas nelly pink prince queen rush sade seal sia ` +
    `tlc tool usher blur yes adele beyonce shakira rihanna outkast creed chamillionaire ` +
    `foreigner survivor heart filter train cake hole metallica nirvana radiohead ` +
    `madonna eagles`).split(/\s+/),
);

/** "DMX", "TLC" — treat as artist when on the left of "-". Not Y.M.C.A.-style dotted acronyms or *decorated* titles. */
function looksLikeAllCapsStageName(token) {
  const s = String(token || '').trim();
  if (/^\*[^*]+\*$/.test(s)) return false;
  if (/\b[A-Z]\.(?:[A-Z]\.)+[A-Z]?\.?/i.test(s)) return false;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2 || letters.length > 6) return false;
  return s === s.toUpperCase();
}

/** e.g. "Stevie Wonder Superstition" with no " - " (channel is not the artist name). Conservative. */
function tryLeadingTwoWordPersonArtist(normalized) {
  const s = String(normalized || '').trim();
  if (!s || /\s+-\s+/.test(s) || /\s+[|/]\s+/.test(s) || /\sby\s/i.test(s)) return null;
  const m = s.match(/^([A-Z][a-z]+ [A-Z][a-z]+)\s+(.+)$/);
  if (!m) return null;
  const w1 = m[1].split(/\s+/)[0];
  const w2 = m[1].split(/\s+/)[1];
  const pair = `${w1} ${w2}`.toLowerCase();
  if (/^(The|A|An|All|My|Your|Our|Its?|If|When|Where|Why|How|Let|One|Two|Three|For|But|Not|And|She|Her|His|Our)$/i.test(w1)) return null;
  const badPair = new Set([
    'one more',
    'one last',
    'all falls',
    'let it',
    'let me',
    'hold on',
    'come on',
    'move on',
    'run away',
    'get down',
    'get low',
    'shake it',
    'take me',
    'give me',
  ]);
  if (badPair.has(pair)) return null;
  const rest = m[2].trim();
  const restTok = tokenCount(rest);
  if (restTok >= 2) return { artist: m[1].trim(), title: rest };
  if (rest.length >= 8) return { artist: m[1].trim(), title: rest };
  return null;
}

function isLikelyOneWordArtistTitleLeft(token) {
  const s = String(token || '').trim();
  if (!s) return false;
  if (looksLikeAllCapsStageName(s)) return true;
  return SINGLE_WORD_ARTIST_TITLE_LEFT_HINTS.has(s.toLowerCase());
}

/**
 * "Jimmy Eat World-Polaris" / "Twenty One Pilots-Stressed Out" — hyphen with no surrounding spaces.
 * Turn the last "word-hyphen-rest" before EOL into "word - rest" so spaced-dash logic applies.
 */
function expandTightHyphenSeparators(line) {
  let s = String(line || '');
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/^(.+)\s([^-\s]+)-(.+)$/, '$1 $2 - $3');
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * @param {string} rawTitle
 * @returns {{ title: string; artist: string }}
 */
function parseYoutubeVideoTitleForDisplay(rawTitle) {
  const raw = String(rawTitle || '').trim();
  if (!raw) return { title: '', artist: '' };

  const cleaned = preprocessYoutubeVideoTitleLine(raw);
  let normalized = cleaned.replace(/\u2013|\u2014|\u2212/g, '-');
  normalized = expandTightHyphenSeparators(normalized);

  const officialRe =
    /\b(official\s*(video|audio|mv|lyric|lyrics)?|lyric\s*video|audio\s*only|m\/v)\b|\(official[^)]*\)|\[official[^]]*\]|\(lyrics?\)/i;

  function hasFeat(side) {
    return /\b(feat\.?|ft\.|featuring)\b/i.test(side);
  }

  /**
   * @param {string} left
   * @param {string} right
   * @returns {{ title: string; artist: string } | null}
   */
  function pickOrientation(left, right) {
    const L = left.trim();
    const R = right.trim();
    if (!L || !R) return null;

    const oL = officialRe.test(L) ? 1 : 0;
    const oR = officialRe.test(R) ? 1 : 0;
    if (oR > oL) return { artist: L, title: R };
    if (oL > oR) return { artist: R, title: L };

    const fL = hasFeat(L) ? 1 : 0;
    const fR = hasFeat(R) ? 1 : 0;
    if (fR && !fL) return { artist: L, title: R };
    if (fL && !fR) return { artist: R, title: L };

    if (L.length > R.length * 1.85 && L.length > 48) {
      return { artist: R, title: L };
    }

    return { artist: L, title: R };
  }

  const dashParts = normalized.split(/\s+-\s+/);

  if (dashParts.length >= 3 && isAllCapsArtistPrefix(dashParts[0])) {
    const artist = dashParts[0].trim();
    const title = dashParts[1].trim();
    const extra = dashParts.slice(2).join(' - ').trim();
    const titleFull =
      extra && extra.length <= 120 ? `${title} (${extra})` : title;
    return { title: titleFull, artist };
  }

  if (dashParts.length >= 2) {
    const left = dashParts[0].trim();
    const right = dashParts.slice(1).join(' - ').trim();

    const tL = tokenCount(left);
    const tR = tokenCount(right);
    const titleFirstOrder =
      ((tL === 1 &&
        tR >= 2 &&
        !/[\/&]/.test(left) &&
        !/^\d+$/.test(left) &&
        left.length <= 48 &&
        !isLikelyOneWordArtistTitleLeft(left)) ||
        (tL === 2 && tR === 2 && /^the\s+/i.test(right) && !/^the\s+/i.test(left)));

    if (titleFirstOrder) {
      return { artist: right, title: left };
    }

    const picked = pickOrientation(left, right);
    if (picked) return picked;
  }

  const pipeParts = normalized.split(/\s+\|\s+/);
  if (pipeParts.length === 2) {
    const picked = pickOrientation(pipeParts[0], pipeParts[1]);
    if (picked) return picked;
  }

  const slashParts = normalized.split(/\s+\/\s+/);
  if (slashParts.length === 2) {
    const picked = pickOrientation(slashParts[0], slashParts[1]);
    if (picked) return picked;
  }

  const colonMatch = normalized.match(/^(.{1,120}):\s+(.{1,200})$/);
  if (colonMatch && !/^\d{1,2}:\d{2}/.test(normalized)) {
    const picked = pickOrientation(colonMatch[1], colonMatch[2]);
    if (picked) return picked;
  }

  // "Song Title by Artist" / "Song by Artist ft. …" — fixed order (do not use pickOrientation)
  const byMatch = normalized.match(/^(.{2,200}?)\s+\bby\s+(.{2,120})$/i);
  if (byMatch && !/^\d{1,2}:\d{2}/.test(byMatch[1])) {
    return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
  }

  // "Title (Artist)" when the paren is not a video tag
  const paren = normalized.match(/^(.+?)\s*\(\s*([^)]+)\)\s*$/);
  if (paren) {
    const inner = paren[2].trim();
    if (isParenVersionOrEditTag(inner)) {
      return { title: paren[1].trim(), artist: '' };
    }
    if (
      inner.length >= 2 &&
      inner.length <= 120 &&
      !officialRe.test(inner) &&
      !/\b(official|lyrics?|audio|video|mv)\b/i.test(inner)
    ) {
      const picked = pickOrientation(paren[1].trim(), inner);
      if (picked) return picked;
    }
  }

  const twoWordArtist = tryLeadingTwoWordPersonArtist(normalized);
  if (twoWordArtist) return twoWordArtist;

  return { title: normalized, artist: '' };
}

module.exports = { parseYoutubeVideoTitleForDisplay, preprocessYoutubeVideoTitleLine };
