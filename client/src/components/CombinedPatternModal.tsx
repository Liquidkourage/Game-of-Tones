import React from 'react';
import { Save, Trash2 } from 'lucide-react';
import HostSubmodalPortal from './HostSubmodalPortal';
import './CombinedPatternModal.css';
import {
  BingoPattern,
  BINGO_PATTERNS,
  COMPOSITE_CLAUSE_PRESETS,
  CompositeClausePreset,
  PatternCompositeSpec,
  SavedCompositePattern,
  SavedCustomPattern,
  clauseSupportsMatchVariants,
  compositeClauseSelectValue,
  maskClauseFromSavedCustom,
  savedCustomForMaskClause,
  deleteSavedCompositePattern,
  getSavedCompositePatterns,
  LINE_PATTERN_MAX_LINES,
  normalizeLinesRequired,
  normalizePatternComposite,
  saveCompositePattern,
} from '../patternDefinitions';

export interface CombinedPatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  patternComposite: PatternCompositeSpec;
  commitPatternComposite: (next: PatternCompositeSpec) => void;
  editingMaskClauseIndex: number | null;
  setEditingMaskClauseIndex: React.Dispatch<React.SetStateAction<number | null>>;
  compositePaintDraft: string[];
  setCompositePaintDraft: React.Dispatch<React.SetStateAction<string[]>>;
  compositeRecipePickId: string;
  setCompositeRecipePickId: React.Dispatch<React.SetStateAction<string>>;
  compositeRecipeSaveName: string;
  setCompositeRecipeSaveName: React.Dispatch<React.SetStateAction<string>>;
  savedCompositePatterns: SavedCompositePattern[];
  setSavedCompositePatterns: React.Dispatch<React.SetStateAction<SavedCompositePattern[]>>;
  savedCustomPatterns: SavedCustomPattern[];
  showToast: (message: string, type?: 'info' | 'success' | 'warn' | 'error') => void;
  addLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

const CombinedPatternModal: React.FC<CombinedPatternModalProps> = (props) => {
  const {
    isOpen,
    onClose,
    patternComposite,
    commitPatternComposite,
    editingMaskClauseIndex,
    setEditingMaskClauseIndex,
    compositePaintDraft,
    setCompositePaintDraft,
    compositeRecipePickId,
    setCompositeRecipePickId,
    compositeRecipeSaveName,
    setCompositeRecipeSaveName,
    savedCompositePatterns,
    setSavedCompositePatterns,
    savedCustomPatterns,
    showToast,
    addLog,
  } = props;

  if (!isOpen) return null;

  return (
    <HostSubmodalPortal
      isOpen={isOpen}
      onClose={onClose}
      title="Combined pattern"
      subtitle="Configure AND/OR clauses and painted shapes. Changes apply to this round immediately."
      titleId="host-combined-pattern-title"
      maxWidth="600px"
    >
      <div className="host-ui host-combined-pattern">
          <div className="host-combined-pattern__panel">
            <p className="host-combined-pattern__lead">
              {patternComposite.op === 'or'
                ? 'Win if any clause completes'
                : 'Win only when every clause completes'}
            </p>
            <div className="host-combined-pattern__op-row">
              <span className="host-field-label">Combine with</span>
              <div className="host-segmented" role="group" aria-label="Combine clauses with">
                <button
                  type="button"
                  className={`host-segmented__btn${patternComposite.op === 'or' ? ' host-segmented__btn--active' : ''}`}
                  onClick={() => commitPatternComposite({ ...patternComposite, op: 'or' })}
                >
                  Any (OR)
                </button>
                <button
                  type="button"
                  className={`host-segmented__btn${patternComposite.op === 'and' ? ' host-segmented__btn--active' : ''}`}
                  onClick={() => commitPatternComposite({ ...patternComposite, op: 'and' })}
                >
                  All (AND)
                </button>
              </div>
            </div>

            <div className="host-combined-pattern__recipes host-actions-row">
              <label className="host-field-label host-field-label--inline">
                <span>Saved recipe</span>
                <select
                  className="host-field-select host-field-select--wide"
                  value={compositeRecipePickId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCompositeRecipePickId(id);
                    if (!id) return;
                    const r = savedCompositePatterns.find((p) => p.id === id);
                    const n = r ? normalizePatternComposite(r.spec) : null;
                    if (n) {
                      commitPatternComposite(n);
                      setEditingMaskClauseIndex(null);
                      setCompositePaintDraft([]);
                      addLog(`Loaded combined recipe: ${r!.name}`, 'info');
                    }
                  }}
                >
                  <option value="">Choose…</option>
                  {savedCompositePatterns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-danger-outline host-btn--sm"
                disabled={!compositeRecipePickId}
                title="Remove this recipe from this browser only"
                onClick={() => {
                  if (!compositeRecipePickId) return;
                  const r = savedCompositePatterns.find((p) => p.id === compositeRecipePickId);
                  if (
                    !window.confirm(
                      r ? `Delete saved recipe “${r.name}”?` : 'Delete this saved recipe?',
                    )
                  ) {
                    return;
                  }
                  deleteSavedCompositePattern(compositeRecipePickId);
                  setSavedCompositePatterns(getSavedCompositePatterns());
                  setCompositeRecipePickId('');
                  addLog('Saved combined recipe deleted', 'info');
                }}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                Delete
              </button>
              <input
                type="text"
                className="host-field-text"
                value={compositeRecipeSaveName}
                onChange={(e) => setCompositeRecipeSaveName(e.target.value)}
                placeholder="Name for current recipe"
                style={{ width: '10.5rem' }}
              />
              <button
                type="button"
                className="btn-secondary host-btn--sm"
                onClick={() => {
                  const name = compositeRecipeSaveName.trim();
                  if (!name) {
                    showToast('Enter a recipe name first', 'warn');
                    return;
                  }
                  const norm = normalizePatternComposite(patternComposite);
                  if (!norm) {
                    showToast('Cannot save invalid combined pattern', 'error');
                    return;
                  }
                  const saved = saveCompositePattern({ name, spec: norm });
                  if (!saved) {
                    showToast('Could not save recipe', 'error');
                    return;
                  }
                  setSavedCompositePatterns(getSavedCompositePatterns());
                  setCompositeRecipeSaveName('');
                  setCompositeRecipePickId(saved.id);
                  addLog(`Saved combined recipe: ${saved.name}`, 'info');
                  showToast(`Saved “${saved.name}”`, 'success');
                }}
              >
                <Save className="w-3.5 h-3.5" aria-hidden />
                Save recipe
              </button>
            </div>

            <div className="host-combined-pattern__clauses">
                      {patternComposite.clauses.map((clause, idx) => {
                        const sel = compositeClauseSelectValue(clause, savedCustomPatterns);
                        const linkedSaved = savedCustomForMaskClause(clause, savedCustomPatterns);
                        return (
                          <div key={`clause-${idx}`} className="host-combined-pattern__clause">
                            <div className="host-combined-pattern__clause-toolbar">
                              <select
                                className="host-field-select host-combined-pattern__clause-select"
                                value={sel}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const isMaskLike = v === 'mask' || v.startsWith('saved:');
                                  if (editingMaskClauseIndex === idx && !isMaskLike) {
                                    setEditingMaskClauseIndex(null);
                                    setCompositePaintDraft([]);
                                  }
                                  const clauses = [...patternComposite.clauses];
                                  if (v.startsWith('saved:')) {
                                    const id = v.slice(6);
                                    const sp = savedCustomPatterns.find((p) => p.id === id);
                                    if (sp) {
                                      clauses[idx] = maskClauseFromSavedCustom(sp);
                                    }
                                  } else if (v === 'mask') {
                                    const pos =
                                      compositePaintDraft.length > 0
                                        ? [...compositePaintDraft].sort()
                                        : ['2-2'];
                                    clauses[idx] = { kind: 'mask', positions: pos };
                                  } else if (v.startsWith('preset:')) {
                                    const preset = v.slice(7) as CompositeClausePreset;
                                    const prevClause = clauses[idx];
                                    if (preset === 'line') {
                                      clauses[idx] = {
                                        kind: 'preset',
                                        preset: 'line',
                                        ...(prevClause.kind === 'preset' &&
                                        prevClause.preset === 'line' &&
                                        prevClause.linesRequired != null
                                          ? {
                                              linesRequired: normalizeLinesRequired(prevClause.linesRequired),
                                            }
                                          : {}),
                                      };
                                    } else {
                                      clauses[idx] = { kind: 'preset', preset };
                                    }
                                  }
                                  commitPatternComposite({ ...patternComposite, clauses });
                                }}
                              >
                                <optgroup label="Built-in shapes">
                                  {COMPOSITE_CLAUSE_PRESETS.map((pk) => (
                                    <option key={pk} value={`preset:${pk}`}>
                                      {BINGO_PATTERNS[pk as BingoPattern]?.label ?? pk}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Saved custom shapes">
                                  {savedCustomPatterns.length === 0 ? (
                                    <option disabled value="">
                                      None yet — create under Custom pattern on this round
                                    </option>
                                  ) : (
                                    savedCustomPatterns.map((sp) => (
                                      <option key={sp.id} value={`saved:${sp.id}`}>
                                        {sp.name} ({sp.positions.length} sq)
                                      </option>
                                    ))
                                  )}
                                </optgroup>
                                <option value="mask">Paint new shape (grid below)</option>
                              </select>
                              {clause.kind === 'mask' && (
                                <span className="host-combined-pattern__clause-meta">
                                  {linkedSaved
                                    ? `Saved: ${linkedSaved.name}`
                                    : `${clause.positions.length} squares (painted)`}
                                </span>
                              )}
                              {clause.kind === 'mask' && (
                                <button
                                  type="button"
                                  className={`btn-secondary host-btn--sm${editingMaskClauseIndex === idx ? ' host-btn--active' : ''}`}
                                  onClick={() => {
                                    setEditingMaskClauseIndex(idx);
                                    setCompositePaintDraft([...clause.positions]);
                                  }}
                                >
                                  Edit in grid
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-secondary host-btn--sm"
                                disabled={patternComposite.clauses.length <= 1}
                                title={
                                  patternComposite.clauses.length <= 1
                                    ? 'Need at least one clause'
                                    : 'Remove this clause'
                                }
                                onClick={() => {
                                  let nextEdit = editingMaskClauseIndex;
                                  if (editingMaskClauseIndex !== null) {
                                    if (editingMaskClauseIndex === idx) nextEdit = null;
                                    else if (editingMaskClauseIndex > idx)
                                      nextEdit = editingMaskClauseIndex - 1;
                                  }
                                  const clauses = patternComposite.clauses.filter((_, j) => j !== idx);
                                  setEditingMaskClauseIndex(nextEdit);
                                  if (nextEdit === null) setCompositePaintDraft([]);
                                  commitPatternComposite({ ...patternComposite, clauses });
                                }}
                              >
                                Remove
                              </button>
                            </div>
                            {clause.kind === 'preset' && clause.preset === 'line' && (
                              <label className="host-combined-pattern__lines-row">
                                <span>Lines for this clause (1–{LINE_PATTERN_MAX_LINES})</span>
                                <input
                                  type="number"
                                  className="host-field-input host-field-input--narrow"
                                  min={1}
                                  max={LINE_PATTERN_MAX_LINES}
                                  value={normalizeLinesRequired(clause.linesRequired)}
                                  onChange={(e) => {
                                    const v = normalizeLinesRequired(parseInt(e.target.value, 10));
                                    const clauses = [...patternComposite.clauses];
                                    const prev = clauses[idx];
                                    if (!(prev.kind === 'preset' && prev.preset === 'line')) return;
                                    clauses[idx] = {
                                      kind: 'preset',
                                      preset: 'line',
                                      ...(v !== 1 ? { linesRequired: v } : {}),
                                    };
                                    commitPatternComposite({ ...patternComposite, clauses });
                                  }}
                                />
                              </label>
                            )}
                            {clauseSupportsMatchVariants(clause) && (
                              <div className="host-combined-pattern__variants">
                                <p className="host-combined-pattern__variants-hint">
                                  After you choose this clause&apos;s shape, optionally allow the{' '}
                                  <strong>same marked squares</strong> to count when the pattern appears oriented
                                  differently:
                                </p>
                                <label className="host-check-row">
                                  <input
                                    type="checkbox"
                                    className="host-control-checkbox"
                                    checked={clause.matchAllowRotation === true}
                                    onChange={(e) => {
                                      const clauses = [...patternComposite.clauses];
                                      const prev = clauses[idx];
                                      if (!clauseSupportsMatchVariants(prev)) return;
                                      const checked = e.target.checked;
                                      if (prev.kind === 'mask') {
                                        clauses[idx] = {
                                          kind: 'mask',
                                          positions: prev.positions,
                                          ...(checked ? { matchAllowRotation: true } : {}),
                                          ...(prev.matchAllowMirror ? { matchAllowMirror: true } : {}),
                                        };
                                      } else {
                                        const lrPreset =
                                          prev.kind === 'preset' && prev.preset === 'line'
                                            ? {
                                                ...(normalizeLinesRequired(prev.linesRequired) !== 1
                                                  ? {
                                                      linesRequired: normalizeLinesRequired(prev.linesRequired),
                                                    }
                                                  : {}),
                                              }
                                            : {};
                                        clauses[idx] = {
                                          kind: 'preset',
                                          preset: prev.preset,
                                          ...lrPreset,
                                          ...(checked ? { matchAllowRotation: true } : {}),
                                          ...(prev.matchAllowMirror ? { matchAllowMirror: true } : {}),
                                        };
                                      }
                                      commitPatternComposite({ ...patternComposite, clauses });
                                    }}
                                  />
                                  <span>
                                    <strong>Allow rotations</strong> — also win if this shape matches after 90°, 180°, or
                                    270° on the grid.
                                  </span>
                                </label>
                                <label className="host-check-row">
                                  <input
                                    type="checkbox"
                                    className="host-control-checkbox"
                                    checked={clause.matchAllowMirror === true}
                                    onChange={(e) => {
                                      const clauses = [...patternComposite.clauses];
                                      const prev = clauses[idx];
                                      if (!clauseSupportsMatchVariants(prev)) return;
                                      const checked = e.target.checked;
                                      if (prev.kind === 'mask') {
                                        clauses[idx] = {
                                          kind: 'mask',
                                          positions: prev.positions,
                                          ...(prev.matchAllowRotation ? { matchAllowRotation: true } : {}),
                                          ...(checked ? { matchAllowMirror: true } : {}),
                                        };
                                      } else {
                                        const lrPreset =
                                          prev.kind === 'preset' && prev.preset === 'line'
                                            ? {
                                                ...(normalizeLinesRequired(prev.linesRequired) !== 1
                                                  ? {
                                                      linesRequired: normalizeLinesRequired(prev.linesRequired),
                                                    }
                                                  : {}),
                                              }
                                            : {};
                                        clauses[idx] = {
                                          kind: 'preset',
                                          preset: prev.preset,
                                          ...lrPreset,
                                          ...(prev.matchAllowRotation ? { matchAllowRotation: true } : {}),
                                          ...(checked ? { matchAllowMirror: true } : {}),
                                        };
                                      }
                                      commitPatternComposite({ ...patternComposite, clauses });
                                    }}
                                  />
                                  <span>
                                    <strong>Allow mirrors</strong> — also win if this shape matches after a horizontal or
                                    vertical flip.
                                  </span>
                                </label>
                              </div>
                            )}
                          </div>
                        );
                      })}
            </div>

            <div className="host-combined-pattern__add-clause">
              <button
                type="button"
                className="btn-secondary host-btn--sm"
                onClick={() =>
                  commitPatternComposite({
                    ...patternComposite,
                    clauses: [...patternComposite.clauses, { kind: 'preset', preset: 'line' }],
                  })
                }
              >
                + Add clause
              </button>
            </div>

            <div className="host-combined-pattern__paint-section">
              <p className="host-muted host-combined-pattern__paint-hint">
                {editingMaskClauseIndex !== null ? (
                  <>
                    <span className="host-combined-pattern__paint-hint-accent">
                      Editing painted clause {editingMaskClauseIndex + 1}
                    </span>
                    {' — '}
                    change squares below, then apply (or cancel).
                  </>
                ) : (
                  <>
                    Paint one reference shape below. Rotations / mirrors are only the checkboxes on each clause — not
                    separate buttons here.
                  </>
                )}
              </p>
              <div className="host-actions-row" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="btn-secondary host-btn--sm"
                  onClick={() => setCompositePaintDraft([])}
                >
                  Clear draft
                </button>
              </div>
              <div className="host-bingo-grid" style={{ marginBottom: 10 }}>
                {Array.from({ length: 25 }, (_, index) => {
                  const row = Math.floor(index / 5);
                  const col = index % 5;
                  const position = `${row}-${col}`;
                  const on = compositePaintDraft.includes(position);
                  return (
                    <button
                      key={position}
                      type="button"
                      className={`host-bingo-cell${on ? ' host-bingo-cell--on' : ''}`}
                      onClick={() => {
                        setCompositePaintDraft((prev) =>
                          prev.includes(position)
                            ? prev.filter((p) => p !== position)
                            : [...prev, position].sort(),
                        );
                      }}
                    >
                      {on ? '✓' : ''}
                    </button>
                  );
                })}
              </div>
              <div className="host-actions-row">
                {editingMaskClauseIndex !== null ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary host-btn--sm"
                      disabled={compositePaintDraft.length === 0}
                      onClick={() => {
                                const i = editingMaskClauseIndex;
                                if (i === null || compositePaintDraft.length === 0) return;
                                const clauses = [...patternComposite.clauses];
                                if (i < 0 || i >= clauses.length) return;
                                const prevClause = clauses[i];
                                const mvFlags =
                                  prevClause.kind === 'mask'
                                    ? {
                                        ...(prevClause.matchAllowRotation ? { matchAllowRotation: true as const } : {}),
                                        ...(prevClause.matchAllowMirror ? { matchAllowMirror: true as const } : {}),
                                      }
                                    : {};
                                clauses[i] = {
                                  kind: 'mask',
                                  positions: [...compositePaintDraft].sort(),
                                  ...mvFlags,
                                };
                                commitPatternComposite({ ...patternComposite, clauses });
                                setEditingMaskClauseIndex(null);
                                setCompositePaintDraft([]);
                                addLog(`Updated painted clause ${i + 1}`, 'info');
                              }}
                            >
                              Apply to clause {editingMaskClauseIndex + 1}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary host-btn--sm"
                              onClick={() => {
                                setEditingMaskClauseIndex(null);
                                setCompositePaintDraft([]);
                              }}
                            >
                              Cancel edit
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary host-btn--sm"
                            disabled={compositePaintDraft.length === 0}
                            onClick={() => {
                              if (!compositePaintDraft.length) return;
                              commitPatternComposite({
                                ...patternComposite,
                                clauses: [
                                  ...patternComposite.clauses,
                                  { kind: 'mask', positions: [...compositePaintDraft].sort() },
                                ],
                              });
                              setCompositePaintDraft([]);
                            }}
                          >
                            Add painted squares as clause
                          </button>
                        )}
              </div>
            </div>
          </div>

          <div className="host-footer-actions">
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
      </div>
    </HostSubmodalPortal>
  );
};

export default CombinedPatternModal;
