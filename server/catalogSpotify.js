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
 *   Useful when the catalog refresh token is your personal library so only bingo-named playlists appear as packs.
 * - TEMPO_CATALOG_PLAYLIST_NAME_PREFIX_IGNORE_CASE — true: prefix match is case-insensitive (GoT vs got).
 * - TEMPO_CATALOG_PREFIX_OWNER_ONLY — default true: prefix matches must be owned by the catalog user
 *   (avoids followed playlists that 403 on /items).
 * - TEMPO_CATALOG_PREFIX_CACHE_MS — ms to cache prefix discovery in-memory per process (default 300000).
 * - TEMPO_CATALOG_PACKS_SERVER_CACHE_MS — Postgres TTL for `/api/spotify/catalog/packs` snapshots (default 604800000 = 7d).
 *   Set to 0 to always try live Spotify for packs (still uses stale DB row on hard failure).
 * - TEMPO_CATALOG_PACKS_BACKGROUND_WARM_MS — optional interval (ms) to refresh that Postgres snapshot in the
 *   background so hosts rarely trigger live Spotify when TTL is fresh. Minimum 300000 (5 min); unset disables.
 * - TEMPO_CATALOG_PUBLIC_FETCH_DISABLED — true: skip all catalog Spotify reads for pack list; API returns
 *   configured=false (Official packs hidden) until unset.
 * - TEMPO_CATALOG_SPOTIFY_CLIENT_ID / TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET — optional; default SPOTIFY_*
 * - TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET (alone) — optional; non-empty value replaces **only the client secret**
 *   used for catalog token refresh (client id still comes from CREDENTIALS_USER_ID row, TEMPO_CATALOG_* pair, or SPOTIFY_*).
 *   Use when Postgres decrypt succeeds but the stored secret does not match Spotify (persistent invalid_client) while
 *   the Dashboard secret pasted into Railway is correct.
 * - TEMPO_CATALOG_SPOTIFY_CREDENTIALS_USER_ID — optional host **users.id** (integer). When set, the server loads
 *   that row’s Spotify Developer **client id + decrypted client secret** from the organizations table and uses them
 *   for catalog refresh (same app as host OAuth). Use this when Railway has no reliable SPOTIFY_CLIENT_SECRET but
 *   hosts already work via encrypted org credentials — avoids `invalid_client` on GET /api/spotify/catalog/packs.
 *
 * Catalog OAuth must use the same Spotify Developer app as the refresh token was issued for.
 *
 * Rate limits / best practice:
 * - Host library + catalog prefix discovery both paginate GET /v1/me/playlists (~1 page per 50 playlists).
 *   Server-side pack cache avoids re-running catalog discovery on every host refresh.
 * - When the Spotify Dashboard allows it, TEMPO_CATALOG_SPOTIFY_CLIENT_* on a second Developer app isolates
 *   catalog quota from hosts; many creators only have one app (development mode) — then rely on this cache
 *   TTL + prefix/static config instead of a second client_id.
 * - Prefer static TEMPO_CATALOG_PLAYLIST_IDS / JSON without prefix mode if you only ship a fixed pack list
 *   — zero playlist enumeration on the catalog token for discovery.
 * - Host pagination spacing: SPOTIFY_PLAYLIST_LIST_PAGE_GAP_MS (see spotify.js) between /me/playlists pages.
 */

const crypto = require('crypto');
const SpotifyService = require('./spotify');
const organizationsStore = require('./organizations');

/** Railway/env sometimes wraps tokens in quotes — normalize for refresh_token grant. */
function normalizeCatalogRefreshTokenFromEnv() {
  let s = String(process.env.TEMPO_CATALOG_SPOTIFY_REFRESH_TOKEN || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

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
  return normalizeCatalogRefreshTokenFromEnv() !== '';
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

/** When true, `/api/spotify/catalog/packs` returns configured=false without calling Spotify. */
function isCatalogPublicFetchDisabled() {
  return parseEnvBool(process.env.TEMPO_CATALOG_PUBLIC_FETCH_DISABLED, false);
}

/**
 * Stable key for Postgres snapshot of pack summaries (invalidates when catalog env meaningfully changes).
 * @returns {string}
 */
function getCatalogPackSummariesCacheKey() {
  const cid =
    process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_ID != null &&
    String(process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_ID).trim() !== ''
      ? String(process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_ID).trim()
      : String(process.env.SPOTIFY_CLIENT_ID || '').trim();
  const parts = {
    hasRt: hasCatalogRefreshToken() ? '1' : '0',
    prefix: getCatalogPlaylistNamePrefix(),
    ignoreCase: getCatalogPrefixIgnoreCase(),
    ownerOnly: getCatalogPrefixOwnerOnlyDefaultTrue(),
    playlistsJson: process.env.TEMPO_CATALOG_PLAYLISTS_JSON || '',
    playlistIds: process.env.TEMPO_CATALOG_PLAYLIST_IDS || '',
    clientId: cid,
  };
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * @typedef {{ id: string, label?: string, tracksFromList?: number }} CatalogAllowlistEntry
 * `tracksFromList` when set from GET /v1/me/playlists lets pack summaries skip per-playlist metadata.
 */

/** @type {{ key: string, entries: CatalogAllowlistEntry[], meta?: { prefixSkippedDueToSpotify?: boolean }, at: number } | null} */
let catalogAllowlistResolveCache = null;

/**
 * Static entries plus optional prefix-discovered playlists (catalog token’s /me/playlists).
 * @returns {Promise<{ entries: CatalogAllowlistEntry[], meta: { prefixSkippedDueToSpotify?: boolean } }>}
 */
async function resolveCatalogAllowlistEntries() {
  const prefix = getCatalogPlaylistNamePrefix();
  const staticEntries = parseCatalogAllowlistEntries();

  if (!prefix) {
    return { entries: staticEntries, meta: {} };
  }

  const svc = await ensureCatalogAccessToken();
  if (typeof svc.isQuarantined === 'function' && svc.isQuarantined()) {
    const rem = typeof svc.getQuarantineRemainingSec === 'function' ? svc.getQuarantineRemainingSec() : null;
    const fallback = staticEntries.map((row) => ({ id: row.id, ...(row.label ? { label: row.label } : {}) }));
    console.warn(
      `[catalog] prefix discovery skipped — catalog Spotify quarantined${rem != null ? ` (~${rem}s)` : ''}; using static allowlist only`
    );
    return { entries: fallback, meta: { prefixSkippedDueToSpotify: true } };
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
    return {
      entries: catalogAllowlistResolveCache.entries,
      meta: catalogAllowlistResolveCache.meta || {},
    };
  }

  let catalogSpotifyUserId = null;
  let playlists;

  try {
    if (ownerOnly) {
      const prof = await svc.getCurrentUserProfileBrief();
      catalogSpotifyUserId = prof.spotifyUserId;
      if (!catalogSpotifyUserId) {
        console.warn(
          '[catalog] PREFIX_OWNER_ONLY set but GET /v1/me returned no user id; using static allowlist only'
        );
        catalogAllowlistResolveCache = { key: cacheKey, entries: staticEntries, meta: {}, at: now };
        return { entries: staticEntries, meta: {} };
      }
    }
    playlists = (await svc.getUserPlaylists()).playlists;
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    const rl =
      (typeof svc.isRateLimitError === 'function' && svc.isRateLimitError(e)) ||
      msg.includes('quarantined') ||
      msg.includes('429');
    console.warn(
      `[catalog] catalog Spotify Web API blocked (${rl ? 'rate limit / quarantine' : 'error'}); prefix discovery skipped — using static allowlist only. ${msg.slice(0, 200)}`
    );
    /** Do not cache: retry prefix discovery on the next /catalog/packs call after Spotify recovers. */
    const fallback = staticEntries.map((row) => ({ id: row.id, ...(row.label ? { label: row.label } : {}) }));
    return { entries: fallback, meta: { prefixSkippedDueToSpotify: true } };
  }

  /** @type {CatalogAllowlistEntry[]} */
  const prefixEntries = [];
  for (let i = 0; i < playlists.length; i++) {
    const p = playlists[i];
    const name = p.name != null ? String(p.name) : '';
    if (!catalogPlaylistNameStartsWithPrefix(name, prefix, ignoreCase)) continue;
    const oid = p.ownerId != null ? String(p.ownerId) : '';
    if (ownerOnly && catalogSpotifyUserId && oid !== catalogSpotifyUserId) continue;
    const tracksFromList = Math.max(0, Number(p.tracks) || 0);
    prefixEntries.push({ id: String(p.id).trim(), label: name, tracksFromList });
  }

  const mergedMap = new Map();
  for (const e of staticEntries) {
    mergedMap.set(e.id, { id: e.id, ...(e.label ? { label: e.label } : {}) });
  }
  for (const e of prefixEntries) {
    if (!mergedMap.has(e.id)) mergedMap.set(e.id, e);
  }
  /** Enrich static ids with track totals from list rows when the same playlist appears in prefix results. */
  for (const e of prefixEntries) {
    const cur = mergedMap.get(e.id);
    if (
      cur &&
      typeof e.tracksFromList === 'number' &&
      Number.isFinite(e.tracksFromList) &&
      cur.tracksFromList == null
    ) {
      mergedMap.set(e.id, { ...cur, tracksFromList: e.tracksFromList });
    }
  }
  const merged = [...mergedMap.values()];

  catalogAllowlistResolveCache = { key: cacheKey, entries: merged, meta: {}, at: now };
  return { entries: merged, meta: {} };
}

let catalogServiceSingleton = null;

/** When primed at startup, catalog refresh uses these instead of env-only SPOTIFY_* (see TEMPO_CATALOG_SPOTIFY_CREDENTIALS_USER_ID). */
let catalogOrgCredentials = null;

/**
 * Load Spotify Developer app credentials from an organizations row for catalog token refresh only.
 * Resets the catalog service singleton so the next request picks up the new client id/secret.
 * @param {{ clientId: string, clientSecret: string } | null | undefined} creds
 */
function primeCatalogSpotifyCredentialsFromOrg(creds) {
  if (!creds || typeof creds.clientId !== 'string' || typeof creds.clientSecret !== 'string') return;
  const clientId = creds.clientId.trim().replace(/^\uFEFF/, '');
  const clientSecret = creds.clientSecret.trim().replace(/^\uFEFF/, '');
  if (!clientId || !clientSecret) return;
  catalogOrgCredentials = { clientId, clientSecret };
  catalogServiceSingleton = null;
}

function getCatalogSpotifyService() {
  if (!isCatalogFeatureConfigured()) return null;
  if (!catalogServiceSingleton) {
    let resolvedId = '';
    let resolvedSecret = '';
    let credSource = '';

    /** Same `{ clientId, clientSecret }` object path as `multiTenantSpotify.getService('user_<id>')` after tenant prime. */
    const catalogCredUid = Number(process.env.TEMPO_CATALOG_SPOTIFY_CREDENTIALS_USER_ID);
    if (Number.isFinite(catalogCredUid) && catalogCredUid > 0) {
      const o = organizationsStore.getCredentialOptionsForUser(catalogCredUid);
      if (
        o &&
        typeof o.clientId === 'string' &&
        typeof o.clientSecret === 'string' &&
        o.clientId.trim() &&
        o.clientSecret.trim()
      ) {
        resolvedId = o.clientId.trim().replace(/^\uFEFF/, '');
        resolvedSecret = o.clientSecret.trim().replace(/^\uFEFF/, '');
        credSource = `organizations credential map (users.id=${catalogCredUid}, same as host SpotifyService)`;
      }
    }

    if (!resolvedId || !resolvedSecret) {
      if (catalogOrgCredentials && catalogOrgCredentials.clientId && catalogOrgCredentials.clientSecret) {
        resolvedId = catalogOrgCredentials.clientId;
        resolvedSecret = catalogOrgCredentials.clientSecret;
        credSource = 'organizations table startup snapshot (TEMPO_CATALOG_SPOTIFY_CREDENTIALS_USER_ID)';
      } else {
        const ecid = process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_ID;
        const esec = process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET;
        const ecidTrim = ecid && String(ecid).trim() !== '';
        const esecTrim = esec && String(esec).trim() !== '';
        const hasCatalogPair = ecidTrim && esecTrim;
        if (ecidTrim && !esecTrim) {
          console.warn(
            '[catalog] TEMPO_CATALOG_SPOTIFY_CLIENT_ID is set without TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET — falling back to SPOTIFY_* secret or org row; set the catalog secret or omit the catalog client id.'
          );
        }
        if (hasCatalogPair) {
          resolvedId = String(ecid).trim();
          resolvedSecret = String(esec).trim();
          credSource = 'TEMPO_CATALOG_SPOTIFY_CLIENT_ID / TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET';
        } else {
          resolvedId = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
          resolvedSecret = String(process.env.SPOTIFY_CLIENT_SECRET || '').trim();
          credSource = 'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET';
        }
      }
    }

    const catalogSecretOverride = String(process.env.TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET || '')
      .trim()
      .replace(/^\uFEFF/, '');
    if (catalogSecretOverride && resolvedId && catalogSecretOverride !== resolvedSecret) {
      resolvedSecret = catalogSecretOverride;
      credSource = `${credSource} (client secret from TEMPO_CATALOG_SPOTIFY_CLIENT_SECRET override)`;
    }

    if (!resolvedId || !resolvedSecret) {
      console.error(
        '[catalog] Missing Spotify client id or secret for catalog token refresh. Host OAuth may still work via organizations table while GET /api/spotify/catalog/packs fails with invalid_client — set TEMPO_CATALOG_SPOTIFY_CREDENTIALS_USER_ID, or set matching TEMPO_CATALOG_SPOTIFY_CLIENT_* / SPOTIFY_CLIENT_SECRET in env.'
      );
    }

    catalogServiceSingleton =
      resolvedId && resolvedSecret
        ? new SpotifyService({ clientId: resolvedId, clientSecret: resolvedSecret })
        : new SpotifyService();
    if (credSource) {
      console.info(`[catalog] Pack/list token refresh uses ${credSource}`);
    }
    const rt = normalizeCatalogRefreshTokenFromEnv();
    catalogServiceSingleton.setTokens('', rt);
  }
  return catalogServiceSingleton;
}

/** @param {string} playlistId */
async function assertCatalogPlaylistAllowlisted(playlistId) {
  const id = String(playlistId || '').trim();
  const { entries } = await resolveCatalogAllowlistEntries();
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
 * @returns {Promise<{ packs: { id: string, name: string, tracks: number, catalog: true }[], catalogPrefixDiscoverySkipped?: boolean }>}
 */
async function loadCatalogPackSummariesForApi() {
  const { entries, meta } = await resolveCatalogAllowlistEntries();
  const svc = await ensureCatalogAccessToken();
  const out = [];
  let loggedQuarantineBulk = false;
  let loggedQuarantineCatch = false;

  const summaryFromListRow = (entry) => {
    const label = entry.label != null ? String(entry.label).trim() : '';
    const tr = entry.tracksFromList;
    if (!label || typeof tr !== 'number' || !Number.isFinite(tr)) return null;
    return {
      id: entry.id,
      name: label,
      tracks: Math.max(0, Math.floor(tr)),
      catalog: true,
    };
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { id, label } = entry;

    if (svc.isQuarantined()) {
      if (!loggedQuarantineBulk) {
        loggedQuarantineBulk = true;
        console.warn(
          `[catalog] pack summaries: Spotify quarantine active (~${svc.getQuarantineRemainingSec()}s); skipping metadata calls`
        );
      }
      const fromList = summaryFromListRow(entry);
      out.push(
        fromList || {
          id,
          name: label || `Playlist ${id}`,
          tracks: 0,
          catalog: true,
        }
      );
      continue;
    }

    const fromListFirst = summaryFromListRow(entry);
    if (fromListFirst) {
      out.push(fromListFirst);
      continue;
    }

    if (i > 0) {
      await new Promise((r) => setTimeout(r, 400));
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
      const msg = e && e.message ? String(e.message) : String(e);
      const quarantined = msg.includes('quarantined');
      if (quarantined) {
        if (!loggedQuarantineCatch) {
          loggedQuarantineCatch = true;
          console.warn(
            `[catalog] metadata halted (${msg}); ~${svc.getQuarantineRemainingSec()}s quarantine — using list fallbacks for remaining packs`
          );
        }
      } else {
        console.warn(`[catalog] metadata failed for ${id}:`, msg);
      }
      const fromList = summaryFromListRow(entry);
      out.push(
        fromList || {
          id,
          name: label || `Playlist ${id}`,
          tracks: 0,
          catalog: true,
        }
      );
    }
  }
  return {
    packs: out,
    catalogPrefixDiscoverySkipped: meta.prefixSkippedDueToSpotify === true,
  };
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
  isCatalogPublicFetchDisabled,
  getCatalogPackSummariesCacheKey,
  parseCatalogAllowlistEntries,
  resolveCatalogAllowlistEntries,
  loadCatalogPackSummariesForApi,
  fetchCatalogPlaylistTracks,
  assertCatalogPlaylistAllowlisted,
  ensureCatalogAccessToken,
  primeCatalogSpotifyCredentialsFromOrg,
};
