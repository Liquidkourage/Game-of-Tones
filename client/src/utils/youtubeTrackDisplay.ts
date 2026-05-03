/**
 * YouTube Music / YouTube Data API: derive Spotify-like title + artist from video title only.
 * Must match server/youtubeTrackDisplayParse.js (keep in sync).
 */

import { cleanSongTitle } from './songTitleCleaner';

function preprocessYoutubeVideoTitleLine(rawTitle: string): string {
  let s = String(rawTitle || '').trim();
  if (!s) return s;
  for (let iter = 0; iter < 8; iter++) {
    const before = s;
    s = s.replace(/^\s*[\(\[]\s*official[^)\]]*[\)\]]\s*(?:ft\.?|feat\.?|featuring)\s+/i, '');
    s = s.replace(/^\s*[\(\[]\s*official[^)\]]*[\)\]]\s+/i, '');
    s = s.replace(
      /\s+(\||\u007c|\uff5c)\s*(official[^|]*|lyrics?[^|]*|lyric\s*video[^|]*|audio[^|]*|music\s*video[^|]*|mv\b[^|]*|video\b[^|]*)\s*$/i,
      '',
    );
    s = s.replace(/\s+\/\s*(official[^/]*|lyrics?[^/]*|audio[^/]*)\s*$/i, '');
    s = s.replace(
      /\s*[\(\[]\s*(official|lyric|lyrics?|audio\s*only|music\s*video|\bmv\b)\b[^)\]]*[\)\]]\s*$/i,
      '',
    );
    s = s.replace(/\s*【[^】]{0,48}】\s*/u, '');
    s = s.replace(/\s*「[^」]{0,48}」\s*/u, '');
    s = s.replace(/\s+(\||\u007c)\s*(HD|4K|HQ)(\s*video)?\s*$/i, '');
    s = s.replace(/\s+\(?\s*HD\s*\)?\s*$/i, '');
    s = s.replace(/\s*[•·]\s*top\s*pop\s*$/i, '');
    s = s.replace(/\s*[\(\[]\s*with\s+lyrics\s*[\)\]]\s*$/i, '');
    if (s === before) break;
  }
  return s.trim();
}

function tokenCount(s: string): number {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isAllCapsArtistPrefix(seg: string): boolean {
  const s = String(seg || '').trim();
  if (s.length < 4) return false;
  const letters = s.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 4) return false;
  return s === s.toUpperCase();
}

function isParenVersionOrEditTag(inner: string): boolean {
  const x = String(inner || '').trim();
  if (!x) return true;
  if (/\b(version|remix|rm\b|re-?master|mix|edit|mono|stereo|live|acoustic|hq|extended)\b/i.test(x)) return true;
  if (/^\d{1,2}["'″]?\s*(version)?$/i.test(x)) return true;
  if (/^\d{4}\s*(\([^)]*\))?$/i.test(x)) return true;
  if (/\(RM\)|\bR\.?M\.?\b/i.test(x)) return true;
  return false;
}

function isParenSubtitleOrRecordingMeta(inner: string): boolean {
  const x = String(inner || '').trim();
  if (/^with\s+(my|your|his|her|our|their)\b/i.test(x)) return true;
  if (/^from\s+(the|a)\b/i.test(x)) return true;
  if (/\brecords?\b/i.test(x) && /\d{4}/.test(x)) return true;
  if (/^live\s+at\b/i.test(x)) return true;
  return false;
}

function looksLikeDottedLetterAcronymTitle(chunk: string): boolean {
  const s = String(chunk || '').trim();
  if (!s) return false;
  const deco = s.replace(/^\*+/, '').replace(/\*+$/, '').trim();
  const compact = deco.replace(/\s+/g, '');
  return /^[a-z](?:\.[a-z])+\.?$/i.test(compact);
}

function allCapsArtistHead(seg: string): string {
  return String(seg || '')
    .split('(')[0]
    .trim();
}

/** Matches server/youtubeTrackDisplayParse.js — skip title-first swap for common "Artist - Title" one-word artists. */
const SINGLE_WORD_ARTIST_TITLE_LEFT_HINTS = new Set(
  (`abba aerosmith aqua boston cher chic chicago drake eminem europe enya journey kansas kiss ` +
    `lorde ludacris moby muse nas nelly pink prince queen rush sade seal sia ` +
    `tlc tool usher blur yes adele beyonce shakira rihanna outkast creed chamillionaire ` +
    `foreigner survivor heart filter train cake hole metallica nirvana radiohead ` +
    `madonna eagles`).split(/\s+/),
);

function looksLikeAllCapsStageName(token: string): boolean {
  const s = String(token || '').trim();
  if (/^\*[^*]+\*$/.test(s)) return false;
  if (/\b[A-Z]\.(?:[A-Z]\.)+[A-Z]?\.?/i.test(s)) return false;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2 || letters.length > 6) return false;
  return s === s.toUpperCase();
}

function tryLeadingTwoWordPersonArtist(normalized: string): { title: string; artist: string } | null {
  const s = String(normalized || '').trim();
  if (!s || /\s+-\s+/.test(s) || /\s+[|/]\s+/.test(s) || /\sby\s/i.test(s)) return null;
  const m = s.match(/^([A-Z][a-z]+ [A-Z][a-z]+)\s+(.+)$/);
  if (!m) return null;
  const w1 = m[1].split(/\s+/)[0];
  const pair = `${m[1].split(/\s+/)[0]} ${m[1].split(/\s+/)[1]}`.toLowerCase();
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
    'we will',
    'we are',
    'we can',
    'you are',
    'blame it',
    'quit playing',
    'drop it',
  ]);
  if (badPair.has(pair)) return null;
  const rest = m[2].trim();
  const restTok = tokenCount(rest);
  if (restTok === 1 && rest.length >= 7) return { artist: m[1].trim(), title: rest };
  if (restTok >= 3) return { artist: m[1].trim(), title: rest };
  return null;
}

function isLikelyOneWordArtistTitleLeft(token: string): boolean {
  const s = String(token || '').trim();
  if (!s) return false;
  if (looksLikeAllCapsStageName(s)) return true;
  return SINGLE_WORD_ARTIST_TITLE_LEFT_HINTS.has(s.toLowerCase());
}

function expandTightHyphenSeparators(line: string): string {
  let s = String(line || '');
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/^(.+)\s([^-\s]+)-(.+)$/, '$1 $2 - $3');
    if (next === s) break;
    s = next;
  }
  return s;
}

export function parseYoutubeVideoTitleForDisplay(rawTitle: string): { title: string; artist: string } {
  const raw = String(rawTitle || '').trim();
  if (!raw) return { title: '', artist: '' };

  const cleaned = preprocessYoutubeVideoTitleLine(raw);
  let normalized = cleaned.replace(/\u2013|\u2014|\u2212/g, '-');
  normalized = expandTightHyphenSeparators(normalized);

  const officialRe =
    /\b(official\s*(video|audio|mv|lyric|lyrics)?|lyric\s*video|audio\s*only|m\/v)\b|\(official[^)]*\)|\[official[^]]*\]|\(lyrics?\)/i;

  function hasFeat(side: string): boolean {
    return /\b(feat\.?|ft\.|featuring)\b/i.test(side);
  }

  function isLikelyPerformerCreditInParens(inner: string, outer: string): boolean {
    const x = String(inner || '').trim();
    const ou = String(outer || '').trim();
    if (isParenSubtitleOrRecordingMeta(x)) return false;
    if (isParenVersionOrEditTag(x)) return false;
    if (officialRe.test(x)) return false;
    if (/\b(official|lyrics?|audio|video|mv)\b/i.test(x)) return false;
    const tk = tokenCount(x);
    if (tk < 1 || tk > 4 || x.length > 48) return false;
    if (/^\d{4}\s*$/.test(x)) return false;
    if (hasFeat(ou)) return false;
    return true;
  }

  function tryDashLeftParenPerformerMatch(
    left: string,
    right: string,
  ): { title: string; artist: string } | null {
    const m = String(left).match(/^(.+?)\s*\(\s*([^)]+)\)\s*$/);
    if (!m) return null;
    const outer = m[1].trim();
    const inner = m[2].trim();
    if (!isLikelyPerformerCreditInParens(inner, outer)) return null;
    const rNorm = right.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const iNorm = inner.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (iNorm.length < 4) return null;
    if (rNorm.includes(iNorm)) return { title: outer, artist: right.trim() };
    return null;
  }

  function pickOrientation(
    left: string,
    right: string,
  ): { title: string; artist: string } | null {
    const L = left.trim();
    const R = right.trim();
    if (!L || !R) return null;

    if (
      looksLikeDottedLetterAcronymTitle(R) &&
      isAllCapsArtistPrefix(allCapsArtistHead(L))
    ) {
      return { artist: L, title: R };
    }
    if (
      looksLikeDottedLetterAcronymTitle(L) &&
      isAllCapsArtistPrefix(allCapsArtistHead(R))
    ) {
      return { artist: R, title: L };
    }

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

  if (dashParts.length >= 3) {
    const a = dashParts[0].trim();
    const b = dashParts[1].trim();
    const c = dashParts[2].trim();
    const cL = c.toLowerCase();
    const midLower = b.toLowerCase();

    if (cL === 'titanic' && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(a) && tokenCount(b) >= 2) {
      return { title: b, artist: a };
    }
    if (midLower === 'titanic' && /\blyrics?\b/i.test(cL)) {
      return { title: a.trim(), artist: '' };
    }
    if (!isAllCapsArtistPrefix(dashParts[0])) {
      const tA = tokenCount(a);
      const tB = tokenCount(b);
      const tC = tokenCount(c);
      if (
        cL !== 'titanic' &&
        tA <= 2 &&
        tB >= 2 &&
        tC >= 1 &&
        tC <= 3 &&
        a.length + b.length >= 12 &&
        !/^\d{4}$/.test(c) &&
        !isAllCapsArtistPrefix(c) &&
        !hasFeat(c) &&
        !officialRe.test(c) &&
        !/\b(remaster(ed)?|version|explicit)\b/i.test(c)
      ) {
        return { title: `${a} ${b}`.replace(/\s+/g, ' ').trim(), artist: c };
      }
    }
  }

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

    const parenPerform = tryDashLeftParenPerformerMatch(left, right);
    if (parenPerform) return parenPerform;

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
    const pL = pipeParts[0].trim();
    const pR = pipeParts[1].trim();
    if (looksLikeDottedLetterAcronymTitle(pL) && isAllCapsArtistPrefix(allCapsArtistHead(pR))) {
      return { title: pL, artist: pR };
    }
    const picked = pickOrientation(pipeParts[0], pipeParts[1]);
    if (picked) return picked;
  }

  const slashParts = normalized.split(/\s+\/\s+/);
  if (slashParts.length === 2) {
    const sL = slashParts[0].trim();
    const sR = slashParts[1].trim();
    if (looksLikeDottedLetterAcronymTitle(sL) && isAllCapsArtistPrefix(allCapsArtistHead(sR))) {
      return { title: sL, artist: sR };
    }
    const picked = pickOrientation(slashParts[0], slashParts[1]);
    if (picked) return picked;
  }

  const colonMatch = normalized.match(/^(.{1,120}):\s+(.{1,200})$/);
  if (colonMatch && !/^\d{1,2}:\d{2}/.test(normalized)) {
    const picked = pickOrientation(colonMatch[1], colonMatch[2]);
    if (picked) return picked;
  }

  const byMatch = normalized.match(/^(.{2,200}?)\s+\bby\s+(.{2,120})$/i);
  if (byMatch && !/^\d{1,2}:\d{2}/.test(byMatch[1])) {
    return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
  }

  const paren = normalized.match(/^(.+?)\s*\(\s*([^)]+)\)\s*$/);
  if (paren) {
    const outer = paren[1].trim();
    const inner = paren[2].trim();
    if (isParenVersionOrEditTag(inner)) {
      return { title: outer, artist: '' };
    }
    if (isParenSubtitleOrRecordingMeta(inner)) {
      return { title: `${outer} (${inner})`, artist: '' };
    }
    if (isLikelyPerformerCreditInParens(inner, outer)) {
      return { title: outer, artist: inner };
    }
    if (
      inner.length >= 2 &&
      inner.length <= 120 &&
      !officialRe.test(inner) &&
      !/\b(official|lyrics?|audio|video|mv)\b/i.test(inner)
    ) {
      const picked = pickOrientation(outer, inner);
      if (picked) return picked;
    }
  }

  const twoWordArtist = tryLeadingTwoWordPersonArtist(normalized);
  if (twoWordArtist) return twoWordArtist;

  return { title: normalized, artist: '' };
}

/**
 * Host setlist / pool rows: server sends split title + artist for new YT tracks; re-parse from `name`
 * when `artist` still looks like an upload channel (legacy rows).
 * Prefer `youtubeRawTitle` when present (full Data API title line).
 */
export function youtubeTrackDisplayFields(song: {
  name?: string;
  artist?: string;
  youtubeMusic?: boolean;
  youtubeRawTitle?: string;
  catalogDisplayVerified?: boolean;
}): { title: string; artist: string } {
  if (!song.youtubeMusic) {
    return { title: song.name || '', artist: song.artist || '' };
  }
  if (song.catalogDisplayVerified && String(song.name || '').trim()) {
    return {
      title: String(song.name || '').trim(),
      artist: String(song.artist || '').trim(),
    };
  }
  const line = String(song.youtubeRawTitle || song.name || '').trim();
  const rawName = line;
  const storedArtist = String(song.artist || '').trim();
  const parsed = parseYoutubeVideoTitleForDisplay(rawName);
  const channely =
    /\bvevo\b/i.test(storedArtist) ||
    /\btopic\b/i.test(storedArtist) ||
    (/\bofficial\b/i.test(storedArtist) && storedArtist.length > 12);

  if (parsed.artist) {
    return { title: parsed.title || rawName, artist: parsed.artist };
  }
  if (storedArtist && !channely) {
    return { title: parsed.title || rawName, artist: storedArtist };
  }
  return { title: parsed.title || rawName, artist: '' };
}

/** Bingo card cells: custom title overrides; YT rows use split/heuristic artist. */
export function youtubeBingoSquareDisplay(sq: {
  customSongName?: string;
  songName?: string;
  artistName?: string;
  youtubeMusic?: boolean;
  youtubeRawTitle?: string;
  catalogDisplayVerified?: boolean;
  isFreeSpace?: boolean;
}): { title: string; artist: string } {
  if (sq.isFreeSpace) return { title: 'FREE', artist: '' };
  if (!sq.youtubeMusic) {
    return {
      title: sq.customSongName || cleanSongTitle(sq.songName || ''),
      artist: sq.artistName || '',
    };
  }
  const ytf = youtubeTrackDisplayFields({
    name: sq.songName,
    artist: sq.artistName,
    youtubeMusic: true,
    youtubeRawTitle: sq.youtubeRawTitle,
    catalogDisplayVerified: sq.catalogDisplayVerified,
  });
  return {
    title: sq.customSongName || cleanSongTitle(ytf.title),
    artist: ytf.artist,
  };
}
