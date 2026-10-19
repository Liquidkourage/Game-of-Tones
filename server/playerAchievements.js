/**
 * Thin lifetime achievements for signed-in players (driven by player_stats counters).
 */

'use strict';

/** @typedef {{ id: string, title: string, test: (s: StatsLike) => boolean }} AchievementDef */
/** @typedef {{ games_joined?: number, marks_made?: number, bingos_called?: number, bingos_won?: number, gamesJoined?: number, marksMade?: number, bingosCalled?: number, bingosWon?: number }} StatsLike */

/** @type {AchievementDef[]} */
const ACHIEVEMENT_CATALOG = [
  {
    id: 'first_call',
    title: 'First Call',
    test: (s) => num(s, 'bingos_called', 'bingosCalled') >= 1,
  },
  {
    id: 'first_win',
    title: 'First Win',
    test: (s) => num(s, 'bingos_won', 'bingosWon') >= 1,
  },
  {
    id: 'ten_wins',
    title: 'Ten Wins',
    test: (s) => num(s, 'bingos_won', 'bingosWon') >= 10,
  },
  {
    id: 'regular',
    title: 'Regular',
    test: (s) => num(s, 'games_joined', 'gamesJoined') >= 10,
  },
  {
    id: 'century_marks',
    title: 'Century Marks',
    test: (s) => num(s, 'marks_made', 'marksMade') >= 100,
  },
];

const CATALOG_BY_ID = new Map(ACHIEVEMENT_CATALOG.map((a) => [a.id, a]));

function num(stats, snake, camel) {
  if (!stats) return 0;
  const v = stats[snake] != null ? stats[snake] : stats[camel];
  return Number(v) || 0;
}

async function ensureAchievementTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS player_achievements (
      player_user_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      unlocked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (player_user_id, achievement_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_player_achievements_user
      ON player_achievements (player_user_id, unlocked_at DESC)
  `);
  return true;
}

function catalogPublic() {
  return ACHIEVEMENT_CATALOG.map(({ id, title }) => ({ id, title }));
}

function titleFor(id) {
  return CATALOG_BY_ID.get(id)?.title || id;
}

/**
 * Idempotent unlocks from current stats. Returns newly unlocked public rows.
 * @param {import('pg').Pool | null} db
 * @param {number} playerUserId
 * @param {StatsLike} stats
 */
async function evaluateAndUnlock(db, playerUserId, stats) {
  if (!db || playerUserId == null) return [];
  await ensureAchievementTable(db);
  const newly = [];
  for (const def of ACHIEVEMENT_CATALOG) {
    if (!def.test(stats)) continue;
    const r = await db.query(
      `INSERT INTO player_achievements (player_user_id, achievement_id)
       VALUES ($1, $2)
       ON CONFLICT (player_user_id, achievement_id) DO NOTHING
       RETURNING achievement_id, unlocked_at`,
      [playerUserId, def.id],
    );
    if (r.rows[0]) {
      newly.push({
        id: r.rows[0].achievement_id,
        title: def.title,
        unlockedAt: r.rows[0].unlocked_at,
      });
    }
  }
  return newly;
}

/**
 * @param {import('pg').Pool | null} db
 * @param {number} playerUserId
 * @returns {Promise<Array<{ id: string, title: string, unlockedAt: string | Date }>>}
 */
async function listForPlayer(db, playerUserId) {
  if (!db || playerUserId == null) return [];
  await ensureAchievementTable(db);
  const r = await db.query(
    `SELECT achievement_id, unlocked_at
     FROM player_achievements
     WHERE player_user_id = $1
     ORDER BY unlocked_at ASC`,
    [playerUserId],
  );
  return r.rows.map((row) => ({
    id: row.achievement_id,
    title: titleFor(row.achievement_id),
    unlockedAt: row.unlocked_at,
  }));
}

/**
 * Compact host/phone payload (id + title only).
 * @param {Array<{ id: string, title: string, unlockedAt?: unknown }>} rows
 */
function compactPublicRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    title: row.title || titleFor(row.id),
  }));
}

module.exports = {
  ACHIEVEMENT_CATALOG,
  ensureAchievementTable,
  catalogPublic,
  titleFor,
  evaluateAndUnlock,
  listForPlayer,
  compactPublicRows,
};
