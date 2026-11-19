/**
 * Platform (system-wide) Spotify Developer app — used by hosts who are not on a
 * tenant-specific Spotify client (allowlisted on Jay's / default API).
 *
 * Prefer Admin-saved DB credentials when present; otherwise Railway env
 * SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.
 * Secrets encrypted with TEMPO_ORG_CREDENTIALS_KEY (same as tenant org secrets).
 */

const credentialCrypto = require('./credentialCrypto');
const spotifyPipelineLog = require('./spotifyPipelineLog');

/** @type {{ clientId: string, clientSecret: string, source: 'db' | 'env', updatedAt?: string | null } | null} */
let effectiveCache = null;
let tableReady = false;

function envCredentials() {
  const clientId = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  return {
    clientId,
    clientSecret,
    source: /** @type {'env'} */ ('env'),
    updatedAt: null,
  };
}

async function ensureTable(db) {
  if (!db || tableReady) return !!db;
  await db.query(`
    CREATE TABLE IF NOT EXISTS platform_spotify_app (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      client_id TEXT NOT NULL,
      client_secret_encrypted TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_user_id INTEGER
    )
  `);
  tableReady = true;
  return true;
}

/**
 * Reload cache from DB (falls back to env if no row / decrypt failure).
 * @param {import('pg').Pool | null | undefined} db
 */
async function refreshFromDb(db) {
  const fallback = envCredentials();
  if (!db) {
    effectiveCache = fallback.clientId && fallback.clientSecret ? fallback : fallback;
    return getEffectiveCredentials();
  }
  try {
    await ensureTable(db);
    const r = await db.query(
      `SELECT client_id, client_secret_encrypted, updated_at FROM platform_spotify_app WHERE id = 1`
    );
    const row = r.rows[0];
    if (!row) {
      effectiveCache = fallback;
      return getEffectiveCredentials();
    }
    const clientId = String(row.client_id || '').trim();
    const secret = credentialCrypto.decryptSecret(row.client_secret_encrypted);
    if (!clientId || !secret) {
      console.warn(
        '[platformSpotify] DB row present but decrypt/client id failed — using SPOTIFY_CLIENT_* env. Check TEMPO_ORG_CREDENTIALS_KEY.'
      );
      effectiveCache = fallback;
      return getEffectiveCredentials();
    }
    effectiveCache = {
      clientId,
      clientSecret: secret,
      source: 'db',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
    return getEffectiveCredentials();
  } catch (e) {
    console.error('[platformSpotify] refreshFromDb failed:', e?.message || e);
    effectiveCache = fallback;
    return getEffectiveCredentials();
  }
}

/**
 * Credentials for hosts without a tenant Spotify app.
 * Sync — uses last refreshFromDb / env.
 */
function getEffectiveCredentials() {
  if (
    effectiveCache &&
    effectiveCache.clientId &&
    effectiveCache.clientSecret
  ) {
    return effectiveCache;
  }
  return envCredentials();
}

function getEffectiveClientId() {
  return getEffectiveCredentials().clientId || '';
}

function getEffectiveClientSecret() {
  return getEffectiveCredentials().clientSecret || '';
}

/**
 * Admin status (never returns the secret).
 */
function getAdminStatus() {
  const eff = getEffectiveCredentials();
  const env = envCredentials();
  return {
    source: eff.source,
    clientId: eff.source === 'db' ? eff.clientId : env.clientId || '',
    clientIdPrefix: spotifyPipelineLog.clientIdPrefix(eff.clientId),
    hasSecret: !!(eff.clientSecret && eff.clientSecret.length > 0),
    updatedAt: eff.source === 'db' ? eff.updatedAt || null : null,
    encryptionKeyConfigured: credentialCrypto.isOrgCredentialsKeyConfigured(),
    envClientIdPrefix: spotifyPipelineLog.clientIdPrefix(env.clientId),
    usingDbOverride: eff.source === 'db',
  };
}

/**
 * Upsert platform app. Empty secret keeps existing DB secret when row exists.
 * @returns {Promise<ReturnType<typeof getAdminStatus>>}
 */
async function savePlatformCredentials(db, { clientId, clientSecret, updatedByUserId }) {
  if (!db) throw new Error('database_required');
  if (!credentialCrypto.isOrgCredentialsKeyConfigured()) {
    throw new Error(
      'TEMPO_ORG_CREDENTIALS_KEY is required to store platform Spotify secrets (64 hex chars).'
    );
  }
  const cid = String(clientId || '').trim();
  if (!cid || cid.length < 8) {
    throw new Error('client_id_required');
  }
  await ensureTable(db);
  const existing = await db.query(
    `SELECT client_secret_encrypted FROM platform_spotify_app WHERE id = 1`
  );
  let secretPlain = String(clientSecret || '').trim();
  if (!secretPlain) {
    if (!existing.rows[0]) {
      throw new Error('client_secret_required');
    }
    const prev = credentialCrypto.decryptSecret(existing.rows[0].client_secret_encrypted);
    if (!prev) throw new Error('client_secret_required_reenter');
    secretPlain = prev;
  }
  const enc = credentialCrypto.encryptSecret(secretPlain);
  await db.query(
    `
    INSERT INTO platform_spotify_app (id, client_id, client_secret_encrypted, updated_at, updated_by_user_id)
    VALUES (1, $1, $2, NOW(), $3)
    ON CONFLICT (id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      client_secret_encrypted = EXCLUDED.client_secret_encrypted,
      updated_at = NOW(),
      updated_by_user_id = EXCLUDED.updated_by_user_id
    `,
    [cid, enc, updatedByUserId != null ? updatedByUserId : null]
  );
  await refreshFromDb(db);
  if (spotifyPipelineLog.isEnabled()) {
    spotifyPipelineLog.log('platform_spotify_credentials_saved', {
      client_id_prefix: spotifyPipelineLog.clientIdPrefix(cid),
      updated_by_user_id: updatedByUserId != null ? String(updatedByUserId) : 'n/a',
    });
  }
  return getAdminStatus();
}

/**
 * Remove DB override — fall back to Railway env.
 */
async function clearPlatformCredentials(db) {
  if (!db) throw new Error('database_required');
  await ensureTable(db);
  await db.query(`DELETE FROM platform_spotify_app WHERE id = 1`);
  effectiveCache = envCredentials();
  return getAdminStatus();
}

module.exports = {
  ensureTable,
  refreshFromDb,
  getEffectiveCredentials,
  getEffectiveClientId,
  getEffectiveClientSecret,
  getAdminStatus,
  savePlatformCredentials,
  clearPlatformCredentials,
};
