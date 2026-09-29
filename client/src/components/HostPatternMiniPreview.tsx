import React, { useMemo } from 'react';
import {
  STANDARD_BINGO_POSITIONS,
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
  patternComposite?: PatternCompositeSpec | null;
  /** Accessible name for the preview grid. */
  label?: string;
  className?: string;
};

/** Compact read-only 5×5 shape preview for Host Setup (matches host bingo cell colors). */
const HostPatternMiniPreview: React.FC<HostPatternMiniPreviewProps> = ({
  pattern,
  linesRequired,
  customPattern,
  customMatchReverse,
  customMatchAllowRotation,
  customMatchAllowMirror,
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
    patternComposite,
  ]);

  if (!pattern) return null;

  return (
    <div
      className={['host-pattern-mini-preview', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
    >
      <div className="host-pattern-mini-preview__grid" aria-hidden>
        {STANDARD_BINGO_POSITIONS.map((pos) => (
          <span
            key={pos}
            className={`host-pattern-mini-preview__cell${lit.has(pos) ? ' host-pattern-mini-preview__cell--on' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};

export default HostPatternMiniPreview;
