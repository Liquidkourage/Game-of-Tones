/**
 * Player accounts (email/password) and lifetime statistics.
 */

const playerAuth = require('./playerAuth');

const MAX_DISPLAY_NAME_LEN = 80;

function normalizeDisplayName(raw) {
  const name = String(raw || '').trim();
  if (!name) return 'Player';
  return name.slice(0, MAX_DISPLAY_NAME_LEN);
}

async function ensurePlayerAccountTables(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS player_accounts (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT 'Player',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_player_accounts_email ON player_accounts (email)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS player_stats (
      player_user_id INTEGER PRIMARY KEY REFERENCES player_accounts(id) ON DELETE CASCADE,
      games_joined INTEGER NOT NULL DEFAULT 0,
      marks_made INTEGER NOT NULL DEFAULT 0,
      bingos_called INTEGER NOT NULL DEFAULT 0,
      bingos_won INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS player_round_history (
      id SERIAL PRIMARY KEY,
      player_user_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
      room_id VARCHAR(64) NOT NULL,
      round_token TEXT NOT NULL DEFAULT '',
      organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      display_name TEXT,
      marks_count INTEGER NOT NULL DEFAULT 0,
      bingo_called BOOLEAN NOT NULL DEFAULT false,
      bingo_won BOOLEAN NOT NULL DEFAULT false,
      started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMPTZ,
      UNIQUE (player_user_id, room_id, round_token)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_player_round_history_user ON player_round_history (player_user_id, started_at DESC)
  `);
  await db.query(`
    ALTER TABLE tempo_players ADD COLUMN IF NOT EXISTS player_user_id INTEGER REFERENCES player_accounts(id) ON DELETE SET NULL
  `);
  await db.query(`
    ALTER TABLE player_room_sessions ADD COLUMN IF NOT EXISTS player_user_id INTEGER REFERENCES player_accounts(id) ON DELETE SET NULL
  `);
  return true;
}

async function ensureStatsRow(db, playerUserId) {
  await db.query(
    `INSERT INTO player_stats (player_user_id) VALUES ($1)
     ON CONFLICT (player_user_id) DO NOTHING`,
    [playerUserId]
  );
}

async function createAccount(db, { email, password, displayName }) {
  if (!db) throw new Error('DATABASE_URL is required for player accounts');
  await ensurePlayerAccountTables(db);
  const normalizedEmail = playerAuth.normalizeEmail(email);
  if (!playerAuth.isValidEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address');
  }
  if (!password || String(password).length < playerAuth.MIN_PASSWORD_LEN) {
    throw new Error(`Password must be at least ${playerAuth.MIN_PASSWORD_LEN} characters`);
  }
  const name = normalizeDisplayName(displayName || normalizedEmail.split('@')[0]);
  const passwordHash = playerAuth.hashPassword(String(password));
  try {
    const r = await db.query(
      `INSERT INTO player_accounts (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, created_at`,
      [normalizedEmail, passwordHash, name]
    );
    const row = r.rows[0];
    await ensureStatsRow(db, row.id);
    return row;
  } catch (e) {
    if (e && e.code === '23505') throw new Error('An account with this email already exists');
    throw e;
  }
}

async function authenticateAccount(db, { email, password }) {
  if (!db) throw new Error('DATABASE_URL is required for player accounts');
  await ensurePlayerAccountTables(db);
  const normalizedEmail = playerAuth.normalizeEmail(email);
  if (!normalizedEmail || !password) throw new Error('Email and password are required');
  const r = await db.query(
    'SELECT id, email, password_hash, display_name, created_at FROM player_accounts WHERE email = $1',
    [normalizedEmail]
  );
  if (r.rows.length === 0) throw new Error('Invalid email or password');
  const row = r.rows[0];
  if (!playerAuth.verifyPassword(String(password), row.password_hash)) {
    throw new Error('Invalid email or password');
  }
  await ensureStatsRow(db, row.id);
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    created_at: row.created_at,
  };
}

async function getAccountById(db, id) {
  if (!db || id == null) return null;
  await ensurePlayerAccountTables(db);
  const r = await db.query(
    'SELECT id, email, display_name, created_at FROM player_accounts WHERE id = $1',
    [id]
  );
  return r.rows[0] || null;
}

async function getStats(db, playerUserId) {
  if (!db || playerUserId == null) return null;
  await ensurePlayerAccountTables(db);
  await ensureStatsRow(db, playerUserId);
  const r = await db.query(
    `SELECT games_joined, marks_made, bingos_called, bingos_won, updated_at
     FROM player_stats WHERE player_user_id = $1`,
    [playerUserId]
  );
  if (r.rows.length === 0) {
    return { games_joined: 0, marks_made: 0, bingos_called: 0, bingos_won: 0, updated_at: null };
  }
  return r.rows[0];
}

async function listRecentRounds(db, playerUserId, limit = 15) {
  if (!db || playerUserId == null) return [];
  await ensurePlayerAccountTables(db);
  const r = await db.query(
    `SELECT room_id, round_token, marks_count, bingo_called, bingo_won, started_at, ended_at
     FROM player_round_history
     WHERE player_user_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [playerUserId, Math.min(50, Math.max(1, limit))]
  );
  return r.rows;
}

async function linkClientToAccount(db, clientId, playerUserId) {
  if (!db || !clientId || playerUserId == null) return;
  await ensurePlayerAccountTables(db);
  await db.query(
    `UPDATE tempo_players SET player_user_id = $2, updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1`,
    [String(clientId).trim(), playerUserId]
  );
}

async function upsertRoundHistory(db, playerUserId, ctx) {
  if (!db || playerUserId == null || !ctx?.roomId) return false;
  await ensurePlayerAccountTables(db);
  const roomId = String(ctx.roomId).slice(0, 64);
  const roundToken = String(ctx.roundToken || '').slice(0, 512);
  const r = await db.query(
    `INSERT INTO player_round_history
       (player_user_id, room_id, round_token, organization_id, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (player_user_id, room_id, round_token) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, player_round_history.display_name),
       organization_id = COALESCE(EXCLUDED.organization_id, player_round_history.organization_id)
     RETURNING id`,
    [
      playerUserId,
      roomId,
      roundToken,
      ctx.organizationId ?? null,
      ctx.displayName ? normalizeDisplayName(ctx.displayName) : null,
    ]
  );
  return r.rows.length > 0;
}

async function ensureRoundHistory(db, playerUserId, ctx) {
  await upsertRoundHistory(db, playerUserId, ctx);
}

async function recordGameJoin(db, playerUserId, ctx) {
  if (!db || playerUserId == null) return;
  await ensureStatsRow(db, playerUserId);
  const r = await db.query(
    `INSERT INTO player_round_history
       (player_user_id, room_id, round_token, organization_id, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (player_user_id, room_id, round_token) DO NOTHING
     RETURNING id`,
    [
      playerUserId,
      String(ctx.roomId).slice(0, 64),
      String(ctx.roundToken || '').slice(0, 512),
      ctx.organizationId ?? null,
      ctx.displayName ? normalizeDisplayName(ctx.displayName) : null,
    ]
  );
  if (r.rows.length > 0) {
    await db.query(
      `UPDATE player_stats SET games_joined = games_joined + 1, updated_at = CURRENT_TIMESTAMP
       WHERE player_user_id = $1`,
      [playerUserId]
    );
  }
}

async function recordMark(db, playerUserId, ctx, delta = 1) {
  if (!db || playerUserId == null || delta <= 0) return;
  await ensureStatsRow(db, playerUserId);
  await ensureRoundHistory(db, playerUserId, ctx);
  await db.query(
    `UPDATE player_stats SET marks_made = marks_made + $2, updated_at = CURRENT_TIMESTAMP
     WHERE player_user_id = $1`,
    [playerUserId, delta]
  );
  await db.query(
    `UPDATE player_round_history SET marks_count = marks_count + $4
     WHERE player_user_id = $1 AND room_id = $2 AND round_token = $3`,
    [
      playerUserId,
      String(ctx.roomId).slice(0, 64),
      String(ctx.roundToken || '').slice(0, 512),
      delta,
    ]
  );
}

async function recordBingoCalled(db, playerUserId, ctx) {
  if (!db || playerUserId == null) return;
  await ensureStatsRow(db, playerUserId);
  await ensureRoundHistory(db, playerUserId, ctx);
  await db.query(
    `UPDATE player_stats SET bingos_called = bingos_called + 1, updated_at = CURRENT_TIMESTAMP
     WHERE player_user_id = $1`,
    [playerUserId]
  );
  await db.query(
    `UPDATE player_round_history SET bingo_called = true
     WHERE player_user_id = $1 AND room_id = $2 AND round_token = $3`,
    [playerUserId, String(ctx.roomId).slice(0, 64), String(ctx.roundToken || '').slice(0, 512)]
  );
}

async function recordBingoWon(db, playerUserId, ctx) {
  if (!db || playerUserId == null) return;
  await ensureStatsRow(db, playerUserId);
  await ensureRoundHistory(db, playerUserId, ctx);
  await db.query(
    `UPDATE player_stats SET bingos_won = bingos_won + 1, updated_at = CURRENT_TIMESTAMP
     WHERE player_user_id = $1`,
    [playerUserId]
  );
  await db.query(
    `UPDATE player_round_history SET bingo_won = true, bingo_called = true, ended_at = CURRENT_TIMESTAMP
     WHERE player_user_id = $1 AND room_id = $2 AND round_token = $3`,
    [playerUserId, String(ctx.roomId).slice(0, 64), String(ctx.roundToken || '').slice(0, 512)]
  );
}

function accountPublicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function statsPublicRow(row) {
  if (!row) return { gamesJoined: 0, marksMade: 0, bingosCalled: 0, bingosWon: 0 };
  return {
    gamesJoined: Number(row.games_joined) || 0,
    marksMade: Number(row.marks_made) || 0,
    bingosCalled: Number(row.bingos_called) || 0,
    bingosWon: Number(row.bingos_won) || 0,
    updatedAt: row.updated_at || null,
  };
}

module.exports = {
  ensurePlayerAccountTables,
  createAccount,
  authenticateAccount,
  getAccountById,
  getStats,
  listRecentRounds,
  linkClientToAccount,
  recordGameJoin,
  recordMark,
  recordBingoCalled,
  recordBingoWon,
  accountPublicRow,
  statsPublicRow,
};
