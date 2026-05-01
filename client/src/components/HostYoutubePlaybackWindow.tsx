import React, { useLayoutEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { HostYoutubeIframePlayer } from './HostYoutubeIframePlayer';
import {
  getYoutubeHostPlaybackChannelName,
  type YoutubeHostPlaybackPayload,
} from '../utils/youtubeHostPlaybackChannel';

/**
 * Minimal route opened via window.open from HostView. Receives clip + volume over BroadcastChannel
 * so this window can stay focused for reliable YouTube iframe audio while the host uses another tab for the projector.
 */
export default function HostYoutubePlaybackWindow() {
  const { roomId = '' } = useParams<{ roomId: string }>();
  const [playback, setPlayback] = useState<YoutubeHostPlaybackPayload>(null);
  const [volume, setVolume] = useState(100);

  useLayoutEffect(() => {
    if (!roomId) return;
    const ch = new BroadcastChannel(getYoutubeHostPlaybackChannelName(roomId));

    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; payload?: YoutubeHostPlaybackPayload; volume?: number } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'playback') setPlayback(d.payload ?? null);
      if (d.type === 'volume' && typeof d.volume === 'number') setVolume(d.volume);
    };
    ch.addEventListener('message', onMessage);

    const requestSync = () => {
      try {
        ch.postMessage({ type: 'REQUEST_SYNC' });
      } catch {
        /* ignore */
      }
    };

    const notifyActive = () => {
      try {
        ch.postMessage({ type: 'POPUP_ACTIVE' });
      } catch {
        /* ignore */
      }
    };

    requestSync();
    queueMicrotask(requestSync);
    window.setTimeout(requestSync, 120);
    window.setTimeout(requestSync, 500);

    notifyActive();
    const pingIv = window.setInterval(notifyActive, 10000);

    const onUnload = () => {
      try {
        ch.postMessage({ type: 'POPUP_CLOSING' });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', onUnload);

    return () => {
      window.removeEventListener('pagehide', onUnload);
      onUnload();
      window.clearInterval(pingIv);
      ch.removeEventListener('message', onMessage);
      ch.close();
    };
  }, [roomId]);

  const snippetFallback = playback?.snippetSeconds ?? 30;

  return (
    <div
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '20px 24px 40px',
        background: 'linear-gradient(180deg, #080a0e 0%, #12161f 55%, #0e1118 100%)',
        color: '#e8eaef',
      }}
    >
      <header style={{ maxWidth: 920, margin: '0 auto 20px' }}>
        <h1 style={{ fontSize: '1.28rem', fontWeight: 700, margin: '0 0 10px', letterSpacing: '0.02em' }}>
          YouTube playback
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'rgba(232,234,239,0.76)', lineHeight: 1.5 }}>
          Keep this window open on the computer that runs audio. The host console sends each clip here so playback
          stays reliable while you use another tab or screen for the projector.
        </p>
        <p style={{ margin: '12px 0 0', fontSize: '0.82rem', color: 'rgba(232,234,239,0.5)' }}>
          Room{' '}
          <code style={{ color: '#00ff88', fontSize: '0.85rem' }}>{roomId || '—'}</code>
          {!roomId ? (
            <span style={{ marginLeft: 8 }}> Open this page from the host using &quot;Playback window&quot;.</span>
          ) : null}
        </p>
      </header>

      <HostYoutubeIframePlayer
        variant="window"
        videoId={playback?.videoId ?? null}
        startSeconds={(playback?.startMs ?? 0) / 1000}
        snippetSeconds={snippetFallback}
        volume={volume}
      />

      {!playback?.videoId ? (
        <p
          style={{
            maxWidth: 920,
            margin: '18px auto 0',
            fontSize: '0.84rem',
            color: 'rgba(232,234,239,0.55)',
            textAlign: 'center',
            lineHeight: 1.45,
          }}
        >
          Waiting for the host to advance a YouTube Music track…
        </p>
      ) : null}
    </div>
  );
}
