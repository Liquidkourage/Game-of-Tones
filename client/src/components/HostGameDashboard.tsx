import React, { useMemo } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  Music,
  ListChecks,
  Users,
  ListPlus,
  RotateCcw,
  Flag,
  Volume2,
  VolumeX,
  CheckCircle2,
} from 'lucide-react';
import { SpotifyExplicitBadge } from './SpotifyExplicitBadge';
import type { BingoPoolSong } from './BingoPoolList';

export type HostGameDashboardProps = {
  gameState: 'waiting' | 'playing' | 'ended';
  currentSong: { id: string; name?: string; artist?: string; explicit?: boolean } | null;
  gamePaused: boolean;
  pendingVerification: { playerName: string } | null;
  isPlaying: boolean;
  isMuted: boolean;
  playbackState: { volume: number; currentTime?: number };
  playbackTrackNumber: number | null;
  playbackTrackTotal: number | null;
  snippetLength: number;
  roundName: string | null;
  patternLabel: string;
  poolCount: number;
  playedCount: number;
  playlistNames: string[];
  poolSongs: BingoPoolSong[];
  prepRoundReadyForGoLive: boolean;
  showPrimaryFinalizeMixButton: boolean;
  mixGameActionsBlocked: boolean;
  savedRoundRoomSyncBusy: boolean;
  isSpotifyConnecting: boolean;
  mixNeedsHostSpotify: boolean;
  gameTabRoundBuilderReady: boolean;
  hasFinalizedSongPool: boolean;
  playerCardsCount: number;
  onPause: () => void;
  onSkip: () => void;
  onMuteToggle: () => void;
  onVolumeChange: (volume: number) => void;
  setIsMuted: (muted: boolean) => void;
  setPlaybackVolume: (volume: number) => void;
  onStartGame: () => void;
  onFinalizeMix: () => void;
  onEndGame: () => void;
  onNewRoundSetup: () => void;
  onOpenLibrary: () => void;
  onOpenPool: () => void;
  onOpenPlayerCards: () => void;
  onResetDisplayLetters: () => void;
  onResumeGame: () => void;
  getDisplaySongTitle: (id: string, cleaned: string) => string;
  getDisplaySongArtist: (id: string, fallback: string) => string;
};

function ProgressRing({ played, total }: { played: number; total: number }) {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, (played / safeTotal) * 100);
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="host-r4-ring" aria-label={`${played} of ${total} songs played`}>
      <svg width="128" height="128" viewBox="0 0 128 128" className="host-r4-ring__svg">
        <circle cx="64" cy="64" r={r} className="host-r4-ring__track" />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="host-r4-ring__progress"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="host-r4-ring__label">
        <span className="host-r4-ring__nums">
          {played} / {total}
        </span>
        <span className="host-r4-ring__caption">songs played</span>
      </div>
    </div>
  );
}

const HostGameDashboard: React.FC<HostGameDashboardProps> = (props) => {
  const {
    gameState,
    currentSong,
    gamePaused,
    pendingVerification,
    isPlaying,
    isMuted,
    playbackState,
    playbackTrackNumber,
    playbackTrackTotal,
    snippetLength,
    roundName,
    patternLabel,
    poolCount,
    playedCount,
    playlistNames,
    poolSongs,
    prepRoundReadyForGoLive,
    showPrimaryFinalizeMixButton,
    mixGameActionsBlocked,
    savedRoundRoomSyncBusy,
    isSpotifyConnecting,
    mixNeedsHostSpotify,
    gameTabRoundBuilderReady,
    hasFinalizedSongPool,
    playerCardsCount,
    onPause,
    onSkip,
    onMuteToggle,
    onVolumeChange,
    setIsMuted,
    setPlaybackVolume,
    onStartGame,
    onFinalizeMix,
    onEndGame,
    onNewRoundSetup,
    onOpenLibrary,
    onOpenPool,
    onOpenPlayerCards,
    onResetDisplayLetters,
    onResumeGame,
    getDisplaySongTitle,
    getDisplaySongArtist,
  } = props;

  const totalTracks = poolCount > 0 ? poolCount : playbackTrackTotal ?? 75;
  const played = gameState === 'playing' ? playedCount : 0;
  const displayNum = playbackTrackNumber ?? (played > 0 ? played : null);

  const upNext = useMemo(() => {
    if (!poolSongs.length) return [];
    const idx = currentSong ? poolSongs.findIndex((s) => s.id === currentSong.id) : -1;
    const start = idx >= 0 ? idx + 1 : 0;
    return poolSongs.slice(start, start + 6);
  }, [poolSongs, currentSong]);

  const progressPct =
    snippetLength > 0 && playbackState.currentTime != null
      ? Math.min(100, (playbackState.currentTime / (snippetLength * 1000)) * 100)
      : isPlaying
        ? 40
        : 0;

  return (
    <div className="host-r4-grid" data-host-tour="go-live">
      {/* Now playing / Ready */}
      <section
        className="host-r4-card host-glass-panel host-r4-now-playing"
        aria-label={gameState === 'playing' ? 'Now playing' : 'Ready to play'}
      >
        {gamePaused && (
          <div className="host-r4-paused">
            <p className="host-r4-paused__title">Game paused</p>
            <p className="host-r4-paused__sub">
              {pendingVerification
                ? `Bingo verification: ${pendingVerification.playerName}`
                : 'Resume when ready.'}
            </p>
            <button type="button" className="btn-primary host-r4-btn-primary" onClick={onResumeGame}>
              Resume game
            </button>
          </div>
        )}
        <div className="host-r4-now-playing__layout">
          <div className="host-r4-art" aria-hidden>
            <Music className="host-r4-art__icon" />
          </div>
          <div className="host-r4-now-playing__main">
            {gameState === 'playing' ? (
              <>
                <p className="host-r4-card__eyebrow">Now playing</p>
                {currentSong ? (
                  <>
                    <h2 className="host-r4-track-title">
                      {getDisplaySongTitle(currentSong.id, currentSong.name || '')}
                      {currentSong.explicit ? (
                        <SpotifyExplicitBadge size="md" title="Explicit on Spotify" />
                      ) : null}
                    </h2>
                    <p className="host-r4-track-artist">
                      {getDisplaySongArtist(currentSong.id, currentSong.artist || '')}
                    </p>
                  </>
                ) : (
                  <p className="host-r4-track-artist">Starting next track…</p>
                )}
                {displayNum != null ? (
                  <p className="host-r4-track-meta">
                    Track <strong>{displayNum}</strong> of {totalTracks}
                  </p>
                ) : null}
                <div className="host-r4-progress">
                  <div className="host-r4-progress__bar" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="host-r4-transport">
                  <button type="button" className="host-r4-play" onClick={onPause} aria-label={isPlaying ? 'Pause' : 'Resume'}>
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>
                  <button type="button" className="btn-secondary" onClick={onSkip}>
                    <SkipForward className="w-4 h-4" aria-hidden />
                    Skip
                  </button>
                  <div className="host-r4-volume">
                    <button type="button" className="btn-secondary btn-host-icon" onClick={onMuteToggle}>
                      {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={isMuted ? 0 : playbackState.volume}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (isMuted && v > 0) setIsMuted(false);
                        setPlaybackVolume(v);
                        onVolumeChange(v);
                      }}
                      className="host-range host-range--volume"
                      aria-label="Volume"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="host-r4-card__eyebrow">Ready to play</p>
                <h2 className="host-r4-track-title">{roundName ?? 'Select a round'}</h2>
                <p className="host-r4-track-meta">
                  {poolCount > 0
                    ? `${poolCount} tracks · ${patternLabel}`
                    : 'Add playlists from Library, then start the show.'}
                </p>
                {prepRoundReadyForGoLive ? (
                  <p className="host-r4-ready-badge">
                    <CheckCircle2 className="w-4 h-4" aria-hidden />
                    Ready to start — cards and playback are set
                  </p>
                ) : null}
                <div className="host-r4-go-live-actions">
                  {showPrimaryFinalizeMixButton ? (
                    <button
                      type="button"
                      className="btn-secondary host-r4-btn-secondary"
                      onClick={onFinalizeMix}
                      disabled={mixGameActionsBlocked}
                    >
                      <ListChecks className="w-4 h-4" aria-hidden />
                      Show playlists
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
                {!gameTabRoundBuilderReady ? (
                  <p className="host-r4-hint">
                    Start game finalizes the mix automatically if needed.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Round summary */}
      <section className="host-r4-card host-glass-panel host-r4-round" aria-label="Round summary">
        <p className="host-r4-card__eyebrow">Round summary</p>
        <h2 className="host-r4-round__name">{roundName ?? '—'}</h2>
        <ProgressRing played={played} total={totalTracks} />
        <dl className="host-r4-stats">
          <div>
            <dt>Pattern</dt>
            <dd>{patternLabel}</dd>
          </div>
          <div>
            <dt>Pool</dt>
            <dd>{poolCount > 0 ? `${poolCount} tracks` : '—'}</dd>
          </div>
          <div>
            <dt>Playlists</dt>
            <dd>{playlistNames.length || '—'}</dd>
          </div>
        </dl>
        {playlistNames.length > 0 ? (
          <div className="host-r4-pills">
            {playlistNames.slice(0, 4).map((name, i) => (
              <span key={`${name}-${i}`} className="host-r4-pill" title={name}>
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* Up next / pool */}
      <section className="host-r4-card host-glass-panel host-r4-queue" aria-label="Up next">
        <div className="host-r4-card__head">
          <p className="host-r4-card__eyebrow">Up next</p>
          {hasFinalizedSongPool ? (
            <button type="button" className="host-r4-link-btn" onClick={onOpenPool}>
              View full pool
            </button>
          ) : null}
        </div>
        {upNext.length > 0 ? (
          <ul className="host-r4-queue-list">
            {upNext.map((song, i) => (
              <li key={song.id} className="host-r4-queue-item">
                <span className="host-r4-queue-num">{displayNum != null ? displayNum + i + 1 : i + 1}</span>
                <div className="host-r4-queue-text">
                  <span className="host-r4-queue-title">
                    {getDisplaySongTitle(song.id, song.name || '')}
                  </span>
                  <span className="host-r4-queue-artist">
                    {getDisplaySongArtist(song.id, song.artist || '')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="host-r4-empty">Build the pool from your round playlists to see upcoming tracks.</p>
        )}
      </section>

      {/* Host actions */}
      <section className="host-r4-card host-glass-panel host-r4-actions" aria-label="Host actions">
        <p className="host-r4-card__eyebrow">Host actions</p>
        <div className="host-r4-action-grid">
          {gameState === 'playing' ? (
            <>
              <button type="button" className="host-r4-action-tile" onClick={onSkip}>
                <SkipForward className="w-5 h-5" aria-hidden />
                Skip song
              </button>
              <button type="button" className="host-r4-action-tile" onClick={onOpenLibrary}>
                <ListPlus className="w-5 h-5" aria-hidden />
                Library
              </button>
              {hasFinalizedSongPool ? (
                <button type="button" className="host-r4-action-tile" onClick={onOpenPool}>
                  <ListChecks className="w-5 h-5" aria-hidden />
                  Bingo pool
                </button>
              ) : null}
              {playerCardsCount > 0 ? (
                <button type="button" className="host-r4-action-tile" onClick={onOpenPlayerCards}>
                  <Users className="w-5 h-5" aria-hidden />
                  Player cards
                </button>
              ) : null}
              <button type="button" className="host-r4-action-tile" onClick={onResetDisplayLetters}>
                <RotateCcw className="w-5 h-5" aria-hidden />
                Reset letters
              </button>
              <button type="button" className="host-r4-action-tile host-r4-action-tile--muted" onClick={onNewRoundSetup}>
                <RotateCcw className="w-5 h-5" aria-hidden />
                New round
              </button>
              <button type="button" className="host-r4-action-tile host-r4-action-tile--danger" onClick={onEndGame}>
                <Flag className="w-5 h-5" aria-hidden />
                End game
              </button>
            </>
          ) : (
            <>
              <button type="button" className="host-r4-action-tile" onClick={onOpenLibrary}>
                <ListPlus className="w-5 h-5" aria-hidden />
                Playlist library
              </button>
              {hasFinalizedSongPool ? (
                <button type="button" className="host-r4-action-tile" onClick={onOpenPool}>
                  <ListChecks className="w-5 h-5" aria-hidden />
                  Bingo pool
                </button>
              ) : null}
              {playerCardsCount > 0 ? (
                <button type="button" className="host-r4-action-tile" onClick={onOpenPlayerCards}>
                  <Users className="w-5 h-5" aria-hidden />
                  Player cards ({playerCardsCount})
                </button>
              ) : null}
              {showPrimaryFinalizeMixButton ? (
                <button
                  type="button"
                  className="host-r4-action-tile"
                  onClick={onFinalizeMix}
                  disabled={mixGameActionsBlocked}
                >
                  <ListChecks className="w-5 h-5" aria-hidden />
                  Show playlists
                </button>
              ) : null}
            </>
          )}
        </div>
        {gameState === 'waiting' && !currentSong ? (
          <button
            type="button"
            className="btn-primary host-r4-btn-primary host-r4-btn-primary--wide host-r4-actions__start"
            onClick={onStartGame}
            disabled={mixGameActionsBlocked}
          >
            <Play className="w-5 h-5" aria-hidden />
            Start game
          </button>
        ) : null}
      </section>
    </div>
  );
};

export default HostGameDashboard;
