import React from 'react';
import { ListMusic, Printer, Save } from 'lucide-react';
import {
  BINGO_PATTERNS,
  PATTERN_OPTIONS,
  PRESET_SHAPE_PATTERNS,
  LINE_PATTERN_MAX_LINES,
  normalizeLinesRequired,
  type BingoPattern,
  type SavedCustomPattern,
} from '../patternDefinitions';

export interface RoundBucketSettingsRound {
  id: string;
  name: string;
  playlistIds: string[];
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  linesRequired?: number;
  freeSpaceEnabled?: boolean;
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
  savedMixSnapshot?: { songs: { length: number }; mixGeometry: string; savedAt: number };
}

export interface RoundBucketBingoPatch {
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  patternComposite?: import('../patternDefinitions').PatternCompositeSpec;
  freeSpaceEnabled?: boolean;
  linesRequired?: number;
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
}

interface RoundBucketSettingsProps {
  round: RoundBucketSettingsRound;
  roundIndex: number;
  hostDefaultFreeSpace: boolean;
  savedCustomPatterns: SavedCustomPattern[];
  onUpdateBingo: (roundIndex: number, patch: RoundBucketBingoPatch) => void;
  onSaveRound?: () => void;
  saveRoundBusy?: boolean;
  snapshotReady: boolean;
  printablePdfLoading?: boolean;
  callSheetReady?: boolean;
  onPrintPdf?: () => void;
  onCallSheet?: () => void;
  onOpenComposite?: () => void;
  onNewCustomPattern?: (roundIndex: number) => void;
}

const RoundBucketSettings: React.FC<RoundBucketSettingsProps> = ({
  round,
  roundIndex,
  hostDefaultFreeSpace,
  savedCustomPatterns,
  onUpdateBingo,
  onSaveRound,
  saveRoundBusy,
  snapshotReady,
  printablePdfLoading,
  callSheetReady,
  onPrintPdf,
  onCallSheet,
  onOpenComposite,
  onNewCustomPattern,
}) => {
  const pattern = round.bingoPattern ?? 'line';
  const hasPlaylists = (round.playlistIds || []).length > 0;
  const freeCenter =
    round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : hostDefaultFreeSpace;
  const needTracks = freeCenter ? 24 : 25;

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
        ? { customMatchAllowRotation: undefined, customMatchAllowMirror: undefined }
        : {}),
    });
    if (v === 'composite') {
      window.setTimeout(() => openCombinedEditor(), 0);
    }
    if (v === 'custom') onNewCustomPattern?.(roundIndex);
  };

  return (
    <div className="round-bucket-settings">
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
              value={(() => {
                const mask = round.customPatternMask;
                if (!mask?.length) return '';
                const norm = (arr: string[]) => [...arr].sort().join(',');
                const key = norm(mask);
                const sp = savedCustomPatterns.find((p) => norm(p.positions) === key);
                return sp?.id ?? '';
              })()}
              onChange={(e) => {
                const id = e.target.value;
                const sp = savedCustomPatterns.find((p) => p.id === id);
                if (sp) {
                  onUpdateBingo(roundIndex, {
                    bingoPattern: 'custom',
                    customPatternMask: [...sp.positions],
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
            ? 'Drag playlists from the library'
            : snapshotReady
              ? `Saved · ${round.savedMixSnapshot!.songs.length} tracks (${round.savedMixSnapshot!.mixGeometry})`
              : `Not saved · need ${needTracks} tracks`}
        </span>
        <div className="round-bucket-settings__actions">
          {hasPlaylists && onSaveRound ? (
            <button
              type="button"
              className="round-bucket-settings__action"
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
              disabled={printablePdfLoading}
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
