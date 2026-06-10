import React from 'react';
import { ArrowRight, ListMusic } from 'lucide-react';
import './HostSetupCockpit.css';

export type HostSetupPlaylistStepProps = {
  roundName: string | null;
  playlistNames: string[];
  playlistReady: boolean;
  spotifyCacheInfo: string | null;
  onGoToRounds: () => void;
};

const HostSetupPlaylistStep: React.FC<HostSetupPlaylistStepProps> = ({
  roundName,
  playlistNames,
  playlistReady,
  spotifyCacheInfo,
  onGoToRounds,
}) => {
  return (
    <div className="host-setup-step">
      <header className="host-setup-step__header">
        <p className="host-setup-step__eyebrow">Step 1 · Playlist</p>
        <h2 className="host-setup-step__title">Attach music to this round</h2>
      </header>

      <div className="host-setup-playlist__assigned host-glass-panel">
        <div className="host-setup-playlist__assigned-head">
          <div>
            <h3 className="host-setup-playlist__assigned-title">
              {roundName ? `Round: ${roundName}` : 'Current round'}
            </h3>
            <p className="host-setup-playlist__assigned-meta">
              {playlistReady
                ? `${playlistNames.length} playlist${playlistNames.length !== 1 ? 's' : ''} assigned`
                : 'No playlists assigned yet'}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary host-setup-playlist__library-btn"
            onClick={onGoToRounds}
            data-host-tutorial="playlist"
          >
            <ArrowRight className="w-5 h-5" aria-hidden />
            Assign on Rounds tab
          </button>
        </div>
        {playlistNames.length > 0 ? (
          <ul className="host-setup-playlist__list">
            {playlistNames.map((name, i) => (
              <li key={`${name}-${i}`}>
                <ListMusic className="w-4 h-4" aria-hidden />
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="host-setup-playlist__empty" role="status">
            Use the Rounds tab to browse Spotify, YouTube, or official packs and assign playlists to
            each round.
          </p>
        )}
        {spotifyCacheInfo ? (
          <p className="host-setup-playlist__cache">{spotifyCacheInfo}</p>
        ) : null}
      </div>

      {!playlistReady ? (
        <p className="host-setup-play__hint" role="status">
          Assign at least one playlist on the Rounds tab to continue to Criteria.
        </p>
      ) : null}
    </div>
  );
};

export default HostSetupPlaylistStep;
