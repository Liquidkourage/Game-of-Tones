import React from 'react';
import { Monitor, Music, Wifi, WifiOff } from 'lucide-react';
import './HostSetupCockpit.css';

export type HostSetupStatusStripProps = {
  roomId: string;
  gameState: 'waiting' | 'playing' | 'ended';
  playbackReady: boolean;
  displayConnected: boolean;
  displayStale: boolean;
  displaySyncLabel: string;
};

const HostSetupStatusStrip: React.FC<HostSetupStatusStripProps> = ({
  roomId,
  gameState,
  playbackReady,
  displayConnected,
  displayStale,
  displaySyncLabel,
}) => {
  const eventLabel =
    gameState === 'playing' ? 'Live' : gameState === 'ended' ? 'Ended' : 'Pre-show setup';

  return (
    <div className="host-setup-status-strip host-glass-panel" role="status" aria-label="Event status">
      <div className="host-setup-status-strip__item">
        <span className="host-setup-status-strip__label">Room</span>
        <strong className="host-setup-status-strip__value">{roomId}</strong>
      </div>
      <div className="host-setup-status-strip__item">
        <span className="host-setup-status-strip__label">Event</span>
        <strong
          className={
            gameState === 'playing'
              ? 'host-setup-status-strip__value host-setup-status-strip__value--live'
              : 'host-setup-status-strip__value'
          }
        >
          {eventLabel}
        </strong>
      </div>
      <div
        className={
          playbackReady
            ? 'host-setup-status-strip__item host-setup-status-strip__item--ok'
            : 'host-setup-status-strip__item host-setup-status-strip__item--warn'
        }
      >
        {playbackReady ? (
          <Music className="host-setup-status-strip__icon" aria-hidden />
        ) : (
          <WifiOff className="host-setup-status-strip__icon" aria-hidden />
        )}
        <span>{playbackReady ? 'Playback connected' : 'Playback not connected'}</span>
      </div>
      <div
        className={
          displayConnected && !displayStale
            ? 'host-setup-status-strip__item host-setup-status-strip__item--ok'
            : displayConnected
              ? 'host-setup-status-strip__item host-setup-status-strip__item--warn'
              : 'host-setup-status-strip__item'
        }
      >
        <Monitor className="host-setup-status-strip__icon" aria-hidden />
        <span>
          {displayConnected
            ? displayStale
              ? `Display stale · ${displaySyncLabel}`
              : `Display · ${displaySyncLabel}`
            : 'Display not connected'}
        </span>
      </div>
      <div className="host-setup-status-strip__item host-setup-status-strip__item--muted">
        <Wifi className="host-setup-status-strip__icon" aria-hidden />
        <span>Connection &amp; account in header</span>
      </div>
    </div>
  );
};

export default HostSetupStatusStrip;
