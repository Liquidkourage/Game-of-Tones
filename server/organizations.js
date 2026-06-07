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
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id)
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'none'
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS lifetime_paid_cents BIGINT NOT NULL DEFAULT 0
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMP
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none'
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMP
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_price_id TEXT
  `);
  try {
    await db.query(`ALTER TABLE organizations ALTER COLUMN spotify_client_id DROP NOT NULL`);
  } catch {
    /* already nullable */
  }
  try {
    await db.query(`ALTER TABLE organizations ALTER COLUMN spotify_client_secret_encrypted DROP NOT NULL`);
  } catch {
    /* already nullable */
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS org_host_invites (
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      invited_by_user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, email)
    )
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
  const clientIdRaw = row.spotify_client_id;
  if (clientIdRaw == null || String(clientIdRaw).trim() === '') return null;
  const raw = row.spotify_client_secret_encrypted;
  if (raw == null || String(raw).trim() === '') return null;
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

function orgRowToSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    spotify_client_id: row.spotify_client_id,
    created_at: row.created_at,
    owner_user_id: row.owner_user_id ?? null,
    billing_status: row.billing_status || 'none',
    lifetime_paid_cents: Number(row.lifetime_paid_cents) || 0,
    last_payment_at: row.last_payment_at || null,
    subscription_status: row.subscription_status || 'none',
    subscription_period_end: row.subscription_period_end || null,
    subscription_price_id: row.subscription_price_id || null,
    subscription_tier: row.subscription_tier || 'none',
    trial_ends_at: row.trial_ends_at || null,
    subscription_paused_at: row.subscription_paused_at || null,
    venueSettings: sanitizeVenueSettings(row.venue_settings),
  };
}

async function getOrganizationById(db, id) {
  if (!db) return null;
  await ensureOrganizationsTable(db);
  const r = await db.query(
    `SELECT id, name, spotify_client_id, created_at, venue_settings,
            owner_user_id, billing_status, lifetime_paid_cents, last_payment_at,
            subscription_status, subscription_period_end, subscription_price_id,
            subscription_tier, trial_ends_at, subscription_paused_at
     FROM organizations WHERE id = $1`,
    [id]
  );
  if (r.rows.length === 0) return null;
  return orgRowToSummary(r.rows[0]);
}

function sameUserId(a, b) {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

/**
 * Orgs created in Admin (or before owner_user_id existed) may have owner_user_id NULL.
 * Sole remaining member is treated as owner and persisted so billing/invites unlock.
 */
async function resolveOrganizationRole(db, organizationId, userId) {
  const orgId = Number(organizationId);
  const uid = Number(userId);
  if (!Number.isFinite(orgId) || !Number.isFinite(uid)) return 'host';
  const r = await db.query(
    `SELECT owner_user_id FROM organizations WHERE id = $1`,
    [orgId]
  );
  if (r.rows.length === 0) return 'host';
  const ownerId = r.rows[0].owner_user_id;
  if (ownerId != null && sameUserId(ownerId, uid)) return 'owner';
  if (ownerId != null) return 'host';

  const members = await db.query(
    `SELECT id FROM users WHERE organization_id = $1 ORDER BY id ASC`,
    [orgId]
  );
  if (members.rows.length === 1 && sameUserId(members.rows[0].id, uid)) {
    await db.query(`UPDATE organizations SET owner_user_id = $2 WHERE id = $1 AND owner_user_id IS NULL`, [
      orgId,
      uid,
    ]);
    return 'owner';
  }
  return 'host';
}

async function getUserOrganizationContext(db, userId) {
  if (!db || userId == null) return { organization: null, role: null, membership: null };
  await ensureOrganizationsTable(db);
  const uid = Number(userId);
  const u = await db.query(
    'SELECT id, email, display_name, organization_id FROM users WHERE id = $1',
    [uid]
  );
  if (u.rows.length === 0) return { organization: null, role: null, membership: null };
  const user = u.rows[0];
  if (user.organization_id == null) {
    const owned = await db.query(
      `SELECT id, name, spotify_client_id, created_at, venue_settings,
              owner_user_id, billing_status, lifetime_paid_cents, last_payment_at,
              subscription_status, subscription_period_end, subscription_price_id,
              subscription_tier, trial_ends_at, subscription_paused_at
       FROM organizations WHERE owner_user_id = $1 ORDER BY id ASC LIMIT 1`,
      [uid]
    );
    if (owned.rows.length > 0) {
      return {
        organization: orgRowToSummary(owned.rows[0]),
        role: 'owner',
        membership: { userId: user.id, email: user.email, organizationId: owned.rows[0].id },
      };
    }
    return { organization: null, role: null, membership: null };
  }
  const orgId = user.organization_id;
  const role = await resolveOrganizationRole(db, orgId, uid);
  const org = await getOrganizationById(db, orgId);
  if (org && role === 'owner' && org.owner_user_id == null) {
    org.owner_user_id = uid;
  }
  return {
    organization: org,
    role,
    membership: { userId: user.id, email: user.email, organizationId: orgId },
  };
}

async function createSelfServeOrganization(db, { name, ownerUserId }) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureOrganizationsTable(db);
  const n = String(name || '').trim();
  if (!n || n.length < 2) throw new Error('Organization name is required (at least 2 characters)');
  const uid = Number(ownerUserId);
  if (!Number.isFinite(uid)) throw new Error('ownerUserId is required');

  const existing = await db.query('SELECT organization_id FROM users WHERE id = $1', [uid]);
  if (existing.rows.length === 0) throw new Error('user not found');
  if (existing.rows[0].organization_id != null) {
    throw new Error('You are already part of an organization');
  }
  const owned = await db.query('SELECT id FROM organizations WHERE owner_user_id = $1 LIMIT 1', [uid]);
  if (owned.rows.length > 0) {
    throw new Error('You already own an organization');
  }

  const usersStore = require('./users');
  const ownerRow = await usersStore.getUserById(db, uid);
  const ownerEmail = usersStore.normalizeHostEmail(ownerRow?.email || '');

  const r = await db.query(
    `INSERT INTO organizations (name, spotify_client_id, spotify_client_secret_encrypted, owner_user_id)
     VALUES ($1, NULL, NULL, $2)
     RETURNING id, name, spotify_client_id, created_at, venue_settings,
               owner_user_id, billing_status, lifetime_paid_cents, last_payment_at,
               subscription_status, subscription_period_end, subscription_price_id`,
    [n, uid]
  );
  const org = orgRowToSummary(r.rows[0]);
  await db.query('UPDATE users SET organization_id = $2 WHERE id = $1', [uid, org.id]);
  if (ownerEmail) {
    await usersStore.addHostAllowlistEmail(db, ownerEmail);
  }
  return org;
}

async function isOrganizationOwner(db, userId, organizationId) {
  if (!db || userId == null || organizationId == null) return false;
  await ensureOrganizationsTable(db);
  const role = await resolveOrganizationRole(db, organizationId, userId);
  return role === 'owner';
}

/** Explicit claim when org has no owner yet (e.g. multiple members after Admin setup). */
async function claimOrganizationOwnership(db, userId, organizationId) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureOrganizationsTable(db);
  const uid = Number(userId);
  const orgId = Number(organizationId);
  if (!Number.isFinite(uid) || !Number.isFinite(orgId)) throw new Error('Invalid user or organization');

  const u = await db.query('SELECT organization_id FROM users WHERE id = $1', [uid]);
  if (u.rows.length === 0 || Number(u.rows[0].organization_id) !== orgId) {
    throw new Error('You must belong to this organization to claim ownership');
  }

  const org = await db.query('SELECT owner_user_id FROM organizations WHERE id = $1', [orgId]);
  if (org.rows.length === 0) throw new Error('organization not found');
  if (org.rows[0].owner_user_id != null) {
    if (sameUserId(org.rows[0].owner_user_id, uid)) return { ok: true, organizationId: orgId, role: 'owner' };
    throw new Error('This organization already has an owner');
  }

  const members = await db.query('SELECT id FROM users WHERE organization_id = $1', [orgId]);
  if (members.rows.length === 1 && sameUserId(members.rows[0].id, uid)) {
    await db.query('UPDATE organizations SET owner_user_id = $2 WHERE id = $1', [orgId, uid]);
    return { ok: true, organizationId: orgId, role: 'owner' };
  }

  throw new Error(
    'Ownership is not set yet. If you are the venue lead, ask your platform admin to set owner_user_id, or be the only member to auto-claim.'
  );
}

async function listOrganizationMembers(db, organizationId) {
  if (!db || organizationId == null) return [];
  await ensureOrganizationsTable(db);
  const r = await db.query(
    `SELECT id, email, display_name, created_at
     FROM users
     WHERE organization_id = $1
     ORDER BY id ASC`,
    [organizationId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  }));
}

async function listOrganizationInvites(db, organizationId) {
  if (!db || organizationId == null) return [];
  await ensureOrganizationsTable(db);
  const r = await db.query(
    `SELECT email, invited_by_user_id, created_at
     FROM org_host_invites
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId]
  );
  return r.rows;
}

async function inviteHostToOrganization(db, { organizationId, email, invitedByUserId }) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureOrganizationsTable(db);
  const usersStore = require('./users');
  const norm = usersStore.normalizeHostEmail(email);
  if (!norm || !norm.includes('@')) throw new Error('Valid email is required');
  const orgId = Number(organizationId);
  if (!Number.isFinite(orgId)) throw new Error('organizationId is required');

  await db.query(
    `INSERT INTO org_host_invites (organization_id, email, invited_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, email) DO UPDATE SET invited_by_user_id = EXCLUDED.invited_by_user_id`,
    [orgId, norm, invitedByUserId ?? null]
  );
  await usersStore.addHostAllowlistEmail(db, norm);

  const existingUser = await db.query(
    'SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
    [norm]
  );
  if (existingUser.rows.length > 0) {
    await db.query('UPDATE users SET organization_id = $2 WHERE id = $1', [
      existingUser.rows[0].id,
      orgId,
    ]);
  }
  return { email: norm, organizationId: orgId };
}

async function removeOrganizationInvite(db, { organizationId, email }) {
  if (!db) throw new Error('DATABASE_URL required');
  const usersStore = require('./users');
  const norm = usersStore.normalizeHostEmail(email);
  await db.query('DELETE FROM org_host_invites WHERE organization_id = $1 AND email = $2', [
    organizationId,
    norm,
  ]);
  return { removed: true, email: norm };
}

/** After Google sign-in: attach user to org if they were invited. */
async function applyPendingInvitesForUser(db, userId, email) {
  if (!db || userId == null) return null;
  await ensureOrganizationsTable(db);
  const usersStore = require('./users');
  const norm = usersStore.normalizeHostEmail(email || '');
  if (!norm) return null;

  const u = await db.query('SELECT organization_id FROM users WHERE id = $1', [userId]);
  if (u.rows.length === 0) return null;
  if (u.rows[0].organization_id != null) return u.rows[0].organization_id;

  const candidates = usersStore.emailAllowlistCandidates(norm);
  const inv = await db.query(
    `SELECT organization_id FROM org_host_invites
     WHERE email = ANY($1::text[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [candidates.length ? candidates : [norm]]
  );
  if (inv.rows.length === 0) return null;
  const orgId = inv.rows[0].organization_id;
  await db.query('UPDATE users SET organization_id = $2 WHERE id = $1', [userId, orgId]);
  await usersStore.addHostAllowlistEmail(db, norm);
  return orgId;
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
  createSelfServeOrganization,
  setUserOrganizationId,
  getOrganizationById,
  getUserOrganizationContext,
  isOrganizationOwner,
  claimOrganizationOwnership,
  listOrganizationMembers,
  listOrganizationInvites,
  inviteHostToOrganization,
  removeOrganizationInvite,
  applyPendingInvitesForUser,
  patchOrganizationVenueSettings,
  getVenueBrandingContextForHostUserId,
  getVenueBrandingForHostUserId,
};
