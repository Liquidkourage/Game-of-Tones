import React, { useState } from 'react';
import { Monitor, Save, Trash2 } from 'lucide-react';
import {
  loadDisplayPresets,
  saveDisplayPresets,
  type HostDisplayPreset,
} from '../../host/displayPresets';

type HostDisplayExtrasPanelProps = {
  displayConnected: boolean;
  displayStale: boolean;
  displaySyncLabel: string;
  publicDisplayCallListMode: string;
  publicDisplayFontSize: number;
  publicDisplayTitleRevealMode: 'letter' | 'track_start' | 'track_end';
  letterRevealIntervalSec: number;
  publicDisplayLetterRevealToast: boolean;
  onApplyPreset: (preset: HostDisplayPreset) => void;
};

const HostDisplayExtrasPanel: React.FC<HostDisplayExtrasPanelProps> = ({
  displayConnected,
  displayStale,
  displaySyncLabel,
  publicDisplayCallListMode,
  publicDisplayFontSize,
  publicDisplayTitleRevealMode,
  letterRevealIntervalSec,
  publicDisplayLetterRevealToast,
  onApplyPreset,
}) => {
  const [presets, setPresets] = useState<HostDisplayPreset[]>(() => loadDisplayPresets());
  const [presetName, setPresetName] = useState('');

  const saveCurrentAsPreset = () => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const next: HostDisplayPreset = {
      id: `p-${Date.now()}`,
      name,
      publicDisplayFontSize,
      publicDisplayTitleRevealMode,
      letterRevealIntervalSec,
      publicDisplayLetterRevealToast,
    };
    const merged = [...presets, next];
    setPresets(merged);
    saveDisplayPresets(merged);
    setPresetName('');
  };

  const removePreset = (id: string) => {
    const merged = presets.filter((p) => p.id !== id);
    setPresets(merged);
    saveDisplayPresets(merged);
  };

  return (
    <section className="host-display-extras host-glass-panel" aria-label="Display diagnostics and presets">
      <h2 className="host-display-extras__title">
        <Monitor className="host-display-extras__icon" aria-hidden />
        Diagnostics &amp; presets
      </h2>
      <dl className="host-display-extras__diag">
        <div>
          <dt>Projector socket</dt>
          <dd className={displayConnected ? (displayStale ? 'is-stale' : 'is-ok') : 'is-off'}>
            {displayConnected
              ? displayStale
                ? `Connected · stale (${displaySyncLabel})`
                : `Connected · ${displaySyncLabel}`
              : 'Not connected'}
          </dd>
        </div>
        <div>
          <dt>Call layout mode</dt>
          <dd>{publicDisplayCallListMode}</dd>
        </div>
        <div>
          <dt>Font scale</dt>
          <dd>{(publicDisplayFontSize * 100).toFixed(0)}%</dd>
        </div>
      </dl>

      <div className="host-display-extras__presets">
        <h3 className="host-display-extras__sub">Venue presets</h3>
        <p className="host-display-extras__hint">Save font scale for this room layout (stored on this device).</p>
        <div className="host-display-extras__save-row">
          <input
            type="text"
            className="host-display-extras__input"
            placeholder="Preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={saveCurrentAsPreset}>
            <Save className="w-4 h-4" aria-hidden />
            Save current
          </button>
        </div>
        {presets.length > 0 ? (
          <ul className="host-display-extras__preset-list">
            {presets.map((p) => (
              <li key={p.id} className="host-display-extras__preset-row">
                <button type="button" className="btn-secondary" onClick={() => onApplyPreset(p)}>
                  Apply {p.name}
                </button>
                <button
                  type="button"
                  className="btn-secondary host-display-extras__delete"
                  aria-label={`Delete preset ${p.name}`}
                  onClick={() => removePreset(p.id)}
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
};

export default HostDisplayExtrasPanel;
