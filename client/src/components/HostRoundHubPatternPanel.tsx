import React from 'react';
import { Plus, Grid3x3 } from 'lucide-react';
import {
  BINGO_PATTERNS,
  PRESET_SHAPE_PATTERNS,
  LINE_PATTERN_MAX_LINES,
  normalizeLinesRequired,
  describeCompositePatternAudienceSentence,
  type BingoPattern,
  type PatternCompositeSpec,
  type SavedCustomPattern,
} from '../patternDefinitions';

export interface HostRoundHubPatternPanelProps {
  targetRoundLabel: string | null;
  pattern: BingoPattern;
  onSelectPattern: (p: BingoPattern) => void;
  linesRequired: number;
  onLinesRequiredChange: (n: number) => void;
  patternComposite: PatternCompositeSpec;
  onOpenCompositeModal: () => void;
  freeSpaceEnabled: boolean;
  onFreeSpaceChange: (v: boolean) => void;
  savedCustomPatterns: SavedCustomPattern[];
  selectedCustomPattern: SavedCustomPattern | null;
  onSelectSavedCustom: (p: SavedCustomPattern) => void;
  onNewCustomPattern: () => void;
  customMask: string[];
  customMatchAllowRotation: boolean;
  customMatchAllowMirror: boolean;
  onCustomMatchRotationChange: (v: boolean) => void;
  onCustomMatchMirrorChange: (v: boolean) => void;
  getPatternDisplayName: (p: BingoPattern) => string;
}

const HostRoundHubPatternPanel: React.FC<HostRoundHubPatternPanelProps> = ({
  targetRoundLabel,
  pattern,
  onSelectPattern,
  linesRequired,
  onLinesRequiredChange,
  patternComposite,
  onOpenCompositeModal,
  freeSpaceEnabled,
  onFreeSpaceChange,
  savedCustomPatterns,
  selectedCustomPattern,
  onSelectSavedCustom,
  onNewCustomPattern,
  customMask,
  customMatchAllowRotation,
  customMatchAllowMirror,
  onCustomMatchRotationChange,
  onCustomMatchMirrorChange,
  getPatternDisplayName,
}) => (
  <div className="host-round-hub-pattern">
    <p className="host-round-hub-pattern__lead">
      <Grid3x3 className="w-4 h-4" aria-hidden />
      {targetRoundLabel ? (
        <>
          Pattern for <strong>{targetRoundLabel}</strong> — use <strong>Load for prep</strong> on a bucket so the mix
          matches.
        </>
      ) : (
        <>Pick a round on <strong>Build</strong> (Load for prep) before changing pattern here.</>
      )}
    </p>

    <div className="host-round-hub-pattern__main">
      {(['line', 'full_card', 'composite'] as const).map((key) => {
        const def = BINGO_PATTERNS[key];
        const active =
          key === 'line'
            ? pattern === 'line'
            : key === 'full_card'
              ? pattern === 'full_card' || pattern === 'blackout'
              : pattern === 'composite';
        return (
          <button
            key={key}
            type="button"
            className={`host-round-hub-pattern__opt${active ? ' host-round-hub-pattern__opt--active' : ''}`}
            onClick={() => {
              if (key === 'composite') {
                onSelectPattern('composite');
                onOpenCompositeModal();
              } else {
                onSelectPattern(key);
              }
            }}
          >
            <span className="host-round-hub-pattern__opt-label">{def.label}</span>
            <span className="host-round-hub-pattern__opt-desc">{def.description}</span>
          </button>
        );
      })}
    </div>

    {pattern === 'line' ? (
      <label className="host-round-hub-pattern__lines">
        Lines required (1–{LINE_PATTERN_MAX_LINES})
        <input
          type="number"
          min={1}
          max={LINE_PATTERN_MAX_LINES}
          value={linesRequired}
          onChange={(e) => onLinesRequiredChange(normalizeLinesRequired(parseInt(e.target.value, 10)))}
        />
      </label>
    ) : null}

    {pattern === 'composite' ? (
      <div className="host-round-hub-pattern__composite">
        <span>
          <strong>{patternComposite.op.toUpperCase()}</strong> · {patternComposite.clauses.length} clause
          {patternComposite.clauses.length !== 1 ? 's' : ''}
        </span>
        <button type="button" className="btn-secondary" onClick={onOpenCompositeModal}>
          Configure combined pattern…
        </button>
      </div>
    ) : null}

    <div className="host-round-hub-pattern__shapes">
      {PRESET_SHAPE_PATTERNS.map((shapeKey) => {
        const def = BINGO_PATTERNS[shapeKey];
        const active = pattern === shapeKey;
        return (
          <button
            key={shapeKey}
            type="button"
            className={`host-round-hub-pattern__shape${active ? ' host-round-hub-pattern__shape--active' : ''}`}
            title={def.description}
            onClick={() => onSelectPattern(shapeKey)}
          >
            {def.label}
          </button>
        );
      })}
    </div>

    <label className="host-round-hub-pattern__free">
      <input type="checkbox" checked={freeSpaceEnabled} onChange={(e) => onFreeSpaceChange(e.target.checked)} />
      Free center (counts without that song playing)
    </label>

    <div className="host-round-hub-pattern__custom">
      <select
        value={selectedCustomPattern?.id || ''}
        onChange={(e) => {
          const sp = savedCustomPatterns.find((p) => p.id === e.target.value);
          if (sp) onSelectSavedCustom(sp);
        }}
      >
        <option value="">Custom saved shape…</option>
        {savedCustomPatterns.map((sp) => (
          <option key={sp.id} value={sp.id}>
            {sp.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn-secondary" onClick={onNewCustomPattern}>
        <Plus className="w-4 h-4" aria-hidden />
        New custom
      </button>
    </div>

    {pattern === 'custom' && customMask.length > 0 ? (
      <div className="host-round-hub-pattern__custom-rules">
        <label>
          <input
            type="checkbox"
            checked={customMatchAllowRotation}
            onChange={(e) => onCustomMatchRotationChange(e.target.checked)}
          />
          Allow rotations
        </label>
        <label>
          <input
            type="checkbox"
            checked={customMatchAllowMirror}
            onChange={(e) => onCustomMatchMirrorChange(e.target.checked)}
          />
          Allow mirrors
        </label>
      </div>
    ) : null}

    <p className="host-round-hub-pattern__current">
      Current:{' '}
      <strong>
        {pattern === 'custom' && selectedCustomPattern
          ? selectedCustomPattern.name
          : pattern === 'composite'
            ? `${BINGO_PATTERNS.composite.label} (${patternComposite.op.toUpperCase()})`
            : getPatternDisplayName(pattern)}
      </strong>
      {pattern === 'composite' ? (
        <span className="host-round-hub-pattern__composite-desc">
          {describeCompositePatternAudienceSentence(patternComposite)}
        </span>
      ) : null}
    </p>
  </div>
);

export default HostRoundHubPatternPanel;
