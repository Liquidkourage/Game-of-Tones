import React from 'react';
import { Copy, ExternalLink, Monitor, Music, Users, WifiOff } from 'lucide-react';
import './HostSetupCockpit.css';

export type HostSetupPlaybackStatusKind =
  | 'ready'
  | 'api_unavailable'
  | 'device_inactive'
  | 'device_offline'
  | 'no_device'
  | 'not_connected';

export type HostSetupStatusStripProps = {
  roomId: string;
  gameState: 'waiting' | 'playing' | 'ended';
  playback: { status: HostSetupPlaybackStatusKind; label: string; detail?: string };
  onOpenConnection?: () => void;
  displayConnected: boolean;
  displayStale: boolean;
  displaySyncLabel: string;
  displayUrl?: string;
  playerCount: number;
  onCopyJoinLink?: () => void;
};

const HostSetupStatusStrip: React.FC<HostSetupStatusStripProps> = ({
  roomId,
  gameState,
  playback,
  onOpenConnection,
  displayConnected,
  displayStale,
  displaySyncLabel,
  displayUrl,
  playerCount,
  onCopyJoinLink,
}) => {
  const eventLabel =
    gameState === 'playing' ? 'Live' : gameState === 'ended' ? 'Ended' : 'Pre-show setup';

  // Hard-down states are warnings; selected-but-inactive style states are soft warnings.
  const playbackTone =
    playback.status === 'ready'
      ? 'ok'
      : playback.status === 'not_connected'
        ? 'warn'
        : 'soft-warn';

  const displayNeedsAttention = !displayConnected || displayStale;

  return (
    <div className="host-setup-status-strip host-glass-panel" role="status" aria-label="Event status">
      <div className="host-setup-status-strip__item">
        <span className="host-setup-status-strip__label">Room</span>
        <strong className="host-setup-status-strip__value">{roomId}</strong>
        {onCopyJoinLink ? (
          <button
            type="button"
            className="host-setup-status-strip__action"
            onClick={onCopyJoinLink}
            title="Copy the player join link for this room"
          >
            <Copy aria-hidden />
            Copy join link
          </button>
        ) : null}
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
        className={`host-setup-status-strip__item host-setup-status-strip__item--${playbackTone}`}
        title={playback.detail}
      >
        {playback.status === 'not_connected' ? (
          <WifiOff className="host-setup-status-strip__icon" aria-hidden />
        ) : (
          <Music className="host-setup-status-strip__icon" aria-hidden />
        )}
        <span>{playback.label}</span>
        {playback.status !== 'ready' && onOpenConnection ? (
          <button
            type="button"
            className="host-setup-status-strip__action"
            onClick={onOpenConnection}
            title={playback.detail || 'Open playback & connection settings'}
          >
            Fix in Settings
          </button>
        ) : null}
      </div>
      <div
        className={
          displayConnected && !displayStale
            ? 'host-setup-status-strip__item host-setup-status-strip__item--ok'
            : displayConnected
              ? 'host-setup-status-strip__item host-setup-status-strip__item--soft-warn'
              : 'host-setup-status-strip__item'
        }
        title={
          displayStale
            ? 'Stale means the public display has not checked in recently. Re-open or refresh the display page.'
            : undefined
        }
      >
        <Monitor className="host-setup-status-strip__icon" aria-hidden />
        <span>
          {displayConnected
            ? displayStale
              ? `Display stale · last seen ${displaySyncLabel}`
              : `Display · ${displaySyncLabel}`
            : 'Display not connected'}
        </span>
        {displayNeedsAttention && displayUrl ? (
          <a
            className="host-setup-status-strip__action"
            href={displayUrl}
            target="_blank"
            rel="noreferrer"
            title="Open the public display in a new tab"
          >
            <ExternalLink aria-hidden />
            Open display
          </a>
        ) : null}
      </div>
      <div className="host-setup-status-strip__item">
        <Users className="host-setup-status-strip__icon" aria-hidden />
        <span>
          {playerCount} player{playerCount !== 1 ? 's' : ''} joined
        </span>
      </div>
    </div>
  );
};

export default HostSetupStatusStrip;
