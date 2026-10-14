/**
 * Player avatars: presets, uploaded bytes, or mirrored remote URLs.
 * Served same-origin under /api/player-avatar/:digest (venue-logo pattern).
 *
 * Disable disk cache: TEMPO_PLAYER_AVATAR_CACHE=0
 * Storage: TEMPO_PLAYER_AVATAR_DIR (default: <cwd>/data/player-avatars)
 */

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;

const MAX_BYTES = 1024 * 1024; // 1MB
const FETCH_TIMEOUT_MS = 14_000;
const PRESET_IDS = new Set([
  'fox',
  'owl',
  'cat',
  'dog',
  'bear',
  'bird',
  'fish',
  'star',
  'moon',
  'bolt',
  'heart',
  'music',
]);

function cacheDisabled() {
  const v = String(process.env.TEMPO_PLAYER_AVATAR_CACHE || '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

function cacheRootDir() {
  const raw = String(process.env.TEMPO_PLAYER_AVATAR_DIR || '').trim();
  return raw ? path.resolve(raw) : path.join(process.cwd(), 'data', 'player-avatars');
}

function isPrivateOrBlockedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  if (ip === '0.0.0.0') return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map((x) => Number(x));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1') return true;
    if (low.startsWith('fe80:')) return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true;
    return false;
  }
  return true;
}

function hostnameBlocked(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal' || h.endsWith('.metadata.google.internal')) return true;
  if (h.endsWith('.local')) return true;
  if (h === 'metadata' || h.startsWith('metadata.')) return true;
  return false;
}

async function assertResolvableHostIsPublic(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIp(hostname)) throw new Error('player-avatar: blocked IP');
    return;
  }
  if (hostnameBlocked(hostname)) throw new Error('player-avatar: blocked host');

  let addr;
  try {
    const r = await dns.lookup(hostname, { all: false, verbatim: true });
    addr = r && r.address;
  } catch {
    throw new Error('player-avatar: DNS failed');
  }
  if (!addr || isPrivateOrBlockedIp(addr)) throw new Error('player-avatar: host resolves to private IP');
}

function normalizeContentType(raw) {
  return String(raw || '').split(';')[0].trim().toLowerCase();
}

function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return '';
}

const ALLOWED_CT = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/pjpeg']);

function extForContentType(ct) {
  const c = normalizeContentType(ct);
  if (c === 'image/png') return 'png';
  if (c === 'image/webp') return 'webp';
  if (c === 'image/gif') return 'gif';
  return 'jpg';
}

/** Accept preset:<id>, /api/player-avatar/<digest>, or https URL (caller may mirror). */
function sanitizeAvatarValue(raw, maxLen = 2000) {
  const t = String(raw == null ? '' : raw).trim().slice(0, maxLen);
  if (!t) return '';
  const preset = t.match(/^preset:([a-z0-9_-]{1,32})$/i);
  if (preset) {
    const id = preset[1].toLowerCase();
    if (!PRESET_IDS.has(id)) return '';
    return `preset:${id}`;
  }
  const local = t.match(/^\/api\/player-avatar\/([a-f0-9]{32})$/i);
  if (local) return `/api/player-avatar/${local[1].toLowerCase()}`;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
      return '';
    }
    // Keep query string — many CDNs / signed image links 404 without it.
    u.hash = '';
    return u.href.slice(0, maxLen);
  } catch {
    return '';
  }
}

function isPresetAvatar(value) {
  return /^preset:[a-z0-9_-]+$/i.test(String(value || ''));
}

function isLocalAvatarPath(value) {
  return /^\/api\/player-avatar\/[a-f0-9]{32}$/i.test(String(value || ''));
}

async function fetchRemoteImageBytes(url) {
  let current = String(url);
  for (let hop = 0; hop < 8; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      throw new Error('player-avatar: bad URL');
    }
    if (
      u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))
    ) {
      throw new Error('player-avatar: protocol');
    }
    await assertResolvableHostIsPublic(u.hostname);

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          // Some CDNs 404/403 anonymous fetches without a UA.
          'User-Agent':
            'Mozilla/5.0 (compatible; TempoMusicBingo/1.0; +https://tempomusicbingo.com)',
        },
      });
    } finally {
      clearTimeout(to);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('player-avatar: redirect without location');
      current = new URL(loc, current).href;
      continue;
    }

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          'That image URL was not found (404). Use a direct link to the image file, or upload/drop a photo instead.',
        );
      }
      if (res.status === 403 || res.status === 401) {
        throw new Error(
          'That image host blocked the download. Try uploading the photo instead of pasting a URL.',
        );
      }
      throw new Error(`player-avatar: HTTP ${res.status}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('player-avatar: too large');

    let ct = normalizeContentType(res.headers.get('content-type'));
    if (!ALLOWED_CT.has(ct)) ct = sniffImageMime(buf);
    if (!ALLOWED_CT.has(ct)) throw new Error('player-avatar: not a raster image');

    return { buf, contentType: ct };
  }
  throw new Error('player-avatar: too many redirects');
}

function parseDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const m = s.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif|pjpeg));base64,(.+)$/i);
  if (!m) return null;
  let ct = normalizeContentType(m[1]);
  if (ct === 'image/jpg') ct = 'image/jpeg';
  if (!ALLOWED_CT.has(ct)) return null;
  let buf;
  try {
    buf = Buffer.from(m[2], 'base64');
  } catch {
    return null;
  }
  if (!buf.length || buf.length > MAX_BYTES) return null;
  const sniffed = sniffImageMime(buf);
  if (sniffed && !ALLOWED_CT.has(sniffed)) return null;
  return { buf, contentType: sniffed || ct };
}

async function writeAvatarBytes(buf, contentType, sourceLabel) {
  if (cacheDisabled()) throw new Error('player-avatar: storage disabled');
  if (!buf || buf.length === 0 || buf.length > MAX_BYTES) {
    throw new Error('player-avatar: invalid size');
  }
  let ct = normalizeContentType(contentType);
  if (!ALLOWED_CT.has(ct)) ct = sniffImageMime(buf);
  if (!ALLOWED_CT.has(ct)) throw new Error('player-avatar: not a raster image');

  const digest = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const root = cacheRootDir();
  const binPath = path.join(root, `${digest}.bin`);
  const metaPath = path.join(root, `${digest}.json`);
  const publicPath = `/api/player-avatar/${digest}`;

  if (fssync.existsSync(binPath) && fssync.existsSync(metaPath)) {
    return publicPath;
  }

  await fs.mkdir(root, { recursive: true });
  const meta = {
    sourceLabel: String(sourceLabel || '').slice(0, 200),
    contentType: ct,
    bytes: buf.length,
    cachedAt: new Date().toISOString(),
    ext: extForContentType(ct),
  };
  const tmpBase = path.join(root, `.tmp-${digest}-${process.pid}-${Date.now()}`);
  const tmpBin = `${tmpBase}.bin`;
  const tmpMeta = `${tmpBase}.json`;
  await fs.writeFile(tmpBin, buf);
  await fs.writeFile(tmpMeta, JSON.stringify(meta), 'utf8');
  try {
    await fs.rename(tmpMeta, metaPath);
  } catch (e) {
    await fs.unlink(tmpBin).catch(() => {});
    throw e;
  }
  try {
    await fs.rename(tmpBin, binPath);
  } catch (e) {
    await fs.unlink(metaPath).catch(() => {});
    if (fssync.existsSync(binPath)) return publicPath;
    throw e;
  }
  return publicPath;
}

async function mirrorRemoteUrl(sourceUrl) {
  const sanitized = sanitizeAvatarValue(sourceUrl);
  if (!sanitized || isPresetAvatar(sanitized) || isLocalAvatarPath(sanitized)) {
    return sanitized || '';
  }
  const fetched = await fetchRemoteImageBytes(sanitized);
  return writeAvatarBytes(fetched.buf, fetched.contentType, sanitized.slice(0, 120));
}

async function storeDataUrlOrBase64(payload) {
  const raw = String(payload || '').trim();
  if (raw.startsWith('data:')) {
    const parsed = parseDataUrl(raw);
    if (!parsed) throw new Error('player-avatar: invalid data URL');
    return writeAvatarBytes(parsed.buf, parsed.contentType, 'data-url');
  }
  // Raw base64 JPEG/PNG
  let buf;
  try {
    buf = Buffer.from(raw.replace(/\s/g, ''), 'base64');
  } catch {
    throw new Error('player-avatar: invalid base64');
  }
  const ct = sniffImageMime(buf);
  if (!ct) throw new Error('player-avatar: not a raster image');
  return writeAvatarBytes(buf, ct, 'base64');
}

/**
 * Resolve an incoming avatar intent to a stored value.
 * @param {{ avatar?: string, dataUrl?: string, imageUrl?: string, imageBase64?: string }} body
 */
async function resolveAvatarFromBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.dataUrl || b.imageBase64) {
    return storeDataUrlOrBase64(b.dataUrl || b.imageBase64);
  }
  const imageUrl = b.imageUrl || b.url;
  if (imageUrl) {
    return mirrorRemoteUrl(imageUrl);
  }
  if (b.avatar != null) {
    const sanitized = sanitizeAvatarValue(b.avatar);
    if (!sanitized) return '';
    if (isPresetAvatar(sanitized) || isLocalAvatarPath(sanitized)) return sanitized;
    return mirrorRemoteUrl(sanitized);
  }
  return null; // no avatar field in body
}

async function readMeta(metaPath) {
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

function registerPlayerAvatarRoutes(app) {
  app.get('/api/player-avatar/:digest', async (req, res) => {
    try {
      const digest = String(req.params.digest || '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(digest)) {
        return res.status(400).send('bad digest');
      }
      const root = cacheRootDir();
      const binPath = path.join(root, `${digest}.bin`);
      const metaPath = path.join(root, `${digest}.json`);
      const meta = await readMeta(metaPath);
      if (!meta || typeof meta.contentType !== 'string') {
        return res.status(404).send('not found');
      }
      if (!fssync.existsSync(binPath)) {
        return res.status(404).send('not found');
      }
      res.setHeader('Content-Type', meta.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(path.resolve(binPath));
    } catch (e) {
      console.error('[player-avatar] serve', e?.message || e);
      res.status(500).send('error');
    }
  });
}

module.exports = {
  PRESET_IDS: [...PRESET_IDS],
  sanitizeAvatarValue,
  isPresetAvatar,
  isLocalAvatarPath,
  resolveAvatarFromBody,
  mirrorRemoteUrl,
  storeDataUrlOrBase64,
  registerPlayerAvatarRoutes,
  MAX_BYTES,
};
