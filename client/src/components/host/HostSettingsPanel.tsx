import React, { useState } from 'react';
import { Download, Link2 } from 'lucide-react';
import HostActivityFeed from './HostActivityFeed';
import HostOrgBillingCard from './HostOrgBillingCard';
import type { HostActivityEntry } from '../../host/hostActivityLog';

type HostSettingsPanelProps = {
  connectionPanel: React.ReactNode;
  templatesPanel: React.ReactNode;
  onOpenConnectionModal: () => void;
  activityEntries: HostActivityEntry[];
  onExportEventRecap: () => void;
  hybridInPersonPlusOnline: boolean;
  onHybridChange: (v: boolean) => void;
  snippetLength: number;
  onSnippetLengthChange: (n: number) => void;
  randomStarts: 'none' | 'early' | 'random';
  onRandomStartsChange: (v: 'none' | 'early' | 'random') => void;
};

const HostSettingsPanel: React.FC<HostSettingsPanelProps> = ({
  connectionPanel,
  templatesPanel,
  onOpenConnectionModal,
  activityEntries,
  onExportEventRecap,
  hybridInPersonPlusOnline,
  onHybridChange,
  snippetLength,
  onSnippetLengthChange,
  randomStarts,
  onRandomStartsChange,
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
            Full-screen panel
          </button>
        </div>
        <label className="host-settings-workspace__toggle">
          <input
            type="checkbox"
            checked={showAdvancedConnection}
            onChange={(e) => setShowAdvancedConnection(e.target.checked)}
          />
          Show connection details here
        </label>
        {showAdvancedConnection ? (
          <div className="host-settings-workspace__connection-body">{connectionPanel}</div>
        ) : (
          <p className="host-settings-workspace__hint">
            Use <strong>Connection</strong> in the header or open the full-screen panel for Spotify device
            picker and YouTube Music.
          </p>
        )}
      </section>

      <section className="host-glass-panel host-settings-workspace__prefs">
        <h2 className="host-settings-workspace__title">Playback defaults</h2>
        <p className="host-settings-workspace__lead">
          Applied to new rounds on this device. Projector reveal timing is under Display.
        </p>
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
            <strong>Hybrid in-person + online</strong> — remote players can play; only in-person bingos end the
            round for prizes.
          </span>
        </label>
      </section>

      <section className="host-glass-panel host-settings-workspace__export">
        <h2 className="host-settings-workspace__title">Event recap</h2>
        <p className="host-settings-workspace__lead">Download a JSON snapshot of rounds, calls, and winners.</p>
        <button type="button" className="btn-secondary" onClick={onExportEventRecap}>
          <Download className="w-4 h-4" aria-hidden />
          Export event recap
        </button>
      </section>

      {templatesPanel}

      <HostActivityFeed entries={activityEntries} />
    </div>
  );
};

export default HostSettingsPanel;
