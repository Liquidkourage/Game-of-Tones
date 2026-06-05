/**
 * Player authentication: email/password accounts + JWT session cookie.
 * Separate from host Google OAuth (`hostAuth.js`).
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const COOKIE_NAME = 'tempo_player_session';
const MIN_PASSWORD_LEN = 8;

function getJwtSecret() {
  const s = process.env.JWT_SECRET || process.env.TEMPO_JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') {
    console.warn('⚠️ JWT_SECRET not set — using insecure dev default; set JWT_SECRET in production.');
  }
  return s || 'dev-only-change-me';
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function isValidEmail(email) {
  const n = normalizeEmail(email);
  if (!n || n.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  try {
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function signPlayerJwt(userId) {
  return jwt.sign({ sub: String(userId), typ: 'player' }, getJwtSecret(), { expiresIn: '90d' });
}

function decodePlayerJwtPayload(token) {
  try {
    const p = jwt.verify(token, getJwtSecret());
    if (p.typ !== 'player' || !p.sub) return null;
    const id = parseInt(p.sub, 10);
    if (!Number.isFinite(id)) return null;
    return { userId: id };
  } catch {
    return null;
  }
}

function verifyPlayerJwt(token) {
  const p = decodePlayerJwtPayload(token);
  return p ? p.userId : null;
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

function getPlayerJwtRawFromRequest(req) {
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

function getPlayerUserIdFromRequest(req) {
  const raw = getPlayerJwtRawFromRequest(req);
  if (raw) {
    const id = verifyPlayerJwt(raw);
    if (id != null) return id;
  }
  return null;
}

function getPlayerSessionTokenFromHandshake(handshake) {
  const auth = handshake && handshake.auth;
  const fromAuth =
    auth && typeof auth.playerToken === 'string'
      ? auth.playerToken.trim()
      : auth && typeof auth.token === 'string'
        ? auth.token.trim()
        : '';
  if (fromAuth.length > 0) {
    const p = decodePlayerJwtPayload(fromAuth);
    if (p && p.userId != null) return fromAuth;
    const hostTyp = (() => {
      try {
        const raw = jwt.decode(fromAuth);
        return raw && raw.typ;
      } catch {
        return null;
      }
    })();
    if (hostTyp !== 'host') {
      /* fall through to cookie */
    } else {
      return null;
    }
  }
  const raw = handshake && handshake.headers && handshake.headers.cookie;
  if (!raw || typeof raw !== 'string') return null;
  const cookies = parseCookies(raw);
  const c = cookies[COOKIE_NAME];
  return typeof c === 'string' && c.length > 0 ? c : null;
}

function sessionCookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  const domain = (process.env.TEMPO_PLAYER_COOKIE_DOMAIN || process.env.TEMPO_HOST_COOKIE_DOMAIN || '').trim();
  return { httpOnly: true, secure, sameSite: 'lax', maxAge: 90 * 24 * 60 * 60 * 1000, path: '/', domain: domain || undefined };
}

function setPlayerSessionCookie(res, userId) {
  const token = signPlayerJwt(userId);
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
  return token;
}

function clearPlayerSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const domain = (process.env.TEMPO_PLAYER_COOKIE_DOMAIN || process.env.TEMPO_HOST_COOKIE_DOMAIN || '').trim();
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

module.exports = {
  COOKIE_NAME,
  MIN_PASSWORD_LEN,
  normalizeEmail,
  isValidEmail,
  hashPassword,
  verifyPassword,
  signPlayerJwt,
  verifyPlayerJwt,
  decodePlayerJwtPayload,
  getPlayerJwtRawFromRequest,
  getPlayerUserIdFromRequest,
  getPlayerSessionTokenFromHandshake,
  setPlayerSessionCookie,
  clearPlayerSessionCookie,
};
