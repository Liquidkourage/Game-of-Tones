import React from 'react';
import { CheckCircle2, Eraser, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import './HostEventActionsPanel.css';

export type HostEventActionsPanelProps = {
  gameState: string;
  /** Stop playback, clear cards, mark the current round complete. Live only. */
  onEndRound: () => void;
  /** Stop playback + clear cards but keep the same round active. Live only. */
  onResetCurrentRound: () => void;
  onStartNextPlanned: () => void;
  hasNextPlanned: boolean;
  /** Every round back to unplanned (saved snapshots keep playlists). */
  onResetEvent: () => void;
  /** Wipe all saved round prep for this room in this browser. */
  onClearPrepCache: () => void;
};

/**
 * Round/event reset controls, shown at the bottom of the Game tab (moved here from
 * the Rounds planner so hosts don't have to leave the live view to end/reset).
 */
const HostEventActionsPanel: React.FC<HostEventActionsPanelProps> = ({
  gameState,
  onEndRound,
  onResetCurrentRound,
  onStartNextPlanned,
  hasNextPlanned,
  onResetEvent,
  onClearPrepCache,
}) => {
  return (
    <section className="host-event-actions host-glass-panel" aria-labelledby="host-event-actions-title">
      <h3 id="host-event-actions-title" className="host-event-actions__title">
        Event actions
      </h3>
      <div className="host-event-actions__row">
        {gameState === 'playing' ? (
          <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onEndRound}>
            <CheckCircle2 className="w-3 h-3" aria-hidden />
            End round
          </button>
        ) : null}
        {gameState === 'playing' ? (
          <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onResetCurrentRound}>
            <RotateCcw className="w-3 h-3" aria-hidden />
            Reset round
          </button>
        ) : null}
        {hasNextPlanned ? (
          <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onStartNextPlanned}>
            <SkipForward className="w-3 h-3" aria-hidden />
            Next planned
          </button>
        ) : null}
        <button type="button" className="round-planner-btn round-planner-btn--danger" onClick={onResetEvent}>
          <Trash2 className="w-3 h-3" aria-hidden />
          Reset event
        </button>
        <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onClearPrepCache}>
          <Eraser className="w-3 h-3" aria-hidden />
          Clear prep cache
        </button>
      </div>
    </section>
  );
};

export default HostEventActionsPanel;
