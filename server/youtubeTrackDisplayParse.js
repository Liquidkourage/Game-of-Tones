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
    if (s === before) break;
  }
  return s.trim();
}

/**
 * @param {string} rawTitle
 * @returns {{ title: string; artist: string }}
 */
function parseYoutubeVideoTitleForDisplay(rawTitle) {
  const raw = String(rawTitle || '').trim();
  if (!raw) return { title: '', artist: '' };

  const cleaned = preprocessYoutubeVideoTitleLine(raw);
  const normalized = cleaned.replace(/\u2013|\u2014|\u2212/g, '-');

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
  if (dashParts.length >= 2) {
    const left = dashParts[0];
    const right = dashParts.slice(1).join(' - ');
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

  return { title: normalized, artist: '' };
}

module.exports = { parseYoutubeVideoTitleForDisplay, preprocessYoutubeVideoTitleLine };
