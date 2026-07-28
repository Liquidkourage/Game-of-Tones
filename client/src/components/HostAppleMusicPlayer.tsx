import React, { useEffect, useRef } from 'react';
import { API_BASE } from '../config';
import { hostFetch } from '../utils/hostFetch';
import { configureMusicKit, getMusicKitInstance } from '../utils/musicKitHost';

export type AppleHostPlayback = {
  songId: string;
  startMs: number;
  snippetSeconds: number;
} | null;

type Props = {
  playback: AppleHostPlayback;
  volume: number;
  /** When false, pause MusicKit without tearing down. */
  isPlaying: boolean;
};

/**
 * Host-browser MusicKit snippet player. Server owns call order; this only transports audio.
 */
export function HostAppleMusicPlayer({ playback, volume, isPlaying }: Props) {
  const lastSongRef = useRef<string | null>(null);
  const snippetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await hostFetch(`${API_BASE || ''}/api/apple/music/developer-token?_=${Date.now()}`, {
          cache: 'no-store',
        });
        const data = (await r.json().catch(() => ({}))) as { success?: boolean; token?: string };
        if (!r.ok || !data.token || cancelled) return;
        await configureMusicKit(data.token);
        readyRef.current = true;
      } catch {
        readyRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const mk = getMusicKitInstance();
    if (!mk) return;
    const vol = Math.min(1, Math.max(0, volume / 100));
    try {
      mk.volume = vol;
    } catch {
      /* ignore */
    }
  }, [volume]);

  useEffect(() => {
    if (snippetTimerRef.current) {
      clearTimeout(snippetTimerRef.current);
      snippetTimerRef.current = null;
    }

    const mk = getMusicKitInstance();
    if (!playback?.songId || !mk) {
      lastSongRef.current = null;
      try {
        void mk?.pause();
      } catch {
        /* ignore */
      }
      return;
    }

    const songKey = `${playback.songId}:${playback.startMs}:${playback.snippetSeconds}`;
    if (lastSongRef.current === songKey && isPlaying) {
      try {
        void mk.play();
      } catch {
        /* ignore */
      }
      return;
    }
    lastSongRef.current = songKey;

    let cancelled = false;
    (async () => {
      try {
        if (!readyRef.current) {
          const r = await hostFetch(`${API_BASE || ''}/api/apple/music/developer-token?_=${Date.now()}`, {
            cache: 'no-store',
          });
          const data = (await r.json().catch(() => ({}))) as { token?: string };
          if (data.token) await configureMusicKit(data.token);
          readyRef.current = true;
        }
        if (cancelled) return;
        await mk.setQueue({ song: playback.songId });
        if (cancelled) return;
        const startSec = Math.max(0, (playback.startMs || 0) / 1000);
        await mk.play();
        if (startSec > 0) {
          try {
            await mk.seekToTime(startSec);
          } catch {
            /* ignore */
          }
        }
        const snippetMs = Math.max(1000, (playback.snippetSeconds || 30) * 1000);
        snippetTimerRef.current = setTimeout(() => {
          try {
            void mk.pause();
          } catch {
            /* ignore */
          }
        }, snippetMs);
      } catch (e) {
        console.warn('Apple Music host playback failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      if (snippetTimerRef.current) {
        clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
    };
  }, [playback, isPlaying]);

  useEffect(() => {
    const mk = getMusicKitInstance();
    if (!mk || !playback?.songId) return;
    if (!isPlaying) {
      try {
        void mk.pause();
      } catch {
        /* ignore */
      }
    } else {
      try {
        void mk.play();
      } catch {
        /* ignore */
      }
    }
  }, [isPlaying, playback?.songId]);

  return null;
}
