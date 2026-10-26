/**
 * Multi-prize pattern rounds — prize slots + matching helpers.
 * Legacy rounds with no prizeSlots keep single pattern + currentRoundPrize behavior.
 */

const {
  normalizeLinesRequiredSrv,
  listCompletedLinesPlayedStrict,
  unionLineWinningPositions,
  validateBingoForPattern,
  isMarkedSquareValidPlayed,
} = require('./validateBingo');

const PRIZE_SLOT_MAX = 5;

const SLOT_PATTERN_KEYS = new Set([
  'line',
  'line_row',
  'line_col',
  'four_corners',
  'x',
  't',
  'l',
  'u',
  'plus',
  'full_card',
  'blackout',
]);

const MULTI_SLOT_POLICIES = new Set([
  'multi_slot_any',
  'multi_slot_one_per_player',
  'multi_slot_one_per_card',
]);

function normalizeMultiSlotWinPolicy(raw) {
  const s = String(raw || '').trim();
  if (MULTI_SLOT_POLICIES.has(s)) return s;
  return 'multi_slot_any';
}

function sanitizePrizeSlotLabel(raw) {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .slice(0, 80)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function newPrizeSlotId() {
  return `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @returns {Array<{id:string,label:string,pattern:string,linesRequired?:number,claimedBy?:object|null}>}
 */
function normalizePrizeSlots(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    let id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 64) : newPrizeSlotId();
    if (seen.has(id)) id = newPrizeSlotId();
    seen.add(id);
    let pattern = typeof row.pattern === 'string' ? row.pattern.trim() : 'line';
    if (!SLOT_PATTERN_KEYS.has(pattern)) pattern = 'line';
    const label = sanitizePrizeSlotLabel(row.label) || defaultLabelForPattern(pattern);
    const slot = {
      id,
      label,
      pattern,
      claimedBy: row.claimedBy && typeof row.claimedBy === 'object' ? row.claimedBy : null,
    };
    if (pattern === 'line' || pattern === 'line_row' || pattern === 'line_col') {
      slot.linesRequired = normalizeLinesRequiredSrv(row.linesRequired);
    }
    out.push(slot);
    if (out.length >= PRIZE_SLOT_MAX) break;
  }
  return out;
}

function defaultLabelForPattern(pattern) {
  switch (pattern) {
    case 'line_row':
      return 'First row';
    case 'line_col':
      return 'First column';
    case 'four_corners':
      return 'Four corners';
    case 'full_card':
    case 'blackout':
      return 'Blackout';
    case 'line':
      return 'Any line';
    default:
      return pattern.replace(/_/g, ' ');
  }
}

function roomHasPrizeSlots(room) {
  return Array.isArray(room?.prizeSlots) && room.prizeSlots.length > 0;
}

function openPrizeSlots(room) {
  if (!roomHasPrizeSlots(room)) return [];
  return room.prizeSlots.filter((s) => s && !s.claimedBy);
}

function playedSongIdsForRoom(room) {
  const playedSongIds = Array.isArray(room?.calledSongIds) ? [...room.calledSongIds] : [];
  if (room?.currentSong?.id && !playedSongIds.includes(room.currentSong.id)) {
    playedSongIds.push(room.currentSong.id);
  }
  return playedSongIds;
}

function filterCompletedLinesByOrientation(completed, orientation) {
  if (orientation === 'row') {
    return completed.filter((o) => String(o.type || '').startsWith('Row '));
  }
  if (orientation === 'col') {
    return completed.filter((o) => String(o.type || '').startsWith('Column '));
  }
  return completed;
}

function checkOrientedLines(card, playedSongIds, linesRequiredRaw, orientation) {
  const isMarkedSquareValid = (square) => isMarkedSquareValidPlayed(square, playedSongIds);
  const need = normalizeLinesRequiredSrv(linesRequiredRaw != null ? linesRequiredRaw : 1);
  const all = listCompletedLinesPlayedStrict(card, isMarkedSquareValid);
  const completed = filterCompletedLinesByOrientation(all, orientation);
  if (completed.length >= need) {
    const used = completed.slice(0, need);
    return {
      valid: true,
      type: need === 1 ? used[0].type : `${need} ${orientation === 'row' ? 'rows' : 'columns'}`,
      winningPositions: unionLineWinningPositions(used),
      completedLineCount: completed.length,
      reason:
        need === 1
          ? `${orientation === 'row' ? 'Row' : 'Column'} bingo complete! (${used[0].type})`
          : `${need}-${orientation === 'row' ? 'row' : 'column'} bingo complete!`,
    };
  }
  return {
    valid: false,
    type: null,
    winningPositions: [],
    completedLineCount: completed.length,
    reason: `Need ${need} complete ${orientation === 'row' ? 'row(s)' : 'column(s)'} (have ${completed.length}).`,
  };
}

/**
 * Validate card against one prize slot (preset patterns only for v1).
 */
function validateBingoForPrizeSlot(card, room, slot) {
  if (!slot || !card) {
    return { valid: false, reason: 'Missing slot or card', type: null, winningPositions: [] };
  }
  const pattern = slot.pattern || 'line';
  const playedSongIds = playedSongIdsForRoom(room);

  if (pattern === 'line_row') {
    return checkOrientedLines(card, playedSongIds, slot.linesRequired, 'row');
  }
  if (pattern === 'line_col') {
    return checkOrientedLines(card, playedSongIds, slot.linesRequired, 'col');
  }

  // Reuse room validator with a virtual room pattern for this slot.
  const virtualRoom = {
    ...room,
    pattern,
    linesRequired: slot.linesRequired != null ? slot.linesRequired : room.linesRequired,
    patternComposite: undefined,
    customPattern: undefined,
  };
  const result = validateBingoForPattern(card, virtualRoom);
  const winningPositions = Array.isArray(result.lineWinningPositions)
    ? result.lineWinningPositions
    : Array.isArray(result.customWinningMask)
      ? Array.from(result.customWinningMask)
      : [];
  return {
    valid: !!result.valid,
    reason: result.reason || (result.valid ? 'Pattern complete' : 'Pattern incomplete'),
    type: result.type || pattern,
    winningPositions,
  };
}

/**
 * Match all still-open prize slots the card satisfies (host slot order).
 * @returns {Array<{slot, validation}>}
 */
function matchOpenPrizeSlots(card, room) {
  const open = openPrizeSlots(room);
  if (open.length === 0) return [];
  const matched = [];
  for (const slot of open) {
    const validation = validateBingoForPrizeSlot(card, room, slot);
    if (validation.valid) {
      matched.push({ slot, validation });
    }
  }
  return matched;
}

function playerAlreadyWonSlotThisRound(room, playerId, participantId) {
  if (!roomHasPrizeSlots(room)) return false;
  for (const s of room.prizeSlots) {
    const c = s && s.claimedBy;
    if (!c) continue;
    if (participantId && c.participantId && String(c.participantId) === String(participantId)) {
      return true;
    }
    if (playerId && c.playerId && String(c.playerId) === String(playerId)) return true;
  }
  return false;
}

function cardAlreadyWonSlotThisRound(room, cardId) {
  if (!cardId || !roomHasPrizeSlots(room)) return false;
  const want = String(cardId);
  for (const s of room.prizeSlots) {
    if (s?.claimedBy?.cardId && String(s.claimedBy.cardId) === want) return true;
  }
  return false;
}

/**
 * Drop matched slots the player/card cannot take under multiSlotWinPolicy.
 */
function filterMatchedSlotsByPolicy(matched, room, player, cardId) {
  if (!Array.isArray(matched) || matched.length === 0) return [];
  const policy = normalizeMultiSlotWinPolicy(room?.multiSlotWinPolicy);
  if (policy === 'multi_slot_any') return matched;

  const participantId = player?.participantId || null;
  const playerId = player?.id || null;

  if (policy === 'multi_slot_one_per_player') {
    if (playerAlreadyWonSlotThisRound(room, playerId, participantId)) return [];
    // Still allow multiple slots on this first claim.
    return matched;
  }

  if (policy === 'multi_slot_one_per_card') {
    if (cardAlreadyWonSlotThisRound(room, cardId)) return [];
    return matched;
  }

  return matched;
}

function markPrizeSlotsClaimed(room, slotIds, claimMeta) {
  if (!roomHasPrizeSlots(room) || !Array.isArray(slotIds)) return [];
  const want = new Set(slotIds.map((id) => String(id)));
  const awarded = [];
  const at = Date.now();
  room.prizeSlots = room.prizeSlots.map((s) => {
    if (!s || !want.has(String(s.id)) || s.claimedBy) return s;
    const claimedBy = {
      playerId: claimMeta.playerId || null,
      participantId: claimMeta.participantId || null,
      playerName: claimMeta.playerName || '',
      cardId: claimMeta.cardId || null,
      at,
    };
    awarded.push({ ...s, claimedBy });
    return { ...s, claimedBy };
  });
  return awarded;
}

function prizeSlotsPublicSummary(room) {
  if (!roomHasPrizeSlots(room)) return null;
  return {
    multiSlotWinPolicy: normalizeMultiSlotWinPolicy(room.multiSlotWinPolicy),
    slots: room.prizeSlots.map((s) => ({
      id: s.id,
      label: s.label,
      pattern: s.pattern,
      ...(s.linesRequired != null ? { linesRequired: s.linesRequired } : {}),
      open: !s.claimedBy,
      ...(s.claimedBy
        ? {
            claimedBy: {
              playerName: s.claimedBy.playerName || '',
              cardId: s.claimedBy.cardId || null,
            },
          }
        : {}),
    })),
  };
}

module.exports = {
  PRIZE_SLOT_MAX,
  SLOT_PATTERN_KEYS,
  normalizeMultiSlotWinPolicy,
  normalizePrizeSlots,
  sanitizePrizeSlotLabel,
  defaultLabelForPattern,
  newPrizeSlotId,
  roomHasPrizeSlots,
  openPrizeSlots,
  matchOpenPrizeSlots,
  validateBingoForPrizeSlot,
  filterMatchedSlotsByPolicy,
  markPrizeSlotsClaimed,
  prizeSlotsPublicSummary,
  checkOrientedLines,
};
