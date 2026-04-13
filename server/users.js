/**
 * Persistent users (hosts). Requires DATABASE_URL.
 */

async function ensureUsersTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      display_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub)
  `);
  return true;
}

async function upsertUserByGoogle(db, { googleSub, email, displayName }) {
  if (!db) throw new Error('DATABASE_URL is required for host accounts');
  /** Never persist empty string: COALESCE(EXCLUDED.email, users.email) would keep '' and break allowlist checks. */
  const emailClean =
    email && typeof email === 'string' && email.trim() ? email.trim() : null;
  const nameClean =
    displayName && typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null;
  const r = await db.query(
    `INSERT INTO users (google_sub, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email),
       display_name = COALESCE(EXCLUDED.display_name, users.display_name)
     RETURNING id, google_sub, email, display_name, created_at`,
    [googleSub, emailClean, nameClean]
  );
  return r.rows[0];
}

async function getUserById(db, id) {
  if (!db) return null;
  const r = await db.query(
    'SELECT id, google_sub, email, display_name, created_at FROM users WHERE id = $1',
    [id]
  );
  return r.rows[0] || null;
}

function normalizeHostEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Gmail treats j.doe@gmail.com and jdoe@gmail.com as the same inbox. Allowlist matching uses this
 * so an admin can add either form and sign-in still matches Google’s returned address.
 */
function canonicalEmailForAllowlist(email) {
  const n = normalizeHostEmail(email);
  if (!n) return '';
  const at = n.lastIndexOf('@');
  if (at <= 0) return n;
  let local = n.slice(0, at);
  let domain = n.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') {
    const noTag = local.split('+')[0];
    const collapsed = noTag.replace(/\./g, '');
    return `${collapsed}@gmail.com`;
  }
  return n;
}

/** Distinct strings to check against host_allowlist / env (raw + canonical for Gmail). */
function emailAllowlistCandidates(normalizedEmail) {
  const n = normalizeHostEmail(normalizedEmail);
  if (!n) return [];
  const c = canonicalEmailForAllowlist(n);
  if (c && c !== n) return [...new Set([n, c])];
  return [n];
}

async function getUserByGoogleSub(db, googleSub) {
  if (!db || !googleSub) return null;
  const r = await db.query('SELECT id, google_sub, email, display_name, created_at FROM users WHERE google_sub = $1', [
    googleSub,
  ]);
  return r.rows[0] || null;
}

async function ensureHostAllowlistTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS host_allowlist (
      email TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return true;
}

/**
 * When true, only emails on the host allowlist (DB + TEMPO_HOST_ALLOWLIST_EMAILS) may sign in as hosts,
 * create rooms via POST /api/host/rooms, or join a socket as host. Set TEMPO_APPROVED_HOSTS_ONLY=1.
 */
function isApprovedHostsOnlyMode() {
  const v = (process.env.TEMPO_APPROVED_HOSTS_ONLY || '').trim();
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

/** Emails listed in TEMPO_HOST_ALLOWLIST_EMAILS (comma-separated) or host_allowlist table. */
async function isEmailAllowlistedForHostSignin(db, normalizedEmail) {
  const candidates = emailAllowlistCandidates(normalizedEmail);
  if (candidates.length === 0) return false;
  const userCanon = canonicalEmailForAllowlist(normalizedEmail);

  const envList = (process.env.TEMPO_HOST_ALLOWLIST_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const e of envList) {
    if (candidates.includes(e)) return true;
    if (userCanon && canonicalEmailForAllowlist(e) === userCanon) return true;
  }
  if (!db) return false;
  const r = await db.query('SELECT 1 FROM host_allowlist WHERE email = ANY($1::text[])', [candidates]);
  if (r.rows.length > 0) return true;
  /** DB rows may use a different Gmail spelling than Google returns — compare canonical forms. */
  const all = await db.query('SELECT email FROM host_allowlist');
  for (const row of all.rows) {
    if (userCanon && canonicalEmailForAllowlist(row.email) === userCanon) return true;
  }
  return false;
}

/**
 * True if any of the provided emails (JWT claim, users.email, etc.) matches the host allowlist.
 * Use this for session checks so old JWTs without `eml` still work when DB email matches, and
 * Workspace/OAuth vs stored email quirks are covered as long as one spelling is allowlisted.
 */
async function isEmailAllowlistedForHostUser(db, ...emails) {
  const seen = new Set();
  for (const raw of emails) {
    const n = normalizeHostEmail(typeof raw === 'string' ? raw : '');
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (await isEmailAllowlistedForHostSignin(db, n)) return true;
  }
  return false;
}

async function addHostAllowlistEmail(db, normalizedEmail) {
  if (!db) throw new Error('DATABASE_URL is required');
  await ensureHostAllowlistTable(db);
  const r = await db.query(
    `INSERT INTO host_allowlist (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING email, created_at`,
    [normalizedEmail]
  );
  return r.rows[0];
}

async function removeHostAllowlistEmail(db, normalizedEmail) {
  if (!db) throw new Error('DATABASE_URL is required');
  await ensureHostAllowlistTable(db);
  const r = await db.query('DELETE FROM host_allowlist WHERE email = $1 RETURNING email', [normalizedEmail]);
  return r.rows[0] || null;
}

async function listHostAllowlist(db) {
  if (!db) return [];
  await ensureHostAllowlistTable(db);
  const r = await db.query('SELECT email, created_at FROM host_allowlist ORDER BY email ASC');
  return r.rows;
}

module.exports = {
  ensureUsersTable,
  ensureHostAllowlistTable,
  upsertUserByGoogle,
  getUserById,
  getUserByGoogleSub,
  normalizeHostEmail,
  canonicalEmailForAllowlist,
  emailAllowlistCandidates,
  isApprovedHostsOnlyMode,
  isEmailAllowlistedForHostSignin,
  isEmailAllowlistedForHostUser,
  addHostAllowlistEmail,
  removeHostAllowlistEmail,
  listHostAllowlist,
};
