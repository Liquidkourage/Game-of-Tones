/**
 * Enterprise tenants: each organization may use its own Spotify Developer app (client id + secret).
 * Secrets are encrypted at rest when TEMPO_ORG_CREDENTIALS_KEY is set.
 */

const credentialCrypto = require('./credentialCrypto');

/** uid -> { clientId, clientSecret } | null (primed: use env) | missing (not primed yet) */
const credentialOptionsByUserId = new Map();

function getCredentialOptionsForUser(uid) {
  if (uid == null) return undefined;
  if (!credentialOptionsByUserId.has(uid)) return undefined;
  const v = credentialOptionsByUserId.get(uid);
  if (v === null) return null;
  return { clientId: v.clientId, clientSecret: v.clientSecret };
}

/**
 * Load org Spotify app credentials for this host user and invalidate cached SpotifyService if they changed.
 */
async function primeTenantSpotifyCredentials(db, multiTenantSpotify, uid) {
  if (uid == null || !db) return;
  const creds = await getCredentialsForUserId(db, uid);
  const fp = creds ? `${creds.clientId}:${creds.clientSecret.length}` : 'env';
  const prev = credentialOptionsByUserId.get(uid);
  const prevFp = prev === null ? 'env' : prev && typeof prev === 'object' ? `${prev.clientId}:${prev.clientSecret.length}` : undefined;
  if (prevFp === fp && credentialOptionsByUserId.has(uid)) return;
  credentialOptionsByUserId.set(uid, creds);
  if (multiTenantSpotify && typeof multiTenantSpotify.invalidateUserService === 'function') {
    multiTenantSpotify.invalidateUserService(uid);
  }
}

async function ensureOrganizationsTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      spotify_client_id TEXT NOT NULL,
      spotify_client_secret_encrypted TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users (organization_id)
  `);
  return true;
}

/**
 * Raw Spotify app credentials for a host user (from their org), or null to use server env SPOTIFY_*.
 */
async function getCredentialsForUserId(db, userId) {
  if (!db || userId == null) return null;
  const r = await db.query(
    `SELECT o.spotify_client_id, o.spotify_client_secret_encrypted
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [userId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const secret = credentialCrypto.decryptSecret(row.spotify_client_secret_encrypted);
  if (!secret) {
    console.error(
      `organizations: could not decrypt Spotify secret for user ${userId} — check TEMPO_ORG_CREDENTIALS_KEY`
    );
    return null;
  }
  return {
    clientId: String(row.spotify_client_id || '').trim(),
    clientSecret: secret,
  };
}

async function listOrganizations(db) {
  if (!db) return [];
  await ensureOrganizationsTable(db);
  const r = await db.query(
    'SELECT id, name, spotify_client_id, created_at FROM organizations ORDER BY id ASC'
  );
  return r.rows;
}

async function createOrganization(db, { name, spotifyClientId, spotifyClientSecret }) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureOrganizationsTable(db);
  const n = String(name || '').trim();
  const cid = String(spotifyClientId || '').trim();
  const csec = String(spotifyClientSecret || '').trim();
  if (!n || !cid || !csec) {
    throw new Error('name, spotifyClientId, and spotifyClientSecret are required');
  }
  const enc = credentialCrypto.encryptSecret(csec);
  const r = await db.query(
    `INSERT INTO organizations (name, spotify_client_id, spotify_client_secret_encrypted)
     VALUES ($1, $2, $3)
     RETURNING id, name, spotify_client_id, created_at`,
    [n, cid, enc]
  );
  return r.rows[0];
}

async function setUserOrganizationId(db, userId, organizationId) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureOrganizationsTable(db);
  if (organizationId == null) {
    await db.query('UPDATE users SET organization_id = NULL WHERE id = $1', [userId]);
    return { ok: true, userId, organizationId: null };
  }
  const check = await db.query('SELECT 1 FROM organizations WHERE id = $1', [organizationId]);
  if (check.rows.length === 0) throw new Error('organization not found');
  await db.query('UPDATE users SET organization_id = $2 WHERE id = $1', [userId, organizationId]);
  return { ok: true, userId, organizationId };
}

module.exports = {
  ensureOrganizationsTable,
  getCredentialsForUserId,
  getCredentialOptionsForUser,
  primeTenantSpotifyCredentials,
  listOrganizations,
  createOrganization,
  setUserOrganizationId,
};
