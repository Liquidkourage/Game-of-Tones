import React from 'react';
import { ListMusic, Pencil, Printer, Save, Trash2 } from 'lucide-react';
import {
  BINGO_PATTERNS,
  PATTERN_OPTIONS,
  PRESET_SHAPE_PATTERNS,
  LINE_PATTERN_MAX_LINES,
  normalizeLinesRequired,
  deleteCustomPattern,
  getSavedCustomPatterns,
  renameCustomPattern,
  type BingoPattern,
  type PatternCompositeSpec,
  type SavedCustomPattern,
} from '../patternDefinitions';
import HostPatternMiniPreview from './HostPatternMiniPreview';

export interface RoundBucketSettingsRound {
  id: string;
  name: string;
  playlistIds: string[];
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  patternComposite?: PatternCompositeSpec;
  linesRequired?: number;
  freeSpaceEnabled?: boolean;
  customMatchReverse?: boolean;
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
  savedMixSnapshot?: { songs: { length: number }; mixGeometry: string; savedAt: number };
  /** Optional prize shown on projector + night winners board. */
  prize?: string;
}

export interface RoundBucketBingoPatch {
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  patternComposite?: import('../patternDefinitions').PatternCompositeSpec;
  freeSpaceEnabled?: boolean;
  linesRequired?: number;
  customMatchReverse?: boolean;
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
  prize?: string;
}

interface RoundBucketSettingsProps {
  round: RoundBucketSettingsRound;
  roundIndex: number;
  hostDefaultFreeSpace: boolean;
  savedCustomPatterns: SavedCustomPattern[];
  onUpdateBingo: (roundIndex: number, patch: RoundBucketBingoPatch) => void;
  /** Refresh React state after localStorage rename/delete (also triggers org shelf replace). */
  onSavedCustomPatternsChange?: (next: SavedCustomPattern[]) => void;
  onSaveRound?: () => void;
  saveRoundBusy?: boolean;
  snapshotReady: boolean;
  printablePdfLoading?: boolean;
  callSheetReady?: boolean;
  onPrintPdf?: () => void;
  onCallSheet?: () => void;
  onOpenComposite?: () => void;
  onNewCustomPattern?: (roundIndex: number) => void;
  /** Live deduped card-ready pool size for this round (0 = tracks not hydrated yet). */
  poolCount?: number;
  /** Required card-ready tracks (24/25 for MIX by Free Center; 75 for 5×15 / 1×75). */
  minRequired?: number;
  /** Sum of Spotify-listed track counts across assigned playlists (metadata, not loaded tracks). */
  listedTotal?: number;
  /** Tracks for this round are expected to be hydrating right now (round is the active mix). */
  tracksLikelyLoading?: boolean;
}

function matchSavedCustomByMask(
  mask: string[] | undefined,
  saved: SavedCustomPattern[],
): SavedCustomPattern | null {
  if (!mask?.length) return null;
  const norm = (arr: string[]) => [...arr].sort().join(',');
  const key = norm(mask);
  return saved.find((p) => norm(p.positions) === key) ?? null;
}

const RoundBucketSettings: React.FC<RoundBucketSettingsProps> = ({
  round,
  roundIndex,
  hostDefaultFreeSpace,
  savedCustomPatterns,
  onUpdateBingo,
  onSavedCustomPatternsChange,
  onSaveRound,
  saveRoundBusy,
  snapshotReady,
  printablePdfLoading,
  callSheetReady,
  onPrintPdf,
  onCallSheet,
  onOpenComposite,
  onNewCustomPattern,
  poolCount = 0,
  minRequired,
  listedTotal = 0,
  tracksLikelyLoading = false,
}) => {
  const pattern = round.bingoPattern ?? 'line';
  const hasPlaylists = (round.playlistIds || []).length > 0;
  const freeCenter =
    round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : hostDefaultFreeSpace;
  /** Card-ready tracks required to save: dynamic 24/25 by Free Center unless geometry needs 75. */
  const requiredTracks = minRequired ?? (freeCenter ? 24 : 25);
  const selectedSavedCustom = matchSavedCustomByMask(round.customPatternMask, savedCustomPatterns);

  /**
   * Readiness copy distinguishes Spotify-listed metadata from the actual loaded/deduped
   * card-ready pool — listed totals alone never imply the round is ready.
   */
  const notSavedStatus = (() => {
    if (poolCount >= requiredTracks) {
      return `Not saved · ${poolCount} of ${requiredTracks} card-ready tracks loaded — Save to lock`;
    }
    if (poolCount > 0) {
      return `Not saved · ${poolCount} of ${requiredTracks} card-ready tracks loaded`;
    }
    if (tracksLikelyLoading) {
      return 'Not saved · playlist tracks are still loading…';
    }
    return `Not saved · 0 of ${requiredTracks} card-ready tracks loaded${
      listedTotal > 0 ? ` (${listedTotal} listed on Spotify — not loaded yet)` : ''
    }`;
  })();

  const openCombinedEditor = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    onOpenComposite?.();
  };

  const selectPattern = (v: BingoPattern) => {
    onUpdateBingo(roundIndex, {
      bingoPattern: v,
      ...(v !== 'custom' ? { customPatternMask: undefined } : {}),
      ...(v !== 'composite' ? { patternComposite: undefined } : {}),
      ...(v !== 'custom'
        ? { customMatchReverse: undefined, customMatchAllowRotation: undefined, customMatchAllowMirror: undefined }
        : {}),
    });
    if (v === 'composite') {
      window.setTimeout(() => openCombinedEditor(), 0);
    }
    if (v === 'custom') onNewCustomPattern?.(roundIndex);
  };

  const previewLabel =
    pattern === 'custom' && selectedSavedCustom
      ? selectedSavedCustom.name
      : pattern === 'composite'
        ? BINGO_PATTERNS.composite.label
        : BINGO_PATTERNS[pattern]?.label ?? 'Pattern';

  const handleRenameSavedCustom = () => {
    if (!selectedSavedCustom) return;
    const next = window.prompt('Rename saved shape', selectedSavedCustom.name);
    if (next == null) return;
    const updated = renameCustomPattern(selectedSavedCustom.id, next);
    if (!updated) {
      window.alert('Enter a non-empty name.');
      return;
    }
    onSavedCustomPatternsChange?.(getSavedCustomPatterns());
  };

  const handleDeleteSavedCustom = () => {
    if (!selectedSavedCustom) return;
    if (!window.confirm(`Delete saved shape “${selectedSavedCustom.name}”?`)) return;
    deleteCustomPattern(selectedSavedCustom.id);
    onSavedCustomPatternsChange?.(getSavedCustomPatterns());
  };

  return (
    <div className="round-bucket-settings host-ui">
      <div className="round-bucket-settings__row">
        <label className="round-bucket-settings__field round-bucket-settings__field--prize">
          <span className="round-bucket-settings__label">Prize</span>
          <input
            type="text"
            className="round-bucket-settings__input"
            maxLength={120}
            placeholder="e.g. Free pitcher"
            value={round.prize ?? ''}
            onChange={(e) => onUpdateBingo(roundIndex, { prize: e.target.value })}
          />
        </label>
      </div>

      <div className="round-bucket-settings__row">
        <label className="round-bucket-settings__field">
          <span className="round-bucket-settings__label">Pattern</span>
          <select
            className="round-bucket-settings__select"
            value={pattern}
            onChange={(e) => selectPattern(e.target.value as BingoPattern)}
          >
            {PATTERN_OPTIONS.filter((opt) => opt.value !== 'blackout').map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {pattern === 'line' ? (
          <label className="round-bucket-settings__field round-bucket-settings__field--narrow">
            <span className="round-bucket-settings__label">Lines</span>
            <input
              type="number"
              className="round-bucket-settings__input"
              min={1}
              max={LINE_PATTERN_MAX_LINES}
              value={normalizeLinesRequired(round.linesRequired ?? 1)}
              onChange={(e) =>
                onUpdateBingo(roundIndex, {
                  linesRequired: normalizeLinesRequired(parseInt(e.target.value, 10)),
                })
              }
            />
          </label>
        ) : null}

        <label className="round-bucket-settings__field round-bucket-settings__field--check">
          <input
            type="checkbox"
            className="host-control-checkbox"
            checked={freeCenter}
            onChange={(e) => onUpdateBingo(roundIndex, { freeSpaceEnabled: e.target.checked })}
          />
          <span className="round-bucket-settings__label">Free center</span>
        </label>
      </div>

      <div className="round-bucket-settings__shapes" role="group" aria-label="Pattern presets">
        {PRESET_SHAPE_PATTERNS.map((shapeKey) => {
          const active = pattern === shapeKey;
          return (
            <button
              key={shapeKey}
              type="button"
              className={
                active
                  ? 'round-bucket-settings__shape round-bucket-settings__shape--active'
                  : 'round-bucket-settings__shape'
              }
              title={BINGO_PATTERNS[shapeKey].description}
              onClick={() => selectPattern(shapeKey)}
            >
              {BINGO_PATTERNS[shapeKey].label}
            </button>
          );
        })}
      </div>

      <div className="round-bucket-settings__preview-row">
        <HostPatternMiniPreview
          pattern={pattern}
          linesRequired={round.linesRequired}
          customPattern={round.customPatternMask}
          customMatchReverse={round.customMatchReverse}
          customMatchAllowRotation={round.customMatchAllowRotation}
          customMatchAllowMirror={round.customMatchAllowMirror}
          patternComposite={round.patternComposite}
          label={`Preview: ${previewLabel}`}
        />
        <span className="round-bucket-settings__preview-label">{previewLabel}</span>
      </div>

      {(pattern === 'composite' || pattern === 'custom') && (onOpenComposite || onNewCustomPattern) ? (
        <div className="round-bucket-settings__pattern-editor">
          {pattern === 'composite' && onOpenComposite ? (
            <button
              type="button"
              className="round-bucket-settings__pattern-editor-btn round-bucket-settings__pattern-editor-btn--primary"
              onClick={openCombinedEditor}
            >
              Edit combined pattern…
            </button>
          ) : null}
          {pattern === 'custom' && onNewCustomPattern ? (
            <button
              type="button"
              className="round-bucket-settings__pattern-editor-btn round-bucket-settings__pattern-editor-btn--primary"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNewCustomPattern(roundIndex);
              }}
            >
              Draw custom pattern…
            </button>
          ) : null}
        </div>
      ) : null}

      {pattern === 'custom' ? (
        <div className="round-bucket-settings__custom">
          <label className="round-bucket-settings__field">
            <span className="round-bucket-settings__label">Saved shape</span>
            <select
              className="round-bucket-settings__select"
              value={selectedSavedCustom?.id ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                const sp = savedCustomPatterns.find((p) => p.id === id);
                if (sp) {
                  onUpdateBingo(roundIndex, {
                    bingoPattern: 'custom',
                    customPatternMask: [...sp.positions],
                    customMatchReverse: sp.matchReverse === true,
                    customMatchAllowRotation: sp.matchAllowRotation === true,
                    customMatchAllowMirror: sp.matchAllowMirror === true,
                  });
                }
              }}
            >
              <option value="">Pick saved shape…</option>
              {savedCustomPatterns.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </label>
          {selectedSavedCustom ? (
            <div className="round-bucket-settings__library-actions">
              <button
                type="button"
                className="round-bucket-settings__link-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRenameSavedCustom();
                }}
              >
                <Pencil className="w-3 h-3" aria-hidden />
                Rename
              </button>
              <button
                type="button"
                className="round-bucket-settings__link-btn round-bucket-settings__link-btn--danger"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDeleteSavedCustom();
                }}
              >
                <Trash2 className="w-3 h-3" aria-hidden />
                Delete
              </button>
            </div>
          ) : null}
          {onNewCustomPattern ? (
            <button
              type="button"
              className="round-bucket-settings__link-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNewCustomPattern(roundIndex);
              }}
            >
              New custom
            </button>
          ) : null}
          <label className="round-bucket-settings__field round-bucket-settings__field--check">
            <input
              type="checkbox"
              className="host-control-checkbox"
              checked={round.customMatchReverse === true}
              onChange={(e) =>
                onUpdateBingo(roundIndex, {
                  bingoPattern: 'custom',
                  customPatternMask: round.customPatternMask,
                  customMatchReverse: e.target.checked,
                })
              }
            />
            <span className="round-bucket-settings__label">Reverse</span>
          </label>
          <label className="round-bucket-settings__field round-bucket-settings__field--check">
            <input
              type="checkbox"
              className="host-control-checkbox"
              checked={round.customMatchAllowRotation === true}
              onChange={(e) =>
                onUpdateBingo(roundIndex, {
                  bingoPattern: 'custom',
                  customPatternMask: round.customPatternMask,
                  customMatchAllowRotation: e.target.checked,
                })
              }
            />
            <span className="round-bucket-settings__label">Rotations</span>
          </label>
          <label className="round-bucket-settings__field round-bucket-settings__field--check">
            <input
              type="checkbox"
              className="host-control-checkbox"
              checked={round.customMatchAllowMirror === true}
              onChange={(e) =>
                onUpdateBingo(roundIndex, {
                  bingoPattern: 'custom',
                  customPatternMask: round.customPatternMask,
                  customMatchAllowMirror: e.target.checked,
                })
              }
            />
            <span className="round-bucket-settings__label">Mirrors</span>
          </label>
        </div>
      ) : null}

      <div className="round-bucket-settings__footer">
        <span
          className={
            snapshotReady
              ? 'round-bucket-settings__status round-bucket-settings__status--ok'
              : hasPlaylists
                ? 'round-bucket-settings__status'
                : 'round-bucket-settings__status round-bucket-settings__status--muted'
          }
        >
          {!hasPlaylists
            ? 'No playlists'
            : snapshotReady
              ? `Saved · ${round.savedMixSnapshot!.songs.length} in bingo pool (${round.savedMixSnapshot!.mixGeometry})`
              : notSavedStatus}
        </span>
        <div className="round-bucket-settings__actions">
          {hasPlaylists && onSaveRound ? (
            <button
              type="button"
              className="round-bucket-settings__action round-bucket-settings__action--primary"
              disabled={saveRoundBusy}
              onClick={onSaveRound}
            >
              <Save className="w-3 h-3" aria-hidden />
              {saveRoundBusy ? 'Saving…' : 'Save'}
            </button>
          ) : null}
          {hasPlaylists && onPrintPdf ? (
            <button
              type="button"
              className="round-bucket-settings__action"
              disabled={printablePdfLoading || !callSheetReady}
              title={!callSheetReady ? 'Save round first' : undefined}
              onClick={onPrintPdf}
            >
              <Printer className="w-3 h-3" aria-hidden />
              Print PDF
            </button>
          ) : null}
          {hasPlaylists && onCallSheet ? (
            <button
              type="button"
              className="round-bucket-settings__action"
              disabled={printablePdfLoading || !callSheetReady}
              onClick={onCallSheet}
            >
              <ListMusic className="w-3 h-3" aria-hidden />
              Call sheet
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default RoundBucketSettings;
