import React from 'react';
import { Copy, Download, Link2 } from 'lucide-react';
import HostActivityFeed from './HostActivityFeed';
import HostEventActivationBar from './HostEventActivationBar';
import HostPlayerFeedbackList, { type PlayerFeedbackEntry } from './HostPlayerFeedbackList';
import type { HostActivityEntry } from '../../host/hostActivityLog';
import { DEFAULT_PLAYLIST_TITLE_FLAGS, type BingoWinPolicy } from '../../utils/hostPreferences';
import type { PublicDisplayTitleRevealMode } from '../../utils/publicDisplayTitleReveal';

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
}) => {
  const lettersIncomplete = bingoColumnLetters.length > 0 && bingoColumnLetters.length < 5;
  const letterRevealEnabled = publicDisplayTitleRevealMode === 'letter';

  return (
    <div className="host-settings-workspace">
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
