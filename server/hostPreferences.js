/**
 * Persist saved host preferences (snippet/projector defaults, title flags) per Tempo account —
 * survives browser site-data clears and follows the host across devices.
 * Requires DATABASE_URL and users table (host JWT maps to users.id).
 */

const GAME_LAYOUTS = new Set(['classic', 'focus', 'transport', 'compact', 'show_desk']);

/**
 * Clamp known preference fields before store/return. Unknown keys are preserved
 * so older/newer clients can round-trip extras safely.
 */
function sanitizePreferencesPayload(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = { ...raw };
  if (Object.prototype.hasOwnProperty.call(out, 'gameLayout')) {
    out.gameLayout = GAME_LAYOUTS.has(out.gameLayout) ? out.gameLayout : 'classic';
  }
  return out;
}

async function ensureHostPreferencesTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS host_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return true;
}

async function getHostPreferences(db, userId) {
  if (!db || userId == null) return null;
  const r = await db.query(`SELECT payload, updated_at FROM host_preferences WHERE user_id = $1`, [userId]);
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return { payload: sanitizePreferencesPayload(row.payload), updatedAt: row.updated_at };
}

async function upsertHostPreferences(db, userId, payloadObject) {
  if (!db || userId == null) throw new Error('upsertHostPreferences: missing db or userId');
  const sanitized = sanitizePreferencesPayload(payloadObject);
  const r = await db.query(
    `INSERT INTO host_preferences (user_id, payload, updated_at)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING updated_at`,
    [userId, JSON.stringify(sanitized)],
  );
  return r.rows[0].updated_at;
}

module.exports = {
  ensureHostPreferencesTable,
  getHostPreferences,
  upsertHostPreferences,
  sanitizePreferencesPayload,
};
