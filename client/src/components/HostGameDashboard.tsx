import React, { useEffect, useMemo, useState } from 'react';
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
  currentSong: {
    id: string;
    name?: string;
    artist?: string;
    explicit?: boolean;
    youtubeMusic?: boolean;
  } | null;
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
  remainingCount: number;
  percentComplete: number;
  roundStatus: 'completed' | 'active' | 'planned' | 'unplanned' | null;
  roundStatusLabel: string;
  titleRevealLabel: string;
  randomStartsLabel: string;
  mixFinalized: boolean;
  savedRound: boolean;
  playersOnlineCount: number;
  winnersCount: number;
  lastPlayed: { name: string; artist: string } | null;
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

function ProgressRing({
  played,
  total,
  size = 'md',
}: {
  played: number;
  total: number;
  size?: 'sm' | 'md';
}) {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, (played / safeTotal) * 100);
  const sm = size === 'sm';
  const r = sm ? 38 : 52;
  const dim = sm ? 96 : 128;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const cx = dim / 2;
  return (
    <div
      className={`host-r4-ring${sm ? ' host-r4-ring--sm' : ''}`}
      aria-label={`${played} of ${total} songs played`}
    >
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="host-r4-ring__svg">
        <defs>
          <linearGradient id="host-r4-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="55%" stopColor="#c4b5fd" />
            <stop offset="100%" stopColor="#00ff88" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cx} r={r} className="host-r4-ring__track" />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          className="host-r4-ring__progress"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cx})`}
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
    remainingCount,
    percentComplete,
    roundStatus,
    roundStatusLabel,
    titleRevealLabel,
    randomStartsLabel,
    mixFinalized,
    savedRound,
    playersOnlineCount,
    winnersCount,
    lastPlayed,
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
  const ringPlayed =
    gameState === 'playing' || gameState === 'ended'
      ? Math.max(playedCount, playbackTrackNumber ?? 0)
      : 0;
  const displayNum = playbackTrackNumber ?? (ringPlayed > 0 ? ringPlayed : null);

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

  const [albumArtUrl, setAlbumArtUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!currentSong?.id) {
      setAlbumArtUrl(null);
      return;
    }
    if (currentSong.youtubeMusic) {
      setAlbumArtUrl(`https://i.ytimg.com/vi/${encodeURIComponent(currentSong.id)}/hqdefault.jpg`);
      return;
    }
    const ctrl = new AbortController();
    const spotifyUrl = `https://open.spotify.com/track/${encodeURIComponent(currentSong.id)}`;
    fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { thumbnail_url?: string } | null) => {
        setAlbumArtUrl(data?.thumbnail_url ?? null);
      })
      .catch(() => setAlbumArtUrl(null));
    return () => ctrl.abort();
  }, [currentSong?.id, currentSong?.youtubeMusic]);

  const tourGoLive = gameState === 'waiting' && !currentSong;
  const tourLiveDock = gameState === 'playing';

  return (
    <div className="host-r4-grid">
      {/* Now playing / Ready */}
      <section
        className={
          tourLiveDock
            ? 'host-r4-card host-glass-panel host-r4-now-playing host-r4-now-playing--live'
            : 'host-r4-card host-glass-panel host-r4-now-playing'
        }
        data-host-tour={tourLiveDock ? 'live-dock' : tourGoLive ? 'go-live' : undefined}
        aria-label={gameState === 'playing' ? 'Now playing' : 'Ready to play'}
      >
        {gamePaused && (
          <div className="host-r4-paused host-paused-banner">
            <p className="host-r4-paused__title host-paused-banner__title">Game paused — resume here</p>
            <p className="host-r4-paused__sub host-paused-banner__sub">
              {pendingVerification
                ? `Bingo verification: ${pendingVerification.playerName}`
                : 'Playback paused (verification or Spotify). Use Resume when ready.'}
            </p>
            <button type="button" className="btn-primary host-r4-btn-primary host-resume-game-btn" onClick={onResumeGame}>
              Resume game
            </button>
          </div>
        )}
        <div className="host-r4-now-playing__layout">
          <div className="host-r4-art" aria-hidden>
            {albumArtUrl ? (
              <img className="host-r4-art__img" src={albumArtUrl} alt="" />
            ) : (
              <Music className="host-r4-art__icon" />
            )}
          </div>
          <div className="host-r4-now-playing__main">
            {gameState === 'playing' ? (
              <>
                <div className="host-r4-now-playing__head">
                  <p className="host-r4-card__eyebrow">Now playing</p>
                  {(playbackTrackNumber != null || playbackTrackTotal != null) && (
                    <span className="host-live-dock__song-index" aria-label="Song position in round">
                      {playbackTrackNumber ?? '—'}
                      <span className="host-live-dock__song-index-sep">/</span>
                      {playbackTrackTotal ?? totalTracks}
                    </span>
                  )}
                </div>
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
                  <button type="button" className="btn-secondary" onClick={onPause}>
                    {!isPlaying ? 'Resume' : 'Pause'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={onSkip}>
                    <SkipForward className="w-4 h-4" aria-hidden />
                    Skip
                  </button>
                </div>
                <div className="host-r4-volume host-r4-volume--full">
                  <button type="button" className="btn-secondary btn-host-icon" onClick={onMuteToggle}>
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <span className="host-live-dock__volume-label">{isMuted ? 0 : playbackState.volume}%</span>
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
                  <p className="host-r4-ready-badge mix-finalized-status">
                    <CheckCircle2 className="w-4 h-4" aria-hidden />
                    {gameTabRoundBuilderReady
                      ? 'Ready to start game — cards and playback are set for this round'
                      : 'Ready to start — cards and playback are set'}
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
                  <p className="host-r4-hint host-go-live__hint">
                    Start game will <strong>finalize the mix automatically</strong> if needed. Use Show playlists to
                    preview playlist names on the display.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Round summary */}
      <section className="host-r4-card host-glass-panel host-r4-round" aria-label="Round summary">
        <div className="host-r4-round__head">
          <div>
            <p className="host-r4-card__eyebrow">Round summary</p>
            <h2 className="host-r4-round__name">{roundName ?? '—'}</h2>
          </div>
          <span
            className={`host-r4-round__status${
              roundStatus ? ` host-r4-round__status--${roundStatus}` : ''
            }`}
          >
            {roundStatusLabel}
          </span>
        </div>

        <div className="host-r4-round__progress-bar" aria-hidden>
          <div className="host-r4-round__progress-fill" style={{ width: `${percentComplete}%` }} />
        </div>
        <p className="host-r4-round__progress-caption">
          {gameState === 'playing' || gameState === 'ended' ? (
            <>
              <strong>{ringPlayed}</strong> played · <strong>{remainingCount}</strong> left ·{' '}
              <strong>{percentComplete}%</strong> of pool
            </>
          ) : (
            <>Pattern: {patternLabel} · ready to start</>
          )}
        </p>

        <div className="host-r4-round__body">
          <ProgressRing played={ringPlayed} total={totalTracks} size="sm" />
          <dl className="host-r4-stats host-r4-stats--round">
            <div>
              <dt>Pattern</dt>
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
              <dt>Players</dt>
              <dd>
                {playerCardsCount > 0 ? (
                  <>
                    {playerCardsCount} card{playerCardsCount !== 1 ? 's' : ''}
                    {playersOnlineCount > 0 ? ` · ${playersOnlineCount} online` : ''}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Mix</dt>
              <dd>
                {mixFinalized ? 'Finalized' : poolCount > 0 ? 'Pool ready' : 'Not built'}
                {savedRound ? ' · saved round' : ''}
              </dd>
            </div>
            {winnersCount > 0 ? (
              <div>
                <dt>Winners</dt>
                <dd>
                  {winnersCount} this event
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        {lastPlayed && (gameState === 'playing' || gameState === 'ended') ? (
          <p className="host-r4-round__last">
            <span className="host-r4-round__last-label">Last call</span>
            <span className="host-r4-round__last-title">{lastPlayed.name}</span>
            {lastPlayed.artist ? (
              <span className="host-r4-round__last-artist"> — {lastPlayed.artist}</span>
            ) : null}
          </p>
        ) : null}

        {playlistNames.length > 0 ? (
          <div className="host-r4-pills">
            {playlistNames.slice(0, 5).map((name, i) => (
              <span key={`${name}-${i}`} className="host-r4-pill" title={name}>
                {name}
              </span>
            ))}
            {playlistNames.length > 5 ? (
              <span className="host-r4-pill host-r4-pill--more">+{playlistNames.length - 5}</span>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Up next / pool */}
      <section className="host-r4-card host-glass-panel host-r4-queue" aria-label="Up next">
        <div className="host-r4-card__head">
          <p className="host-r4-card__eyebrow">Up next</p>
          {hasFinalizedSongPool ? (
            <button type="button" className="host-r4-link-btn" onClick={onOpenPool}>
              View bingo pool
            </button>
          ) : null}
        </div>
        {upNext.length > 0 ? (
          <ul className="host-r4-queue-list">
            {upNext.map((song, i) => (
              <li key={song.id} className="host-r4-queue-item">
                <span className="host-r4-queue-thumb" aria-hidden>
                  <Music />
                </span>
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
