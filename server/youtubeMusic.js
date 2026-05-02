/**
 * Host-only YouTube Music integration (library/playlists via Google YouTube Data API v3 — the supported surface for third-party library access).
 * Env: YOUTUBE_MUSIC_GOOGLE_CLIENT_ID, YOUTUBE_MUSIC_GOOGLE_CLIENT_SECRET,
 * optional YOUTUBE_MUSIC_REDIRECT_URI (defaults to PUBLIC_APP_ORIGIN + /api/youtube/music/callback).
 *
 * Tokens are in-memory for now; persist similarly to Spotify when this ships broadly.
 */

'use strict';

const { OAuth2Client } = require('google-auth-library');
const hostAuth = require('./hostAuth');
const { parseYoutubeVideoTitleForDisplay } = require('./youtubeTrackDisplayParse');

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

/**
 * Channel display name normalized for use as fallback artist when the title line has no performer.
 * Strips " - Topic" / trailing VEVO so "Artist - Topic" → "Artist".
 */
function channelFallbackArtistName(channelTitle) {
  let ch = String(channelTitle || '').trim();
  if (!ch) return '';
  ch = ch.replace(/\s*-\s*topic\s*$/i, '').trim();
  ch = ch.replace(/vevo\s*$/i, '').trim();
  if (ch.length < 2) return '';
  if (/\bvevo\b/i.test(ch)) return '';
  if (/\btopic\b/i.test(ch)) return '';
  if (/\bkaraoke\b/i.test(ch)) return '';
  if (/^various artists$/i.test(ch)) return '';
  if (/^lyrics?(\s+channel)?$/i.test(ch)) return '';
  return ch;
}

/** If the visible title begins with the channel artist name, return the remainder (e.g. "Stevie Wonder Superstition" → "Superstition"). */
function titleIfStartsWithChannel(displayTitle, channelArtist) {
  const t = String(displayTitle || '').trim();
  const ch = String(channelArtist || '').trim();
  if (!t || !ch) return null;
  const tl = t.toLowerCase();
  const cl = ch.toLowerCase();
  if (!tl.startsWith(cl + ' ')) return null;
  const rest = t.slice(ch.length).trim();
  return rest.length >= 2 ? rest : null;
}

/** @type {Map<number, import('google-auth-library').Credentials>} */
const tokenStore = new Map();

function publicAppOriginOrDefault() {
  const raw = (process.env.PUBLIC_APP_URL || process.env.CLIENT_APP_URL || '').trim();
  let base = raw || 'http://localhost:3000';
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  try {
    return new URL(base).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

function redirectUri() {
  const explicit = (process.env.YOUTUBE_MUSIC_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  return `${publicAppOriginOrDefault()}/api/youtube/music/callback`;
}

function clientId() {
  return (process.env.YOUTUBE_MUSIC_GOOGLE_CLIENT_ID || '').trim();
}

function clientSecret() {
  return (process.env.YOUTUBE_MUSIC_GOOGLE_CLIENT_SECRET || '').trim();
}

function isConfigured() {
  return !!(clientId() && clientSecret());
}

function createOAuth2Client() {
  return new OAuth2Client(clientId(), clientSecret(), redirectUri());
}

/**
 * @param {number} hostUserId
 * @param {string | null} roomId
 */
function generateAuthUrl(hostUserId, roomId) {
  const oauth2 = createOAuth2Client();
  const state = hostAuth.signYoutubeMusicOAuthState({
    userId: hostUserId,
    roomId: roomId || undefined,
  });
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
    state,
  });
}

/**
 * @param {string} code
 * @param {number} hostUserId
 */
async function handleCallback(code, hostUserId) {
  const oauth2 = createOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.access_token) {
    const err = new Error('YouTube Music OAuth returned no access_token');
    /** @type {any} */ (err).statusCode = 502;
    throw err;
  }
  tokenStore.set(hostUserId, tokens);
}

/**
 * @param {number} hostUserId
 */
function hasCredentials(hostUserId) {
  const t = tokenStore.get(hostUserId);
  return !!(t && t.access_token);
}

/**
 * @param {number} hostUserId
 * @returns {OAuth2Client | null}
 */
function getOAuthClientForHost(hostUserId) {
  const tokens = tokenStore.get(hostUserId);
  if (!tokens || !tokens.access_token) return null;
  const oauth2 = createOAuth2Client();
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', (fresh) => {
    const cur = tokenStore.get(hostUserId) || {};
    tokenStore.set(hostUserId, { ...cur, ...fresh });
  });
  return oauth2;
}

/**
 * @param {number} hostUserId
 */
async function listMyPlaylists(hostUserId) {
  const oauth2 = getOAuthClientForHost(hostUserId);
  if (!oauth2) {
    const err = new Error('YouTube Music not connected for this host');
    /** @type {any} */ (err).statusCode = 401;
    throw err;
  }

  const out = [];
  let pageToken = '';
  for (;;) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const { data } = await oauth2.request({ url: url.toString() });
    const items = Array.isArray(data.items) ? data.items : [];
    for (const it of items) {
      out.push({
        id: it.id,
        title: it.snippet?.title || '',
        description: it.snippet?.description || '',
        itemCount: it.contentDetails?.itemCount ?? null,
        thumbnails: it.snippet?.thumbnails || null,
      });
    }
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    if (!pageToken) break;
  }
  return out;
}

/**
 * Playlist items as `{ id, name, artist, sourcePlaylistId, sourcePlaylistName? }` for host setlists (video id as track id).
 * @param {number} hostUserId
 * @param {string} playlistId
 * @param {{ playlistName?: string }} [options]
 */
async function listPlaylistItems(hostUserId, playlistId, options = {}) {
  const oauth2 = getOAuthClientForHost(hostUserId);
  if (!oauth2) {
    const err = new Error('YouTube Music not connected for this host');
    /** @type {any} */ (err).statusCode = 401;
    throw err;
  }

  const pid = String(playlistId || '').trim();
  if (!pid) {
    const err = new Error('Missing playlist id');
    /** @type {any} */ (err).statusCode = 400;
    throw err;
  }

  const playlistName =
    options.playlistName != null && String(options.playlistName).trim() !== ''
      ? String(options.playlistName).trim()
      : '';

  const tracks = [];
  let pageToken = '';
  for (;;) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', pid);
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const { data } = await oauth2.request({ url: url.toString() });
    const items = Array.isArray(data.items) ? data.items : [];
    for (const it of items) {
      const vid =
        it.snippet?.resourceId?.videoId || it.contentDetails?.videoId || '';
      if (!vid) continue;
      const rawTitle = it.snippet?.title || '';
      if (rawTitle === 'Deleted video' || rawTitle === 'Private video') continue;
      const { title: parsedTitle, artist: parsedArtist } = parseYoutubeVideoTitleForDisplay(rawTitle);
      let displayName = (parsedTitle || rawTitle).trim() || rawTitle;
      let displayArtist = (parsedArtist || '').trim();
      const channelArtist = channelFallbackArtistName(it.snippet?.videoOwnerChannelTitle || '');
      if (!displayArtist && channelArtist) {
        const stripped = titleIfStartsWithChannel(displayName, channelArtist);
        if (stripped) displayName = stripped;
        displayArtist = channelArtist;
      }
      tracks.push({
        id: vid,
        name: displayName,
        artist: displayArtist,
        /** Full Data API `snippet.title` — used for finalize reconciliation + cache keys (not for channel name). */
        youtubeRawTitle: rawTitle,
        youtubeMusic: true,
        sourcePlaylistId: pid,
        ...(playlistName ? { sourcePlaylistName: playlistName } : {}),
      });
    }
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    if (!pageToken) break;
  }
  return tracks;
}

/**
 * @param {number} hostUserId
 */
function clearHost(hostUserId) {
  tokenStore.delete(hostUserId);
}

module.exports = {
  SCOPES,
  redirectUri,
  isConfigured,
  generateAuthUrl,
  handleCallback,
  hasCredentials,
  listMyPlaylists,
  listPlaylistItems,
  clearHost,
};
