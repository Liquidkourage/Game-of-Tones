import React from 'react';
import { Copy, Download, Link2, LayoutTemplate } from 'lucide-react';
import HostActivityFeed from './HostActivityFeed';
import HostEventActivationBar from './HostEventActivationBar';
import HostPlayerFeedbackList, { type PlayerFeedbackEntry } from './HostPlayerFeedbackList';
import type { HostActivityEntry } from '../../host/hostActivityLog';
import {
  DEFAULT_PLAYLIST_TITLE_FLAGS,
  GAME_LAYOUT_IDS,
  type BingoWinPolicy,
  type GameLayout,
} from '../../utils/hostPreferences';
import type { PublicDisplayTitleRevealMode } from '../../utils/publicDisplayTitleReveal';

const GAME_LAYOUT_OPTIONS: {
  id: GameLayout;
  name: string;
  blurb: string;
}[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Four-card grid with full round summary and Up next.',
  },
  {
    id: 'focus',
    name: 'Focus',
    blurb: 'Now Playing full-width; hide summary live; shorter Up next.',
  },
  {
    id: 'transport',
    name: 'Transport',
    blurb: 'Now Playing + call log; Bump / Mark played in Quick → More.',
  },
  {
    id: 'compact',
    name: 'Compact',
    blurb: 'Dense stack; Tonight closed live; summary as a status chip.',
  },
  {
    id: 'show_desk',
    name: 'Show desk',
    blurb: 'Bingo verify sticky on top; Quick emphasizes Reject / Resume / End.',
  },
];

/** Tiny wireframe preview — layout readable, no theme colors. */
function GameLayoutPreview({ id }: { id: GameLayout }) {
  const stroke = 'currentColor';
  const fill = 'currentColor';
  return (
    <svg
      className="host-game-layout-preview"
      viewBox="0 0 72 48"
      width={72}
      height={48}
      aria-hidden
    >
      {id === 'classic' ? (
        <>
          <rect x="2" y="2" width="32" height="18" rx="2" fillOpacity="0.22" stroke={stroke} strokeWidth="1.2" />
          <rect x="38" y="2" width="32" height="44" rx="2" fillOpacity="0.12" stroke={stroke} strokeWidth="1.2" />
          <rect x="2" y="24" width="32" height="10" rx="2" fillOpacity="0.16" stroke={stroke} strokeWidth="1.2" />
          <rect x="2" y="36" width="32" height="10" rx="2" fillOpacity="0.1" stroke={stroke} strokeWidth="1.2" />
        </>
      ) : null}
      {id === 'focus' ? (
        <>
          <rect x="2" y="2" width="68" height="20" rx="2" fillOpacity="0.22" stroke={stroke} strokeWidth="1.2" />
          <rect x="2" y="26" width="68" height="20" rx="2" fillOpacity="0.12" stroke={stroke} strokeWidth="1.2" />
          <rect x="8" y="30" width="20" height="3" rx="1" fill={fill} fillOpacity="0.35" />
          <rect x="8" y="36" width="28" height="3" rx="1" fill={fill} fillOpacity="0.25" />
          <rect x="8" y="42" width="16" height="3" rx="1" fill={fill} fillOpacity="0.2" />
        </>
      ) : null}
      {id === 'transport' ? (
        <>
          <rect x="2" y="2" width="34" height="44" rx="2" fillOpacity="0.22" stroke={stroke} strokeWidth="1.2" />
          <rect x="40" y="2" width="30" height="44" rx="2" fillOpacity="0.12" stroke={stroke} strokeWidth="1.2" />
          <rect x="46" y="8" width="18" height="3" rx="1" fill={fill} fillOpacity="0.3" />
          <rect x="46" y="14" width="18" height="3" rx="1" fill={fill} fillOpacity="0.22" />
          <rect x="46" y="20" width="14" height="3" rx="1" fill={fill} fillOpacity="0.18" />
        </>
      ) : null}
      {id === 'compact' ? (
        <>
          <rect x="6" y="3" width="60" height="8" rx="2" fillOpacity="0.14" stroke={stroke} strokeWidth="1.2" />
          <rect x="6" y="14" width="60" height="14" rx="2" fillOpacity="0.22" stroke={stroke} strokeWidth="1.2" />
          <rect x="6" y="31" width="60" height="6" rx="2" fillOpacity="0.16" stroke={stroke} strokeWidth="1.2" />
          <rect x="6" y="40" width="60" height="5" rx="2" fillOpacity="0.1" stroke={stroke} strokeWidth="1.2" />
        </>
      ) : null}
      {id === 'show_desk' ? (
        <>
          <rect x="2" y="2" width="68" height="10" rx="2" fillOpacity="0.28" stroke={stroke} strokeWidth="1.2" />
          <rect x="2" y="16" width="34" height="30" rx="2" fillOpacity="0.2" stroke={stroke} strokeWidth="1.2" />
          <rect x="40" y="16" width="30" height="30" rx="2" fillOpacity="0.12" stroke={stroke} strokeWidth="1.2" />
        </>
      ) : null}
    </svg>
  );
}

type HostSettingsPanelProps = {
  roomId: string | null;
  connectionPanel: React.ReactNode;
  activityEntries: HostActivityEntry[];
  onExportEventRecap: () => void;
  playerFeedback: PlayerFeedbackEntry[];
  onDownloadPlayerFeedback: () => void;
  onCopyPlayerFeedback: () => void;
  hybridInPersonPlusOnline: boolean;
  onHybridChange: (v: boolean) => void;
  bingoWinPolicy: BingoWinPolicy;
  onBingoWinPolicyChange: (v: BingoWinPolicy) => void;
  snippetLength: number;
  onSnippetLengthChange: (n: number) => void;
  randomStarts: 'none' | 'early' | 'random';
  onRandomStartsChange: (v: 'none' | 'early' | 'random') => void;
  playlistTitleFlags: string;
  onPlaylistTitleFlagsChange: (v: string) => void;
  publicDisplayTitleRevealMode: PublicDisplayTitleRevealMode;
  onTitleRevealModeChange: (raw: string) => void;
  letterRevealIntervalSec: number;
  onLetterRevealIntervalChange: (sec: number) => void;
  publicDisplayLetterRevealToast: boolean;
  onLetterRevealToastChange: (v: boolean) => void;
  bingoColumnLetters: string;
  onBingoColumnLettersChange: (v: string) => void;
  maxPlayerBingoCards: number;
  onMaxPlayerBingoCardsChange: (n: number) => void;
  /** True while a round is live — cards-per-player cannot change. */
  maxPlayerBingoCardsLocked?: boolean;
  gameLayout: GameLayout;
  onGameLayoutChange: (v: GameLayout) => void;
};

const HostSettingsPanel: React.FC<HostSettingsPanelProps> = ({
  roomId,
  connectionPanel,
  activityEntries,
  onExportEventRecap,
  playerFeedback,
  onDownloadPlayerFeedback,
  onCopyPlayerFeedback,
  hybridInPersonPlusOnline,
  onHybridChange,
  bingoWinPolicy,
  onBingoWinPolicyChange,
  snippetLength,
  onSnippetLengthChange,
  randomStarts,
  onRandomStartsChange,
  playlistTitleFlags,
  onPlaylistTitleFlagsChange,
  publicDisplayTitleRevealMode,
  onTitleRevealModeChange,
  letterRevealIntervalSec,
  onLetterRevealIntervalChange,
  publicDisplayLetterRevealToast,
  onLetterRevealToastChange,
  bingoColumnLetters,
  onBingoColumnLettersChange,
  maxPlayerBingoCards,
  onMaxPlayerBingoCardsChange,
  maxPlayerBingoCardsLocked = false,
  gameLayout,
  onGameLayoutChange,
}) => {
  const lettersIncomplete = bingoColumnLetters.length > 0 && bingoColumnLetters.length < 5;
  const letterRevealEnabled = publicDisplayTitleRevealMode === 'letter';
  const selectedLayout = GAME_LAYOUT_IDS.includes(gameLayout) ? gameLayout : 'classic';

  return (
    <div className="host-settings-workspace">
      <section className="host-glass-panel host-settings-cockpit" aria-label="Game layout">
        <div className="host-settings-cockpit__header host-settings-cockpit__header--stack">
          <h2 className="host-settings-cockpit__title">
            <LayoutTemplate className="host-settings-workspace__title-icon" aria-hidden />
            Game layout
          </h2>
        </div>
        <p className="host-game-layout-picker__lead">
          Arranges the Game tab. Classic keeps today’s prep cockpit; other presets preview the
          dashboard below it (and reshape the live round). Pick Classic anytime to revert.
        </p>
        <div className="host-game-layout-picker" role="radiogroup" aria-label="Game layout">
          {GAME_LAYOUT_OPTIONS.map((opt) => {
            const selected = selectedLayout === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={
                  selected
                    ? 'host-game-layout-picker__card is-selected'
                    : 'host-game-layout-picker__card'
                }
                onClick={() => onGameLayoutChange(opt.id)}
              >
                <GameLayoutPreview id={opt.id} />
                <span className="host-game-layout-picker__name">{opt.name}</span>
                <span className="host-game-layout-picker__blurb">{opt.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="host-glass-panel host-settings-workspace__connection">
        <div className="host-settings-workspace__head">
          <h2 className="host-settings-workspace__title">
            <Link2 className="host-settings-workspace__title-icon" aria-hidden />
            Playback &amp; connections
          </h2>
        </div>
        <div className="host-settings-workspace__connection-body">{connectionPanel}</div>
      </section>

      <section className="host-glass-panel host-settings-cockpit" aria-label="Game defaults">
        <div className="host-settings-cockpit__header">
          <h2 className="host-settings-cockpit__title">Game defaults</h2>
        </div>

        <div className="host-settings-cockpit__row">
          <span className="host-settings-cockpit__label">Snippet</span>
          <div className="host-settings-cockpit__controls host-settings-cockpit__controls--snippet">
            <input
              type="range"
              className="host-range host-range--snippet"
              min={5}
              max={60}
              value={snippetLength}
              onChange={(e) => onSnippetLengthChange(Number(e.target.value))}
              aria-label={`Snippet length ${snippetLength} seconds`}
            />
            <span className="host-settings-cockpit__value">{snippetLength}s</span>
          </div>
        </div>

        <div className="host-settings-cockpit__row">
          <span className="host-settings-cockpit__label">Start</span>
          <div className="host-settings-cockpit__segment" role="group" aria-label="Snippet start">
            {(
              [
                ['none', 'From start'],
                ['early', 'Early'],
                ['random', 'Random'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={
                  randomStarts === val
                    ? 'host-settings-cockpit__seg-btn is-on'
                    : 'host-settings-cockpit__seg-btn'
                }
                onClick={() => onRandomStartsChange(val)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="host-settings-cockpit__row">
          <span className="host-settings-cockpit__label">Cards</span>
          <div className="host-settings-cockpit__controls">
            <select
              className="host-host-prefs__select"
              value={maxPlayerBingoCards}
              disabled={maxPlayerBingoCardsLocked}
              onChange={(e) => onMaxPlayerBingoCardsChange(Number(e.target.value))}
              aria-label="Cards per player"
            >
              <option value={1}>1 per player</option>
              <option value={2}>2 per player</option>
              <option value={3}>3 per player</option>
            </select>
            {maxPlayerBingoCardsLocked ? (
              <span className="host-settings-cockpit__hint">Locked while live</span>
            ) : null}
          </div>
        </div>

        <div className="host-settings-cockpit__row">
          <span className="host-settings-cockpit__label">Wins</span>
          <div className="host-settings-cockpit__segment" role="group" aria-label="Official wins">
            {(
              [
                ['any_round', 'Any round'],
                ['one_win', 'One win only'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={
                  bingoWinPolicy === val
                    ? 'host-settings-cockpit__seg-btn is-on'
                    : 'host-settings-cockpit__seg-btn'
                }
                onClick={() => onBingoWinPolicyChange(val)}
                title={
                  val === 'one_win'
                    ? 'After a verified win, later pattern completes get a shout-out but do not pause the round.'
                    : 'Players can call an official (pausing) bingo each round.'
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="host-settings-cockpit__row">
          <span className="host-settings-cockpit__label">Mode</span>
          <label className="host-settings-cockpit__toggle">
            <input
              type="checkbox"
              className="host-control-checkbox"
              checked={hybridInPersonPlusOnline}
              onChange={(e) => onHybridChange(e.target.checked)}
            />
            <span>Hybrid (in-person + online)</span>
          </label>
        </div>
      </section>

      {roomId ? <HostEventActivationBar roomId={roomId} /> : null}

      <details className="host-glass-panel host-settings-more">
        <summary className="host-settings-more__summary">Projector defaults</summary>
        <div className="host-settings-more__body host-settings-more__body--grid">
          <label className="host-host-prefs__field">
            <span className="host-host-prefs__label">Reveal titles</span>
            <select
              className="host-host-prefs__select"
              value={publicDisplayTitleRevealMode}
              onChange={(e) => onTitleRevealModeChange(e.target.value)}
            >
              <option value="letter">By letter (timed)</option>
              <option value="track_start">Full title at clip start</option>
              <option value="track_end">Full title at clip end</option>
            </select>
          </label>
          <label className="host-host-prefs__field">
            <span className="host-host-prefs__label">Letter interval</span>
            <select
              className="host-host-prefs__select"
              value={letterRevealIntervalSec}
              disabled={!letterRevealEnabled}
              onChange={(e) => onLetterRevealIntervalChange(Number(e.target.value))}
            >
              {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((sec) => (
                <option key={sec} value={sec}>
                  {sec}s
                </option>
              ))}
            </select>
          </label>
          <label className="host-host-prefs__field host-host-prefs__field--checkbox">
            <span className="host-host-prefs__label">Reveal toast</span>
            <span className="host-host-prefs__checkbox-row">
              <input
                type="checkbox"
                checked={publicDisplayLetterRevealToast}
                disabled={!letterRevealEnabled}
                onChange={(e) => onLetterRevealToastChange(e.target.checked)}
              />
              Show “Revealed:…” banner
            </span>
          </label>
        </div>
      </details>

      <details className="host-glass-panel host-settings-more">
        <summary className="host-settings-more__summary">Library &amp; column letters</summary>
        <div className="host-settings-more__body host-settings-more__body--grid">
          <label className="host-host-prefs__field">
            <span className="host-host-prefs__label">Playlist title flags</span>
            <input
              type="text"
              className="host-host-prefs__input"
              value={playlistTitleFlags}
              maxLength={200}
              placeholder={DEFAULT_PLAYLIST_TITLE_FLAGS}
              onChange={(e) => onPlaylistTitleFlagsChange(e.target.value)}
            />
            <span className="host-host-prefs__hint">
              Comma-separated. Library picks/All uses titles that contain one of these.
            </span>
          </label>
          <label className="host-host-prefs__field">
            <span className="host-host-prefs__label">Column letters</span>
            <input
              type="text"
              className="host-host-prefs__input host-settings-cockpit__letters"
              value={bingoColumnLetters}
              maxLength={5}
              placeholder="BINGO"
              spellCheck={false}
              autoCapitalize="characters"
              onChange={(e) => onBingoColumnLettersChange(e.target.value)}
            />
            <span
              className="host-host-prefs__hint"
              style={lettersIncomplete ? { color: '#f5d061' } : undefined}
            >
              {lettersIncomplete
                ? 'Needs exactly 5 letters — BINGO is used until then.'
                : 'Exactly 5 letters for cards + call list (BINGO, TEMPO, TONES…).'}
            </span>
          </label>
        </div>
      </details>

      <details className="host-glass-panel host-settings-more">
        <summary className="host-settings-more__summary">
          Recap &amp; feedback
          {playerFeedback.length > 0 ? (
            <span className="host-settings-more__badge">{playerFeedback.length}</span>
          ) : null}
        </summary>
        <div className="host-settings-more__body">
          <div className="host-settings-more__actions">
            <button type="button" className="btn-secondary" onClick={onExportEventRecap}>
              <Download className="w-4 h-4" aria-hidden />
              Export recap JSON
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={onDownloadPlayerFeedback}
              disabled={playerFeedback.length === 0}
            >
              <Download className="w-4 h-4" aria-hidden />
              Feedback .txt
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={onCopyPlayerFeedback}
              disabled={playerFeedback.length === 0}
            >
              <Copy className="w-4 h-4" aria-hidden />
              Copy feedback
            </button>
          </div>
          <p className="host-host-prefs__hint">
            {playerFeedback.length === 0
              ? 'No player feedback yet.'
              : `${playerFeedback.length} message${playerFeedback.length === 1 ? '' : 's'} in this browser (max 500).`}
          </p>
          <HostPlayerFeedbackList entries={playerFeedback} />
        </div>
      </details>

      <details className="host-glass-panel host-settings-more">
        <summary className="host-settings-more__summary">
          Activity
          {activityEntries.length > 0 ? (
            <span className="host-settings-more__badge">{activityEntries.length}</span>
          ) : null}
        </summary>
        <div className="host-settings-more__body host-settings-more__body--activity">
          <HostActivityFeed entries={activityEntries} />
        </div>
      </details>
    </div>
  );
};

export default HostSettingsPanel;
