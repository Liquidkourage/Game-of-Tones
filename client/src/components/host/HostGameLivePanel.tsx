import React from 'react';
import { AlertTriangle, ListOrdered, Undo2 } from 'lucide-react';

export type CallLogRow = {
  id: string;
  name: string;
  artist: string;
  index: number;
};

type HostGameLivePanelProps = {
  bingoVerificationCount: number;
  pendingPlayerName: string | null;
  onOpenBingoVerification: () => void;
  callLog: CallLogRow[];
  canUndoSkip: boolean;
  onUndoSkip: () => void;
};

const HostGameLivePanel: React.FC<HostGameLivePanelProps> = ({
  bingoVerificationCount,
  pendingPlayerName,
  onOpenBingoVerification,
  callLog,
  canUndoSkip,
  onUndoSkip,
}) => (
  <div className="host-game-live-extras">
    {bingoVerificationCount > 0 ? (
      <section className="host-bingo-queue host-glass-panel" aria-label="Bingo verification queue">
        <h2 className="host-bingo-queue__title">
          <AlertTriangle className="host-bingo-queue__icon" aria-hidden />
          Bingo verification
        </h2>
        <p className="host-bingo-queue__lead">
          {pendingPlayerName ? (
            <>
              Reviewing <strong>{pendingPlayerName}</strong>
              {bingoVerificationCount > 1
                ? ` · ${bingoVerificationCount - 1} more in queue`
                : ''}
            </>
          ) : (
            `${bingoVerificationCount} claim(s) need review`
          )}
        </p>
        <button type="button" className="btn-primary host-r4-btn-primary" onClick={onOpenBingoVerification}>
          Open verification
        </button>
      </section>
    ) : null}

    <section className="host-call-log host-glass-panel" aria-label="Call log">
      <h2 className="host-call-log__title">
        <ListOrdered className="host-call-log__icon" aria-hidden />
        Call log
      </h2>
      {callLog.length === 0 ? (
        <p className="host-call-log__empty">No songs called yet this round.</p>
      ) : (
        <ol className="host-call-log__list" reversed>
          {callLog.map((row) => (
            <li key={`${row.id}-${row.index}`} className="host-call-log__row">
              <span className="host-call-log__num">#{row.index}</span>
              <span className="host-call-log__title">{row.name}</span>
              {row.artist ? <span className="host-call-log__artist"> — {row.artist}</span> : null}
            </li>
          ))}
        </ol>
      )}
      {canUndoSkip ? (
        <button type="button" className="btn-secondary host-call-log__undo" onClick={onUndoSkip}>
          <Undo2 className="w-4 h-4" aria-hidden />
          Undo last skip
        </button>
      ) : null}
    </section>
  </div>
);

export default HostGameLivePanel;
