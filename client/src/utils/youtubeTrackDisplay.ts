/**
 * YouTube Music / YouTube Data API: derive Spotify-like title + artist from video title only.
 * Must match server/youtubeTrackDisplayParse.js (keep in sync).
 */

import { cleanSongTitle } from './songTitleCleaner';
export function parseYoutubeVideoTitleForDisplay(rawTitle: string): { title: string; artist: string } {
  const raw = String(rawTitle || '').trim();
  if (!raw) return { title: '', artist: '' };

  const normalized = raw.replace(/\u2013|\u2014|\u2212/g, '-');

  const officialRe =
    /\b(official\s*(video|audio|mv|lyric|lyrics)?|lyric\s*video|audio\s*only|m\/v)\b|\(official[^)]*\)|\[official[^]]*\]|\(lyrics?\)/i;

  function hasFeat(side: string): boolean {
    return /\b(feat\.?|ft\.|featuring)\b/i.test(side);
  }

  function pickOrientation(
    left: string,
    right: string,
  ): { title: string; artist: string } | null {
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

/**
 * Host setlist / pool rows: server sends split title + artist for new YT tracks; re-parse from `name`
 * when `artist` still looks like an upload channel (legacy rows).
 */
export function youtubeTrackDisplayFields(song: {
  name?: string;
  artist?: string;
  youtubeMusic?: boolean;
}): { title: string; artist: string } {
  if (!song.youtubeMusic) {
    return { title: song.name || '', artist: song.artist || '' };
  }
  const rawName = String(song.name || '').trim();
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
  });
  return {
    title: sq.customSongName || cleanSongTitle(ytf.title),
    artist: ytf.artist,
  };
}
