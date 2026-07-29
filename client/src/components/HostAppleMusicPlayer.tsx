import React, { useEffect, useRef } from 'react';
import { API_BASE } from '../config';
import { hostFetch } from '../utils/hostFetch';
import { configureMusicKit, getMusicKitInstance, type MusicKitInstance } from '../utils/musicKitHost';

export type AppleHostPlayback = {
  songId: string;
  startMs: number;
  snippetSeconds: number;
} | null;

type Props = {
  playback: AppleHostPlayback;
  volume: number;
  /** When false, pause MusicKit without tearing down the queue. */
  isPlaying: boolean;
};

async function ensureConfigured(): Promise<MusicKitInstance | null> {
  try {
    const existing = getMusicKitInstance();
    if (existing) return existing;
    const r = await hostFetch(`${API_BASE || ''}/api/apple/music/developer-token?_=${Date.now()}`, {
      cache: 'no-store',
    });
    const data = (await r.json().catch(() => ({}))) as { success?: boolean; token?: string };
    if (!r.ok || !data.token) return null;
    return await configureMusicKit(data.token);
  } catch {
    return null;
  }
}

/**
 * Host-browser MusicKit snippet player. Server owns call order; this only transports audio.
 *
 * Important: one play pipeline + generation counters. A competing pause/play effect and
 * stale snippet timers were silencing every other song on advance.
 */
export function HostAppleMusicPlayer({ playback, volume, isPlaying }: Props) {
  const snippetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipGenerationRef = useRef(0);
  const volumeRef = useRef(volume);
  const isPlayingRef = useRef(isPlaying);
  const lastLoadedKeyRef = useRef<string | null>(null);

  volumeRef.current = volume;
  isPlayingRef.current = isPlaying;

  // Keep MusicKit volume in sync without touching transport.
  useEffect(() => {
    const mk = getMusicKitInstance();
    if (!mk) return;
    try {
      mk.volume = Math.min(1, Math.max(0, volume / 100));
    } catch {
      /* ignore */
    }
  }, [volume]);

  // Load / start each call once. Do not depend on isPlaying (that cancelled in-flight setQueue).
  useEffect(() => {
    if (snippetTimerRef.current) {
      clearTimeout(snippetTimerRef.current);
      snippetTimerRef.current = null;
    }

    if (!playback?.songId) {
      clipGenerationRef.current += 1;
      lastLoadedKeyRef.current = null;
      const mk = getMusicKitInstance();
      try {
        void mk?.pause();
      } catch {
        /* ignore */
      }
      return;
    }

    const songKey = `${playback.songId}:${playback.startMs}:${playback.snippetSeconds}`;
    const gen = ++clipGenerationRef.current;
    lastLoadedKeyRef.current = songKey;

    let cancelled = false;
    (async () => {
      const mk = await ensureConfigured();
      if (!mk || cancelled || gen !== clipGenerationRef.current) return;

      try {
        mk.volume = Math.min(1, Math.max(0, volumeRef.current / 100));
      } catch {
        /* ignore */
      }

      try {
        // MusicKit often no-ops or errors on setQueue while already playing — stop first.
        try {
          await mk.stop();
        } catch {
          try {
            await mk.pause();
          } catch {
            /* ignore */
          }
        }
        if (cancelled || gen !== clipGenerationRef.current) return;

        await mk.setQueue({ song: playback.songId });
        if (cancelled || gen !== clipGenerationRef.current) return;

        const startSec = Math.max(0, (playback.startMs || 0) / 1000);
        if (isPlayingRef.current) {
          await mk.play();
          if (startSec > 0) {
            try {
              await mk.seekToTime(startSec);
            } catch {
              /* ignore */
            }
          }
        }

        const snippetMs = Math.max(1000, (playback.snippetSeconds || 30) * 1000);
        if (snippetTimerRef.current) clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = setTimeout(() => {
          // Only pause if this clip is still the active one (avoids silencing the next song).
          if (gen !== clipGenerationRef.current) return;
          try {
            void mk.pause();
          } catch {
            /* ignore */
          }
        }, snippetMs);
      } catch (e) {
        if (gen === clipGenerationRef.current) {
          console.warn('Apple Music host playback failed:', e);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (snippetTimerRef.current) {
        clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
    };
  }, [playback?.songId, playback?.startMs, playback?.snippetSeconds]);

  // Host pause / resume only — never reload the queue or depend on songId
  // (that raced with setQueue and silenced every other advance).
  useEffect(() => {
    const mk = getMusicKitInstance();
    if (!mk || !lastLoadedKeyRef.current) return;
    try {
      if (!isPlaying) {
        void mk.pause();
      } else {
        void mk.play();
      }
    } catch {
      /* ignore */
    }
  }, [isPlaying]);

  return null;
}
