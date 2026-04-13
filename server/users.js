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
  const r = await db.query(
    `INSERT INTO users (google_sub, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email),
       display_name = COALESCE(EXCLUDED.display_name, users.display_name)
     RETURNING id, google_sub, email, display_name, created_at`,
    [googleSub, email || null, displayName || null]
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
  if (!normalizedEmail) return false;
  const envList = (process.env.TEMPO_HOST_ALLOWLIST_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (envList.includes(normalizedEmail)) return true;
  if (!db) return false;
  const r = await db.query('SELECT 1 FROM host_allowlist WHERE email = $1', [normalizedEmail]);
  return r.rows.length > 0;
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
  isApprovedHostsOnlyMode,
  isEmailAllowlistedForHostSignin,
  addHostAllowlistEmail,
  removeHostAllowlistEmail,
  listHostAllowlist,
};
