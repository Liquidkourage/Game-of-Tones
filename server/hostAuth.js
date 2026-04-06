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

function signHostJwt(userId) {
  return jwt.sign({ sub: String(userId), typ: 'host' }, getJwtSecret(), { expiresIn: '30d' });
}

function verifyHostJwt(token) {
  try {
    const p = jwt.verify(token, getJwtSecret());
    if (p.typ !== 'host' || !p.sub) return null;
    const id = parseInt(p.sub, 10);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/** Short-lived JWT for Spotify OAuth `state` (ties callback to host user + optional room redirect). */
function signSpotifyOAuthState({ userId, roomId }) {
  return jwt.sign(
    { typ: 'spotify_oauth', uid: userId, rid: roomId || null },
    getJwtSecret(),
    { expiresIn: '15m' }
  );
}

function verifySpotifyOAuthState(token) {
  try {
    const p = jwt.verify(token, getJwtSecret());
    if (p.typ !== 'spotify_oauth' || p.uid == null) return null;
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

function getHostUserIdFromRequest(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const id = verifyHostJwt(auth.slice(7));
    if (id != null) return id;
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    const id = verifyHostJwt(req.cookies[COOKIE_NAME]);
    if (id != null) return id;
  }
  const cookies = parseCookies(req.headers.cookie);
  const t = cookies[COOKIE_NAME];
  if (t) return verifyHostJwt(t);
  return null;
}

function sessionCookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = 'lax';
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  return { httpOnly: true, secure, sameSite, maxAge, path: '/' };
}

function setSessionCookie(res, userId) {
  const token = signHostJwt(userId);
  const opts = sessionCookieOptions();
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.floor(opts.maxAge / 1000)}`,
    `SameSite=${opts.sameSite}`,
    opts.secure ? 'Secure' : '',
    'HttpOnly',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=lax${secure ? '; Secure' : ''}; HttpOnly`
  );
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
  signSpotifyOAuthState,
  verifySpotifyOAuthState,
  parseCookies,
  getHostUserIdFromRequest,
  sessionCookieOptions,
  setSessionCookie,
  clearSessionCookie,
  buildDefaultRoomCode,
  randomStateToken,
};
