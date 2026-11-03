import React, { useMemo } from 'react';
import {
  STANDARD_BINGO_POSITIONS,
  clauseHighlightPositions,
  compositeShapeClausesUseUnionHighlight,
  patternHintCellPositions,
  type BingoPattern,
  type PatternCompositeSpec,
} from '../patternDefinitions';

export type HostPatternMiniPreviewProps = {
  pattern: BingoPattern | string;
  linesRequired?: number;
  customPattern?: readonly string[] | null;
  customMatchReverse?: boolean;
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
  customMatchAnywhere?: boolean;
  patternComposite?: PatternCompositeSpec | null;
  /** Accessible name for the preview grid. */
  label?: string;
  className?: string;
};

/** Clause hues aligned with projector `.composite-clause-color-*` / chip accents. */
const COMPOSITE_CLAUSE_FILLS: readonly string[] = [
  'rgba(74, 222, 128, 0.85)',
  'rgba(56, 189, 248, 0.85)',
  'rgba(250, 204, 21, 0.85)',
  'rgba(232, 121, 249, 0.85)',
  'rgba(165, 180, 252, 0.85)',
  'rgba(251, 146, 60, 0.85)',
];
const COMPOSITE_CLAUSE_BORDERS: readonly string[] = [
  '#22c55e',
  '#38bdf8',
  '#facc15',
  '#e879f9',
  '#a5b4fc',
  '#fb923c',
];

/** Compact read-only 5×5 shape preview for Host Setup (matches host bingo cell colors). */
const HostPatternMiniPreview: React.FC<HostPatternMiniPreviewProps> = ({
  pattern,
  linesRequired,
  customPattern,
  customMatchReverse,
  customMatchAllowRotation,
  customMatchAllowMirror,
  customMatchAnywhere,
  patternComposite,
  label = 'Pattern preview',
  className,
}) => {
  const lit = useMemo(() => {
    const positions = patternHintCellPositions({
      pattern,
      linesRequired,
      customPattern,
      customMatchReverse,
      customMatchAllowRotation,
      customMatchAllowMirror,
      customMatchAnywhere,
      patternComposite,
    });
    return new Set(positions);
  }, [
    pattern,
    linesRequired,
    customPattern,
    customMatchReverse,
    customMatchAllowRotation,
    customMatchAllowMirror,
    customMatchAnywhere,
    patternComposite,
  ]);

  /** Per-cell clause color slots when composite shapes share squares (OR/AND union). */
  const clauseSlotsByPos = useMemo(() => {
    if (pattern !== 'composite' || !patternComposite?.clauses?.length) return null;
    if (!compositeShapeClausesUseUnionHighlight(patternComposite)) return null;
    const map = new Map<string, number[]>();
    patternComposite.clauses.forEach((clause, clauseIndex) => {
      const slot = clauseIndex % COMPOSITE_CLAUSE_FILLS.length;
      for (const pos of clauseHighlightPositions(clause)) {
        const prev = map.get(pos) ?? [];
        prev.push(slot);
        map.set(pos, prev);
      }
    });
    return map;
  }, [pattern, patternComposite]);

  if (!pattern) return null;

  return (
    <div
      className={['host-pattern-mini-preview', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
    >
      <div className="host-pattern-mini-preview__grid" aria-hidden>
        {STANDARD_BINGO_POSITIONS.map((pos) => {
          const on = lit.has(pos);
          const slots = clauseSlotsByPos?.get(pos);
          let style: React.CSSProperties | undefined;
          let overlapClass = '';
          if (on && slots && slots.length >= 2) {
            const a = slots[0];
            const b = slots[1];
            overlapClass = ' host-pattern-mini-preview__cell--overlap';
            style = {
              ['--mini-overlap-a' as string]: COMPOSITE_CLAUSE_FILLS[a],
              ['--mini-overlap-b' as string]: COMPOSITE_CLAUSE_FILLS[b],
              ['--mini-overlap-border-a' as string]: COMPOSITE_CLAUSE_BORDERS[a],
              ['--mini-overlap-border-b' as string]: COMPOSITE_CLAUSE_BORDERS[b],
            };
          } else if (on && slots && slots.length === 1) {
            style = {
              background: COMPOSITE_CLAUSE_FILLS[slots[0]],
              borderColor: COMPOSITE_CLAUSE_BORDERS[slots[0]],
            };
          }
          return (
            <span
              key={pos}
              className={`host-pattern-mini-preview__cell${on ? ' host-pattern-mini-preview__cell--on' : ''}${overlapClass}`}
              style={style}
            />
          );
        })}
      </div>
    </div>
  );
};

export default HostPatternMiniPreview;
