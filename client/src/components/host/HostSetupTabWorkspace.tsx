import React from 'react';
import HostRoundTimeline, { type RoundTimelineRow } from './HostRoundTimeline';
import './HostSetupTabWorkspace.css';

export type HostSetupTabWorkspaceProps = {
  rounds: RoundTimelineRow[];
  roundSummary?: string;
  columnLetters?: readonly string[];
  onSelectRound: (index: number) => void;
  playlistReady: boolean;
  onGoToRounds: () => void;
  onGoToGame: () => void;
  prepRoundReadyForGoLive: boolean;
  children: React.ReactNode;
};

const HostSetupTabWorkspace: React.FC<HostSetupTabWorkspaceProps> = ({
  rounds,
  roundSummary,
  columnLetters,
  onSelectRound,
  playlistReady,
  onGoToRounds,
  onGoToGame,
  prepRoundReadyForGoLive,
  children,
}) => {
  return (
    <div className="host-setup-tab-workspace">
      <div data-host-tutorial="next-round">
        <HostRoundTimeline
          className="host-round-timeline--setup-tab"
          rounds={rounds}
          summary={roundSummary}
          emptyHint="Assign playlists on the Rounds tab first."
          columnLetters={columnLetters}
          onSelectRound={onSelectRound}
        />
      </div>

      {playlistReady ? (
        <section
          className="host-setup-tab-workspace__panel host-glass-panel"
          aria-labelledby="host-setup-tab-title"
          data-host-tutorial="criteria"
        >
          <header className="host-setup-tab-workspace__head">
            <div>
              <p className="host-setup-tab-workspace__eyebrow">Card setup</p>
              <h2 id="host-setup-tab-title" className="host-setup-tab-workspace__title">
                Set how this round plays
              </h2>
              <p className="host-setup-tab-workspace__lead">
                Win pattern, clip length, playback rules, and print options for the selected round.
              </p>
            </div>
            {prepRoundReadyForGoLive ? (
              <button type="button" className="btn-primary host-setup-tab-workspace__go-game" onClick={onGoToGame}>
                Go to Game
              </button>
            ) : null}
          </header>
          <div className="host-setup-tab-workspace__body">{children}</div>
        </section>
      ) : (
        <section className="host-setup-tab-workspace__panel host-setup-tab-workspace__empty host-glass-panel">
          <p className="host-setup-tab-workspace__eyebrow">Card setup</p>
          <h2 className="host-setup-tab-workspace__title">Add playlists first</h2>
          <p className="host-setup-tab-workspace__lead">
            Rounds need 1 playlist for a round mix, or 5 playlists for column mode. Build tonight&apos;s
            rounds on the Rounds tab, then come back here to set patterns and playback.
          </p>
          <button type="button" className="btn-primary" onClick={onGoToRounds}>
            Open Rounds
          </button>
        </section>
      )}
    </div>
  );
};

export default HostSetupTabWorkspace;
