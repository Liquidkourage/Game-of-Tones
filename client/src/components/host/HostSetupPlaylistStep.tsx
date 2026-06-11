import React from 'react';
import { ArrowUpRight, ListMusic } from 'lucide-react';
import './HostSetupCockpit.css';

export type HostSetupPlaylistStepProps = {
  roundName: string | null;
  playlistNames: string[];
  playlistReady: boolean;
  /** Mode-aware 1-or-5 rule status ("Round Mix · …", "Column mode · …", "Add N more…"). */
  structureCopy: string;
  /** Exactly 5 playlists: list rows show their card-column mapping. */
  columnMode: boolean;
  poolCount: number;
  spotifyCacheInfo: string | null;
  /** Inline playlist library (same component the Rounds tab uses). */
  library: React.ReactNode;
  onGoToRounds: () => void;
};

const HostSetupPlaylistStep: React.FC<HostSetupPlaylistStepProps> = ({
  roundName,
  playlistNames,
  playlistReady,
  structureCopy,
  columnMode,
  poolCount,
  spotifyCacheInfo,
  library,
  onGoToRounds,
}) => {
  const roundLabel = roundName || 'Round 1';
  return (
    <div className="host-setup-step">
      <header className="host-setup-step__header host-setup-playlist__header">
        <div>
          <p className="host-setup-step__eyebrow">Step 1 · Build rounds</p>
          <h2 className="host-setup-step__title">
            {playlistReady ? `Music for ${roundLabel}` : 'Let’s build your first round'}
          </h2>
          <p className="host-setup-playlist__lead">
            {playlistReady
              ? 'Add or remove playlists below, then continue to Card setup.'
              : `Rounds use 1 playlist for the whole round, or 5 playlists — one per card column. Pick from the library below to add them to ${roundLabel}.`}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary host-setup-playlist__rounds-link"
          onClick={onGoToRounds}
          title="Power-user view: manage every round, drag-and-drop assignment, and the full planner"
        >
          <ArrowUpRight className="w-4 h-4" aria-hidden />
          Open full Rounds manager
        </button>
      </header>

      <div className="host-setup-playlist__assigned host-glass-panel" data-host-tutorial="playlist">
        <div className="host-setup-playlist__assigned-head">
          <div>
            <h3 className="host-setup-playlist__assigned-title">{roundLabel}</h3>
            <p className="host-setup-playlist__assigned-meta" role="status">
              {structureCopy}
              {poolCount > 0 ? ` · ${poolCount} tracks in the pool` : ''}
            </p>
          </div>
        </div>
        {playlistNames.length > 0 ? (
          <ul className="host-setup-playlist__list">
            {playlistNames.map((name, i) => (
              <li key={`${name}-${i}`}>
                <ListMusic className="w-4 h-4" aria-hidden />
                {columnMode ? (
                  <span className="host-setup-playlist__column-label">Column {i + 1}</span>
                ) : null}
                {name}
              </li>
            ))}
          </ul>
        ) : null}
        {spotifyCacheInfo ? (
          <p className="host-setup-playlist__cache">{spotifyCacheInfo}</p>
        ) : null}
      </div>

      <div className="host-setup-playlist__library">{library}</div>
    </div>
  );
};

export default HostSetupPlaylistStep;
