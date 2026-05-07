// Shared bingo pattern definitions for consistency across all interfaces

export type BingoPattern =
  | 'line'
  | 'four_corners'
  | 'x'
  | 't'
  | 'l'
  | 'u'
  | 'plus'
  | 'full_card'
  | 'blackout'
  | 'custom'
  | 'composite';

/** Presets allowed as sub-clauses inside a combined pattern (not `custom` / `composite`). */
export type CompositeClausePreset =
  | 'line'
  | 'four_corners'
  | 'x'
  | 't'
  | 'l'
  | 'u'
  | 'plus'
  | 'full_card';

export type GridTransform = 'rotateCw' | 'rotateCcw' | 'rotate180' | 'flipH' | 'flipV';

/** Optional host controls: pick the shape first, then allow extra winning orientations. */
export type PatternCompositeClause =
  | {
      kind: 'preset';
      preset: CompositeClausePreset;
      /** Only used when `preset === 'line'` (default 1). */
      linesRequired?: number;
      matchAllowRotation?: boolean;
      matchAllowMirror?: boolean;
    }
  | {
      kind: 'mask';
      positions: string[];
      matchAllowRotation?: boolean;
      matchAllowMirror?: boolean;
    };

export interface PatternCompositeSpec {
  op: 'and' | 'or';
  clauses: PatternCompositeClause[];
}

export const COMPOSITE_CLAUSE_PRESETS: readonly CompositeClausePreset[] = [
  'line',
  'four_corners',
  'x',
  't',
  'l',
  'u',
  'plus',
  'full_card',
] as const;

export const DEFAULT_COMPOSITE_SPEC: PatternCompositeSpec = {
  op: 'or',
  clauses: [{ kind: 'preset', preset: 'line' }, { kind: 'preset', preset: 'four_corners' }],
};

export interface PatternDefinition {
  value: BingoPattern;
  label: string;
  description: string;
  positions: string[];
}

export interface SavedCustomPattern {
  id: string;
  name: string;
  positions: string[];
  /** When set, any 90° rotation of the painted shape counts as a win (same as combined-pattern masks). */
  matchAllowRotation?: boolean;
  /** When set, horizontal and/or vertical mirror of the painted shape counts as a win. */
  matchAllowMirror?: boolean;
  createdAt: number;
}

export const BINGO_PATTERNS: Record<BingoPattern, PatternDefinition> = {
  line: {
    value: 'line',
    label: 'Line',
    description: 'Rows, columns, or diagonals — host sets how many lines to complete',
    positions: [] // Dynamic - any complete line
  },
  four_corners: {
    value: 'four_corners',
    label: 'Four Corners',
    description: 'All four corner squares',
    positions: ['0-0', '0-4', '4-0', '4-4']
  },
  x: {
    value: 'x',
    label: 'X Pattern',
    description: 'Both diagonal lines',
    positions: ['0-0', '1-1', '2-2', '3-3', '4-4', '0-4', '1-3', '3-1', '4-0'],
  },
  t: {
    value: 't',
    label: 'T Pattern',
    description: 'Top row + middle column',
    positions: ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2']
  },
  l: {
    value: 'l',
    label: 'L Pattern',
    description: 'Left column + bottom row',
    positions: ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4']
  },
  u: {
    value: 'u',
    label: 'U Pattern',
    description: 'Left + right columns + bottom row',
    positions: ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3']
  },
  plus: {
    value: 'plus',
    label: 'Plus Pattern',
    description: 'Middle row + middle column',
    positions: ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2']
  },
  full_card: {
    value: 'full_card',
    label: 'Full card',
    description: 'All 25 squares (same as blackout)',
    positions: Array.from({ length: 25 }, (_, i) => `${Math.floor(i / 5)}-${i % 5}`)
  },
  blackout: {
    value: 'blackout',
    label: 'Full card',
    description: 'Alias of full card (legacy)',
    positions: Array.from({ length: 25 }, (_, i) => `${Math.floor(i / 5)}-${i % 5}`),
  },
  custom: {
    value: 'custom',
    label: 'Custom',
    description: 'Custom pattern (set squares manually)',
    positions: [] // User-defined
  },
  composite: {
    value: 'composite',
    label: 'Combined',
    description: 'Win by AND/OR mix of lines, presets, or painted shapes',
    positions: [],
  },
};

export const PATTERN_OPTIONS = Object.values(BINGO_PATTERNS);

/** Shape presets (not line / cover-all / custom). */
export const PRESET_SHAPE_PATTERNS: readonly BingoPattern[] = ['four_corners', 'x', 't', 'l', 'u', 'plus'];

/** Full grid win modes (identical validation on server). */
export function isCoverAllWinPattern(pattern: BingoPattern): boolean {
  return pattern === 'full_card' || pattern === 'blackout';
}

/** All 25 cell keys for a standard 5×5 card (same set as `full_card`). */
export const STANDARD_BINGO_POSITIONS: readonly string[] = BINGO_PATTERNS.full_card.positions;

/**
 * True only if the card has exactly 25 squares, unique `row-col` keys (0–4), covering the full grid.
 * Prevents false full-card / blackout detection when the payload is truncated, duplicated, or malformed.
 */
export function validateBingoCardGrid(card: { squares?: { position: string }[] } | null | undefined): boolean {
  if (!card?.squares || card.squares.length !== 25) return false;
  const seen = new Set<string>();
  for (const sq of card.squares) {
    if (!sq?.position || !/^[0-4]-[0-4]$/.test(sq.position)) return false;
    if (seen.has(sq.position)) return false;
    seen.add(sq.position);
  }
  return seen.size === 25;
}

const POS_RE = /^[0-4]-[0-4]$/;

function parseRC(pos: string): [number, number] {
  const [a, b] = pos.split('-').map(Number);
  return [a, b];
}

/** Rotate / mirror selected cells on the 5×5 grid (row 0 = top, col 0 = left). */
export function transformPositions(positions: string[], t: GridTransform): string[] {
  const out = new Set<string>();
  for (const pos of positions) {
    if (!POS_RE.test(pos)) continue;
    let [r, c] = parseRC(pos);
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

const VARIANT_TRANSFORM_ORDER: GridTransform[] = ['rotateCw', 'rotateCcw', 'rotate180', 'flipH', 'flipV'];

/** Dedupe / clamp transforms from legacy `matchVariants` arrays. */
export function normalizeMatchVariants(raw: unknown): GridTransform[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(VARIANT_TRANSFORM_ORDER);
  const out: GridTransform[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && allowed.has(x) && !(out as string[]).includes(x)) {
      out.push(x as GridTransform);
    }
    if (out.length >= 8) break;
  }
  return out;
}

function readOrientationBool(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(s);
  }
  return false;
}

/** Collect orientation flags from modern booleans and legacy `matchVariants` arrays. */
function deriveOrientationFlags(raw: Record<string, unknown>): { rot: boolean; mir: boolean } {
  let rot = readOrientationBool(raw.matchAllowRotation);
  let mir = readOrientationBool(raw.matchAllowMirror);
  const legacy = normalizeMatchVariants(raw.matchVariants);
  for (const t of legacy) {
    if (t === 'rotateCw' || t === 'rotateCcw' || t === 'rotate180') rot = true;
    if (t === 'flipH' || t === 'flipV') mir = true;
  }
  return { rot, mir };
}

/**
 * Grid transforms implied by host orientation choices (rotation = 90° / 180° / 270°, mirror = ↔ and ↕).
 * Handles legacy per-transform `matchVariants` until recipes are re-saved.
 */
export function hostOrientationTransforms(opts: {
  matchAllowRotation?: boolean;
  matchAllowMirror?: boolean;
  matchVariants?: GridTransform[];
}): GridTransform[] {
  const { rot, mir } = deriveOrientationFlags(opts as unknown as Record<string, unknown>);
  const out: GridTransform[] = [];
  if (rot) out.push('rotateCw', 'rotate180', 'rotateCcw');
  if (mir) out.push('flipH', 'flipV');
  return normalizeMatchVariants(out);
}

export function clauseOrientationTransforms(
  clause: PatternCompositeClause & { matchVariants?: GridTransform[] },
): GridTransform[] {
  return hostOrientationTransforms(clause as unknown as Parameters<typeof hostOrientationTransforms>[0]);
}

/** Union of base cells plus rotated/reflected copies (for highlights). */
export function unionMaskVariantsPositions(
  base: readonly string[],
  transforms: GridTransform[] | null | undefined,
): string[] {
  const variants = expandMaskOrientations(base, transforms?.length ? transforms : []);
  const u = new Set<string>();
  for (const m of variants) {
    for (const p of m) u.add(p);
  }
  return Array.from(u).sort();
}

/** Highlight cells for a custom saved pattern including optional orientation allowances. */
export function customMaskHighlightPositions(
  positions: readonly string[] | undefined,
  opts?: { matchAllowRotation?: boolean; matchAllowMirror?: boolean },
): string[] {
  if (!positions?.length) return [];
  const t = hostOrientationTransforms(opts || {});
  return unionMaskVariantsPositions(positions, t);
}

type CardSqLite = { position: string; marked?: boolean; songId?: string; isFreeSpace?: boolean };

function everyMarked(card: { squares: CardSqLite[] }, mask: readonly string[]): boolean {
  return mask.every((pos) => {
    const sq = card.squares.find((s) => s.position === pos);
    return !!(sq && sq.marked);
  });
}

function everyStrict(
  card: { squares: CardSqLite[] },
  mask: readonly string[],
  isValid: (sq: CardSqLite) => boolean,
): boolean {
  return mask.every((pos) => {
    const sq = card.squares.find((s) => s.position === pos);
    return !!(sq && isValid(sq));
  });
}

/** Visual win check for standalone custom pattern (marks only), honoring orientation flags. */
export function evaluateCustomPatternVisual(
  card: { squares: CardSqLite[] } | null | undefined,
  basePositions: readonly string[] | null | undefined,
  opts?: { matchAllowRotation?: boolean; matchAllowMirror?: boolean },
): boolean {
  if (!card?.squares?.length || !basePositions?.length) return false;
  const transforms = hostOrientationTransforms(opts || {});
  const variants = expandMaskOrientations(basePositions, transforms);
  return variants.some((m) => everyMarked(card, m));
}

/** Strict win check for standalone custom pattern (played songs / free space), honoring orientation flags. */
export function evaluateCustomPatternStrict(
  card: { squares: CardSqLite[] } | null | undefined,
  basePositions: readonly string[] | null | undefined,
  playedSongIds: readonly string[],
  opts?: { matchAllowRotation?: boolean; matchAllowMirror?: boolean },
): boolean {
  if (!card?.squares?.length || !basePositions?.length) return false;
  const cur = playedSongIds;
  const isValid = (sq: CardSqLite) => {
    const free = !!(sq.isFreeSpace || sq.songId === '__FREE_SPACE__');
    return !!(sq.marked && (free || cur.includes(sq.songId || '')));
  };
  const transforms = hostOrientationTransforms(opts || {});
  const variants = expandMaskOrientations(basePositions, transforms);
  return variants.some((m) => everyStrict(card, m, isValid));
}

/** Max distinct row/column/diagonal lines on a 5×5 card. */
export const LINE_PATTERN_MAX_LINES = 12;

export function normalizeLinesRequired(raw: unknown): number {
  const x = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(x)) return 1;
  return Math.min(LINE_PATTERN_MAX_LINES, Math.max(1, Math.round(x)));
}

/** Count complete lines (rows, columns, both diagonals) using mark-only predicate. */
export function countCompletedLinesVisual(card: { squares: CardSqLite[] }): number {
  const isOn = (pos: string) => {
    const sq = card.squares.find((s) => s.position === pos);
    return !!(sq && sq.marked);
  };
  let n = 0;
  for (let row = 0; row < 5; row++) {
    if ([0, 1, 2, 3, 4].every((c) => isOn(`${row}-${c}`))) n++;
  }
  for (let col = 0; col < 5; col++) {
    if ([0, 1, 2, 3, 4].every((r) => isOn(`${r}-${col}`))) n++;
  }
  let d1 = true;
  let d2 = true;
  for (let i = 0; i < 5; i++) {
    if (!isOn(`${i}-${i}`)) d1 = false;
    if (!isOn(`${i}-${4 - i}`)) d2 = false;
  }
  if (d1) n++;
  if (d2) n++;
  return n;
}

/** Count complete lines where every cell passes the given validator (e.g. marked + played song). */
export function countCompletedLinesWithValidator(
  card: { squares: CardSqLite[] },
  isLineCellValid: (sq: CardSqLite | undefined) => boolean,
): number {
  let n = 0;
  for (let row = 0; row < 5; row++) {
    if ([0, 1, 2, 3, 4].every((c) => isLineCellValid(card.squares.find((s) => s.position === `${row}-${c}`)))) n++;
  }
  for (let col = 0; col < 5; col++) {
    if ([0, 1, 2, 3, 4].every((r) => isLineCellValid(card.squares.find((s) => s.position === `${r}-${col}`)))) n++;
  }
  const d1 = [0, 1, 2, 3, 4].every((i) => isLineCellValid(card.squares.find((s) => s.position === `${i}-${i}`)));
  const d2 = [0, 1, 2, 3, 4].every((i) => isLineCellValid(card.squares.find((s) => s.position === `${i}-${4 - i}`)));
  if (d1) n++;
  if (d2) n++;
  return n;
}

/** Count complete lines where every cell passes strict validation (played songs / free). */
export function countCompletedLinesStrict(
  card: { squares: CardSqLite[] },
  playedSongIds: readonly string[],
): number {
  const isValid = (sq: CardSqLite | undefined) =>
    !!(sq && sq.marked && (sq.isFreeSpace || sq.songId === '__FREE_SPACE__' || playedSongIds.includes(sq.songId || '')));
  return countCompletedLinesWithValidator(card, isValid);
}

/** Identity mask plus each transformed copy (deduped). */
export function expandMaskOrientations(base: readonly string[], extras?: GridTransform[] | null): string[][] {
  const transforms = extras?.length ? extras : [];
  const maps = new Map<string, string[]>();
  const add = (arr: string[]) => {
    const sorted = [...arr].sort();
    maps.set(sorted.join('|'), sorted);
  };
  add([...base]);
  for (const t of transforms) {
    add(transformPositions([...base], t));
  }
  return Array.from(maps.values());
}

/** Whether this clause type may use extra rotations/reflections at match time. */
export function clauseSupportsMatchVariants(clause: PatternCompositeClause): boolean {
  if (clause.kind === 'mask') return true;
  return clause.preset !== 'line' && clause.preset !== 'full_card';
}

function unionVariantPositions(variants: string[][]): string[] {
  const u = new Set<string>();
  for (const m of variants) {
    for (const p of m) u.add(p);
  }
  return Array.from(u).sort();
}

function isCompositePreset(x: string): x is CompositeClausePreset {
  return (COMPOSITE_CLAUSE_PRESETS as readonly string[]).includes(x);
}

/** Normalize and validate combined-pattern payload from host or server. */
export function normalizePatternComposite(raw: unknown): PatternCompositeSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as PatternCompositeSpec;
  const op = o.op === 'and' || o.op === 'or' ? o.op : null;
  if (!op || !Array.isArray(o.clauses)) return null;
  const clauses: PatternCompositeClause[] = [];
  for (const c of o.clauses) {
    if (!c || typeof c !== 'object') continue;
    const cl = c as PatternCompositeClause;
    if (cl.kind === 'preset' && typeof (cl as { preset?: string }).preset === 'string') {
      let p = (cl as { preset: string }).preset;
      if (p === 'blackout') p = 'full_card';
      if (!isCompositePreset(p)) continue;
      if (p === 'line') {
        const lr = normalizeLinesRequired((cl as { linesRequired?: unknown }).linesRequired);
        clauses.push({
          kind: 'preset',
          preset: 'line',
          ...(lr !== 1 ? { linesRequired: lr } : {}),
        });
        continue;
      }
      if (p === 'full_card') {
        clauses.push({ kind: 'preset', preset: p });
        continue;
      }
      const { rot, mir } = deriveOrientationFlags(cl as unknown as Record<string, unknown>);
      clauses.push({
        kind: 'preset',
        preset: p,
        ...(rot ? { matchAllowRotation: true } : {}),
        ...(mir ? { matchAllowMirror: true } : {}),
      });
    } else if (cl.kind === 'mask' && Array.isArray((cl as { positions?: unknown }).positions)) {
      const mask = Array.from(
        new Set(
          (cl as { positions: string[] }).positions.filter((x) => typeof x === 'string' && POS_RE.test(x)),
        ),
      );
      if (mask.length === 0) continue;
      const { rot, mir } = deriveOrientationFlags(cl as unknown as Record<string, unknown>);
      clauses.push({
        kind: 'mask',
        positions: mask.sort(),
        ...(rot ? { matchAllowRotation: true } : {}),
        ...(mir ? { matchAllowMirror: true } : {}),
      });
    }
  }
  if (clauses.length === 0 || clauses.length > 12) return null;
  return { op, clauses };
}

/** Cells to highlight on player/public UI as “part of some winning clause”. */
export function clauseHighlightPositions(clause: PatternCompositeClause): string[] {
  if (clause.kind === 'preset') {
    const preset = clause.preset;
    if (preset === 'line' || preset === 'full_card') {
      return [...STANDARD_BINGO_POSITIONS];
    }
    const def = BINGO_PATTERNS[preset];
    const pts = def?.positions;
    if (!pts?.length) return [];
    const variants = expandMaskOrientations(pts, clauseOrientationTransforms(clause));
    return unionVariantPositions(variants);
  }
  const variants = expandMaskOrientations(clause.positions, clauseOrientationTransforms(clause));
  return unionVariantPositions(variants);
}

/** Short clause label for projector / winner UI (combined patterns). */
export function describeCompositeClauseBrief(clause: PatternCompositeClause): string {
  if (clause.kind === 'preset') {
    if (clause.preset === 'line') {
      const n = normalizeLinesRequired(clause.linesRequired);
      return n <= 1 ? 'Any line' : `Any ${n} lines`;
    }
    if (clause.preset === 'full_card') return 'Full card';
    const def = BINGO_PATTERNS[clause.preset];
    return def?.label ?? clause.preset;
  }
  const n = clause.positions?.length ?? 0;
  return `Painted shape (${n} sq)`;
}

/** Readable combined rule with shape-orientation hints where relevant. */
export function describeCompositeClauseAudience(clause: PatternCompositeClause): string {
  const base = describeCompositeClauseBrief(clause);
  if (!clauseSupportsMatchVariants(clause)) return base;
  const tf = clauseOrientationTransforms(clause);
  const rot = tf.some((t) => t === 'rotateCw' || t === 'rotateCcw' || t === 'rotate180');
  const mir = tf.some((t) => t === 'flipH' || t === 'flipV');
  const bits: string[] = [];
  if (rot) bits.push('rotations OK');
  if (mir) bits.push('mirrors OK');
  if (!bits.length) return base;
  return `${base} (${bits.join(', ')})`;
}

export function describeCompositePatternAudienceSentence(
  spec: PatternCompositeSpec | null | undefined,
): string {
  if (!spec?.clauses?.length) return '';
  const sep = spec.op === 'and' ? ' AND ' : ' OR ';
  return spec.clauses.map(describeCompositeClauseAudience).join(sep);
}

/** Readable combined rule, e.g. "Four corners OR X pattern". */
export function describeCompositePatternFullSentence(spec: PatternCompositeSpec | null | undefined): string {
  if (!spec?.clauses?.length) return '';
  const sep = spec.op === 'and' ? ' AND ' : ' OR ';
  return spec.clauses.map(describeCompositeClauseBrief).join(sep);
}

export function unionCompositeHighlightPositions(spec: PatternCompositeSpec | null | undefined): string[] {
  if (!spec?.clauses?.length) return [];
  const u = new Set<string>();
  for (const c of spec.clauses) {
    for (const p of clauseHighlightPositions(c)) u.add(p);
  }
  return Array.from(u).sort();
}

type SquareLite = { position: string; marked?: boolean; songId?: string; isFreeSpace?: boolean };

function maskVisualComplete(card: { squares: SquareLite[] }, positions: readonly string[]): boolean {
  return positions.every((pos) => {
    const sq = card.squares.find((s) => s.position === pos);
    return !!(sq && sq.marked);
  });
}

function maskStrictComplete(
  card: { squares: SquareLite[] },
  positions: readonly string[],
  isValid: (sq: SquareLite) => boolean,
): boolean {
  return positions.every((pos) => {
    const sq = card.squares.find((s) => s.position === pos);
    return !!(sq && isValid(sq));
  });
}

function clauseVisualComplete(card: { squares: SquareLite[] }, clause: PatternCompositeClause): boolean {
  if (clause.kind === 'preset') {
    if (clause.preset === 'line') {
      const need = normalizeLinesRequired(clause.linesRequired);
      return countCompletedLinesVisual(card) >= need;
    }
    if (clause.preset === 'full_card') {
      if (!validateBingoCardGrid(card)) return false;
      return STANDARD_BINGO_POSITIONS.every((pos) => {
        const sq = card.squares.find((s) => s.position === pos);
        return !!(sq && sq.marked);
      });
    }
    const def = BINGO_PATTERNS[clause.preset];
    const pts = def?.positions;
    if (!pts?.length) return false;
    const variants = expandMaskOrientations(pts, clauseOrientationTransforms(clause));
    return variants.some((m) => maskVisualComplete(card, m));
  }
  const variants = expandMaskOrientations(clause.positions, clauseOrientationTransforms(clause));
  return variants.some((m) => maskVisualComplete(card, m));
}

function clauseStrictComplete(
  card: { squares: SquareLite[] },
  clause: PatternCompositeClause,
  isValid: (sq: SquareLite) => boolean,
): boolean {
  if (clause.kind === 'preset') {
    if (clause.preset === 'line') {
      const need = normalizeLinesRequired(clause.linesRequired);
      return countCompletedLinesWithValidator(card, (sq) => !!(sq && isValid(sq))) >= need;
    }
    if (clause.preset === 'full_card') {
      if (!validateBingoCardGrid(card)) return false;
      return STANDARD_BINGO_POSITIONS.every((pos) => {
        const sq = card.squares.find((s) => s.position === pos);
        return !!(sq && isValid(sq));
      });
    }
    const def = BINGO_PATTERNS[clause.preset];
    const pts = def?.positions;
    if (!pts?.length) return false;
    const variants = expandMaskOrientations(pts, clauseOrientationTransforms(clause));
    return variants.some((m) => maskStrictComplete(card, m, isValid));
  }
  const variants = expandMaskOrientations(clause.positions, clauseOrientationTransforms(clause));
  return variants.some((m) => maskStrictComplete(card, m, isValid));
}

export function evaluateCompositeVisual(
  card: { squares: SquareLite[] } | null | undefined,
  spec: PatternCompositeSpec | null | undefined,
): boolean {
  if (!card?.squares || !spec?.clauses?.length) return false;
  if (spec.op === 'or') return spec.clauses.some((c) => clauseVisualComplete(card, c));
  return spec.clauses.every((c) => clauseVisualComplete(card, c));
}

export function evaluateCompositeStrict(
  card: { squares: SquareLite[] } | null | undefined,
  spec: PatternCompositeSpec | null | undefined,
  playedSongIds: readonly string[],
): boolean {
  if (!card?.squares || !spec?.clauses?.length) return false;
  const cur = playedSongIds;
  const isValid = (sq: SquareLite) => {
    const free = !!(sq.isFreeSpace || sq.songId === '__FREE_SPACE__');
    return !!(sq.marked && (free || cur.includes(sq.songId || '')));
  };
  if (spec.op === 'or') return spec.clauses.some((c) => clauseStrictComplete(card, c, isValid));
  return spec.clauses.every((c) => clauseStrictComplete(card, c, isValid));
}

/** Host-facing completion estimate using legitimate marks only (0–100). */
export function compositeLegitProgressPct(
  card: { squares: SquareLite[] } | null | undefined,
  spec: PatternCompositeSpec | null | undefined,
  playedSongIds: readonly string[],
): number {
  if (!card?.squares?.length || !spec?.clauses?.length) return 0;
  const legit = (sq: SquareLite | undefined) => {
    if (!sq?.marked) return false;
    if (sq.isFreeSpace || sq.songId === '__FREE_SPACE__') return true;
    return playedSongIds.includes(sq.songId || '');
  };
  const ratioMask = (positions: readonly string[]) => {
    if (!positions.length) return 0;
    let hit = 0;
    for (const pos of positions) {
      const sq = card.squares.find((s) => s.position === pos);
      if (legit(sq)) hit++;
    }
    return hit / positions.length;
  };
  const ratioFullCard = (): number => {
    if (!validateBingoCardGrid(card)) return 0;
    let h = 0;
    for (const pos of STANDARD_BINGO_POSITIONS) {
      const sq = card.squares.find((s) => s.position === pos);
      if (legit(sq)) h++;
    }
    return h / 25;
  };

  const clauseLegitRatio = (clause: PatternCompositeClause): number => {
    if (clause.kind === 'preset') {
      if (clause.preset === 'line') {
        const need = normalizeLinesRequired(clause.linesRequired);
        const done = countCompletedLinesStrict(card, playedSongIds);
        return Math.min(1, need > 0 ? done / need : 0);
      }
      if (clause.preset === 'full_card') return ratioFullCard();
      const def = BINGO_PATTERNS[clause.preset];
      const pts = def?.positions;
      if (!pts?.length) return 0;
      const variants = expandMaskOrientations(pts, clauseOrientationTransforms(clause));
      return Math.max(...variants.map((m) => ratioMask(m)));
    }
    const variants = expandMaskOrientations(clause.positions, clauseOrientationTransforms(clause));
    return Math.max(...variants.map((m) => ratioMask(m)));
  };

  const ratios = spec.clauses.map((c) => clauseLegitRatio(c));
  const agg = spec.op === 'or' ? Math.max(...ratios) : Math.min(...ratios);
  return Math.round(Math.max(0, Math.min(1, agg)) * 100);
}

// Helper function to check if a position is part of a pattern
export function isPositionInPattern(position: string, pattern: BingoPattern, customPositions?: string[]): boolean {
  if (pattern === 'custom') {
    return customPositions ? customPositions.includes(position) : false;
  }
  if (pattern === 'composite') {
    return false;
  }

  const patternDef = BINGO_PATTERNS[pattern];
  if (!patternDef) return false;

  return patternDef.positions.includes(position);
}

// Helper function to get pattern display name
export function getPatternDisplayName(pattern: BingoPattern | string): string {
  if (pattern === 'blackout') return BINGO_PATTERNS.full_card.label;
  const key = pattern as BingoPattern;
  return BINGO_PATTERNS[key]?.label || pattern;
}

// Helper function to validate pattern positions
export function validatePatternPositions(positions: string[]): boolean {
  return positions.every(pos => /^[0-4]-[0-4]$/.test(pos));
}

// Custom pattern storage utilities
const CUSTOM_PATTERNS_KEY = 'bingo_custom_patterns';

export function getSavedCustomPatterns(): SavedCustomPattern[] {
  try {
    const stored = localStorage.getItem(CUSTOM_PATTERNS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveCustomPattern(pattern: Omit<SavedCustomPattern, 'id' | 'createdAt'>): SavedCustomPattern {
  const savedPattern: SavedCustomPattern = {
    ...pattern,
    id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: Date.now()
  };
  
  const existing = getSavedCustomPatterns();
  existing.push(savedPattern);
  
  try {
    localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(existing));
  } catch (error) {
    console.error('Failed to save custom pattern:', error);
  }
  
  return savedPattern;
}

export function deleteCustomPattern(id: string): void {
  const existing = getSavedCustomPatterns();
  const filtered = existing.filter(p => p.id !== id);
  
  try {
    localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to delete custom pattern:', error);
  }
}

/** Browser-local named combined (AND/OR) recipes for the host. */
export interface SavedCompositePattern {
  id: string;
  name: string;
  spec: PatternCompositeSpec;
  createdAt: number;
}

const COMPOSITE_RECIPES_KEY = 'bingo_composite_recipes';

export function getSavedCompositePatterns(): SavedCompositePattern[] {
  try {
    const stored = localStorage.getItem(COMPOSITE_RECIPES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SavedCompositePattern[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as { id?: unknown }).id;
      const name = (row as { name?: unknown }).name;
      const specRaw = (row as { spec?: unknown }).spec;
      const createdAt = (row as { createdAt?: unknown }).createdAt;
      if (typeof id !== 'string' || typeof name !== 'string') continue;
      const spec = normalizePatternComposite(specRaw);
      if (!spec) continue;
      out.push({
        id,
        name,
        spec,
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Persist a normalized copy of the combined recipe. Returns null if spec is invalid. */
export function saveCompositePattern(entry: {
  name: string;
  spec: PatternCompositeSpec;
}): SavedCompositePattern | null {
  const norm = normalizePatternComposite(JSON.parse(JSON.stringify(entry.spec)) as PatternCompositeSpec);
  if (!norm || !entry.name.trim()) return null;

  const saved: SavedCompositePattern = {
    id: `composite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: entry.name.trim(),
    spec: norm,
    createdAt: Date.now(),
  };

  const existing = getSavedCompositePatterns();
  existing.push(saved);

  try {
    localStorage.setItem(COMPOSITE_RECIPES_KEY, JSON.stringify(existing));
  } catch (error) {
    console.error('Failed to save composite pattern:', error);
  }

  return saved;
}

export function deleteSavedCompositePattern(id: string): void {
  const existing = getSavedCompositePatterns();
  const filtered = existing.filter((p) => p.id !== id);

  try {
    localStorage.setItem(COMPOSITE_RECIPES_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to delete composite pattern:', error);
  }
}

