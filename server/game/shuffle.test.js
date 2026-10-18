const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { properShuffle } = require('./shuffle');

describe('properShuffle (Fisher–Yates)', () => {
  it('returns a permutation of the input (same multiset)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = properShuffle(input);
    assert.equal(out.length, input.length);
    assert.deepEqual([...out].sort((a, b) => a - b), [...input]);
  });

  it('does not mutate the original array', () => {
    const input = ['a', 'b', 'c', 'd'];
    const copy = [...input];
    properShuffle(input);
    assert.deepEqual(input, copy);
  });

  it('handles empty and singleton arrays', () => {
    assert.deepEqual(properShuffle([]), []);
    assert.deepEqual(properShuffle([42]), [42]);
  });

  it('over many runs, produces more than one distinct order (characterization)', () => {
    const input = [0, 1, 2, 3, 4, 5, 6, 7];
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      seen.add(properShuffle(input).join(','));
    }
    assert.ok(seen.size > 1, `expected multiple permutations, got ${seen.size}`);
  });
});
