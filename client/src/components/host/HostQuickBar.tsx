import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronUp,
  Eraser,
  ImageIcon,
  ListChecks,
  ListMusic,
  MessageSquareText,
  Play,
  RotateCcw,
  SkipForward,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import './HostQuickBar.css';

export type HostQuickBarProps = {
  gameState: string;
  canRejectBingo: boolean;
  canResume: boolean;
  transportLocked?: boolean;
  feedbackCount: number;
  hasNextPlanned: boolean;
  /** Prep / waiting: show Set round + Start game. */
  prepRoundReadyForGoLive?: boolean;
  mixGameActionsBlocked?: boolean;
  startGameLabel?: string;
  onSetRound?: () => void;
  onResetSplash?: () => void;
  onStartGame?: () => void;
  onRejectBingo: () => void;
  onResume: () => void;
  onRedoLastCall: () => void;
  onOpenFeedback: () => void;
  onEndRound: () => void;
  onResetCurrentRound: () => void;
  onStartNextPlanned: () => void;
  onResetEvent: () => void;
  onClearPrepCache: () => void;
  /** Open bingo pool (Alias titles/artists) — prep and live. */
  hasFinalizedSongPool?: boolean;
  onOpenPool?: () => void;
};

/**
 * Sticky bottom "Quick" strip on the Game tab.
 * Prep: Set round / Splash / Start game. Live: interventions + round lifecycle.
 * Transport (Pause / Skip / Bump) stays on Now Playing only.
 */
const HostQuickBar: React.FC<HostQuickBarProps> = ({
  gameState,
  canRejectBingo,
  canResume,
  transportLocked = false,
  feedbackCount,
  hasNextPlanned,
  prepRoundReadyForGoLive = false,
  mixGameActionsBlocked = false,
  startGameLabel = 'Start game',
  onSetRound,
  onResetSplash,
  onStartGame,
  onRejectBingo,
  onResume,
  onRedoLastCall,
  onOpenFeedback,
  onEndRound,
  onResetCurrentRound,
  onStartNextPlanned,
  onResetEvent,
  onClearPrepCache,
  hasFinalizedSongPool = false,
  onOpenPool,
}) => {
  const isLive = gameState === 'playing';
  const isPrep = !isLive && gameState !== 'ended';
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  return (
    <div className="host-quick-bar host-glass-panel" role="toolbar" aria-label="Quick controls">
      <div className="host-quick-bar__label">Quick</div>

      {isPrep ? (
        <div className="host-quick-bar__group host-quick-bar__group--prep" aria-label="Go live">
          {prepRoundReadyForGoLive && onSetRound ? (
            <button
              type="button"
              className="host-quick-bar__btn"
              onClick={onSetRound}
              disabled={mixGameActionsBlocked}
              title="Deal cards and show the call list on the projector"
            >
              <ListMusic className="w-4 h-4" aria-hidden />
              Set round
            </button>
          ) : null}
          {onResetSplash ? (
            <button
              type="button"
              className="host-quick-bar__btn"
              onClick={onResetSplash}
              title="Put the splash / QR screen back on the projector"
            >
              <ImageIcon className="w-4 h-4" aria-hidden />
              Splash
            </button>
          ) : null}
          {onStartGame ? (
            <button
              type="button"
              className="host-quick-bar__btn host-quick-bar__btn--primary"
              onClick={onStartGame}
              disabled={mixGameActionsBlocked}
              title="Begin playback"
              data-host-tutorial="play-start"
            >
              <Play className="w-4 h-4" aria-hidden />
              {startGameLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {isLive ? (
        <div className="host-quick-bar__group" aria-label="Live interventions">
          <button
            type="button"
            className="host-quick-bar__btn host-quick-bar__btn--danger"
            onClick={onRejectBingo}
            disabled={!canRejectBingo}
            title="Reject current bingo claim"
          >
            <XCircle className="w-4 h-4" aria-hidden />
            Reject
          </button>
          <button
            type="button"
            className="host-quick-bar__btn host-quick-bar__btn--go"
            onClick={onResume}
            disabled={!canResume}
            title="Resume after pause / verification"
          >
            <Play className="w-4 h-4" aria-hidden />
            Resume
          </button>
          <button
            type="button"
            className="host-quick-bar__btn"
            onClick={onRedoLastCall}
            disabled={transportLocked}
            title="Redo last call (previous song)"
          >
            <Undo2 className="w-4 h-4" aria-hidden />
            Redo
          </button>
        </div>
      ) : null}

      <div className="host-quick-bar__group" aria-label="Always available">
        {hasFinalizedSongPool && onOpenPool ? (
          <button
            type="button"
            className="host-quick-bar__btn"
            onClick={onOpenPool}
            title="Review the bingo pool and edit display aliases"
          >
            <ListChecks className="w-4 h-4" aria-hidden />
            Pool
          </button>
        ) : null}
        <button
          type="button"
          className="host-quick-bar__btn host-quick-bar__btn--feedback"
          onClick={onOpenFeedback}
          title="Read player feedback"
        >
          <MessageSquareText className="w-4 h-4" aria-hidden />
          Feedback{feedbackCount > 0 ? ` (${feedbackCount})` : ''}
        </button>
      </div>

      <div className="host-quick-bar__divider" aria-hidden />

      <div className="host-quick-bar__group" aria-label="Round actions">
        {isLive ? (
          <>
            <button
              type="button"
              className="host-quick-bar__btn host-quick-bar__btn--primary"
              onClick={onEndRound}
              data-host-tutorial="end-round"
              title="End this round (keeps event going)"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden />
              End round
            </button>
            <button
              type="button"
              className="host-quick-bar__btn"
              onClick={onResetCurrentRound}
              title="Reset this round (same playlists)"
            >
              <RotateCcw className="w-4 h-4" aria-hidden />
              Reset round
            </button>
          </>
        ) : null}
        {!isLive && hasNextPlanned ? (
          <button
            type="button"
            className="host-quick-bar__btn host-quick-bar__btn--primary"
            onClick={onStartNextPlanned}
            title="End current round (if needed) and load the next planned mix — does not Start Game"
          >
            <SkipForward className="w-4 h-4" aria-hidden />
            Next round
          </button>
        ) : null}

        <div className="host-quick-bar__more" ref={moreRef}>
          <button
            type="button"
            className={moreOpen ? 'host-quick-bar__btn is-open' : 'host-quick-bar__btn'}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((v) => !v)}
          >
            More
            <ChevronUp className="w-4 h-4" aria-hidden />
          </button>
          {moreOpen ? (
            <div className="host-quick-bar__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="host-quick-bar__menu-item host-quick-bar__menu-item--danger"
                onClick={() => {
                  setMoreOpen(false);
                  onResetEvent();
                }}
              >
                <Trash2 className="w-4 h-4" aria-hidden />
                Reset event
              </button>
              <button
                type="button"
                role="menuitem"
                className="host-quick-bar__menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  onClearPrepCache();
                }}
              >
                <Eraser className="w-4 h-4" aria-hidden />
                Clear prep cache
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default HostQuickBar;
