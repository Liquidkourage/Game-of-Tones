/**
 * Bingo pattern validation (characterization-extract from server/index.js).
 * Pure aside from optional logger.debug calls.
 */
const {
  FREE_SPACE_SONG_ID,
  isFreeBingoSquare,
  isMarkedSquareValidPlayed,
} = require('./markedSquare');

const logger = {
  debug: () => {},
};

/** Show/UI cap for "Any N lines" — keep in sync with client LINE_PATTERN_MAX_LINES. */
const LINE_PATTERN_MAX_LINES_SRV = 6;

function normalizeLinesRequiredSrv(raw) {
  const x = parseInt(raw, 10);
  if (!Number.isFinite(x)) return 1;
  return Math.min(LINE_PATTERN_MAX_LINES_SRV, Math.max(1, Math.round(x)));
}

function sanitizeCustomPatternNameSrv(raw) {
  if (raw == null) return '';
  const s = String(raw).trim().slice(0, 80);
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function patternExtrasForClient(room) {
  const pat = room?.pattern || 'line';
  if (pat === 'line') {
    return { linesRequired: normalizeLinesRequiredSrv(room.linesRequired) };
  }
  if (pat === 'custom') {
    return {
      customMatchReverse: !!room.customPatternReverse,
      customMatchAllowRotation: !!room.customPatternAllowRotation,
      customMatchAllowMirror: !!room.customPatternAllowMirror,
      customMatchAnywhere: !!room.customPatternAnywhere,
      customPatternName: room.customPatternName || '',
    };
  }
  return {};
}

/** Single source of truth for player/host/display pattern payloads. */
function patternMetaForClient(room) {
  const meta = {
    pattern: room?.pattern || 'line',
    customMask: Array.from(room?.customPattern || []),
    patternComposite: patternCompositeForClient(room),
    ...patternExtrasForClient(room),
  };
  // Lazy require avoids circular load with prizeSlots.js
  if (Array.isArray(room?.prizeSlots) && room.prizeSlots.length > 0) {
    try {
      const { prizeSlotsPublicSummary } = require('./prizeSlots');
      const summary = prizeSlotsPublicSummary(room);
      if (summary) meta.prizeSlots = summary;
    } catch {
      /* ignore */
    }
  }
  return meta;
}

function listCompletedLinesPlayedStrict(card, isMarkedSquareValid) {
  const out = [];
  for (let row = 0; row < 5; row++) {
    const positions = [];
    let ok = true;
    for (let col = 0; col < 5; col++) {
      const pos = `${row}-${col}`;
      positions.push(pos);
      const sq = card.squares.find((s) => s.position === pos);
      if (!isMarkedSquareValid(sq)) ok = false;
    }
    if (ok) out.push({ type: `Row ${row + 1}`, positions });
  }
  for (let col = 0; col < 5; col++) {
    const positions = [];
    let ok = true;
    for (let row = 0; row < 5; row++) {
      const pos = `${row}-${col}`;
      positions.push(pos);
      const sq = card.squares.find((s) => s.position === pos);
      if (!isMarkedSquareValid(sq)) ok = false;
    }
    if (ok) out.push({ type: `Column ${col + 1}`, positions });
  }
  const d1 = [0, 1, 2, 3, 4].map((i) => `${i}-${i}`);
  if (d1.every((pos) => isMarkedSquareValid(card.squares.find((s) => s.position === pos)))) {
    out.push({ type: 'Diagonal (top-left to bottom-right)', positions: d1 });
  }
  const d2 = [0, 1, 2, 3, 4].map((i) => `${i}-${4 - i}`);
  if (d2.every((pos) => isMarkedSquareValid(card.squares.find((s) => s.position === pos)))) {
    out.push({ type: 'Diagonal (top-right to bottom-left)', positions: d2 });
  }
  return out;
}

function unionLineWinningPositions(lineObjs) {
  const s = new Set();
  for (const o of lineObjs) {
    for (const p of o.positions) s.add(p);
  }
  return Array.from(s);
}

function checkBingoWithPlayedSongs(card, playedSongIds, linesRequiredRaw) {
  const isMarkedSquareValid = (square) => isMarkedSquareValidPlayed(square, playedSongIds);
  const need = normalizeLinesRequiredSrv(linesRequiredRaw != null ? linesRequiredRaw : 1);
  const completed = listCompletedLinesPlayedStrict(card, isMarkedSquareValid);
  if (completed.length >= need) {
    const used = completed.slice(0, need);
    const winningPositions = unionLineWinningPositions(used);
    const type = need === 1 ? used[0].type : `${need} lines`;
    return {
      valid: true,
      type,
      winningPositions,
      completedLineCount: completed.length,
    };
  }
  return {
    valid: false,
    type: null,
    winningPositions: [],
    completedLineCount: completed.length,
  };
}

const COMPOSITE_PRESET_KEYS = new Set([
  'line',
  'four_corners',
  'x',
  't',
  'l',
  'u',
  'plus',
  'full_card',
]);

function normalizeCompositeMatchVariants(raw) {
  const ALLOWED = new Set(['rotateCw', 'rotateCcw', 'rotate180', 'flipH', 'flipV']);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (typeof x === 'string' && ALLOWED.has(x) && !out.includes(x)) out.push(x);
    if (out.length >= 8) break;
  }
  return out;
}

function readOrientationBoolSrv(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(s);
  }
  return false;
}

function deriveCompositeOrientationFlags(c) {
  let rot = readOrientationBoolSrv(c.matchAllowRotation);
  let mir = readOrientationBoolSrv(c.matchAllowMirror);
  const legacy = normalizeCompositeMatchVariants(c.matchVariants);
  for (const t of legacy) {
    if (t === 'rotateCw' || t === 'rotateCcw' || t === 'rotate180') rot = true;
    if (t === 'flipH' || t === 'flipV') mir = true;
  }
  return { rot, mir };
}

/** Same semantics as client `clauseOrientationTransforms`. */
function compositeClauseTransformsFromClause(clause) {
  const { rot, mir } = deriveCompositeOrientationFlags(clause);
  const acc = [];
  if (rot) acc.push('rotateCw', 'rotate180', 'rotateCcw');
  if (mir) acc.push('flipH', 'flipV');
  return normalizeCompositeMatchVariants(acc);
}

function parseRcComposite(pos) {
  const [a, b] = String(pos).split('-').map(Number);
  return [a, b];
}

/** Rotate/mirror positions on 5×5 grid — mirrors patternDefinitions.transformPositions */
function transformGridPositions(positions, t) {
  const out = new Set();
  for (const pos of positions) {
    if (!/^[0-4]-[0-4]$/.test(pos)) continue;
    let [r, c] = parseRcComposite(pos);
    switch (t) {
      case 'rotateCw':
        [r, c] = [c, 4 - r];
        break;
      case 'rotateCcw':
        [r, c] = [4 - c, r];
        break;
      case 'rotate180':
        [r, c] = [4 - r, 4 - c];
        break;
      case 'flipH':
        c = 4 - c;
        break;
      case 'flipV':
        r = 4 - r;
        break;
      default:
        break;
    }
    out.add(`${r}-${c}`);
  }
  return Array.from(out).sort();
}

function expandCompositeShapeVariants(baseSorted, transforms) {
  const tArr = Array.isArray(transforms) ? transforms : [];
  const masks = new Map();
  const keyFn = (m) => m.slice().join('|');
  const add = (arr) => {
    const sorted = [...arr].sort();
    masks.set(keyFn(sorted), sorted);
  };
  add(baseSorted);
  for (const t of tArr) {
    add(transformGridPositions(baseSorted, t));
  }
  return [...masks.values()];
}

function customPatternOrientationTransformsSrv(room) {
  const rot = readOrientationBoolSrv(room && room.customPatternAllowRotation);
  const mir = readOrientationBoolSrv(room && room.customPatternAllowMirror);
  const acc = [];
  if (rot) acc.push('rotateCw', 'rotate180', 'rotateCcw');
  if (mir) acc.push('flipH', 'flipV');
  return normalizeCompositeMatchVariants(acc);
}

function resolveCustomPatternMaskSrv(room, reverse = false) {
  const base = new Set(Array.from((room && room.customPattern) || []).filter((p) => /^[0-4]-[0-4]$/.test(p)));
  if (!reverse) return Array.from(base).sort();
  const out = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const pos = `${row}-${col}`;
      if (!base.has(pos)) out.push(pos);
    }
  }
  return out;
}

/** All translations of a painted mask that fit on the 5×5 (relative shape preserved). */
function translateMaskPlacementsSrv(positions) {
  const cells = [];
  for (const pos of positions) {
    if (!/^[0-4]-[0-4]$/.test(pos)) continue;
    cells.push(parseRcComposite(pos));
  }
  if (!cells.length) return [];
  let minR = 4;
  let minC = 4;
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  const offsets = cells.map(([r, c]) => [r - minR, c - minC]);
  const h = maxR - minR;
  const w = maxC - minC;
  const out = [];
  const seen = new Set();
  for (let dr = 0; dr + h <= 4; dr++) {
    for (let dc = 0; dc + w <= 4; dc++) {
      const placed = offsets.map(([r, c]) => `${r + dr}-${c + dc}`).sort();
      const key = placed.join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(placed);
    }
  }
  return out;
}

function customPatternMaskVariantsSrv(room) {
  const transforms = customPatternOrientationTransformsSrv(room);
  const anywhere = readOrientationBoolSrv(room && room.customPatternAnywhere);
  const variants = new Map();
  const addShape = (shape) => {
    if (!shape.length) return;
    for (const mask of expandCompositeShapeVariants(shape, transforms)) {
      if (!anywhere) {
        variants.set(mask.join('|'), mask);
        continue;
      }
      for (const placed of translateMaskPlacementsSrv(mask)) {
        variants.set(placed.join('|'), placed);
      }
    }
  };
  addShape(resolveCustomPatternMaskSrv(room));
  if (readOrientationBoolSrv(room && room.customPatternReverse)) {
    addShape(resolveCustomPatternMaskSrv(room, true));
  }
  return [...variants.values()];
}

function patternCompositeForClient(room) {
  return room && room.pattern === 'composite' && room.patternComposite ? room.patternComposite : null;
}

function normalizePatternComposite(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const op = raw.op === 'and' || raw.op === 'or' ? raw.op : null;
  if (!op || !Array.isArray(raw.clauses)) return null;
  const clauses = [];
  for (const c of raw.clauses) {
    if (!c || typeof c !== 'object') continue;
    if (c.kind === 'preset' && typeof c.preset === 'string') {
      let preset = c.preset === 'blackout' ? 'full_card' : c.preset;
      if (!COMPOSITE_PRESET_KEYS.has(preset)) continue;
      if (preset === 'line') {
        const lr = normalizeLinesRequiredSrv(c.linesRequired);
        clauses.push({
          kind: 'preset',
          preset,
          ...(lr !== 1 ? { linesRequired: lr } : {}),
        });
        continue;
      }
      if (preset === 'full_card') {
        clauses.push({ kind: 'preset', preset });
        continue;
      }
      const { rot, mir } = deriveCompositeOrientationFlags(c);
      clauses.push({
        kind: 'preset',
        preset,
        ...(rot ? { matchAllowRotation: true } : {}),
        ...(mir ? { matchAllowMirror: true } : {}),
      });
    } else if (c.kind === 'mask' && Array.isArray(c.positions)) {
      const mask = [
        ...new Set(c.positions.filter((p) => typeof p === 'string' && /^[0-4]-[0-4]$/.test(p))),
      ];
      if (mask.length === 0) continue;
      const { rot, mir } = deriveCompositeOrientationFlags(c);
      const anywhere = readOrientationBoolSrv(c.matchAnywhere);
      clauses.push({
        kind: 'mask',
        positions: mask.sort(),
        ...(rot ? { matchAllowRotation: true } : {}),
        ...(mir ? { matchAllowMirror: true } : {}),
        ...(anywhere ? { matchAnywhere: true } : {}),
      });
    }
  }
  if (clauses.length === 0 || clauses.length > 12) return null;
  return { op, clauses };
}

function positionsFromLineBingoType(type) {
  if (!type || typeof type !== 'string') return [];
  if (type.startsWith('Row')) {
    const rowNum = parseInt(type.replace('Row ', ''), 10) - 1;
    const positions = [];
    for (let col = 0; col < 5; col++) positions.push(`${rowNum}-${col}`);
    return positions;
  }
  if (type.startsWith('Column')) {
    const colNum = parseInt(type.replace('Column ', ''), 10) - 1;
    const positions = [];
    for (let row = 0; row < 5; row++) positions.push(`${row}-${colNum}`);
    return positions;
  }
  if (type.includes('top-left to bottom-right')) {
    return [0, 1, 2, 3, 4].map((i) => `${i}-${i}`);
  }
  if (type.includes('top-right to bottom-left')) {
    return [0, 1, 2, 3, 4].map((i) => `${i}-${4 - i}`);
  }
  return [];
}

const COMPOSITE_SHAPE_BASE = {
  four_corners: ['0-0', '0-4', '4-0', '4-4'],
  x: ['0-0', '1-1', '2-2', '3-3', '4-4', '0-4', '1-3', '3-1', '4-0'],
  t: ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'],
  l: ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'],
  u: ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'],
  plus: ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'],
};

const COMPOSITE_SHAPE_LABEL = {
  four_corners: 'Four corners',
  x: 'X pattern',
  t: 'T pattern',
  l: 'L pattern',
  u: 'U pattern',
  plus: 'Plus pattern',
};

function validateCompositeClauseResult(card, playedSongIds, clause, isMarkedSquareValid) {
  if (!clause || typeof clause !== 'object') {
    return { valid: false, reason: 'Invalid clause', positions: [] };
  }

  function tryMaskVariants(baseSorted, transforms, okReason, failReason, anywhere) {
    let variants = expandCompositeShapeVariants(baseSorted, transforms);
    if (anywhere) {
      const placed = new Map();
      for (const mask of variants) {
        for (const p of translateMaskPlacementsSrv(mask)) {
          placed.set(p.join('|'), p);
        }
      }
      variants = [...placed.values()];
    }
    for (const mask of variants) {
      const invalid = [];
      for (const pos of mask) {
        const sq = card.squares.find((s) => s.position === pos);
        if (!isMarkedSquareValid(sq)) invalid.push(pos);
      }
      if (invalid.length === 0) return { valid: true, reason: okReason, positions: mask };
    }
    return { valid: false, reason: failReason, positions: [] };
  }

  if (clause.kind === 'mask' && Array.isArray(clause.positions)) {
    const base = [...clause.positions].sort();
    const transforms = compositeClauseTransformsFromClause(clause);
    const anywhere = readOrientationBoolSrv(clause.matchAnywhere);
    if (transforms.length === 0 && !anywhere) {
      const invalid = [];
      for (const pos of base) {
        const sq = card.squares.find((s) => s.position === pos);
        if (!isMarkedSquareValid(sq)) invalid.push(pos);
      }
      if (invalid.length > 0) {
        return {
          valid: false,
          reason: `Painted shape needs ${invalid.length} more squares marked with played songs`,
          positions: [],
        };
      }
      return { valid: true, reason: 'Painted shape complete', positions: base };
    }
    return tryMaskVariants(
      base,
      transforms,
      'Painted shape complete',
      anywhere
        ? 'Painted shape incomplete — no allowed placement fully marked with played songs yet'
        : 'Painted shape incomplete — no chosen orientation fully marked with played songs yet',
      anywhere,
    );
  }

  if (clause.kind !== 'preset' || typeof clause.preset !== 'string') {
    return { valid: false, reason: 'Invalid clause', positions: [] };
  }
  const p = clause.preset;
  if (p === 'line') {
    const need = normalizeLinesRequiredSrv(clause.linesRequired);
    const lineResult = checkBingoWithPlayedSongs(card, playedSongIds, need);
    if (!lineResult.valid) {
      const msg =
        need > 1
          ? `Need ${need} complete lines with played songs (have ${lineResult.completedLineCount})`
          : 'No complete line with played songs';
      return { valid: false, reason: msg, positions: [] };
    }
    const positions =
      Array.isArray(lineResult.winningPositions) && lineResult.winningPositions.length > 0
        ? lineResult.winningPositions
        : positionsFromLineBingoType(lineResult.type);
    return {
      valid: true,
      reason: `Line (${lineResult.type})`,
      positions,
    };
  }
  if (p === 'full_card' || p === 'blackout') {
    if (!validateBingoCardGrid(card)) {
      return { valid: false, reason: 'Invalid bingo card grid', positions: [] };
    }
    const positions = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) positions.push(`${row}-${col}`);
    }
    let invalidCount = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const square = card.squares.find((s) => s.position === `${row}-${col}`);
        if (!isMarkedSquareValid(square)) invalidCount++;
      }
    }
    if (invalidCount > 0) {
      return { valid: false, reason: 'Full card incomplete', positions: [] };
    }
    return { valid: true, reason: 'Full card complete', positions };
  }

  const baseShape = COMPOSITE_SHAPE_BASE[p];
  const shapeLabel = COMPOSITE_SHAPE_LABEL[p];
  if (!baseShape || !shapeLabel) {
    return { valid: false, reason: 'Unknown sub-pattern', positions: [] };
  }
  const transforms = compositeClauseTransformsFromClause(clause);
  const sortedBase = [...baseShape].sort();
  if (transforms.length === 0) {
    const invalid = sortedBase.filter((pos) => {
      const sq = card.squares.find((s) => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      let msg = `${shapeLabel} incomplete — need ${invalid.length} more squares`;
      if (p === 'four_corners') {
        msg = `Four corners incomplete — need ${invalid.length} more corners`;
      } else if (p === 'x') {
        msg = `X pattern incomplete — ${invalid.length} diagonal squares left`;
      }
      return { valid: false, reason: msg, positions: [] };
    }
    return { valid: true, reason: `${shapeLabel}`, positions: sortedBase };
  }
  return tryMaskVariants(
    sortedBase,
    transforms,
    `${shapeLabel} complete`,
    `${shapeLabel} incomplete — no matching orientation yet`,
    false,
  );
}

function validateBingoCompositePattern(card, playedSongIds, composite, isMarkedSquareValid) {
  const op = composite && composite.op;
  const clauses = composite && composite.clauses;
  if (!op || !Array.isArray(clauses) || clauses.length === 0) {
    return { valid: false, reason: 'Combined pattern is not configured' };
  }
  if (op === 'or') {
    const fails = [];
    for (const cl of clauses) {
      const r = validateCompositeClauseResult(card, playedSongIds, cl, isMarkedSquareValid);
      if (r.valid) {
        return {
          valid: true,
          reason: `Win: ${r.reason}`,
          type: 'Composite',
          winningPositions: r.positions,
        };
      }
      fails.push(r.reason);
    }
    return {
      valid: false,
      reason: `No winning combination (${fails.slice(0, 2).join(' · ')})`,
    };
  }
  const union = [];
  for (const cl of clauses) {
    const r = validateCompositeClauseResult(card, playedSongIds, cl, isMarkedSquareValid);
    if (!r.valid) {
      return { valid: false, reason: `Combined (all): ${r.reason}`, type: 'Composite' };
    }
    union.push(...r.positions);
  }
  const winningPositions = [...new Set(union)];
  return {
    valid: true,
    reason: 'Combined pattern (all parts) complete!',
    type: 'Composite',
    winningPositions,
  };
}

function validateBingoCardGrid(card) {
  if (!card?.squares || !Array.isArray(card.squares) || card.squares.length !== 25) return false;
  const seen = new Set();
  for (const sq of card.squares) {
    const pos = sq && sq.position;
    if (!pos || !/^[0-4]-[0-4]$/.test(pos)) return false;
    if (seen.has(pos)) return false;
    seen.add(pos);
  }
  return seen.size === 25;
}

/**
 * Option B: phone owns marks at claim time.
 * Returns a shallow card copy whose `square.marked` comes from client positions
 * (not the server mark map). Invalid / missing positions are ignored.
 * When `markedPositions` is null/undefined, returns the original card (legacy).
 */
function cardWithClientMarks(card, markedPositions) {
  if (!card || markedPositions == null) return card;
  const set = new Set(
    (Array.isArray(markedPositions) ? markedPositions : [])
      .map((p) => String(p))
      .filter((p) => /^[0-4]-[0-4]$/.test(p)),
  );
  return {
    ...card,
    squares: (card.squares || []).map((sq) => ({
      ...sq,
      marked: set.has(String(sq.position)),
    })),
  };
}

/** Mutate card squares in place to match client claim marks (host live / verify snapshot). */
function applyClientMarksInPlace(card, markedPositions) {
  if (!card?.squares || markedPositions == null) return card;
  const set = new Set(
    (Array.isArray(markedPositions) ? markedPositions : [])
      .map((p) => String(p))
      .filter((p) => /^[0-4]-[0-4]$/.test(p)),
  );
  for (const sq of card.squares) {
    if (!sq) continue;
    sq.marked = set.has(String(sq.position));
  }
  return card;
}

function validateBingoForPattern(card, room) {
  const pattern = room?.pattern || 'line';
  // Make a copy to avoid race conditions during validation
  const playedSongIds = Array.isArray(room?.calledSongIds) ? [...room.calledSongIds] : [];
  
  // CRITICAL: Always include current song if it exists (defensive programming against race conditions)
  // This ensures validation works even if current song hasn't been added to calledSongIds yet
  if (room?.currentSong?.id && !playedSongIds.includes(room.currentSong.id)) {
    playedSongIds.push(room.currentSong.id);
    logger.debug(`🎯 Added current song to validation list: ${room.currentSong.name} (${room.currentSong.id})`);
  }
  
  logger.debug(`🎯 Validating bingo for pattern: "${pattern}" (room pattern: "${room?.pattern}")`);
  logger.debug(`🎯 Played songs count: ${playedSongIds.length}`);
  logger.debug(`🎯 Called song IDs (last 10): ${JSON.stringify(playedSongIds.slice(-10))}`);
  logger.debug(`🎯 Card has ${card.squares.length} squares, ${card.squares.filter(s => s.marked).length} marked`);
  
  // Debug: Show card song IDs vs played song IDs
  const cardSongIds = card.squares.map(s => s.songId);
  const markedCardSongIds = card.squares.filter(s => s.marked).map(s => s.songId);
  logger.debug(`🎯 Card song IDs (first 10): ${JSON.stringify(cardSongIds.slice(0, 10))}`);
  logger.debug(`🎯 Marked card song IDs (first 10): ${JSON.stringify(markedCardSongIds.slice(0, 10))}`);
  
  // Helper function to check if a marked square corresponds to a played song (or free space)
  const isMarkedSquareValid = (square) => {
    const isValid = isMarkedSquareValidPlayed(square, playedSongIds);
    if (!isValid && square && square.marked) {
      logger.debug(
        `🎯 Invalid marked square: ${square.position} - songId: ${square.songId}, marked: ${square.marked}, inPlayedList: ${playedSongIds.includes(square.songId)}`
      );
    }
    return isValid;
  };

  if (pattern === 'composite' && room?.patternComposite) {
    return validateBingoCompositePattern(card, playedSongIds, room.patternComposite, isMarkedSquareValid);
  }

  if (pattern === 'custom' && room?.customPattern && room.customPattern.size > 0) {
    const variants = customPatternMaskVariantsSrv(room);
    if (variants.length === 0) {
      return {
        valid: false,
        reason: 'Custom pattern has no valid masks.',
        type: null,
        customWinningMask: null,
      };
    }
    const transforms = customPatternOrientationTransformsSrv(room);
    for (const mask of variants) {
      const bad = [];
      for (const pos of mask) {
        const sq = card.squares.find((s) => s.position === pos);
        if (!isMarkedSquareValid(sq)) bad.push(pos);
      }
      if (bad.length === 0) {
        return {
          valid: true,
          reason: 'Custom pattern complete!',
          type: 'custom',
          customWinningMask: mask,
        };
      }
    }
    const anywhere = readOrientationBoolSrv(room && room.customPatternAnywhere);
    return {
      valid: false,
      reason:
        anywhere
          ? 'Custom pattern incomplete — no allowed placement fully marked with played songs.'
          : transforms.length > 0
            ? 'Custom pattern incomplete — no allowed orientation fully marked with played songs.'
            : 'Custom pattern incomplete. Need more squares marked with played songs.',
      type: null,
      customWinningMask: null,
    };
  }
  
  if (pattern === 'full_card' || pattern === 'blackout') {
    if (!validateBingoCardGrid(card)) {
      return {
        valid: false,
        reason: 'Invalid bingo card (need 25 unique squares with positions 0-0 through 4-4).',
      };
    }
    // All squares must be marked AND correspond to played songs
    let invalidCount = 0;
    let invalidSquares = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const square = card.squares.find(s => s.position === `${row}-${col}`);
        if (!isMarkedSquareValid(square)) {
          invalidCount++;
          if (square) {
            invalidSquares.push({
              position: square.position,
              songId: square.songId,
              marked: square.marked,
              played: playedSongIds.includes(square.songId)
            });
          }
        }
      }
    }
    if (invalidCount > 0) {
      logger.debug(`🎯 Cover-all validation failed (${pattern}): ${invalidCount} invalid squares`);
      logger.debug(`🎯 Invalid squares (first 5): ${JSON.stringify(invalidSquares.slice(0, 5))}`);
      const label = pattern === 'blackout' ? 'Blackout' : 'Full card';
      return { 
        valid: false, 
        reason: `${label} incomplete. Need ${invalidCount} more squares marked with played songs.`
      };
    }
    logger.debug(`🎯 Cover-all validation passed (${pattern}): all 25 squares marked with played songs`);
    const okReason = pattern === 'blackout' ? 'Blackout complete!' : 'Full card complete!';
    return { valid: true, reason: okReason };
  }
  
  if (pattern === 'four_corners') {
    const required = ['0-0', '0-4', '4-0', '4-4'];
    const invalid = required.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `Four corners incomplete. Need ${invalid.length} more corners marked with played songs.`
      };
    }
    return { valid: true, reason: 'Four corners complete!' };
  }
  
  if (pattern === 'x') {
    const invalid = [];
    for (let i = 0; i < 5; i++) {
      const a = card.squares.find(s => s.position === `${i}-${i}`);
      const b = card.squares.find(s => s.position === `${i}-${4 - i}`);
      if (!isMarkedSquareValid(a)) invalid.push(`${i}-${i}`);
      if (!isMarkedSquareValid(b)) invalid.push(`${i}-${4 - i}`);
    }
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `X pattern incomplete. Need ${invalid.length} more diagonal squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'X pattern complete!' };
  }
  
  if (pattern === 't') {
    // T pattern: top row + middle column
    const tPositions = ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'];
    const invalid = tPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `T pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'T pattern complete!' };
  }
  
  if (pattern === 'l') {
    // L pattern: left column + bottom row
    const lPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'];
    const invalid = lPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `L pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'L pattern complete!' };
  }
  
  if (pattern === 'u') {
    // U pattern: left column + right column + bottom row
    const uPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'];
    const invalid = uPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `U pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'U pattern complete!' };
  }
  
  if (pattern === 'plus') {
    // Plus pattern: middle row + middle column
    const plusPositions = ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'];
    const invalid = plusPositions.filter(pos => {
      const sq = card.squares.find(s => s.position === pos);
      return !isMarkedSquareValid(sq);
    });
    if (invalid.length > 0) {
      return { 
        valid: false, 
        reason: `Plus pattern incomplete. Need ${invalid.length} more squares marked with played songs.`
      };
    }
    return { valid: true, reason: 'Plus pattern complete!' };
  }
  
  if (pattern === 'line') {
    const need = normalizeLinesRequiredSrv(room.linesRequired);
    const lineResult = checkBingoWithPlayedSongs(card, playedSongIds, need);
    if (lineResult.valid) {
      return {
        valid: true,
        reason:
          need === 1
            ? `Line bingo complete! (${lineResult.type})`
            : `${need}-line bingo complete!`,
        type: lineResult.type,
        lineWinningPositions: lineResult.winningPositions || [],
      };
    }
    return {
      valid: false,
      reason: `Need ${need} complete line(s) with played songs (have ${lineResult.completedLineCount}).`,
      type: null,
      lineWinningPositions: [],
    };
  }

  return { valid: false, reason: `Unsupported bingo pattern: ${pattern}` };
}

module.exports = {
  FREE_SPACE_SONG_ID,
  isFreeBingoSquare,
  isMarkedSquareValidPlayed,
  LINE_PATTERN_MAX_LINES_SRV,
  normalizeLinesRequiredSrv,
  sanitizeCustomPatternNameSrv,
  readOrientationBoolSrv,
  patternExtrasForClient,
  patternMetaForClient,
  listCompletedLinesPlayedStrict,
  unionLineWinningPositions,
  checkBingoWithPlayedSongs,
  validateBingoCardGrid,
  cardWithClientMarks,
  applyClientMarksInPlace,
  validateBingoForPattern,
  customPatternMaskVariantsSrv,
  normalizePatternComposite,
  patternCompositeForClient,
};
