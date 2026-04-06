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

module.exports = {
  ensureUsersTable,
  upsertUserByGoogle,
  getUserById,
};
