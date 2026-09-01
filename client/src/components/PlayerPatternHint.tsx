import React, { useMemo } from 'react';
import {
  STANDARD_BINGO_POSITIONS,
  getPatternHintLabel,
  patternHintCellPositions,
  type PatternCompositeSpec,
} from '../patternDefinitions';

export type PlayerPatternHintProps = {
  pattern: string;
  linesRequired?: number;
  customPattern?: string[];
  customMatchReverse?: boolean;
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
  customPatternName?: string;
  patternComposite?: PatternCompositeSpec | null;
};

/** Tiny always-on pattern reminder: label + 5×5 dots (does not replace the live card). */
const PlayerPatternHint: React.FC<PlayerPatternHintProps> = ({
  pattern,
  linesRequired,
  customPattern,
  customMatchReverse,
  customMatchAllowRotation,
  customMatchAllowMirror,
  customPatternName,
  patternComposite,
}) => {
  const label = useMemo(
    () =>
      getPatternHintLabel(pattern, {
        linesRequired,
        patternComposite,
        customPatternName,
      }),
    [pattern, linesRequired, patternComposite, customPatternName],
  );

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
    <div className="player-pattern-hint" role="status" aria-label={`Win pattern: ${label}`}>
      <div className="player-pattern-hint__grid" aria-hidden>
        {STANDARD_BINGO_POSITIONS.map((pos) => (
          <span
            key={pos}
            className={`player-pattern-hint__cell${lit.has(pos) ? ' is-lit' : ''}`}
          />
        ))}
      </div>
      <div className="player-pattern-hint__copy">
        <span className="player-pattern-hint__eyebrow">Win with</span>
        <span className="player-pattern-hint__label">{label}</span>
      </div>
    </div>
  );
};

export default PlayerPatternHint;
