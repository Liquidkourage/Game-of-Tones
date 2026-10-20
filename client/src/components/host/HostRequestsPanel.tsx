import React, { useState } from 'react';
import { Inbox, Trash2 } from 'lucide-react';
import PlayerAvatar from '../PlayerAvatar';

export type HostSongRequestRow = {
  id: string;
  playerName: string;
  avatar?: string;
  title: string;
  artist: string;
  submittedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  resolvedSong?: { id: string; name: string; artist: string };
  fromHost?: boolean;
};

export type HostRequestTrackPicker = {
  requestId: string;
  tracks: Array<{
    id: string;
    name: string;
    artist: string;
    duration_ms?: number;
    explicit?: boolean;
    albumId?: string;
  }>;
};

type HostRequestsPanelProps = {
  requests: HostSongRequestRow[];
  approvedCount: number;
  pendingCount: number;
  busyRequestId: string | null;
  trackPicker: HostRequestTrackPicker | null;
  maxSongRequestsPerPlayer: number;
  onMaxSongRequestsPerPlayerChange: (next: number) => void;
  onHostAddRequest: (title: string, artist: string) => void | Promise<void>;
  onModerate: (request: HostSongRequestRow, status: 'approved' | 'rejected') => void;
  onConfirmTrack: (
    request: HostSongRequestRow,
    track: {
      id: string;
      name: string;
      artist: string;
      duration_ms?: number;
      explicit?: boolean;
      albumId?: string;
    },
  ) => void;
  onCancelTrackPicker: () => void;
  onRemove: (request: HostSongRequestRow) => void;
  onClearAll: () => void;
  onGoToRounds: () => void;
};

const HostRequestsPanel: React.FC<HostRequestsPanelProps> = ({
  requests,
  approvedCount,
  pendingCount,
  busyRequestId,
  trackPicker,
  maxSongRequestsPerPlayer,
  onMaxSongRequestsPerPlayerChange,
  onHostAddRequest,
  onModerate,
  onConfirmTrack,
  onCancelTrackPicker,
  onRemove,
  onClearAll,
  onGoToRounds,
}) => {
  const sorted = requests.slice().reverse();
  const [hostTitle, setHostTitle] = useState('');
  const [hostArtist, setHostArtist] = useState('');
  const [hostAddBusy, setHostAddBusy] = useState(false);

  const submitHostRequest = async () => {
    const title = hostTitle.trim();
    if (!title || hostAddBusy) return;
    setHostAddBusy(true);
    try {
      await onHostAddRequest(title, hostArtist.trim());
      setHostTitle('');
      setHostArtist('');
    } finally {
      setHostAddBusy(false);
    }
  };

  return (
    <div className="host-requests-workspace">
      <section className="host-glass-panel host-requests-workspace__summary">
        <div className="host-requests-workspace__head">
          <h2 className="host-requests-workspace__title">
            <Inbox className="host-requests-workspace__title-icon" aria-hidden />
            Song requests
          </h2>
          {requests.length > 0 ? (
            <button type="button" className="btn-secondary" onClick={onClearAll}>
              Clear all
            </button>
          ) : null}
        </div>
        <p className="host-requests-workspace__blurb">
          Audience submissions land here. Approve to add them to the virtual Requests pool, then assign
          that pool on the Rounds tab when you want a Requests round.
        </p>
        <div className="host-requests-workspace__stats">
          <span>
            <strong>{approvedCount}</strong> approved
          </span>
          <span>
            <strong>{pendingCount}</strong> pending
          </span>
          <label className="host-requests-workspace__cap">
            Per-player limit
            <input
              type="number"
              min={1}
              max={20}
              value={maxSongRequestsPerPlayer}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (!Number.isFinite(n)) return;
                onMaxSongRequestsPerPlayerChange(Math.min(20, Math.max(1, n)));
              }}
            />
          </label>
          <button type="button" className="host-requests-workspace__link" onClick={onGoToRounds}>
            Open Rounds →
          </button>
        </div>
      </section>

      <section className="host-glass-panel host-requests-workspace__host-add" aria-label="Add a request as host">
        <h3 className="host-requests-workspace__subtitle">Add a request</h3>
        <p className="host-requests-workspace__blurb">
          Drop a title into the queue yourself (same moderation flow as player submissions).
        </p>
        <div className="host-requests-workspace__host-add-row">
          <input
            type="text"
            placeholder="Song title"
            value={hostTitle}
            onChange={(e) => setHostTitle(e.target.value)}
            maxLength={120}
          />
          <input
            type="text"
            placeholder="Artist (optional)"
            value={hostArtist}
            onChange={(e) => setHostArtist(e.target.value)}
            maxLength={120}
          />
          <button
            type="button"
            className="host-playlist-quick-add"
            disabled={!hostTitle.trim() || hostAddBusy}
            onClick={() => void submitHostRequest()}
          >
            {hostAddBusy ? 'Adding…' : 'Add to queue'}
          </button>
        </div>
      </section>

      <section className="host-glass-panel host-requests-workspace__queue" aria-label="Request queue">
        {sorted.length === 0 ? (
          <p className="host-requests-workspace__empty">
            No requests yet. Players submit from their card menu, or add one above.
          </p>
        ) : (
          <ul className="host-requests-workspace__list">
            {sorted.map((request) => (
              <li key={request.id} className="host-requests-workspace__row">
                <div className="host-requests-workspace__meta">
                  <strong>{request.title}</strong>
                  {request.artist ? <span>— {request.artist}</span> : null}
                  <span
                    className="host-requests-workspace__from"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    from <PlayerAvatar avatar={request.avatar} name={request.playerName} size="sm" />
                    {request.playerName}
                    {request.fromHost ? ' (host)' : ''}
                  </span>
                </div>
                <div className="host-requests-workspace__actions">
                  {request.status === 'pending' ? (
                    <>
                      <button
                        type="button"
                        className="host-playlist-quick-add"
                        disabled={busyRequestId === request.id}
                        onClick={() => onModerate(request, 'approved')}
                      >
                        Find &amp; approve
                      </button>
                      <button
                        type="button"
                        className="host-playlist-quick-add"
                        disabled={busyRequestId === request.id}
                        onClick={() => onModerate(request, 'rejected')}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span
                      className={
                        request.status === 'approved'
                          ? 'host-requests-workspace__status host-requests-workspace__status--approved'
                          : 'host-requests-workspace__status host-requests-workspace__status--rejected'
                      }
                    >
                      {request.status === 'approved'
                        ? `Approved${request.resolvedSong ? ` as ${request.resolvedSong.name}` : ''}`
                        : 'Rejected'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="host-requests-workspace__remove"
                    disabled={busyRequestId === request.id}
                    title="Remove this request"
                    aria-label={`Remove request ${request.title}`}
                    onClick={() => onRemove(request)}
                  >
                    <Trash2 aria-hidden />
                    Remove
                  </button>
                </div>
                {trackPicker?.requestId === request.id ? (
                  <div className="host-requests-workspace__picker">
                    <span className="host-requests-workspace__picker-label">Pick the Spotify track:</span>
                    {trackPicker.tracks.map((track) => (
                      <button
                        key={track.id}
                        type="button"
                        className="host-playlist-quick-add"
                        disabled={busyRequestId === request.id}
                        onClick={() => onConfirmTrack(request, track)}
                      >
                        <strong>{track.name}</strong>
                        <span> — {track.artist}</span>
                      </button>
                    ))}
                    <button type="button" className="host-playlist-quick-add" onClick={onCancelTrackPicker}>
                      Cancel match
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default HostRequestsPanel;
