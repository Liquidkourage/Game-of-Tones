import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import { API_BASE, ENABLE_APPLE_MUSIC } from '../config';
import { hostFetch } from '../utils/hostFetch';
import { configureMusicKit } from '../utils/musicKitHost';

type StatusPayload = {
  success?: boolean;
  configured?: boolean;
  connected?: boolean;
};

type Props = {
  roomId: string;
  /** Fired when connected flips (after status / connect / disconnect). Keep stable in the parent. */
  onConnectionChange?: (connected: boolean) => void;
};

/**
 * Host Connection: MusicKit authorize → POST music-user-token to server.
 */
export function HostAppleMusicSection({ roomId: _roomId, onConnectionChange }: Props) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusReady, setStatusReady] = useState(false);
  const [statusFetchFailed, setStatusFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;
  const lastNotifiedConnectedRef = useRef<boolean | null>(null);
  const statusReadyRef = useRef(false);

  const notifyConnected = useCallback((connected: boolean) => {
    if (lastNotifiedConnectedRef.current === connected) return;
    lastNotifiedConnectedRef.current = connected;
    onConnectionChangeRef.current?.(connected);
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusFetchFailed(false);
    // Only flash “Checking…” on the first load — not on every parent re-render.
    if (!statusReadyRef.current) setStatusReady(false);
    try {
      const r = await hostFetch(`${API_BASE || ''}/api/apple/music/status?_=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = (await r.json().catch(() => ({}))) as StatusPayload;
      if (!r.ok) {
        setStatus(null);
        setStatusFetchFailed(true);
        return;
      }
      setStatus(data);
      notifyConnected(!!data.connected);
    } catch {
      setStatus(null);
      setStatusFetchFailed(true);
    } finally {
      statusReadyRef.current = true;
      setStatusReady(true);
    }
  }, [notifyConnected]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connectApple = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const tr = await hostFetch(`${API_BASE || ''}/api/apple/music/developer-token?_=${Date.now()}`, {
        cache: 'no-store',
      });
      const tdata = (await tr.json().catch(() => ({}))) as {
        success?: boolean;
        token?: string;
        error?: string;
        message?: string;
        loginUrl?: string;
      };
      if (tr.status === 401 || tdata.error === 'login_required') {
        const loginUrl = tdata.loginUrl || `${API_BASE || ''}/api/auth/google`;
        window.location.assign(loginUrl);
        return;
      }
      if (!tr.ok || !tdata.success || !tdata.token) {
        setError(tdata.message || tdata.error || 'Could not get Apple Music developer token.');
        return;
      }

      const music = await configureMusicKit(tdata.token);
      const userToken = await music.authorize();
      if (!userToken) {
        setError('Apple Music authorization was cancelled.');
        return;
      }

      const ur = await hostFetch(`${API_BASE || ''}/api/apple/music/user-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicUserToken: userToken }),
      });
      const udata = (await ur.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (!ur.ok || !udata.success) {
        setError(udata.message || udata.error || 'Could not save Apple Music session.');
        return;
      }
      await refreshStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not connect Apple Music.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  const disconnectApple = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      try {
        const { getMusicKitInstance } = await import('../utils/musicKitHost');
        const mk = getMusicKitInstance();
        if (mk?.isAuthorized) await mk.unauthorize();
      } catch {
        /* ignore */
      }
      const r = await hostFetch(`${API_BASE || ''}/api/apple/music/disconnect`, { method: 'POST' });
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

  const shellStyle = {
    marginTop: 22,
    paddingTop: 18,
    borderTop: '1px solid rgba(255,255,255,0.08)',
  } as const;

  if (!statusReady) {
    return (
      <div className="host-apple-music-section" style={{ ...shellStyle, opacity: 0.75, fontSize: '0.88rem' }}>
        Checking Apple Music availability…
      </div>
    );
  }

  if (statusFetchFailed) {
    if (!ENABLE_APPLE_MUSIC) return null;
    return (
      <div className="host-apple-music-section" style={shellStyle}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Music2 className="w-6 h-6" style={{ color: '#fc3c44' }} aria-hidden />
          Apple Music
        </h2>
        <p className="host-spotify-guide">
          Couldn&apos;t load Apple Music status from this host. Deploy latest server routes, or check your network.
        </p>
        <button className="btn-secondary btn" type="button" onClick={() => void refreshStatus()}>
          Retry
        </button>
      </div>
    );
  }

  if (!status?.configured) {
    if (!ENABLE_APPLE_MUSIC) return null;
    return (
      <div className="host-apple-music-section" style={shellStyle}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Music2 className="w-6 h-6" style={{ color: '#fc3c44' }} aria-hidden />
          Apple Music
        </h2>
        <p className="host-spotify-guide">
          Server is missing Apple Music credentials (Team ID, Key ID, and .p8 private key).
        </p>
      </div>
    );
  }

  const connected = !!status.connected;

  return (
    <div className="host-apple-music-section" style={shellStyle}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Music2 className="w-6 h-6" style={{ color: '#fc3c44' }} aria-hidden />
        Apple Music
      </h2>
      {error ? (
        <div className="spotify-error" style={{ marginBottom: 10 }}>
          <p>{error}</p>
        </div>
      ) : null}
      {!connected ? (
        <button className="spotify-connect-btn btn" type="button" disabled={busy} onClick={() => void connectApple()}>
          <Music2 className="btn-icon spotify-btn-icon" aria-hidden />
          {busy ? 'Connecting…' : 'Connect Apple Music'}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div
            className="spotify-connection-led"
            role="status"
            title="Apple Music linked"
            aria-label="Apple Music linked"
          >
            <span className="spotify-connection-led__dot" aria-hidden />
            <span className="spotify-connection-led__label">Apple Music linked</span>
          </div>
          <button className="disconnect-btn btn" type="button" disabled={busy} onClick={() => void disconnectApple()}>
            Disconnect Apple Music
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
        Uses{' '}
        <a
          href="https://developer.apple.com/documentation/musickitjs"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          MusicKit JS
        </a>{' '}
        and the Apple Music API. Apple Music® is a trademark of Apple Inc. An active Apple Music subscription is
        required for playback.
      </p>
    </div>
  );
}
