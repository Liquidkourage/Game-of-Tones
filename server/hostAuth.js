/**
 * Host authentication: Google OAuth + JWT session cookie.
 * User id is a serial integer assigned on first sign-in.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const COOKIE_NAME = 'tempo_host_session';

function getJwtSecret() {
  const s = process.env.JWT_SECRET || process.env.TEMPO_JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') {
    console.warn('⚠️ JWT_SECRET not set — using insecure dev default; set JWT_SECRET in production.');
  }
  return s || 'dev-only-change-me';
}

/**
 * Host session JWT. Optional `eml` is the normalized email from Google at sign-in time (same source as OAuth
 * allowlist checks) so API/socket approval matches Workspace primary vs alias quirks vs users.email in DB.
 */
function signHostJwt(userId, normalizedEmail) {
  const payload = { sub: String(userId), typ: 'host' };
  if (normalizedEmail && typeof normalizedEmail === 'string') {
    const e = normalizedEmail.trim().toLowerCase();
    if (e) payload.eml = e;
  }
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });
}

function decodeHostJwtPayload(token) {
  try {
    const p = jwt.verify(token, getJwtSecret());
    if (p.typ !== 'host' || !p.sub) return null;
    const id = parseInt(p.sub, 10);
    if (!Number.isFinite(id)) return null;
    const email = typeof p.eml === 'string' ? p.eml.trim().toLowerCase() : null;
    return { userId: id, email: email || null };
  } catch {
    return null;
  }
}

function verifyHostJwt(token) {
  const p = decodeHostJwtPayload(token);
  return p ? p.userId : null;
}

/** Email embedded in host JWT at login (preferred over users.email for allowlist checks). */
function getHostEmailFromJwtToken(token) {
  if (!token || typeof token !== 'string') return null;
  const p = decodeHostJwtPayload(token);
  return p?.email || null;
}

function getHostEmailFromRequest(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const e = getHostEmailFromJwtToken(auth.slice(7));
    if (e) return e;
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    const e = getHostEmailFromJwtToken(req.cookies[COOKIE_NAME]);
    if (e) return e;
  }
  const cookies = parseCookies(req.headers.cookie);
  const t = cookies[COOKIE_NAME];
  if (t) return getHostEmailFromJwtToken(t);
  return null;
}

/** Short-lived JWT for Spotify OAuth `state` (ties callback to host user + optional room redirect). */
function signSpotifyOAuthState({ userId, roomId, spotifyRedirectUri }) {
  const payload = { typ: 'spotify_oauth', uid: userId, rid: roomId || null };
  if (spotifyRedirectUri && typeof spotifyRedirectUri === 'string' && spotifyRedirectUri.length < 512) {
    payload.rdr = spotifyRedirectUri;
  }
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '15m' });
}

function verifySpotifyOAuthState(token) {
  try {
    const p = jwt.verify(token, getJwtSecret());
    if (p.typ !== 'spotify_oauth' || p.uid == null) return null;
    const id = parseInt(p.uid, 10);
    if (!Number.isFinite(id)) return null;
    const redirectUri = typeof p.rdr === 'string' && p.rdr.length > 0 ? p.rdr : null;
    return { userId: id, roomId: p.rid ? String(p.rid) : null, spotifyRedirectUri: redirectUri };
  } catch {
    return null;
  }
}

/** Short-lived JWT for YouTube Music library OAuth `state` (host user + optional room redirect). */
function signYoutubeMusicOAuthState({ userId, roomId }) {
  const payload = { typ: 'ytm_oauth', uid: userId, rid: roomId || null };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '15m' });
}

function verifyYoutubeMusicOAuthState(token) {
  try {
    const p = jwt.verify(token, getJwtSecret());
    if (p.typ !== 'ytm_oauth' || p.uid == null) return null;
    const id = parseInt(p.uid, 10);
    if (!Number.isFinite(id)) return null;
    return { userId: id, roomId: p.rid ? String(p.rid) : null };
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = decodeURIComponent(part.slice(i + 1).trim());
    out[k] = v;
  });
  return out;
}

/** Raw JWT string from Bearer or host session cookie (for syncing client localStorage with HttpOnly cookie). */
function getHostJwtRawFromRequest(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    const t = req.cookies[COOKIE_NAME];
    if (typeof t === 'string' && t.length > 0) return t;
  }
  const cookies = parseCookies(req.headers.cookie || '');
  const t = cookies[COOKIE_NAME];
  return typeof t === 'string' && t.length > 0 ? t : null;
}

function getHostUserIdFromRequest(req) {
  const raw = getHostJwtRawFromRequest(req);
  if (raw) {
    const id = verifyHostJwt(raw);
    if (id != null) return id;
  }
  return null;
}

/**
 * Socket.io: same JWT as REST — handshake.auth.token OR Cookie header (HttpOnly session).
 * Without this, hosts who only have a cookie (no tempo_host_jwt in localStorage) get claimUid=null.
 */
function getHostSessionTokenFromHandshake(handshake) {
  const auth = handshake && handshake.auth;
  const t = auth && typeof auth.token === 'string' ? auth.token.trim() : '';
  if (t.length > 0) return t;
  const raw = handshake && handshake.headers && handshake.headers.cookie;
  if (!raw || typeof raw !== 'string') return null;
  const cookies = parseCookies(raw);
  const c = cookies[COOKIE_NAME];
  return typeof c === 'string' && c.length > 0 ? c : null;
}

function sessionCookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = 'lax';
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  /** e.g. `.liquidkourage.com` — share host session across got.* / tempo.* (localStorage is per-host). */
  const domain = (process.env.TEMPO_HOST_COOKIE_DOMAIN || '').trim();
  return { httpOnly: true, secure, sameSite, maxAge, path: '/', domain: domain || undefined };
}

function setSessionCookie(res, userId, normalizedEmail) {
  const token = signHostJwt(userId, normalizedEmail);
  const opts = sessionCookieOptions();
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.floor(opts.maxAge / 1000)}`,
    `SameSite=${opts.sameSite}`,
    opts.secure ? 'Secure' : '',
    'HttpOnly',
    opts.domain ? `Domain=${opts.domain}` : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const domain = (process.env.TEMPO_HOST_COOKIE_DOMAIN || '').trim();
  // Express clearCookie: drop host-only and Domain= variants; a manual Set-Cookie can miss one
  // and leave a stale `tempo_host_session` (looks like "still signed in" on refresh).
  if (res.clearCookie) {
    res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, secure, sameSite: 'lax' });
    if (domain) {
      res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, secure, sameSite: 'lax', domain });
    }
  } else {
    const domainPart = domain ? `; Domain=${domain}` : '';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=lax${secure ? '; Secure' : ''}; HttpOnly${domainPart}`
    );
  }
}

/** Default room code: MDY (no leading zeros on M/D) + YY + user id */
function buildDefaultRoomCode(userId, date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const yy = String(date.getFullYear()).slice(-2);
  return `${m}${d}${yy}${userId}`;
}

function randomStateToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  COOKIE_NAME,
  signHostJwt,
  verifyHostJwt,
  decodeHostJwtPayload,
  getHostEmailFromJwtToken,
  getHostEmailFromRequest,
  getHostJwtRawFromRequest,
  getHostSessionTokenFromHandshake,
  signSpotifyOAuthState,
  verifySpotifyOAuthState,
  signYoutubeMusicOAuthState,
  verifyYoutubeMusicOAuthState,
  parseCookies,
  getHostUserIdFromRequest,
  sessionCookieOptions,
  setSessionCookie,
  clearSessionCookie,
  buildDefaultRoomCode,
  randomStateToken,
};
