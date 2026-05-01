import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer;
      PlayerState?: { PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** YouTube iframe API player surface we use */
type YtPlayer = {
  destroy?: () => void;
  setVolume?: (n: number) => void;
  seekTo?: (sec: number, allowSeekAhead?: boolean) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  unMute?: () => void;
  mute?: () => void;
  loadVideoById?: (
    videoId: string | { videoId: string; startSeconds?: number },
    startSeconds?: number,
  ) => void;
};

const SESSION_AUDIO_KEY = 'got_host_youtube_audio_unlocked';

/** Tiny silent WAV — keeps an HTML5 audio pipeline warm after user gesture (helps some browsers with background tabs). */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let silentKeepAliveAudio: HTMLAudioElement | null = null;

function readHostYoutubeAudioUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_AUDIO_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHostYoutubeAudioUnlocked() {
  try {
    sessionStorage.setItem(SESSION_AUDIO_KEY, '1');
  } catch {
    /* ignore */
  }
}

function startYoutubeAudioKeepAlive() {
  try {
    if (!silentKeepAliveAudio) {
      const a = new Audio(SILENT_WAV);
      a.loop = true;
      a.volume = 0.001;
      silentKeepAliveAudio = a;
    }
    void silentKeepAliveAudio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

let iframeApiPromise: Promise<void> | null = null;

function ensureYoutubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (!iframeApiPromise) {
    iframeApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try {
          prev?.();
        } catch {
          /* ignore */
        }
        resolve();
      };
      const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
      if (!existing) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
      }
    });
  }
  return iframeApiPromise;
}

function playingState(): number {
  return window.YT?.PlayerState?.PLAYING ?? 1;
}

function destroyYoutubePlayer(
  playerRef: React.MutableRefObject<YtPlayer | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  pauseTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  if (pauseTimerRef.current) {
    clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
  }
  try {
    playerRef.current?.destroy?.();
  } catch {
    /* ignore */
  }
  playerRef.current = null;
  if (containerRef.current) containerRef.current.innerHTML = '';
}

export type HostYoutubeIframePlayerProps = {
  videoId: string | null;
  /** Playback offset from video start (seconds). */
  startSeconds: number;
  /** Auto-pause after this many seconds (matches server snippet timer). */
  snippetSeconds: number;
  /** 0–100 */
  volume?: number;
  /** `dock` = small fixed corner on host. `window` = centered card for dedicated popup route. */
  variant?: 'dock' | 'window';
};

/**
 * Host-only audio via YouTube IFrame API. Browsers usually block unmuted autoplay until a user gesture;
 * we offer a one-time-per-session tap target and call unMute/play explicitly.
 *
 * Mitigations for background-tab / focus loss when advancing tracks:
 * - Reuse one YT.Player and loadVideoById() instead of destroying/recreating (fewer "new autoplay" failures).
 * - After unlock: silent WAV loop keep-alive + retries when tab becomes visible/focused again.
 */
export function HostYoutubeIframePlayer({
  videoId,
  startSeconds,
  snippetSeconds,
  volume = 100,
  variant = 'dock',
}: HostYoutubeIframePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeRef = useRef(volume);
  const snippetSecondsRef = useRef(snippetSeconds);
  const snippetStartedRef = useRef(false);
  /** Bumped when clip params change so stale snippet timers never pause the wrong song. */
  const clipGenerationRef = useRef(0);
  const asyncInitCancelledRef = useRef(false);
  const [showSoundGate, setShowSoundGate] = useState(false);

  volumeRef.current = volume;
  snippetSecondsRef.current = snippetSeconds;

  const kickPlayback = (p: YtPlayer, startSec: number, genAtKick: number) => {
    const vol = Math.round(Math.min(100, Math.max(0, volumeRef.current)));
    const tryOnce = () => {
      if (genAtKick !== clipGenerationRef.current) return;
      if (playerRef.current !== p) return;
      try {
        p.unMute?.();
        p.setVolume?.(vol);
        p.seekTo?.(Math.max(0, startSec), true);
        p.playVideo?.();
      } catch {
        /* ignore */
      }
    };
    tryOnce();
    window.setTimeout(tryOnce, 90);
    window.setTimeout(tryOnce, 320);
  };

  useEffect(() => {
    if (!videoId) {
      setShowSoundGate(false);
      snippetStartedRef.current = false;
      destroyYoutubePlayer(playerRef, containerRef, pauseTimerRef);
      return;
    }

    clipGenerationRef.current += 1;
    const clipGen = clipGenerationRef.current;
    snippetStartedRef.current = false;
    setShowSoundGate(!readHostYoutubeAudioUnlocked());
    if (readHostYoutubeAudioUnlocked()) {
      startYoutubeAudioKeepAlive();
    }

    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }

    asyncInitCancelledRef.current = false;

    void (async () => {
      await ensureYoutubeIframeApi();
      if (asyncInitCancelledRef.current || !videoId || !containerRef.current || !window.YT?.Player) return;

      const startInt = Math.max(0, Math.floor(startSeconds));
      const origin =
        typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined;

      if (playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
        try {
          playerRef.current.loadVideoById(videoId, startInt);
          kickPlayback(playerRef.current, startSeconds, clipGen);
        } catch {
          /* ignore */
        }
        return;
      }

      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      containerRef.current.innerHTML = '';
      const mountEl = document.createElement('div');
      containerRef.current.appendChild(mountEl);

      playerRef.current = new window.YT.Player(mountEl, {
        height: '360',
        width: '100%',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          start: startInt,
          playsinline: 1,
          ...(origin ? { origin } : {}),
        },
        events: {
          onReady: (ev: { target: YtPlayer }) => {
            const p = ev.target;
            playerRef.current = p;
            kickPlayback(p, startSeconds, clipGen);
          },
          onStateChange: (ev: { target: YtPlayer; data: number }) => {
            if (asyncInitCancelledRef.current) return;
            if (ev.data !== playingState()) return;
            if (snippetStartedRef.current) return;
            snippetStartedRef.current = true;
            if (pauseTimerRef.current) {
              clearTimeout(pauseTimerRef.current);
              pauseTimerRef.current = null;
            }
            const scheduledGen = clipGenerationRef.current;
            const ms = Math.max(400, Math.ceil(snippetSecondsRef.current * 1000));
            pauseTimerRef.current = setTimeout(() => {
              if (scheduledGen !== clipGenerationRef.current) return;
              try {
                ev.target.pauseVideo?.();
              } catch {
                /* ignore */
              }
            }, ms);
          },
        },
      });
    })();

    return () => {
      asyncInitCancelledRef.current = true;
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
    };
  }, [videoId, startSeconds, snippetSeconds]);

  useEffect(() => {
    return () => {
      destroyYoutubePlayer(playerRef, containerRef, pauseTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!videoId) return;
    const resumeIfPossible = () => {
      if (document.hidden) return;
      if (!readHostYoutubeAudioUnlocked()) return;
      const p = playerRef.current;
      if (!p) return;
      kickPlayback(p, startSeconds, clipGenerationRef.current);
    };
    document.addEventListener('visibilitychange', resumeIfPossible);
    window.addEventListener('focus', resumeIfPossible);
    return () => {
      document.removeEventListener('visibilitychange', resumeIfPossible);
      window.removeEventListener('focus', resumeIfPossible);
    };
  }, [videoId, startSeconds]);

  const applyUserAudioUnlock = () => {
    writeHostYoutubeAudioUnlocked();
    startYoutubeAudioKeepAlive();
    setShowSoundGate(false);
    const p = playerRef.current;
    if (!p) return;
    kickPlayback(p, startSeconds, clipGenerationRef.current);
  };

  return (
    <div
      className="host-youtube-iframe-player"
      aria-label="YouTube Music playback"
      style={{
        display: variant === 'window' ? (videoId ? 'block' : 'none') : videoId ? 'block' : 'none',
        position: variant === 'window' ? 'relative' : 'fixed',
        ...(variant === 'window'
          ? {
              width: '100%',
              maxWidth: 960,
              margin: '0 auto',
              right: 'auto',
              bottom: 'auto',
              borderRadius: 12,
            }
          : {
              right: 16,
              bottom: 16,
              width: 320,
              maxWidth: 'min(92vw, 420px)',
              borderRadius: 8,
            }),
        zIndex: variant === 'window' ? 1 : 60,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        overflow: 'hidden',
        background: '#0a0a0a',
        border: '1px solid rgba(255, 255, 255, 0.12)',
      }}
    >
      <div style={{ position: 'relative', width: '100%' }}>
        <div
          ref={containerRef}
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            minHeight: variant === 'window' ? 280 : 180,
          }}
        />
        {videoId && showSoundGate ? (
          <button
            type="button"
            onClick={applyUserAudioUnlock}
            style={{
              position: 'absolute',
              inset: 0,
              margin: 0,
              padding: '12px 14px',
              border: 'none',
              borderRadius: 0,
              cursor: 'pointer',
              background: 'linear-gradient(145deg, rgba(15,15,18,0.92), rgba(35,35,42,0.88))',
              color: '#f2f2f4',
              fontSize: '0.95rem',
              fontWeight: 600,
              lineHeight: 1.35,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span>Tap here for sound</span>
            <span style={{ fontWeight: 400, fontSize: '0.8rem', opacity: 0.85 }}>
              Browsers block autoplay audio until you interact once. After this, clips should play with audio for this
              session. For best results while using a separate display tab, leave this window open on another monitor or
              snap it beside the projector — some browsers still throttle background tabs.
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
