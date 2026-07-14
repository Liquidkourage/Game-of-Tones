/**
 * Multi-card helpers for player bingo (MVP: up to ABSOLUTE_MAX cards per player).
 * Storage may be a single card (legacy) or BingoCard[].
 * Cap for a live room comes from room.maxPlayerBingoCards (host-settable).
 */

const crypto = require('crypto');

/** Hard ceiling — host may set 1…ABSOLUTE_MAX. */
const ABSOLUTE_MAX_PLAYER_BINGO_CARDS = 3;
/** @deprecated alias — prefer ABSOLUTE_MAX_PLAYER_BINGO_CARDS */
const MAX_PLAYER_BINGO_CARDS = ABSOLUTE_MAX_PLAYER_BINGO_CARDS;

function normalizeMaxPlayerBingoCards(raw, fallback = 1) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(ABSOLUTE_MAX_PLAYER_BINGO_CARDS, Math.max(1, n));
}

function newBingoCardId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Normalize DB / map value → card array. */
function asBingoCardList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((c) => c && Array.isArray(c.squares) && c.squares.length > 0);
  }
  if (value.cards && Array.isArray(value.cards)) {
    return value.cards.filter((c) => c && Array.isArray(c.squares) && c.squares.length > 0);
  }
  if (Array.isArray(value.squares) && value.squares.length > 0) return [value];
  return [];
}

function ensureBingoCardIdentity(card, playerId) {
  if (!card || typeof card !== 'object') return card;
  if (!card.cardId) card.cardId = newBingoCardId();
  if (playerId && (card.id == null || card.id === '')) card.id = playerId;
  return card;
}

function findBingoCardInList(cardsOrCard, cardId) {
  const list = asBingoCardList(cardsOrCard);
  if (!list.length) return null;
  if (cardId == null || cardId === '') return list[0];
  const id = String(cardId);
  return list.find((c) => c.cardId === id || c.id === id) || null;
}

/** Persist shape: single card (legacy) or { cards: [...] }. */
function cardPayloadForDb(cardsOrCard) {
  const list = asBingoCardList(cardsOrCard);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return { cards: list };
}

function forEachBingoCardInRoomMaps(room, fn) {
  if (!room) return;
  if (room.bingoCards) {
    for (const value of room.bingoCards.values()) {
      for (const card of asBingoCardList(value)) fn(card);
    }
  }
  if (room.clientCards) {
    for (const value of room.clientCards.values()) {
      for (const card of asBingoCardList(value)) fn(card);
    }
  }
  if (room.players) {
    for (const player of room.players.values()) {
      if (!player) continue;
      for (const card of asBingoCardList(player.bingoCards || player.bingoCard)) fn(card);
    }
  }
}

module.exports = {
  MAX_PLAYER_BINGO_CARDS,
  ABSOLUTE_MAX_PLAYER_BINGO_CARDS,
  normalizeMaxPlayerBingoCards,
  newBingoCardId,
  asBingoCardList,
  ensureBingoCardIdentity,
  findBingoCardInList,
  cardPayloadForDb,
  forEachBingoCardInRoomMaps,
};
