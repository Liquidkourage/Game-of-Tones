import React from 'react';
import { CheckCircle2, ListChecks, Loader2, Play } from 'lucide-react';
import HostPlaylistAvailabilityWarnings from '../HostPlaylistAvailabilityWarnings';
import type { PlaylistAvailabilityIssue } from '../HostPlaylistAvailabilityWarnings';
import HostPreShowChecklist, { type PreShowCheckItem } from './HostPreShowChecklist';
import HostEventActivationBar from './HostEventActivationBar';

export type HostSetupPlayStepProps = {
  roomId: string | null;
  roundName: string | null;
  playlistNames: string[];
  patternLabel: string;
  snippetLength: number;
  randomStartsLabel: string;
  titleRevealLabel: string;
  poolCount: number;
  prepRoundReadyForGoLive: boolean;
  showPrimaryFinalizeMixButton: boolean;
  mixGameActionsBlocked: boolean;
  finalizeMixBusy: boolean;
  finalizeMixElapsedSec: number;
  savedRoundRoomSyncBusy: boolean;
  isSpotifyConnecting: boolean;
  mixNeedsHostSpotify: boolean;
  playlistAvailabilityIssues: PlaylistAvailabilityIssue[];
  preShowChecklistItems: PreShowCheckItem[];
  onFinalizeMix: () => void;
  onStartGame: () => void;
};

const HostSetupPlayStep: React.FC<HostSetupPlayStepProps> = ({
  roomId,
  roundName,
  playlistNames,
  patternLabel,
  snippetLength,
  randomStartsLabel,
  titleRevealLabel,
  poolCount,
  prepRoundReadyForGoLive,
  showPrimaryFinalizeMixButton,
  mixGameActionsBlocked,
  finalizeMixBusy,
  finalizeMixElapsedSec,
  savedRoundRoomSyncBusy,
  isSpotifyConnecting,
  mixNeedsHostSpotify,
  playlistAvailabilityIssues,
  preShowChecklistItems,
  onFinalizeMix,
  onStartGame,
}) => {
  const showPlaylistsLabel = finalizeMixBusy
    ? finalizeMixElapsedSec > 0
      ? `Loading playlists… ${finalizeMixElapsedSec}s`
      : 'Loading playlists…'
    : 'Build song pool';

  return (
    <div className="host-setup-play">
      <header className="host-setup-play__header">
        <p className="host-setup-play__eyebrow">Step 3 · Play game</p>
        <h2 className="host-setup-play__title">Readiness and start</h2>
      </header>

      <div className="host-setup-play__checklist" data-host-tutorial="play">
        <HostPreShowChecklist items={preShowChecklistItems} />
      </div>

      {roomId ? (
        <div className="host-setup-play__activation">
          <HostEventActivationBar roomId={roomId} />
        </div>
      ) : null}

      <dl className="host-setup-play__summary">
        <div>
          <dt>Round</dt>
          <dd>{roundName ?? '—'}</dd>
        </div>
        <div>
          <dt>Playlists</dt>
          <dd>
            {playlistNames.length > 0 ? (
              <ul className="host-setup-play__playlist-list">
                {playlistNames.map((name, i) => (
                  <li key={`${name}-${i}`}>{name}</li>
                ))}
              </ul>
            ) : (
              'None selected'
            )}
          </dd>
        </div>
        <div>
          <dt>Win pattern</dt>
          <dd>{patternLabel}</dd>
        </div>
        <div>
          <dt>Clip</dt>
          <dd>
            {snippetLength}s · {randomStartsLabel}
          </dd>
        </div>
        <div>
          <dt>Projector</dt>
          <dd>{titleRevealLabel}</dd>
        </div>
        <div>
          <dt>Song pool</dt>
          <dd>{poolCount > 0 ? `${poolCount} tracks ready` : 'Not built yet'}</dd>
        </div>
      </dl>

      {prepRoundReadyForGoLive ? (
        <p className="host-setup-play__ready">
          <CheckCircle2 className="w-4 h-4" aria-hidden />
          Cards and playback are set for this round
        </p>
      ) : null}

      <div className="host-setup-play__actions">
        {showPrimaryFinalizeMixButton ? (
          <button
            type="button"
            className={
              finalizeMixBusy
                ? 'btn-secondary host-r4-btn-secondary host-r4-btn--loading'
                : 'btn-secondary host-r4-btn-secondary'
            }
            onClick={onFinalizeMix}
            disabled={mixGameActionsBlocked}
            aria-busy={finalizeMixBusy}
          >
            {finalizeMixBusy ? (
              <Loader2 className="w-4 h-4 host-r4-spin" aria-hidden />
            ) : (
              <ListChecks className="w-4 h-4" aria-hidden />
            )}
            {showPlaylistsLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-primary host-r4-btn-primary host-r4-btn-primary--wide"
          onClick={onStartGame}
          disabled={mixGameActionsBlocked}
        >
          <Play className="w-5 h-5" aria-hidden />
          {savedRoundRoomSyncBusy
            ? 'Syncing…'
            : isSpotifyConnecting && mixNeedsHostSpotify
              ? 'Connecting Spotify…'
              : 'Start game'}
        </button>
      </div>

      {finalizeMixBusy ? (
        <p className="host-r4-finalize-progress" role="status" aria-live="polite">
          Fetching tracks and syncing playlist names to the projector — this can take up to 15 seconds.
          {finalizeMixElapsedSec >= 8 ? (
            <>
              {' '}
              <strong>Still working… {finalizeMixElapsedSec}s</strong>
            </>
          ) : null}
        </p>
      ) : null}

      {!prepRoundReadyForGoLive && !showPrimaryFinalizeMixButton && poolCount === 0 ? (
        <p className="host-setup-play__hint" role="status">
          Build the song pool before starting, or save the round from Criteria if you use saved rounds.
        </p>
      ) : null}

      {playlistAvailabilityIssues.length > 0 ? (
        <HostPlaylistAvailabilityWarnings issues={playlistAvailabilityIssues} compact />
      ) : null}
    </div>
  );
};

export default HostSetupPlayStep;
