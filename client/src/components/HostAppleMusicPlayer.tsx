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
 * Call from a user gesture (Start Game / Connect) so the first MusicKit play isn't blocked.
 */
export async function primeAppleMusicHostPlayback(): Promise<void> {
  try {
    const mk = await ensureConfigured();
    if (!mk) return;
    const prevVol = typeof mk.volume === 'number' ? mk.volume : 1;
    try {
      mk.volume = 0.001;
    } catch {
      /* ignore */
    }
    // Touch the player under the gesture; ignore failures when no queue is loaded yet.
    try {
      await mk.play();
    } catch {
      /* ignore */
    }
    try {
      await mk.pause();
    } catch {
      /* ignore */
    }
    try {
      mk.volume = prevVol > 0 ? prevVol : 1;
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

/**
 * Host-browser MusicKit snippet player. Server owns call order; this only transports audio.
 */
export function HostAppleMusicPlayer({ playback, volume, isPlaying }: Props) {
  const snippetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipGenerationRef = useRef(0);
  const volumeRef = useRef(volume);
  const isPlayingRef = useRef(isPlaying);
  /** True only after setQueue succeeded for the current clip — avoids play()-on-empty on song 1. */
  const queueReadyRef = useRef(false);

  volumeRef.current = volume;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const mk = getMusicKitInstance();
    if (!mk) return;
    try {
      mk.volume = Math.min(1, Math.max(0, volume / 100));
    } catch {
      /* ignore */
    }
  }, [volume]);

  // Load / start each call once. Do not depend on isPlaying.
  useEffect(() => {
    if (snippetTimerRef.current) {
      clearTimeout(snippetTimerRef.current);
      snippetTimerRef.current = null;
    }

    if (!playback?.songId) {
      clipGenerationRef.current += 1;
      queueReadyRef.current = false;
      const mk = getMusicKitInstance();
      try {
        void mk?.pause();
      } catch {
        /* ignore */
      }
      return;
    }

    const gen = ++clipGenerationRef.current;
    queueReadyRef.current = false;

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

        queueReadyRef.current = true;

        const startSec = Math.max(0, (playback.startMs || 0) / 1000);
        // Seek before play when possible — more reliable on the first clip.
        if (startSec > 0) {
          try {
            await mk.seekToTime(startSec);
          } catch {
            /* ignore — some builds only seek after play */
          }
        }

        if (isPlayingRef.current) {
          let played = false;
          for (let attempt = 0; attempt < 3 && !played; attempt++) {
            if (cancelled || gen !== clipGenerationRef.current) return;
            try {
              await mk.play();
              played = true;
            } catch (e) {
              if (attempt === 2) throw e;
              await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
            }
          }
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

  // Pause when host pauses. Resume only if a queue is ready (never play-on-empty).
  useEffect(() => {
    const mk = getMusicKitInstance();
    if (!mk) return;
    try {
      if (!isPlaying) {
        void mk.pause();
        return;
      }
      if (!queueReadyRef.current) return;
      void mk.play();
    } catch {
      /* ignore */
    }
  }, [isPlaying]);

  return null;
}
