/**
 * LK-owned “catalog” Spotify account reads playlist /items on the server so hosts can use packs
 * they don’t own (follow-only lists fail GET …/items with the host token per Spotify rules).
 *
 * Env:
 * - TEMPO_CATALOG_SPOTIFY_REFRESH_TOKEN (required if catalog used)
 * - TEMPO_CATALOG_PLAYLIST_IDS — comma-separated Spotify playlist ids, OR
 * - TEMPO_CATALOG_PLAYLISTS_JSON — e.g. [{"id":"abc","label":"Pack name"}] (label optional)
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

function isCatalogFeatureConfigured() {
  return hasCatalogRefreshToken() && parseCatalogAllowlistEntries().length > 0;
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
function assertCatalogPlaylistAllowlisted(playlistId) {
  const id = String(playlistId || '').trim();
  const allowed = new Set(parseCatalogAllowlistEntries().map((e) => e.id));
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
  const entries = parseCatalogAllowlistEntries();
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
  assertCatalogPlaylistAllowlisted(playlistId);
  const svc = await ensureCatalogAccessToken();
  return svc.getPlaylistTracks(String(playlistId).trim(), playlistInfo);
}

module.exports = {
  isCatalogFeatureConfigured,
  parseCatalogAllowlistEntries,
  loadCatalogPackSummariesForApi,
  fetchCatalogPlaylistTracks,
  assertCatalogPlaylistAllowlisted,
};
