import React from 'react';
import { Download, Link2 } from 'lucide-react';
import HostActivityFeed from './HostActivityFeed';
import HostEventActivationBar from './HostEventActivationBar';
import type { HostActivityEntry } from '../../host/hostActivityLog';
import { DEFAULT_PLAYLIST_TITLE_FLAGS } from '../../utils/hostPreferences';
import type { PublicDisplayTitleRevealMode } from '../../utils/publicDisplayTitleReveal';
import { CALL_NUMBER_STYLE_OPTIONS, type CallNumberStyle } from '../../utils/callNumberStyle';

type HostSettingsPanelProps = {
  roomId: string | null;
  connectionPanel: React.ReactNode;
  activityEntries: HostActivityEntry[];
  onExportEventRecap: () => void;
  hybridInPersonPlusOnline: boolean;
  onHybridChange: (v: boolean) => void;
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
  callNumberStyle: CallNumberStyle;
  onCallNumberStyleChange: (raw: string) => void;
};

/**
 * Mini mock of a projector call card so hosts can see exactly how each call-number
 * style renders before picking one. Visual recipe mirrors PublicDisplay's card styles.
 */
const CallNumberStylePreviewCard: React.FC<{ style: CallNumberStyle }> = ({ style }) => {
  const num = 42;
  const centerBase: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 46,
    fontWeight: 900,
    lineHeight: 1,
    letterSpacing: '-0.02em',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: 0,
  };
  let overlay: React.ReactNode = null;
  if (style === 'negative') {
    overlay = (
      <div
        aria-hidden
        style={{
          ...centerBase,
          color: 'rgba(0, 0, 0, 0.92)',
          textShadow:
            '0 0 2px rgba(0, 255, 136, 0.8), 0 0 6px rgba(0, 255, 136, 0.35), 0 0 18px rgba(0, 255, 136, 0.22)',
        }}
      >
        {num}
      </div>
    );
  } else if (style === 'chip') {
    overlay = (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
          color: '#001b10',
          fontWeight: 900,
          fontSize: 13,
          lineHeight: 1.25,
          borderRadius: 8,
          padding: '2px 9px',
          zIndex: 2,
          boxShadow: '0 0 12px rgba(0, 255, 136, 0.45), 0 2px 6px rgba(0, 0, 0, 0.5)',
        }}
      >
        {num}
      </div>
    );
  } else if (style === 'stripe') {
    overlay = (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 18,
          background: 'linear-gradient(180deg, rgba(0, 255, 136, 0.95) 0%, rgba(0, 204, 106, 0.78) 100%)',
          boxShadow: '2px 0 12px rgba(0, 255, 136, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#001b10',
          fontWeight: 900,
          fontSize: 13,
          zIndex: 0,
        }}
      >
        {num}
      </div>
    );
  }
  const sidePad = style === 'stripe' ? 18 : 6;
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        height: 58,
        borderRadius: 8,
        // Matches the projector glass-theme .call-item card over its dark backdrop.
        background:
          'linear-gradient(145deg, rgba(139, 92, 246, 0.22) 0%, rgba(10, 10, 20, 0.65) 100%), #0a0a14',
        border: '1px solid rgba(139, 92, 246, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {overlay}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          width: '100%',
          paddingLeft: sidePad,
          paddingRight: sidePad,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 12.5, color: '#e8e6ff', lineHeight: 1.25 }}>
          {style === 'inline' && (
            <span
              style={{
                display: 'inline-block',
                background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
                color: '#001b10',
                fontWeight: 900,
                fontSize: '0.72em',
                lineHeight: 1.2,
                padding: '0.06em 0.5em',
                borderRadius: '0.55em',
                marginRight: '0.4em',
                verticalAlign: '0.1em',
                whiteSpace: 'nowrap',
                boxShadow: '0 0 10px rgba(0, 255, 136, 0.35)',
              }}
            >
              {num}
            </span>
          )}
          Tiny Dancer
        </div>
        <div style={{ fontSize: 11, color: 'rgba(139, 92, 246, 0.95)', lineHeight: 1.2 }}>
          Elton John
        </div>
      </div>
    </div>
  );
};

const HostSettingsPanel: React.FC<HostSettingsPanelProps> = ({
  roomId,
  connectionPanel,
  activityEntries,
  onExportEventRecap,
  hybridInPersonPlusOnline,
  onHybridChange,
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
  callNumberStyle,
  onCallNumberStyleChange,
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
        <div className="host-host-prefs__field">
          <span className="host-host-prefs__label">Call number style</span>
          <div
            role="radiogroup"
            aria-label="Call number style"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}
          >
            {CALL_NUMBER_STYLE_OPTIONS.map((o) => {
              const selected = callNumberStyle === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={o.description}
                  onClick={() => onCallNumberStyleChange(o.value)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    padding: 6,
                    borderRadius: 10,
                    cursor: 'pointer',
                    textAlign: 'center',
                    background: selected ? 'rgba(0, 255, 136, 0.10)' : 'rgba(255, 255, 255, 0.03)',
                    border: selected
                      ? '2px solid rgba(0, 255, 136, 0.75)'
                      : '2px solid rgba(255, 255, 255, 0.10)',
                  }}
                >
                  <CallNumberStylePreviewCard style={o.value} />
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: selected ? 700 : 500,
                      color: selected ? '#00ff88' : 'rgba(255, 255, 255, 0.75)',
                    }}
                  >
                    {selected ? '✓ ' : ''}
                    {o.label}
                  </span>
                </button>
              );
            })}
          </div>
          <span className="host-host-prefs__hint">
            How the play-order number appears on each song card on the projector call list.
          </span>
        </div>
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

      <HostActivityFeed entries={activityEntries} />
    </div>
  );
};

export default HostSettingsPanel;
