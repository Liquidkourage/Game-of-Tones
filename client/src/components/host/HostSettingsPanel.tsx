import React, { useState } from 'react';
import { Download, Link2 } from 'lucide-react';
import HostActivityFeed from './HostActivityFeed';
import HostOrgBillingCard from './HostOrgBillingCard';
import type { HostActivityEntry } from '../../host/hostActivityLog';
import { DEFAULT_PLAYLIST_TITLE_FLAGS } from '../../utils/hostPreferences';

type HostSettingsPanelProps = {
  connectionPanel: React.ReactNode;
  onOpenConnectionModal: () => void;
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
};

const HostSettingsPanel: React.FC<HostSettingsPanelProps> = ({
  connectionPanel,
  onOpenConnectionModal,
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
}) => {
  const [showAdvancedConnection, setShowAdvancedConnection] = useState(true);

  return (
    <div className="host-settings-workspace">
      <HostOrgBillingCard />

      <section className="host-glass-panel host-settings-workspace__connection">
        <div className="host-settings-workspace__head">
          <h2 className="host-settings-workspace__title">
            <Link2 className="host-settings-workspace__title-icon" aria-hidden />
            Playback &amp; connections
          </h2>
          <button type="button" className="btn-secondary" onClick={onOpenConnectionModal}>
            Panel
          </button>
        </div>
        <label className="host-settings-workspace__toggle">
          <input
            type="checkbox"
            checked={showAdvancedConnection}
            onChange={(e) => setShowAdvancedConnection(e.target.checked)}
          />
          Details
        </label>
        {showAdvancedConnection ? (
          <div className="host-settings-workspace__connection-body">{connectionPanel}</div>
        ) : null}
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
      </section>

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
