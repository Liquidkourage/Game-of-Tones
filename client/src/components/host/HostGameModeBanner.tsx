import React from 'react';
import './HostGameModeBanner.css';

export type HostGameMode = 'prep' | 'live' | 'ended';

export type HostGameModeBannerProps = {
  mode: HostGameMode;
  /** e.g. "Round 2" or a custom round name. */
  roundName: string;
  /** 1-based position of the current round, if known. */
  roundPosition?: number | null;
  roundTotal?: number;
  /** One-line "what to do next" cue for the host. */
  hint?: string;
  paused?: boolean;
};

const MODE_META: Record<HostGameMode, { chip: string; label: string }> = {
  prep: { chip: 'PREP', label: 'Setting up' },
  live: { chip: 'LIVE', label: 'Round in progress' },
  ended: { chip: 'ROUND OVER', label: 'Between rounds' },
};

/**
 * Anchors the Game tab's two-state layout: the same banner renders in every state so
 * hosts always know whether they're prepping or live, which round they're on, and the
 * single next action — instead of inferring mode from which panels happen to render.
 */
const HostGameModeBanner: React.FC<HostGameModeBannerProps> = ({
  mode,
  roundName,
  roundPosition,
  roundTotal,
  hint,
  paused,
}) => {
  const meta = MODE_META[mode];
  const chipText = mode === 'live' && paused ? 'PAUSED' : meta.chip;
  const positionText =
    roundPosition && roundTotal && roundTotal > 0
      ? `Round ${roundPosition} of ${roundTotal}`
      : null;
  return (
    <div
      className={`host-game-mode-banner host-game-mode-banner--${mode}${
        mode === 'live' && paused ? ' host-game-mode-banner--paused' : ''
      } host-glass-panel`}
      role="status"
      aria-label={`${meta.label}: ${roundName}`}
    >
      <span className="host-game-mode-banner__chip">{chipText}</span>
      <div className="host-game-mode-banner__round">
        <span className="host-game-mode-banner__round-name">{roundName}</span>
        {positionText ? (
          <span className="host-game-mode-banner__round-position">{positionText}</span>
        ) : null}
      </div>
      {hint ? <p className="host-game-mode-banner__hint">{hint}</p> : null}
    </div>
  );
};

export default HostGameModeBanner;
