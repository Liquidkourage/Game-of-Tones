import React, { useCallback, useEffect, useState } from 'react';
import { Youtube } from 'lucide-react';
import { API_BASE } from '../config';
import { hostFetch } from '../utils/hostFetch';

type StatusPayload = {
  success?: boolean;
  configured?: boolean;
  connected?: boolean;
};

/**
 * Optional host-only slice: link Google account for YouTube Music library access (readonly OAuth scope).
 * Feature-flagged via REACT_APP_ENABLE_YOUTUBE_MUSIC; server needs Google OAuth env vars for Music/library APIs.
 */
export function HostYoutubeMusicSection({ roomId }: { roomId: string }) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await hostFetch(`${API_BASE || ''}/api/youtube/music/status?_=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = (await r.json().catch(() => ({}))) as StatusPayload;
      if (!r.ok) return;
      setStatus(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connectYoutube = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (roomId) qs.set('roomId', roomId);
      const r = await hostFetch(`${API_BASE || ''}/api/youtube/music/auth-url?${qs.toString()}`);
      const data = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        url?: string;
        error?: string;
        loginUrl?: string;
        message?: string;
      };
      if (r.status === 401 || data.error === 'login_required') {
        const loginUrl = data.loginUrl || `${API_BASE || ''}/api/auth/google`;
        window.location.assign(loginUrl);
        return;
      }
      if (!r.ok || !data.success || !data.url) {
        setError(data.message || data.error || 'Could not start Google sign-in.');
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError('Could not start Google sign-in.');
    } finally {
      setBusy(false);
    }
  }, [roomId]);

  const disconnectYoutube = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await hostFetch(`${API_BASE || ''}/api/youtube/music/disconnect`, { method: 'POST' });
      if (!r.ok) {
        setError('Disconnect failed.');
        return;
      }
      await refreshStatus();
    } catch {
      setError('Disconnect failed.');
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  if (!status?.configured) return null;

  const connected = !!status.connected;

  return (
    <div
      className="host-youtube-music-section"
      style={{
        marginTop: 22,
        paddingTop: 18,
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Youtube className="w-6 h-6" style={{ color: '#ff4444' }} aria-hidden />
        YouTube Music
      </h2>
      <p className="host-spotify-guide" style={{ marginBottom: 12 }}>
        Connect the same Google account you use in <strong>YouTube Music</strong>. We sync your Music library playlists for hosting;
        in-browser playback is wired separately.
      </p>
      {error ? (
        <div className="spotify-error" style={{ marginBottom: 10 }}>
          <p>{error}</p>
        </div>
      ) : null}
      {!connected ? (
        <button className="spotify-connect-btn btn" type="button" disabled={busy} onClick={() => void connectYoutube()}>
          <Youtube className="btn-icon spotify-btn-icon" aria-hidden />
          {busy ? 'Connecting…' : 'Connect YouTube Music'}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div
            className="spotify-connection-led"
            role="status"
            title="YouTube Music linked"
            aria-label="YouTube Music linked"
          >
            <span className="spotify-connection-led__dot" aria-hidden />
            <span className="spotify-connection-led__label">YouTube Music linked</span>
          </div>
          <button className="disconnect-btn btn" type="button" disabled={busy} onClick={() => void disconnectYoutube()}>
            Disconnect YouTube Music
          </button>
        </div>
      )}
      <p
        className="spotify-attribution"
        style={{
          fontSize: '0.72rem',
          color: 'rgba(200, 210, 220, 0.78)',
          marginTop: 14,
          lineHeight: 1.45,
        }}
      >
        Library access uses Google&apos;s{' '}
        <a
          href="https://developers.google.com/youtube/v3"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          YouTube Data API v3
        </a>{' '}
        (the supported interface for third-party playlist sync with YouTube Music). Subject to Google API Services User Data Policy.
      </p>
    </div>
  );
}
