/**
 * Mirrors external venue logo URLs to local disk and serves them under /api/venue-logo/:digest
 * so projector displays hit same-origin static-ish assets (fast, browser-cacheable).
 *
 * Disable: TEMPO_VENUE_LOGO_CACHE=0
 * Storage: TEMPO_VENUE_LOGO_DIR (default: <cwd>/data/venue-logos)
 */

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 14_000;

function cacheDisabled() {
  const v = String(process.env.TEMPO_VENUE_LOGO_CACHE || '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

function cacheRootDir() {
  const raw = String(process.env.TEMPO_VENUE_LOGO_DIR || '').trim();
  return raw ? path.resolve(raw) : path.join(process.cwd(), 'data', 'venue-logos');
}

function digestFor(orgId, sourceUrl) {
  return crypto.createHash('sha256').update(`${Number(orgId)}\0${sourceUrl}`, 'utf8').digest('hex').slice(0, 32);
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
    if (isPrivateOrBlockedIp(hostname)) throw new Error('venue-logo: blocked IP');
    return;
  }
  if (hostnameBlocked(hostname)) throw new Error('venue-logo: blocked host');

  let addr;
  try {
    const r = await dns.lookup(hostname, { all: false, verbatim: true });
    addr = r && r.address;
  } catch {
    throw new Error('venue-logo: DNS failed');
  }
  if (!addr || isPrivateOrBlockedIp(addr)) throw new Error('venue-logo: host resolves to private IP');
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

function shouldTryMirror(sourceUrl) {
  const s = String(sourceUrl || '').trim();
  if (!s || cacheDisabled()) return false;
  if (s.includes('/api/venue-logo/')) return false;
  if (s.startsWith('/') && !s.startsWith('//')) return false;
  if (s.startsWith('data:')) return false;
  let u;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol === 'http:' && !isLocal) return false;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return true;
}

/**
 * Fetch with manual redirects; re-check SSRF on each hop.
 * @returns {{ buf: Buffer, contentType: string }}
 */
async function fetchLogoBytes(url) {
  let current = String(url);
  for (let hop = 0; hop < 8; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      throw new Error('venue-logo: bad URL');
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
      throw new Error('venue-logo: protocol');
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
        headers: { Accept: 'image/*' },
      });
    } finally {
      clearTimeout(to);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('venue-logo: redirect without location');
      current = new URL(loc, current).href;
      continue;
    }

    if (!res.ok) throw new Error(`venue-logo: HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('venue-logo: too large');

    let ct = normalizeContentType(res.headers.get('content-type'));
    if (!ALLOWED_CT.has(ct)) {
      ct = sniffImageMime(buf);
    }
    if (!ALLOWED_CT.has(ct)) throw new Error('venue-logo: not a raster image');

    return { buf, contentType: ct };
  }
  throw new Error('venue-logo: too many redirects');
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

function syncLocalPathIfCached(sourceUrl, orgId) {
  if (!shouldTryMirror(sourceUrl)) return null;
  const oid = Number(orgId);
  if (!Number.isFinite(oid) || oid < 1) return null;
  const digest = digestFor(oid, sourceUrl);
  const root = cacheRootDir();
  const binPath = path.join(root, `${digest}.bin`);
  const metaPath = path.join(root, `${digest}.json`);
  if (!fssync.existsSync(binPath) || !fssync.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fssync.readFileSync(metaPath, 'utf8'));
    if (meta && meta.sourceUrl === sourceUrl) return `/api/venue-logo/${digest}`;
  } catch {
    return null;
  }
  return null;
}

async function mirroredPublicPathOrNull(sourceUrl, orgId) {
  if (!shouldTryMirror(sourceUrl)) return null;
  const oid = Number(orgId);
  if (!Number.isFinite(oid) || oid < 1) return null;

  const digest = digestFor(oid, sourceUrl);
  const root = cacheRootDir();
  const binPath = path.join(root, `${digest}.bin`);
  const metaPath = path.join(root, `${digest}.json`);

  const hit = syncLocalPathIfCached(sourceUrl, orgId);
  if (hit) return hit;

  await fs.mkdir(root, { recursive: true });

  let fetched;
  try {
    fetched = await fetchLogoBytes(sourceUrl);
  } catch (e) {
    console.warn('[venue-logo-cache] fetch failed:', sourceUrl.slice(0, 80), e?.message || e);
    return null;
  }

  const tmpBase = path.join(root, `.tmp-${digest}-${process.pid}-${Date.now()}`);
  const tmpBin = `${tmpBase}.bin`;
  const tmpMeta = `${tmpBase}.json`;

  const meta = {
    sourceUrl,
    orgId: oid,
    contentType: fetched.contentType,
    bytes: fetched.buf.length,
    cachedAt: new Date().toISOString(),
  };

  await fs.writeFile(tmpBin, fetched.buf);
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
    throw e;
  }

  return `/api/venue-logo/${digest}`;
}

function registerVenueLogoRoutes(app) {
  app.get('/api/venue-logo/:digest', async (req, res) => {
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
      console.error('[venue-logo-cache] serve', e?.message || e);
      res.status(500).send('error');
    }
  });
}

module.exports = {
  mirroredPublicPathOrNull,
  registerVenueLogoRoutes,
  shouldTryMirror,
  syncLocalPathIfCached,
  digestFor,
};
