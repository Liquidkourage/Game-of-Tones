import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YtPlayer = {
  destroy?: () => void;
  setVolume?: (n: number) => void;
  seekTo?: (sec: number, allowSeekAhead?: boolean) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
};

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
 * Host-only audio via YouTube IFrame API (Option 1). Visible mini player so the host can confirm audio/output device.
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

  useEffect(() => {
    if (!videoId) {
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

      playerRef.current = new window.YT.Player(mountEl, {
        height: '120',
        width: '100%',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          start: startInt,
        },
        events: {
          onReady: (ev: { target: YtPlayer }) => {
            const p = ev.target;
            try {
              const vol = Math.round(Math.min(100, Math.max(0, volume)));
              p.setVolume?.(vol);
              p.seekTo?.(Math.max(0, startSeconds), true);
              p.playVideo?.();
            } catch {
              /* ignore */
            }
            const ms = Math.max(400, Math.ceil(snippetSeconds * 1000));
            pauseTimerRef.current = setTimeout(() => {
              try {
                p.pauseVideo?.();
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
  }, [videoId, startSeconds, snippetSeconds, volume]);

  return (
    <div
      className="host-youtube-iframe-player"
      aria-label="YouTube Music playback"
      style={{
        display: videoId ? 'block' : 'none',
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 280,
        maxWidth: '42vw',
        zIndex: 60,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#0a0a0a',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', minHeight: 120 }} />
    </div>
  );
}
