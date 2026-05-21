import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface RoundBuilderPrepHintsProps {
  spotifyNeeded: boolean;
  spotifyConnected: boolean;
  deviceNeeded: boolean;
  deviceSelected: boolean;
  onOpenConnection?: () => void;
}

const RoundBuilderPrepHints: React.FC<RoundBuilderPrepHintsProps> = ({
  spotifyNeeded,
  spotifyConnected,
  deviceNeeded,
  deviceSelected,
  onOpenConnection,
}) => {
  if (!spotifyNeeded && !deviceNeeded) return null;

  const items: { ok: boolean; label: string }[] = [];
  if (spotifyNeeded) {
    items.push({
      ok: spotifyConnected,
      label: spotifyConnected ? 'Spotify connected' : 'Connect Spotify (header → Connection)',
    });
  }
  if (deviceNeeded) {
    items.push({
      ok: deviceSelected,
      label: deviceSelected ? 'Playback device selected' : 'Select a Spotify playback device',
    });
  }

  const allOk = items.every((i) => i.ok);

  return (
    <div
      className={`round-builder-prep-hints${allOk ? ' round-builder-prep-hints--ok' : ''}`}
      role="status"
    >
      {items.map((item) => (
        <span key={item.label} className="round-builder-prep-hints__item">
          {item.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" aria-hidden />
          )}
          {item.label}
          {!item.ok && onOpenConnection ? (
            <button type="button" className="round-builder-prep-hints__link" onClick={onOpenConnection}>
              Connection
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
};

export default RoundBuilderPrepHints;
