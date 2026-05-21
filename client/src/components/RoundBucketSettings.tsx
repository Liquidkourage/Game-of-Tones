import React from 'react';
import { Save } from 'lucide-react';
import {
  PATTERN_OPTIONS,
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
  savedMixSnapshot?: { songs: { length: number }; mixGeometry: string; savedAt: number };
}

export interface RoundBucketBingoPatch {
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  patternComposite?: undefined;
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
  onSaveRound?: (roundIndex: number) => void;
  saveRoundBusy?: boolean;
  snapshotReady: boolean;
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
}) => {
  const pattern = round.bingoPattern ?? 'line';
  const hasPlaylists = (round.playlistIds || []).length > 0;
  const freeCenter =
    round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : hostDefaultFreeSpace;
  const needTracks = freeCenter ? 24 : 25;

  return (
    <div className="round-bucket-settings">
      <div className="round-bucket-settings__row">
        <label className="round-bucket-settings__field">
          <span className="round-bucket-settings__label">Pattern</span>
          <select
            className="round-bucket-settings__select"
            value={pattern}
            onChange={(e) => {
              const v = e.target.value as BingoPattern;
              onUpdateBingo(roundIndex, {
                bingoPattern: v,
                ...(v !== 'custom' ? { customPatternMask: undefined } : {}),
                ...(v !== 'composite' ? { patternComposite: undefined } : {}),
              });
            }}
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

        {pattern === 'custom' ? (
          <label className="round-bucket-settings__field">
            <span className="round-bucket-settings__label">Shape</span>
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
        ) : null}

        <label className="round-bucket-settings__field round-bucket-settings__field--check">
          <input
            type="checkbox"
            checked={freeCenter}
            onChange={(e) =>
              onUpdateBingo(roundIndex, { freeSpaceEnabled: e.target.checked })
            }
          />
          <span className="round-bucket-settings__label">Free center</span>
        </label>
      </div>

      {pattern === 'composite' ? (
        <p className="round-bucket-settings__hint">
          Combined (AND/OR) rules: use <strong>Manager → Bingo Pattern</strong> for the full editor.
        </p>
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
            ? 'Add playlists to configure'
            : snapshotReady
              ? `Saved · ${round.savedMixSnapshot!.songs.length} tracks (${round.savedMixSnapshot!.mixGeometry})`
              : `Not saved · need ${needTracks} tracks after Save round`}
        </span>
        {hasPlaylists && onSaveRound ? (
          <button
            type="button"
            className="round-bucket-settings__save"
            disabled={saveRoundBusy}
            title="Finalize if needed, then freeze playback order for this round"
            onClick={() => onSaveRound(roundIndex)}
          >
            <Save className="w-3 h-3" aria-hidden />
            {saveRoundBusy ? 'Saving…' : 'Save round'}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default RoundBucketSettings;
