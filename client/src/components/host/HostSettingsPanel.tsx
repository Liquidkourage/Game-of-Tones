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

      <section className="host-glass-panel host-settings-workspace__prefs">
        <h2 className="host-settings-workspace__title">Defaults</h2>
        <label className="host-host-prefs__field">
          <span className="host-host-prefs__label">Snippet length ({snippetLength}s)</span>
          <input
            type="range"
            className="host-range host-range--snippet"
            min={5}
            max={60}
            value={snippetLength}
            onChange={(e) => onSnippetLengthChange(Number(e.target.value))}
          />
        </label>
        <fieldset className="host-host-prefs__field">
          <legend className="host-host-prefs__label">Snippet start</legend>
          <div className="host-host-prefs__radios">
            {(
              [
                ['none', 'From start'],
                ['early', 'Early random'],
                ['random', 'Random'],
              ] as const
            ).map(([val, label]) => (
              <label key={val} className="host-host-prefs__radio">
                <input
                  type="radio"
                  name="settings-prefs-random-starts"
                  checked={randomStarts === val}
                  onChange={() => onRandomStartsChange(val)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="host-manager-hybrid host-settings-workspace__hybrid">
          <input
            type="checkbox"
            className="host-control-checkbox"
            checked={hybridInPersonPlusOnline}
            onChange={(e) => onHybridChange(e.target.checked)}
          />
          <span>
            <strong>Hybrid</strong>
          </span>
        </label>
        <fieldset className="host-host-prefs__field">
          <legend className="host-host-prefs__label">Official wins</legend>
          <div className="host-host-prefs__radios">
            {(
              [
                ['any_round', 'Any round'],
                ['one_win', 'One win only'],
              ] as const
            ).map(([val, label]) => (
              <label key={val} className="host-host-prefs__radio">
                <input
                  type="radio"
                  name="settings-prefs-bingo-win-policy"
                  checked={bingoWinPolicy === val}
                  onChange={() => onBingoWinPolicyChange(val)}
                />
                {label}
              </label>
            ))}
          </div>
          <span className="host-host-prefs__hint">
            {bingoWinPolicy === 'one_win'
              ? 'After a verified win, later pattern completes get a shout-out but do not pause the round.'
              : 'Players can call an official (pausing) bingo each round.'}
          </span>
        </fieldset>
        <label className="host-host-prefs__field">
          <span className="host-host-prefs__label">Cards per player</span>
          <select
            className="host-host-prefs__select"
            value={maxPlayerBingoCards}
            disabled={maxPlayerBingoCardsLocked}
            onChange={(e) => onMaxPlayerBingoCardsChange(Number(e.target.value))}
          >
            <option value={1}>1 card</option>
            <option value={2}>2 cards</option>
            <option value={3}>3 cards</option>
          </select>
          <span className="host-host-prefs__hint">
            Dealt to every player at round start / finalize / late-join.
            {maxPlayerBingoCardsLocked
              ? ' Locked while this round is live.'
              : ' Cannot change while a round is live.'}
          </span>
        </label>
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
            Comma-separated. The playlist library&rsquo;s picks/All toggle shows only playlists whose
            titles contain one of these flags.
          </span>
        </label>
        <label className="host-host-prefs__field">
          <span className="host-host-prefs__label">Column letters</span>
          <input
            type="text"
            className="host-host-prefs__input"
            value={bingoColumnLetters}
            maxLength={5}
            placeholder="BINGO"
            spellCheck={false}
            autoCapitalize="characters"
            style={{ textTransform: 'uppercase', letterSpacing: '0.35em', fontWeight: 800 }}
            onChange={(e) => onBingoColumnLettersChange(e.target.value)}
          />
          <span
            className="host-host-prefs__hint"
            style={lettersIncomplete ? { color: '#f5d061' } : undefined}
          >
            {lettersIncomplete
              ? 'Needs exactly 5 letters — BINGO is used until then.'
              : 'Exactly 5 letters for card columns and the call list — e.g. BINGO, TEMPO, TONES.'}
          </span>
        </label>
      </section>

      <section className="host-glass-panel host-settings-workspace__prefs">
        <h2 className="host-settings-workspace__title">Projector defaults</h2>
        <label className="host-host-prefs__field">
          <span className="host-host-prefs__label">Reveal titles on projector</span>
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
          <span className="host-host-prefs__label">Letter reveal interval</span>
          <select
            className="host-host-prefs__select"
            value={letterRevealIntervalSec}
            disabled={publicDisplayTitleRevealMode !== 'letter'}
            onChange={(e) => onLetterRevealIntervalChange(Number(e.target.value))}
          >
            {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((sec) => (
              <option key={sec} value={sec}>
                {sec} seconds
              </option>
            ))}
          </select>
        </label>
        <label className="host-host-prefs__field host-host-prefs__field--checkbox">
          <span className="host-host-prefs__label">Letter reveal toast</span>
          <span className="host-host-prefs__checkbox-row">
            <input
              type="checkbox"
              checked={publicDisplayLetterRevealToast}
              disabled={publicDisplayTitleRevealMode !== 'letter'}
              onChange={(e) => onLetterRevealToastChange(e.target.checked)}
            />
            Show &ldquo;Revealed:&hellip;&rdquo; banner on projector
          </span>
        </label>
      </section>

      {/* Always-reachable event lifecycle controls — the setup cockpit's copy disappears once a round is live. */}
      {roomId ? <HostEventActivationBar roomId={roomId} /> : null}

      <section className="host-glass-panel host-settings-workspace__export">
        <h2 className="host-settings-workspace__title">Recap</h2>
        <button type="button" className="btn-secondary" onClick={onExportEventRecap}>
          <Download className="w-4 h-4" aria-hidden />
          Export JSON
        </button>
      </section>

      <section className="host-glass-panel host-settings-workspace__export">
        <h2 className="host-settings-workspace__title">Player feedback</h2>
        <p className="host-host-prefs__hint">
          {playerFeedback.length === 0
            ? 'No feedback received yet.'
            : `${playerFeedback.length} message${playerFeedback.length === 1 ? '' : 's'} saved in this browser.`}
          {' '}Up to 500 messages are kept for this room.
        </p>
        <HostPlayerFeedbackList entries={playerFeedback} />
        <div className="host-host-prefs__radios host-player-feedback-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onDownloadPlayerFeedback}
            disabled={playerFeedback.length === 0}
          >
            <Download className="w-4 h-4" aria-hidden />
            Download .txt
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCopyPlayerFeedback}
            disabled={playerFeedback.length === 0}
          >
            <Copy className="w-4 h-4" aria-hidden />
            Copy all
          </button>
        </div>
      </section>

      <HostActivityFeed entries={activityEntries} />
    </div>
  );
};

export default HostSettingsPanel;
