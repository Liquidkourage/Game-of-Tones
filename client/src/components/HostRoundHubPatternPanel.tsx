import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  BINGO_PATTERNS,
  DEFAULT_PRESET_SHAPE_PATTERN,
  HOST_PATTERN_CATEGORY_OPTIONS,
  PRESET_SHAPE_PATTERNS,
  LINE_PATTERN_MAX_LINES,
  hostPatternCategory,
  isPresetShapePattern,
  normalizeLinesRequired,
  deleteCustomPattern,
  getSavedCustomPatterns,
  renameCustomPattern,
  type BingoPattern,
  type HostPatternCategory,
  type PatternCompositeSpec,
  type SavedCustomPattern,
} from '../patternDefinitions';
import HostPatternMiniPreview from './HostPatternMiniPreview';

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
  /** Open draw-custom modal (create). Wired from top-level New only. */
  onNewCustomPattern: () => void;
  onEditCustomPattern?: (p: SavedCustomPattern) => void;
  onSavedCustomPatternsChange?: (next: SavedCustomPattern[]) => void;
  customMask: string[];
  customMatchReverse: boolean;
  customMatchAllowRotation: boolean;
  customMatchAllowMirror: boolean;
  onCustomMatchRotationChange: (v: boolean) => void;
  onCustomMatchMirrorChange: (v: boolean) => void;
  onCustomMatchReverseChange: (v: boolean) => void;
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
  onEditCustomPattern,
  onSavedCustomPatternsChange,
  customMask,
  customMatchReverse,
  customMatchAllowRotation,
  customMatchAllowMirror,
  onCustomMatchRotationChange,
  onCustomMatchMirrorChange,
  onCustomMatchReverseChange,
  getPatternDisplayName,
}) => {
  const category = hostPatternCategory(pattern);
  const previewLabel =
    pattern === 'custom' && selectedCustomPattern
      ? selectedCustomPattern.name
      : pattern === 'composite'
        ? `${BINGO_PATTERNS.composite.label} (${patternComposite.op.toUpperCase()})`
        : getPatternDisplayName(pattern);

  const selectCategory = (cat: HostPatternCategory) => {
    if (cat === 'custom') {
      // New: open draw modal only — do not switch into a Custom panel.
      onNewCustomPattern();
      return;
    }
    if (cat === 'pattern') {
      if (!isPresetShapePattern(pattern) && pattern !== 'custom') {
        onSelectPattern(DEFAULT_PRESET_SHAPE_PATTERN);
      }
      return;
    }
    if (cat === 'composite') {
      onSelectPattern('composite');
      onOpenCompositeModal();
      return;
    }
    onSelectPattern(cat);
  };

  const handleRename = () => {
    if (!selectedCustomPattern) return;
    const next = window.prompt('Rename saved shape', selectedCustomPattern.name);
    if (next == null) return;
    const updated = renameCustomPattern(selectedCustomPattern.id, next);
    if (!updated) {
      window.alert('Enter a non-empty name.');
      return;
    }
    onSavedCustomPatternsChange?.(getSavedCustomPatterns());
  };

  const handleDelete = () => {
    if (!selectedCustomPattern) return;
    if (!window.confirm(`Delete saved shape “${selectedCustomPattern.name}”?`)) return;
    deleteCustomPattern(selectedCustomPattern.id);
    onSavedCustomPatternsChange?.(getSavedCustomPatterns());
  };

  return (
  <div className="host-round-hub-pattern host-ui">
    {targetRoundLabel ? (
      <p className="host-round-hub-pattern__lead">Pattern for {targetRoundLabel}</p>
    ) : null}
    <div className="host-round-hub-pattern__main">
      {HOST_PATTERN_CATEGORY_OPTIONS.map((opt) => {
        const active = category === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`host-round-hub-pattern__opt${active ? ' host-round-hub-pattern__opt--active' : ''}`}
            onClick={() => selectCategory(opt.value)}
          >
            <span className="host-round-hub-pattern__opt-label">{opt.label}</span>
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

    {category === 'pattern' ? (
      <div className="host-round-hub-pattern__shapes" role="group" aria-label="Pattern shapes">
        <div className="host-round-hub-pattern__shape-grid" role="list">
          {PRESET_SHAPE_PATTERNS.map((shapeKey) => {
            const def = BINGO_PATTERNS[shapeKey];
            const active = pattern === shapeKey;
            return (
              <button
                key={shapeKey}
                type="button"
                role="listitem"
                className={`host-round-hub-pattern__shape-chip${active ? ' host-round-hub-pattern__shape-chip--active' : ''}`}
                aria-pressed={active}
                title={def.description}
                onClick={() => onSelectPattern(shapeKey)}
              >
                <HostPatternMiniPreview
                  pattern={shapeKey}
                  className="host-pattern-mini-preview--chip"
                  label={def.label}
                />
                <span className="host-round-hub-pattern__shape-chip-name">{def.label}</span>
              </button>
            );
          })}
          {savedCustomPatterns.map((sp) => {
            const active = pattern === 'custom' && selectedCustomPattern?.id === sp.id;
            return (
              <button
                key={sp.id}
                type="button"
                role="listitem"
                className={`host-round-hub-pattern__shape-chip${active ? ' host-round-hub-pattern__shape-chip--active' : ''}`}
                aria-pressed={active}
                title={sp.name}
                onClick={() => onSelectSavedCustom(sp)}
              >
                <HostPatternMiniPreview
                  pattern="custom"
                  customPattern={sp.positions}
                  customMatchReverse={sp.matchReverse === true}
                  customMatchAllowRotation={sp.matchAllowRotation === true}
                  customMatchAllowMirror={sp.matchAllowMirror === true}
                  className="host-pattern-mini-preview--chip"
                  label={sp.name}
                />
                <span className="host-round-hub-pattern__shape-chip-name">{sp.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    ) : null}

    <div className="host-round-hub-pattern__preview-row">
      <HostPatternMiniPreview
        pattern={pattern}
        linesRequired={pattern === 'line' ? linesRequired : undefined}
        customPattern={pattern === 'custom' ? customMask : undefined}
        patternComposite={pattern === 'composite' ? patternComposite : undefined}
        label={`Preview: ${previewLabel}`}
      />
      <span className="host-round-hub-pattern__preview-label">{previewLabel}</span>
    </div>

    <label className="host-round-hub-pattern__free">
      <input type="checkbox" checked={freeSpaceEnabled} onChange={(e) => onFreeSpaceChange(e.target.checked)} />
      Free center (counts without that song playing)
    </label>

    {pattern === 'custom' ? (
      <div className="host-round-hub-pattern__custom">
        {selectedCustomPattern ? (
          <div className="host-round-hub-pattern__library-actions">
            {onEditCustomPattern ? (
              <button type="button" className="host-round-hub-pattern__link" onClick={() => onEditCustomPattern(selectedCustomPattern)}>
                <Pencil className="w-3.5 h-3.5" aria-hidden />
                Edit
              </button>
            ) : null}
            <button type="button" className="host-round-hub-pattern__link" onClick={handleRename}>
              <Pencil className="w-3.5 h-3.5" aria-hidden />
              Rename
            </button>
            <button type="button" className="host-round-hub-pattern__link host-round-hub-pattern__link--danger" onClick={handleDelete}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
              Delete
            </button>
          </div>
        ) : null}

        {customMask.length > 0 ? (
          <div className="host-round-hub-pattern__custom-rules">
            <label>
              <input
                type="checkbox"
                checked={customMatchReverse}
                onChange={(e) => onCustomMatchReverseChange(e.target.checked)}
              />
              Reverse
            </label>
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
      </div>
    ) : null}

    <p className="host-round-hub-pattern__current">
      Current:{' '}
      <strong>{previewLabel}</strong>
    </p>
  </div>
  );
};

export default HostRoundHubPatternPanel;
