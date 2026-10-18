const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ABSOLUTE_MAX_PLAYER_BINGO_CARDS,
  normalizeMaxPlayerBingoCards,
  asBingoCardList,
  ensureBingoCardIdentity,
  findBingoCardInList,
  cardPayloadForDb,
  newBingoCardId,
} = require('./playerBingoCards');

function stubCard(cardId, squaresLen = 25) {
  return {
    cardId,
    id: 'player-1',
    squares: Array.from({ length: squaresLen }, (_, i) => ({
      position: `${Math.floor(i / 5)}-${i % 5}`,
      songId: `s${i}`,
      marked: false,
    })),
  };
}

describe('playerBingoCards', () => {
  it('normalizeMaxPlayerBingoCards clamps to 1…ABSOLUTE_MAX', () => {
    assert.equal(normalizeMaxPlayerBingoCards(undefined, 1), 1);
    assert.equal(normalizeMaxPlayerBingoCards(2), 2);
    assert.equal(normalizeMaxPlayerBingoCards(99), ABSOLUTE_MAX_PLAYER_BINGO_CARDS);
    assert.equal(normalizeMaxPlayerBingoCards(0), 1);
  });

  it('asBingoCardList normalizes legacy single card and {cards}', () => {
    const one = stubCard('c1');
    assert.equal(asBingoCardList(one).length, 1);
    assert.equal(asBingoCardList({ cards: [one, stubCard('c2')] }).length, 2);
    assert.deepEqual(asBingoCardList(null), []);
  });

  it('findBingoCardInList matches cardId only (not player id)', () => {
    const a = stubCard('aaa');
    const b = stubCard('bbb');
    a.id = 'player-1';
    b.id = 'player-1';
    assert.equal(findBingoCardInList([a, b], 'bbb').cardId, 'bbb');
    assert.equal(findBingoCardInList([a, b], 'missing'), null);
    assert.equal(findBingoCardInList([a, b], null).cardId, 'aaa');
  });

  it('ensureBingoCardIdentity assigns cardId when missing; keeps existing player id', () => {
    const card = stubCard(undefined);
    delete card.cardId;
    ensureBingoCardIdentity(card, 'p9');
    assert.ok(card.cardId);
    assert.equal(card.id, 'player-1');
  });

  it('ensureBingoCardIdentity sets player id only when empty', () => {
    const card = stubCard('c-new');
    delete card.id;
    ensureBingoCardIdentity(card, 'p9');
    assert.equal(card.id, 'p9');
  });

  it('cardPayloadForDb uses legacy single vs {cards}', () => {
    const a = stubCard('a');
    assert.equal(cardPayloadForDb(a).cardId, 'a');
    const payload = cardPayloadForDb([a, stubCard('b')]);
    assert.ok(Array.isArray(payload.cards));
    assert.equal(payload.cards.length, 2);
  });

  it('newBingoCardId returns a non-empty string', () => {
    assert.ok(typeof newBingoCardId() === 'string' && newBingoCardId().length > 0);
  });
});
