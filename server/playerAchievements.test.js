'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACHIEVEMENT_CATALOG,
  evaluateAndUnlock,
  compactPublicRows,
  titleFor,
} = require('./playerAchievements');

describe('playerAchievements catalog', () => {
  it('has five stable v1 ids', () => {
    assert.deepEqual(
      ACHIEVEMENT_CATALOG.map((a) => a.id),
      ['first_call', 'first_win', 'ten_wins', 'regular', 'century_marks'],
    );
  });

  it('tests counters with snake or camel stats', () => {
    const byId = Object.fromEntries(ACHIEVEMENT_CATALOG.map((a) => [a.id, a]));
    assert.equal(byId.first_call.test({ bingos_called: 1 }), true);
    assert.equal(byId.first_win.test({ bingosWon: 1 }), true);
    assert.equal(byId.ten_wins.test({ bingos_won: 9 }), false);
    assert.equal(byId.ten_wins.test({ bingos_won: 10 }), true);
    assert.equal(byId.regular.test({ gamesJoined: 10 }), true);
    assert.equal(byId.century_marks.test({ marks_made: 99 }), false);
    assert.equal(byId.century_marks.test({ marks_made: 100 }), true);
  });

  it('titleFor and compactPublicRows shape host payload', () => {
    assert.equal(titleFor('first_win'), 'First Win');
    assert.deepEqual(compactPublicRows([{ id: 'first_call', title: 'First Call', unlockedAt: 'x' }]), [
      { id: 'first_call', title: 'First Call' },
    ]);
  });
});

describe('playerAchievements evaluateAndUnlock', () => {
  it('inserts only earned and skips conflicts', async () => {
    const inserted = [];
    const db = {
      query: async (sql, params) => {
        if (String(sql).includes('CREATE TABLE') || String(sql).includes('CREATE INDEX')) {
          return { rows: [] };
        }
        if (String(sql).includes('INSERT INTO player_achievements')) {
          const id = params[1];
          if (inserted.includes(id)) return { rows: [] };
          inserted.push(id);
          return { rows: [{ achievement_id: id, unlocked_at: '2026-01-01T00:00:00Z' }] };
        }
        return { rows: [] };
      },
    };
    const first = await evaluateAndUnlock(db, 7, {
      bingos_called: 1,
      bingos_won: 1,
      games_joined: 0,
      marks_made: 0,
    });
    assert.deepEqual(
      first.map((a) => a.id).sort(),
      ['first_call', 'first_win'],
    );
    const second = await evaluateAndUnlock(db, 7, {
      bingos_called: 1,
      bingos_won: 1,
      games_joined: 0,
      marks_made: 0,
    });
    assert.deepEqual(second, []);
  });
});
