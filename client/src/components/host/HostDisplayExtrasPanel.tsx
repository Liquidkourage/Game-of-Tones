import React, { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
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
    <section className="host-display-extras" aria-label="Display diagnostics and presets">
      <dl className="host-display-extras__diag">
        <div>
          <dt>Call layout</dt>
          <dd>{publicDisplayCallListMode}</dd>
        </div>
        <div>
          <dt>Font</dt>
          <dd>{(publicDisplayFontSize * 100).toFixed(0)}%</dd>
        </div>
        <div>
          <dt>Reveal</dt>
          <dd>
            {publicDisplayTitleRevealMode === 'letter'
              ? `Letter · ${letterRevealIntervalSec}s`
              : publicDisplayTitleRevealMode === 'track_start'
                ? 'Track start'
                : 'Track end'}
            {publicDisplayLetterRevealToast ? ' · toast on' : ''}
          </dd>
        </div>
        <div>
          <dt>Socket</dt>
          <dd className={displayConnected ? (displayStale ? 'is-stale' : 'is-ok') : 'is-off'}>
            {displayConnected
              ? displayStale
                ? `Stale · ${displaySyncLabel}`
                : displaySyncLabel
              : 'Off'}
          </dd>
        </div>
      </dl>

      <div className="host-display-extras__presets">
        <h3 className="host-display-extras__sub">Venue presets</h3>
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
