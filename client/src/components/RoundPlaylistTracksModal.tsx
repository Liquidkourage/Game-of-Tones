import React from 'react';
import { RefreshCw } from 'lucide-react';
import HostSubmodalPortal from './HostSubmodalPortal';
import './RoundPlaylistTracksModal.css';

export type RoundPeekTrack = {
  name: string;
  artist: string;
};

interface RoundPlaylistTracksModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlistName: string;
  tracks: RoundPeekTrack[];
  loading: boolean;
  error: string | null;
  /** Spotify / catalog playlists can force a fresh Spotify page fetch. */
  canRefreshFromSpotify: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Optional note (e.g. served from org cache). */
  sourceNote?: string | null;
}

const RoundPlaylistTracksModal: React.FC<RoundPlaylistTracksModalProps> = ({
  isOpen,
  onClose,
  playlistName,
  tracks,
  loading,
  error,
  canRefreshFromSpotify,
  refreshing = false,
  onRefresh,
  sourceNote,
}) => {
  const subtitle =
    loading || refreshing
      ? 'Loading tracks…'
      : error
        ? undefined
        : tracks.length > 0
          ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}${sourceNote ? ` · ${sourceNote}` : ''}`
          : sourceNote || undefined;

  return (
    <HostSubmodalPortal
      isOpen={isOpen}
      onClose={onClose}
      title={playlistName || 'Playlist'}
      subtitle={subtitle}
      titleId="round-playlist-tracks-title"
      maxWidth="520px"
    >
      <div className="host-ui round-playlist-tracks">
        {canRefreshFromSpotify && onRefresh ? (
          <div className="round-playlist-tracks__toolbar">
            <button
              type="button"
              className="round-playlist-tracks__refresh"
              onClick={onRefresh}
              disabled={loading || refreshing}
            >
              <RefreshCw
                className={`round-playlist-tracks__refresh-icon${refreshing ? ' is-spinning' : ''}`}
                aria-hidden
              />
              {refreshing ? 'Refreshing…' : 'Refresh from Spotify'}
            </button>
          </div>
        ) : null}

        {loading && tracks.length === 0 ? (
          <p className="round-playlist-tracks__status">Loading song list…</p>
        ) : error ? (
          <p className="round-playlist-tracks__status round-playlist-tracks__status--error" role="alert">
            {error}
          </p>
        ) : tracks.length === 0 ? (
          <p className="round-playlist-tracks__status">No tracks found for this playlist.</p>
        ) : (
          <ol className="round-playlist-tracks__list">
            {tracks.map((t, i) => (
              <li key={`${i}-${t.name}-${t.artist}`} className="round-playlist-tracks__row">
                <span className="round-playlist-tracks__index" aria-hidden>
                  {i + 1}
                </span>
                <span className="round-playlist-tracks__meta">
                  <span className="round-playlist-tracks__name">{t.name || 'Untitled'}</span>
                  <span className="round-playlist-tracks__artist">{t.artist || '—'}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </HostSubmodalPortal>
  );
};

export default RoundPlaylistTracksModal;
