/**
 * Enterprise tenants: each organization may use its own Spotify Developer app (client id + secret).
 * By default, secrets in `spotify_client_secret_encrypted` are encrypted with TEMPO_ORG_CREDENTIALS_KEY.
 * For local/diagnostic use only, set TEMPO_ORG_PLAINTEXT_SECRETS=1 to read/write that column as raw
 * text (no encryption). Revert to encrypted storage in production; do not commit secrets.
 */

const credentialCrypto = require('./credentialCrypto');
const spotifyPipelineLog = require('./spotifyPipelineLog');

/**
 * When true, `spotify_client_secret_encrypted` holds the literal client secret (misnamed column).
 * Default off. Unsafe on shared or production DBs.
 */
function orgPlaintextSecretsMode() {
  const v = String(process.env.TEMPO_ORG_PLAINTEXT_SECRETS || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

if (orgPlaintextSecretsMode()) {
  console.warn(
    '[organizations] TEMPO_ORG_PLAINTEXT_SECRETS is on: org Spotify client secrets are stored and read as PLAINTEXT. Turn this off as soon as diagnosis is done.'
  );
}

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
  if (spotifyPipelineLog.isEnabled()) {
    const orgRow = creds
      ? {
          host_user_id: String(uid),
          source: 'organizations_table',
          spotify_client_id_prefix: spotifyPipelineLog.clientIdPrefix(creds.clientId),
          secret_len: String(creds.clientSecret != null ? creds.clientSecret.length : 0),
        }
      : { host_user_id: String(uid), source: 'server_env_SPOTIFY_CLIENT_ID', server_client_id_prefix: spotifyPipelineLog.clientIdPrefix(process.env.SPOTIFY_CLIENT_ID) };
    spotifyPipelineLog.log('prime_credentials_applied', orgRow);
  }
  credentialOptionsByUserId.set(uid, creds);
  if (multiTenantSpotify && typeof multiTenantSpotify.invalidateUserService === 'function') {
    if (spotifyPipelineLog.isEnabled()) {
      spotifyPipelineLog.log('invalidate_spotify_service_cache', { host_user_id: String(uid) });
    }
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
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS venue_settings JSONB DEFAULT '{}'::jsonb
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
  const raw = row.spotify_client_secret_encrypted;
  let secret;
  if (orgPlaintextSecretsMode()) {
    secret = String(raw == null ? '' : raw).trim();
    if (!secret) {
      console.error(`organizations: empty Spotify client secret in DB for user ${userId} (plaintext mode)`);
      return null;
    }
  } else {
    secret = credentialCrypto.decryptSecret(raw);
    if (!secret) {
      console.error(
        `organizations: could not decrypt Spotify secret for user ${userId} — check TEMPO_ORG_CREDENTIALS_KEY, or TEMPO_ORG_PLAINTEXT_SECRETS=1 only for diagnosis with a plaintext value in the column`
      );
      return null;
    }
  }
  const clientId = String(row.spotify_client_id || '').trim().replace(/^\uFEFF/, '');
  const clientSecret = String(secret || '')
    .replace(/^\uFEFF/, '')
    .trim();
  return {
    clientId,
    clientSecret,
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
  const enc = orgPlaintextSecretsMode() ? csec : credentialCrypto.encryptSecret(csec);
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

const MAX_VENUE = {
  eventTitle: 120,
  sponsorLine: 200,
  footerText: 500,
};

function trimStr(s, max) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) : t;
}

function sanitizeHttpUrl(s, maxLen) {
  const t = trimStr(s, maxLen);
  if (!t) return '';
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return '';
    return u.href.split('?')[0].slice(0, maxLen);
  } catch {
    return '';
  }
}

/** Logo: absolute http(s) URL, protocol-relative //..., or same-origin path /uploads/.... */
function sanitizeLogoUrl(s, maxLen) {
  const http = sanitizeHttpUrl(s, maxLen);
  if (http) return http;
  const t = trimStr(String(s == null ? '' : s), maxLen);
  if (!t) return '';
  if (t.startsWith('/') && !t.startsWith('//') && !t.includes('..')) {
    return t.split('?')[0].slice(0, maxLen);
  }
  if (t.startsWith('//') && t.length > 2) {
    try {
      const u = new URL(`https:${t}`);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        if (u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return '';
        return u.href.split('?')[0].slice(0, maxLen);
      }
    } catch {
      return '';
    }
  }
  return '';
}

function sanitizeHexColor(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  if (/^#[0-9a-fA-F]{3}$/.test(t)) return t.toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  return '';
}

function sanitizeVenueSettings(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const defSnippet = o.defaultSnippetLength;
  const volCap = o.volumeCap;
  const rawLogo = o.logoUrl ?? o.logo_url ?? o.logoURI ?? o.logo;
  let dsl = defSnippet == null || defSnippet === '' ? null : parseInt(String(defSnippet), 10);
  if (!Number.isFinite(dsl)) dsl = null;
  else dsl = Math.min(120, Math.max(5, dsl));
  let vc = volCap == null || volCap === '' ? null : parseInt(String(volCap), 10);
  if (!Number.isFinite(vc)) vc = null;
  else vc = Math.min(100, Math.max(1, vc));
  return {
    eventTitle: trimStr(o.eventTitle, MAX_VENUE.eventTitle),
    sponsorLine: trimStr(o.sponsorLine, MAX_VENUE.sponsorLine),
    footerText: trimStr(o.footerText, MAX_VENUE.footerText),
    runbookUrl: sanitizeHttpUrl(o.runbookUrl, 2000),
    logoUrl: sanitizeLogoUrl(rawLogo, 2000),
    primaryColor: sanitizeHexColor(o.primaryColor),
    accentColor: sanitizeHexColor(o.accentColor),
    defaultSnippetLength: dsl,
    volumeCap: vc,
  };
}

function venueBrandingPayloadFromSettings(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if (s.eventTitle) out.eventTitle = s.eventTitle;
  if (s.sponsorLine) out.sponsorLine = s.sponsorLine;
  if (s.footerText) out.footerText = s.footerText;
  if (s.runbookUrl) out.runbookUrl = s.runbookUrl;
  if (s.logoUrl) out.logoUrl = s.logoUrl;
  if (s.primaryColor) out.primaryColor = s.primaryColor;
  if (s.accentColor) out.accentColor = s.accentColor;
  if (s.defaultSnippetLength != null) out.defaultSnippetLength = s.defaultSnippetLength;
  if (s.volumeCap != null) out.volumeCap = s.volumeCap;
  return Object.keys(out).length ? out : null;
}

async function getVenueSettingsRow(db, orgId) {
  const r = await db.query('SELECT venue_settings FROM organizations WHERE id = $1', [orgId]);
  if (r.rows.length === 0) return null;
  const raw = r.rows[0].venue_settings;
  if (raw == null || raw === undefined) return sanitizeVenueSettings({});
  if (typeof raw === 'string') {
    try {
      return sanitizeVenueSettings(JSON.parse(raw));
    } catch {
      return sanitizeVenueSettings({});
    }
  }
  return sanitizeVenueSettings(raw);
}

async function getOrganizationById(db, id) {
  if (!db) return null;
  await ensureOrganizationsTable(db);
  const r = await db.query(
    `SELECT id, name, spotify_client_id, created_at, venue_settings FROM organizations WHERE id = $1`,
    [id]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    name: row.name,
    spotify_client_id: row.spotify_client_id,
    created_at: row.created_at,
    venueSettings: sanitizeVenueSettings(row.venue_settings),
  };
}

async function patchOrganizationVenueSettings(db, orgId, patch) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureOrganizationsTable(db);
  const exists = await db.query('SELECT 1 FROM organizations WHERE id = $1', [orgId]);
  if (exists.rows.length === 0) throw new Error('organization not found');
  const current = await getVenueSettingsRow(db, orgId);
  const merged = sanitizeVenueSettings({ ...(current || {}), ...(patch && typeof patch === 'object' ? patch : {}) });
  await db.query(`UPDATE organizations SET venue_settings = $2::jsonb WHERE id = $1`, [orgId, JSON.stringify(merged)]);
  return merged;
}

async function getVenueBrandingContextForHostUserId(db, userId) {
  if (!db || userId == null) return { branding: null, orgId: null };
  await ensureOrganizationsTable(db);
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return { branding: null, orgId: null };
  const r = await db.query(
    `SELECT u.organization_id AS org_id, o.venue_settings
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [uid]
  );
  if (r.rows.length === 0) {
    console.warn(`[venue-branding] no users row for host user id ${uid} (JWT sub must match users.id)`);
    return { branding: null, orgId: null };
  }
  const { org_id: orgId, venue_settings: vs } = r.rows[0];
  if (orgId == null) {
    console.warn(
      `[venue-branding] host user id ${uid} has organization_id NULL — in Admin assign this user to organization id with your logo (e.g. 1)`
    );
    return { branding: null, orgId: null };
  }
  if (vs == null) {
    console.warn(
      `[venue-branding] host user id ${uid} points to organization ${orgId} but venue_settings is missing (data issue)`
    );
    return { branding: null, orgId: null };
  }
  const merged = sanitizeVenueSettings(vs);
  const payload = venueBrandingPayloadFromSettings(merged);
  if (!payload) {
    console.warn(
      `[venue-branding] organization ${orgId} (user ${uid}) has no displayable fields after sanitize — check logoUrl is https or /path`
    );
  }
  return { branding: payload || null, orgId };
}

async function getVenueBrandingForHostUserId(db, userId) {
  const { branding } = await getVenueBrandingContextForHostUserId(db, userId);
  return branding;
}

module.exports = {
  ensureOrganizationsTable,
  getCredentialsForUserId,
  getCredentialOptionsForUser,
  primeTenantSpotifyCredentials,
  listOrganizations,
  createOrganization,
  setUserOrganizationId,
  getOrganizationById,
  patchOrganizationVenueSettings,
  getVenueBrandingContextForHostUserId,
  getVenueBrandingForHostUserId,
};
