'use strict';

/**
 * Derive Spotify-like track title + performer name from YouTube Data API `snippet.title` only.
 * Upload channel (videoOwnerChannelTitle) is intentionally ignored — hosts want artist/title from
 * the title line, not "VEVO" / auto-generated Topic channels.
 *
 * Keep in sync with client/src/utils/youtubeTrackDisplay.ts (same algorithm).
 */

/**
 * @param {string} rawTitle
 * @returns {{ title: string; artist: string }}
 */
function parseYoutubeVideoTitleForDisplay(rawTitle) {
  const raw = String(rawTitle || '').trim();
  if (!raw) return { title: '', artist: '' };

  const normalized = raw.replace(/\u2013|\u2014|\u2212/g, '-');

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

  return { title: normalized, artist: '' };
}

module.exports = { parseYoutubeVideoTitleForDisplay };
