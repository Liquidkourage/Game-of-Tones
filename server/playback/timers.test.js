const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const timers = require('./timers');

describe('playbackTimers', () => {
  beforeEach(() => {
    timers._resetForTests();
  });

  it('schedule replaces same name', async () => {
    let n = 0;
    timers.schedule('r1', 'advance', 20, () => {
      n += 1;
    });
    timers.schedule('r1', 'advance', 20, () => {
      n += 10;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(n, 10);
  });

  it('stale callSequence no-ops advance', async () => {
    const room = { gameState: 'playing', callSequence: 1 };
    let fired = false;
    timers.schedule(
      'r2',
      'advance',
      15,
      () => {
        fired = true;
      },
      {
        callSequence: 1,
        getRoom: () => room,
        requirePlaying: true,
      },
    );
    room.callSequence = 2;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(fired, false);
  });

  it('clearAll removes pending timers', async () => {
    let fired = false;
    timers.schedule('r3', 'advance', 30, () => {
      fired = true;
    });
    timers.clearAll('r3');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fired, false);
  });
});
