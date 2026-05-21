import React from 'react';
import { Save, Trash2 } from 'lucide-react';
import HostSubmodalPortal from './HostSubmodalPortal';
import {
  BingoPattern,
  BINGO_PATTERNS,
  COMPOSITE_CLAUSE_PRESETS,
  CompositeClausePreset,
  PatternCompositeSpec,
  SavedCompositePattern,
  clauseSupportsMatchVariants,
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
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              border: '1px solid rgba(0, 255, 136, 0.35)',
              background: 'rgba(0, 255, 136, 0.06)',
            }}
          >
﻿                    <div
                      style={{
                        fontWeight: 700,
                        marginBottom: 10,
                        color: '#e8ecf1',
                        fontSize: '0.9rem',
                        textAlign: 'center',
                      }}
                    >
                      {patternComposite.op === 'or'
                        ? 'Win if any clause completes'
                        : 'Win only when every clause completes'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginBottom: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ color: '#9aa5b1', fontSize: '0.78rem' }}>Combine with</span>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => commitPatternComposite({ ...patternComposite, op: 'or' })}
                        style={{
                          fontSize: '0.78rem',
                          borderColor:
                            patternComposite.op === 'or' ? 'rgba(0,255,136,0.75)' : 'rgba(255,255,255,0.25)',
                          color: patternComposite.op === 'or' ? '#00ff88' : '#e0e0e0',
                        }}
                      >
                        Any (OR)
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => commitPatternComposite({ ...patternComposite, op: 'and' })}
                        style={{
                          fontSize: '0.78rem',
                          borderColor:
                            patternComposite.op === 'and' ? 'rgba(0,255,136,0.75)' : 'rgba(255,255,255,0.25)',
                          color: patternComposite.op === 'and' ? '#00ff88' : '#e0e0e0',
                        }}
                      >
                        All (AND)
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginBottom: 14,
                        paddingBottom: 12,
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#b9c3cd' }}>
                        Saved recipe
                        <select
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
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: '1px solid rgba(255,255,255,0.25)',
                            background: 'rgba(0,0,0,0.35)',
                            color: '#fff',
                            fontSize: '0.76rem',
                            maxWidth: 200,
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
                        className="btn-secondary"
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
                        style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden />
                        Delete
                      </button>
                      <input
                        type="text"
                        value={compositeRecipeSaveName}
                        onChange={(e) => setCompositeRecipeSaveName(e.target.value)}
                        placeholder="Name for current recipe"
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: '1px solid rgba(255,255,255,0.25)',
                          background: 'rgba(0,0,0,0.35)',
                          color: '#fff',
                          fontSize: '0.76rem',
                          width: 160,
                        }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
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
                        style={{ fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        <Save className="w-3.5 h-3.5" aria-hidden />
                        Save
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {patternComposite.clauses.map((clause, idx) => {
                        const sel =
                          clause.kind === 'preset' ? `preset:${clause.preset}` : 'mask';
                        return (
                          <div
                            key={`clause-${idx}`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              alignItems: 'stretch',
                              maxWidth: 520,
                              marginLeft: 'auto',
                              marginRight: 'auto',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 8,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <select
                                value={sel}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (editingMaskClauseIndex === idx && v !== 'mask') {
                                    setEditingMaskClauseIndex(null);
                                    setCompositePaintDraft([]);
                                  }
                                  const clauses = [...patternComposite.clauses];
                                  if (v === 'mask') {
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
                                style={{
                                  padding: '6px 10px',
                                  borderRadius: 6,
                                  border: '1px solid rgba(255,255,255,0.25)',
                                  background: 'rgba(0,0,0,0.35)',
                                  color: '#fff',
                                  fontSize: '0.78rem',
                                }}
                              >
                                {COMPOSITE_CLAUSE_PRESETS.map((pk) => (
                                  <option key={pk} value={`preset:${pk}`}>
                                    {BINGO_PATTERNS[pk as BingoPattern]?.label ?? pk}
                                  </option>
                                ))}
                                <option value="mask">Painted shape (uses grid below)</option>
                              </select>
                              {clause.kind === 'mask' && (
                                <span style={{ fontSize: '0.72rem', color: '#9aa5b1' }}>
                                  {clause.positions.length} squares
                                </span>
                              )}
                              {clause.kind === 'mask' && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => {
                                    setEditingMaskClauseIndex(idx);
                                    setCompositePaintDraft([...clause.positions]);
                                  }}
                                  style={{
                                    fontSize: '0.72rem',
                                    padding: '4px 8px',
                                    borderColor:
                                      editingMaskClauseIndex === idx
                                        ? 'rgba(0,255,136,0.75)'
                                        : 'rgba(255,255,255,0.25)',
                                    color: editingMaskClauseIndex === idx ? '#00ff88' : '#e0e0e0',
                                  }}
                                >
                                  Edit in grid
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-secondary"
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
                                style={{
                                  fontSize: '0.72rem',
                                  padding: '4px 8px',
                                  opacity: patternComposite.clauses.length <= 1 ? 0.45 : 1,
                                }}
                              >
                                Remove
                              </button>
                            </div>
                            {clause.kind === 'preset' && clause.preset === 'line' && (
                              <label
                                style={{
                                  fontSize: '0.78rem',
                                  color: '#c5cdd6',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  flexWrap: 'wrap',
                                  justifyContent: 'center',
                                  marginTop: 2,
                                }}
                              >
                                Lines for this clause (1–{LINE_PATTERN_MAX_LINES})
                                <input
                                  type="number"
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
                                  style={{
                                    width: 56,
                                    padding: '6px 8px',
                                    borderRadius: 8,
                                    border: '1px solid rgba(255,255,255,0.28)',
                                    background: 'rgba(0,0,0,0.35)',
                                    color: '#fff',
                                    fontSize: '0.85rem',
                                  }}
                                />
                              </label>
                            )}
                            {clauseSupportsMatchVariants(clause) && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 10,
                                  alignItems: 'stretch',
                                  padding: '8px 10px 10px',
                                  borderRadius: 8,
                                  background: 'rgba(0,0,0,0.18)',
                                  maxWidth: 460,
                                  marginLeft: 'auto',
                                  marginRight: 'auto',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    color: '#8a96a3',
                                    textAlign: 'center',
                                    lineHeight: 1.45,
                                  }}
                                >
                                  After you choose this clause&apos;s shape, optionally allow the{' '}
                                  <strong style={{ color: '#c5cdd6' }}>same marked squares</strong> to count when the
                                  pattern appears oriented differently:
                                </span>
                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 10,
                                    fontSize: '0.74rem',
                                    color: '#dce4ec',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                >
                                  <input
                                    type="checkbox"
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
                                    style={{ marginTop: 3 }}
                                  />
                                  <span>
                                    <strong>Allow rotations</strong> — also win if this shape matches after 90°, 180°, or
                                    270° on the grid.
                                  </span>
                                </label>
                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 10,
                                    fontSize: '0.74rem',
                                    color: '#dce4ec',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                >
                                  <input
                                    type="checkbox"
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
                                    style={{ marginTop: 3 }}
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

                    <div style={{ textAlign: 'center', marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          commitPatternComposite({
                            ...patternComposite,
                            clauses: [...patternComposite.clauses, { kind: 'preset', preset: 'line' }],
                          })
                        }
                        style={{ fontSize: '0.78rem' }}
                      >
                        + Add clause
                      </button>
                    </div>

                    <div
                      style={{
                        marginTop: 16,
                        borderTop: '1px solid rgba(255,255,255,0.12)',
                        paddingTop: 12,
                      }}
                    >
                      <div style={{ fontSize: '0.76rem', color: '#9aa5b1', marginBottom: 8, textAlign: 'center' }}>
                        {editingMaskClauseIndex !== null ? (
                          <>
                            <span style={{ color: '#7dd3fc' }}>
                              Editing painted clause {editingMaskClauseIndex + 1}
                            </span>
                            {' — '}
                            change squares below, then apply (or cancel).
                          </>
                        ) : (
                          <>
                            Paint one reference shape below. Rotations / mirrors are only the checkboxes on each clause —
                            not separate buttons here.
                          </>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                          marginBottom: 10,
                        }}
                      >
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setCompositePaintDraft([])}
                          style={{ fontSize: '0.72rem' }}
                        >
                          Clear draft
                        </button>
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(5, 1fr)',
                          gap: 4,
                          maxWidth: 260,
                          margin: '0 auto 10px',
                        }}
                      >
                        {Array.from({ length: 25 }, (_, index) => {
                          const row = Math.floor(index / 5);
                          const col = index % 5;
                          const position = `${row}-${col}`;
                          const on = compositePaintDraft.includes(position);
                          return (
                            <button
                              key={position}
                              type="button"
                              onClick={() => {
                                setCompositePaintDraft((prev) =>
                                  prev.includes(position)
                                    ? prev.filter((p) => p !== position)
                                    : [...prev, position].sort(),
                                );
                              }}
                              style={{
                                width: 46,
                                height: 46,
                                border: '2px solid rgba(255,255,255,0.28)',
                                borderRadius: 8,
                                background: on ? '#00ff88' : 'rgba(255,255,255,0.07)',
                                color: on ? '#001a0d' : '#fff',
                                cursor: 'pointer',
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              {on ? '✓' : ''}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ textAlign: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                        {editingMaskClauseIndex !== null ? (
                          <>
                            <button
                              type="button"
                              className="btn-secondary"
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
                              style={{ fontSize: '0.78rem' }}
                            >
                              Apply to clause {editingMaskClauseIndex + 1}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => {
                                setEditingMaskClauseIndex(null);
                                setCompositePaintDraft([]);
                              }}
                              style={{ fontSize: '0.78rem' }}
                            >
                              Cancel edit
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary"
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
                            style={{ fontSize: '0.78rem' }}
                          >
                            Add painted squares as clause
                          </button>
                        )}
                      </div>
                    </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18, gap: 10 }}>
            <button type="button" className="btn-primary" onClick={onClose} style={{ fontSize: '0.85rem', padding: '8px 22px' }}>
              Done
            </button>
          </div>
    </HostSubmodalPortal>
  );
};

export default CombinedPatternModal;
