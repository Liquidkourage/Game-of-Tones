/**
 * LK-owned “catalog” Spotify account reads playlist /items on the server so hosts can use packs
 * they don’t own (follow-only lists fail GET …/items with the host token per Spotify rules).
 *
 * Env:
 * - TEMPO_CATALOG_SPOTIFY_REFRESH_TOKEN (required if catalog used)
 * - TEMPO_CATALOG_PLAYLIST_IDS — comma-separated Spotify playlist ids, OR
 * - TEMPO_CATALOG_PLAYLISTS_JSON — e.g. [{"id":"abc","label":"Pack name"}] (label optional)
 * - TEMPO_CATALOG_PLAYLIST_NAME_PREFIX — non-empty: discover packs from GET /v1/me/playlists whose
 *   name starts with this string (merged with static allowlist above; dedupe by id, static wins labels).
 * - TEMPO_CATALOG_PLAYLIST_NAME_PREFIX_IGNORE_CASE — true: prefix match is case-insensitive (GoT vs got).
 * - TEMPO_CATALOG_PREFIX_OWNER_ONLY — default true: prefix matches must be owned by the catalog user
 *   (avoids followed playlists that 403 on /items).
 * - TEMPO_CATALOG_PREFIX_CACHE_MS — ms to cache prefix discovery (default 300000).
 * - TEMPO_CATALOG_SPOTIFY_CLIENT_ID / TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET — optional; default SPOTIFY_*
 *
 * Catalog OAuth must use the same Spotify Developer app as the refresh token was issued for.
 */

const SpotifyService = require('./spotify');

/** @returns {{ id: string, label?: string }[]} */
function parseCatalogAllowlistEntries() {
  const jsonRaw = process.env.TEMPO_CATALOG_PLAYLISTS_JSON;
  if (jsonRaw != null && String(jsonRaw).trim() !== '') {
    try {
      const arr = JSON.parse(String(jsonRaw));
      if (!Array.isArray(arr)) return [];
      return arr
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const id = row.id != null ? String(row.id).trim() : '';
          if (!id) return null;
          const label = row.label != null ? String(row.label).trim() : '';
          return label ? { id, label } : { id };
        })
        .filter(Boolean);
    } catch (e) {
      console.warn('[catalog] Invalid TEMPO_CATALOG_PLAYLISTS_JSON:', e && e.message ? e.message : e);
      return [];
    }
  }
  const idsRaw = process.env.TEMPO_CATALOG_PLAYLIST_IDS;
  if (idsRaw == null || String(idsRaw).trim() === '') return [];
  return String(idsRaw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));
}

function hasCatalogRefreshToken() {
  const rt = process.env.TEMPO_CATALOG_SPOTIFY_REFRESH_TOKEN;
  return !!(rt && String(rt).trim());
}

/** @returns {string} trimmed prefix or '' */
function getCatalogPlaylistNamePrefix() {
  const v = process.env.TEMPO_CATALOG_PLAYLIST_NAME_PREFIX;
  if (v == null || String(v).trim() === '') return '';
  return String(v).trim();
}

function isCatalogPrefixMode() {
  return getCatalogPlaylistNamePrefix() !== '';
}

function getCatalogPrefixIgnoreCase() {
  return parseEnvBool(process.env.TEMPO_CATALOG_PLAYLIST_NAME_PREFIX_IGNORE_CASE, false);
}

/** @param {string} name @param {string} prefix */
function catalogPlaylistNameStartsWithPrefix(name, prefix, ignoreCase) {
  const n = String(name || '');
  const p = String(prefix || '');
  if (!p) return false;
  if (ignoreCase) return n.toLowerCase().startsWith(p.toLowerCase());
  return n.startsWith(p);
}

function parseEnvBool(raw, defaultVal) {
  if (raw == null || String(raw).trim() === '') return defaultVal;
  const s = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return defaultVal;
}

function getCatalogPrefixOwnerOnlyDefaultTrue() {
  return parseEnvBool(process.env.TEMPO_CATALOG_PREFIX_OWNER_ONLY, true);
}

function getCatalogPrefixCacheMs() {
  const n = Number(process.env.TEMPO_CATALOG_PREFIX_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return n;
  return 300000;
}

function isCatalogFeatureConfigured() {
  if (!hasCatalogRefreshToken()) return false;
  if (isCatalogPrefixMode()) return true;
  return parseCatalogAllowlistEntries().length > 0;
}

/** @type {{ key: string, entries: { id: string, label?: string }[], at: number } | null} */
let catalogAllowlistResolveCache = null;

/**
 * Static entries plus optional prefix-discovered playlists (catalog token’s /me/playlists).
 * @returns {Promise<{ id: string, label?: string }[]>}
 */
async function resolveCatalogAllowlistEntries() {
  const prefix = getCatalogPlaylistNamePrefix();
  const staticEntries = parseCatalogAllowlistEntries();

  if (!prefix) {
    return staticEntries;
  }

  const ownerOnly = getCatalogPrefixOwnerOnlyDefaultTrue();
  const ignoreCase = getCatalogPrefixIgnoreCase();
  const staticKey = staticEntries
    .map((e) => e.id)
    .sort()
    .join(',');
  const cacheKey = `${prefix}|${ignoreCase ? 'ic1' : 'ic0'}|${ownerOnly ? '1' : '0'}|${staticKey}`;
  const ttl = getCatalogPrefixCacheMs();
  const now = Date.now();
  if (
    ttl > 0 &&
    catalogAllowlistResolveCache &&
    catalogAllowlistResolveCache.key === cacheKey &&
    now - catalogAllowlistResolveCache.at < ttl
  ) {
    return catalogAllowlistResolveCache.entries;
  }

  const svc = await ensureCatalogAccessToken();
  let catalogSpotifyUserId = null;
  if (ownerOnly) {
    const prof = await svc.getCurrentUserProfileBrief();
    catalogSpotifyUserId = prof.spotifyUserId;
    if (!catalogSpotifyUserId) {
      console.warn(
        '[catalog] PREFIX_OWNER_ONLY set but GET /v1/me returned no user id; using static allowlist only'
      );
      catalogAllowlistResolveCache = { key: cacheKey, entries: staticEntries, at: now };
      return staticEntries;
    }
  }

  const { playlists } = await svc.getUserPlaylists();
  /** @type {{ id: string, label?: string }[]} */
  const prefixEntries = [];
  for (let i = 0; i < playlists.length; i++) {
    const p = playlists[i];
    const name = p.name != null ? String(p.name) : '';
    if (!catalogPlaylistNameStartsWithPrefix(name, prefix, ignoreCase)) continue;
    const oid = p.ownerId != null ? String(p.ownerId) : '';
    if (ownerOnly && catalogSpotifyUserId && oid !== catalogSpotifyUserId) continue;
    prefixEntries.push({ id: String(p.id).trim(), label: name });
  }

  const mergedMap = new Map();
  for (const e of staticEntries) {
    mergedMap.set(e.id, { id: e.id, ...(e.label ? { label: e.label } : {}) });
  }
  for (const e of prefixEntries) {
    if (!mergedMap.has(e.id)) mergedMap.set(e.id, e);
  }
  const merged = [...mergedMap.values()];

  catalogAllowlistResolveCache = { key: cacheKey, entries: merged, at: now };
  return merged;
}

let catalogServiceSingleton = null;

function getCatalogSpotifyService() {
  if (!isCatalogFeatureConfigured()) return null;
  if (!catalogServiceSingleton) {
    const cid = process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_ID;
    const sec = process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET;
    const useOverride =
      cid && sec && String(cid).trim() !== '' && String(sec).trim() !== '';
    catalogServiceSingleton = useOverride
      ? new SpotifyService({ clientId: String(cid).trim(), clientSecret: String(sec).trim() })
      : new SpotifyService();
    const rt = String(process.env.TEMPO_CATALOG_SPOTIFY_REFRESH_TOKEN || '').trim();
    catalogServiceSingleton.setTokens('', rt);
  }
  return catalogServiceSingleton;
}

/** @param {string} playlistId */
async function assertCatalogPlaylistAllowlisted(playlistId) {
  const id = String(playlistId || '').trim();
  const entries = await resolveCatalogAllowlistEntries();
  const allowed = new Set(entries.map((e) => e.id));
  if (!id || !allowed.has(id)) {
    const err = new Error('Playlist not in Tempo catalog allowlist');
    err.statusCode = 400;
    err.body = { error: { status: 400, message: err.message } };
    throw err;
  }
}

async function ensureCatalogAccessToken() {
  const svc = getCatalogSpotifyService();
  if (!svc) {
    const err = new Error('Tempo catalog is not configured');
    err.statusCode = 503;
    err.body = { error: { status: 503, message: err.message } };
    throw err;
  }
  await svc.ensureValidToken();
  return svc;
}

/**
 * @returns {Promise<{ id: string, name: string, tracks: number, catalog: true }[]>}
 */
async function loadCatalogPackSummariesForApi() {
  const entries = await resolveCatalogAllowlistEntries();
  const svc = await ensureCatalogAccessToken();
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const { id, label } = entries[i];
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      const meta = await svc.getPlaylistMetadataBrief(id);
      out.push({
        id: meta.id,
        name: label || meta.name || 'Catalog playlist',
        tracks: Math.max(0, Number(meta.tracks) || 0),
        catalog: true,
      });
    } catch (e) {
      console.warn(`[catalog] metadata failed for ${id}:`, e && e.message ? e.message : e);
      out.push({
        id,
        name: label || `Playlist ${id}`,
        tracks: 0,
        catalog: true,
      });
    }
  }
  return out;
}

/**
 * @param {string} playlistId
 */
async function fetchCatalogPlaylistTracks(playlistId, playlistInfo = null) {
  await assertCatalogPlaylistAllowlisted(playlistId);
  const svc = await ensureCatalogAccessToken();
  return svc.getPlaylistTracks(String(playlistId).trim(), playlistInfo);
}

module.exports = {
  isCatalogFeatureConfigured,
  parseCatalogAllowlistEntries,
  resolveCatalogAllowlistEntries,
  loadCatalogPackSummariesForApi,
  fetchCatalogPlaylistTracks,
  assertCatalogPlaylistAllowlisted,
};
