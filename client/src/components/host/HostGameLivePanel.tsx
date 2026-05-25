import React from 'react';
import { AlertTriangle } from 'lucide-react';

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
};

const HostGameLivePanel: React.FC<HostGameLivePanelProps> = ({
  bingoVerificationCount,
  pendingPlayerName,
  onOpenBingoVerification,
}) => (
  <div className="host-game-live-extras">
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
  </div>
);

export default HostGameLivePanel;
