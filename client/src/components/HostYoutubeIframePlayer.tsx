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
};

const SESSION_AUDIO_KEY = 'got_host_youtube_audio_unlocked';

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

export type HostYoutubeIframePlayerProps = {
  videoId: string | null;
  /** Playback offset from video start (seconds). */
  startSeconds: number;
  /** Auto-pause after this many seconds (matches server snippet timer). */
  snippetSeconds: number;
  /** 0–100 */
  volume?: number;
};

/**
 * Host-only audio via YouTube IFrame API. Browsers usually block unmuted autoplay until a user gesture;
 * we offer a one-time-per-session tap target and call unMute/play explicitly.
 */
export function HostYoutubeIframePlayer({
  videoId,
  startSeconds,
  snippetSeconds,
  volume = 100,
}: HostYoutubeIframePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeRef = useRef(volume);
  const snippetStartedRef = useRef(false);
  const [showSoundGate, setShowSoundGate] = useState(false);

  volumeRef.current = volume;

  useEffect(() => {
    if (!videoId) {
      setShowSoundGate(false);
      snippetStartedRef.current = false;
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
      return;
    }

    setShowSoundGate(!readHostYoutubeAudioUnlocked());
    snippetStartedRef.current = false;

    let cancelled = false;

    void (async () => {
      await ensureYoutubeIframeApi();
      if (cancelled || !videoId || !containerRef.current || !window.YT?.Player) return;

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
      containerRef.current.innerHTML = '';
      const mountEl = document.createElement('div');
      containerRef.current.appendChild(mountEl);

      const startInt = Math.max(0, Math.floor(startSeconds));
      const origin =
        typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined;

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
            try {
              const vol = Math.round(Math.min(100, Math.max(0, volumeRef.current)));
              p.unMute?.();
              p.setVolume?.(vol);
              p.seekTo?.(Math.max(0, startSeconds), true);
              p.playVideo?.();
            } catch {
              /* ignore */
            }
          },
          onStateChange: (ev: { target: YtPlayer; data: number }) => {
            if (cancelled) return;
            if (ev.data !== playingState()) return;
            if (snippetStartedRef.current) return;
            snippetStartedRef.current = true;
            if (pauseTimerRef.current) {
              clearTimeout(pauseTimerRef.current);
              pauseTimerRef.current = null;
            }
            const ms = Math.max(400, Math.ceil(snippetSeconds * 1000));
            pauseTimerRef.current = setTimeout(() => {
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
      cancelled = true;
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
    };
  }, [videoId, startSeconds, snippetSeconds]);

  const applyUserAudioUnlock = () => {
    writeHostYoutubeAudioUnlocked();
    setShowSoundGate(false);
    const p = playerRef.current;
    if (!p) return;
    try {
      const vol = Math.round(Math.min(100, Math.max(0, volume)));
      p.unMute?.();
      p.setVolume?.(vol);
      p.seekTo?.(Math.max(0, startSeconds), true);
      p.playVideo?.();
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="host-youtube-iframe-player"
      aria-label="YouTube Music playback"
      style={{
        display: videoId ? 'block' : 'none',
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 320,
        maxWidth: 'min(92vw, 420px)',
        zIndex: 60,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#0a0a0a',
        border: '1px solid rgba(255, 255, 255, 0.12)',
      }}
    >
      <div style={{ position: 'relative', width: '100%' }}>
        <div ref={containerRef} style={{ width: '100%', aspectRatio: '16 / 9', minHeight: 180 }} />
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
              Browsers block autoplay audio until you interact once. After this, clips should play with audio for this session.
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
