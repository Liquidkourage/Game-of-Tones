import React from 'react';
import { SkipForward, RotateCw, XCircle, Play, Undo2, MessageSquareText } from 'lucide-react';

type HostPanicStripProps = {
  onSkip: () => void;
  onBump: () => void;
  onRejectBingo: () => void;
  onResume: () => void;
  onRedoLastCall: () => void;
  onOpenFeedback: () => void;
  feedbackCount: number;
  canRejectBingo: boolean;
  canResume: boolean;
  /** When true, Skip / Bump / Redo are disabled (e.g. verification pending). */
  transportLocked?: boolean;
  className?: string;
};

const HostPanicStrip: React.FC<HostPanicStripProps> = ({
  onSkip,
  onBump,
  onRejectBingo,
  onResume,
  onRedoLastCall,
  onOpenFeedback,
  feedbackCount,
  canRejectBingo,
  canResume,
  transportLocked = false,
  className,
}) => {
  return (
    <div
      className={['host-live-dock host-live-dock--pinned host-panic-strip', className]
        .filter(Boolean)
        .join(' ')}
      role="toolbar"
      aria-label="Live show panic controls"
    >
      <div className="host-panic-strip__label">Panic</div>
      <div className="host-panic-strip__buttons">
        <button
          type="button"
          className="host-panic-strip__btn"
          onClick={onSkip}
          disabled={transportLocked}
          title="Skip to next song"
        >
          <SkipForward className="w-4 h-4" aria-hidden />
          Skip
        </button>
        <button
          type="button"
          className="host-panic-strip__btn"
          onClick={onBump}
          disabled={transportLocked}
          title="Re-roll snippet start on this song"
        >
          <RotateCw className="w-4 h-4" aria-hidden />
          Bump
        </button>
        <button
          type="button"
          className="host-panic-strip__btn host-panic-strip__btn--danger"
          onClick={onRejectBingo}
          disabled={!canRejectBingo}
          title="Reject current bingo claim"
        >
          <XCircle className="w-4 h-4" aria-hidden />
          Reject bingo
        </button>
        <button
          type="button"
          className="host-panic-strip__btn host-panic-strip__btn--go"
          onClick={onResume}
          disabled={!canResume}
          title="Resume after pause / verification"
        >
          <Play className="w-4 h-4" aria-hidden />
          Resume
        </button>
        <button
          type="button"
          className="host-panic-strip__btn"
          onClick={onRedoLastCall}
          disabled={transportLocked}
          title="Redo last call (previous song)"
        >
          <Undo2 className="w-4 h-4" aria-hidden />
          Redo last call
        </button>
        <button
          type="button"
          className="host-panic-strip__btn host-panic-strip__btn--feedback"
          onClick={onOpenFeedback}
          title="Read player feedback"
        >
          <MessageSquareText className="w-4 h-4" aria-hidden />
          Feedback ({feedbackCount})
        </button>
      </div>
    </div>
  );
};

export default HostPanicStrip;
