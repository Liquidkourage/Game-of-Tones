import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Youtube, RefreshCw } from 'lucide-react';
import { API_BASE } from '../config';
import { hostFetch } from '../utils/hostFetch';

type StatusPayload = {
  success?: boolean;
  configured?: boolean;
  connected?: boolean;
};

type ApiPlaylist = {
  id: string;
  title: string;
  description?: string;
  itemCount: number | null;
  thumbnails?: {
    medium?: { url?: string };
    default?: { url?: string };
  };
};

/** Rows merged into HostView playlist library (`youtubeMusic: true`). */
export type YoutubeMixPlaylistRow = {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  youtubeMusic?: boolean;
};

function mapApiToMixRows(api: ApiPlaylist[]): YoutubeMixPlaylistRow[] {
  return api.map((pl) => ({
    id: pl.id,
    name: pl.title || '',
    tracks:
      pl.itemCount != null && Number.isFinite(Number(pl.itemCount))
        ? Math.max(0, Number(pl.itemCount))
        : 0,
    description: pl.description,
    youtubeMusic: true as const,
  }));
}

type Props = {
  /** Pushes YouTube playlists into the main library table (merged with Spotify). */
  onMixPlaylistsChange?: (rows: YoutubeMixPlaylistRow[]) => void;
  /** Wait until host JWT/session bootstrap finished so playlist requests don’t 401 before `/api/auth/me` syncs storage. */
  hostSessionReady?: boolean;
  /** Bump after OAuth return (`?youtube_music=connected`) to refetch playlists immediately. */
  refreshNonce?: number;
};

/**
 * Loads YouTube Music library playlists and forwards them to HostView for the shared playlist table (mix + round buckets).
 */
export function HostYoutubeMusicPlaylistLibrary({
  onMixPlaylistsChange,
  hostSessionReady = true,
  refreshNonce = 0,
}: Props) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set after a successful GET /playlists while connected (`null` = no successful list fetch yet). */
  const [ytPlaylistCountFromApi, setYtPlaylistCountFromApi] = useState<number | null>(null);
  const refreshGenRef = useRef(0);

  const pushMixRows = useCallback(
    (rows: YoutubeMixPlaylistRow[]) => {
      onMixPlaylistsChange?.(rows);
    },
    [onMixPlaylistsChange]
  );

  const refresh = useCallback(async () => {
    const myGen = ++refreshGenRef.current;
    const stale = () => myGen !== refreshGenRef.current;

    setLoading(true);
    setError(null);
    let waitingForHostSession = false;

    try {
      const sr = await hostFetch(`${API_BASE || ''}/api/youtube/music/status?_=${Date.now()}`, {
        cache: 'no-store',
      });
      if (stale()) return;

      const sdata = (await sr.json().catch(() => ({}))) as StatusPayload & { error?: string };
      if (!sr.ok) {
        setStatus(null);
        pushMixRows([]);
        setYtPlaylistCountFromApi(null);
        setError(
          sdata.error === 'login_required'
            ? 'Sign in as host first, then refresh.'
            : 'Could not load YouTube Music status.'
        );
        return;
      }
      setStatus(sdata);

      if (!sdata.configured) {
        pushMixRows([]);
        setYtPlaylistCountFromApi(null);
        return;
      }

      if (!sdata.connected) {
        pushMixRows([]);
        setYtPlaylistCountFromApi(null);
        return;
      }

      if (!hostSessionReady) {
        // Do not clear parent rows — a follow-up refresh runs when the session is ready; clearing here caused an empty table + misleading “success” copy.
        waitingForHostSession = true;
        return;
      }

      const pr = await hostFetch(`${API_BASE || ''}/api/youtube/music/playlists?_=${Date.now()}`, {
        cache: 'no-store',
      });
      if (stale()) return;

      const pdata = (await pr.json().catch(() => ({}))) as {
        success?: boolean;
        playlists?: ApiPlaylist[];
        message?: string;
        error?: string;
      };

      if (!pr.ok) {
        pushMixRows([]);
        setYtPlaylistCountFromApi(null);
        if (pr.status === 401 && pdata.error === 'youtube_not_connected') {
          setError(null);
          setStatus({ ...sdata, connected: false });
          return;
        }
        if (pr.status === 401 && (pdata.error === 'login_required' || !pdata.error)) {
          setError('Host session missing — finish Google sign-in or reload the page, then refresh.');
          return;
        }
        setError(pdata.message || pdata.error || 'Could not load playlists.');
        return;
      }

      if (!pdata.success) {
        pushMixRows([]);
        setYtPlaylistCountFromApi(null);
        setError(pdata.message || pdata.error || 'Could not load playlists.');
        return;
      }

      const list = Array.isArray(pdata.playlists) ? pdata.playlists : [];
      // Drop rows missing ids so they never disappear in the host table filter (`pid !== ''`).
      const usable = list.filter((row) => row && String(row.id || '').trim() !== '');
      if (stale()) return;
      pushMixRows(mapApiToMixRows(usable));
      setYtPlaylistCountFromApi(usable.length);
    } catch {
      if (stale()) return;
      setStatus(null);
      pushMixRows([]);
      setYtPlaylistCountFromApi(null);
      setError('Network error loading YouTube Music playlists.');
    } finally {
      if (!stale()) {
        setLoading(waitingForHostSession);
      }
    }
  }, [pushMixRows, hostSessionReady]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshNonce]);

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '14px 16px',
        borderRadius: 10,
        border: '1px solid rgba(255, 68, 68, 0.35)',
        background: 'rgba(180, 40, 40, 0.08)',
        maxWidth: 920,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <h4
          style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#ffb4b4',
          }}
        >
          <Youtube className="w-5 h-5" style={{ color: '#ff4444' }} aria-hidden />
          YouTube Music
        </h4>
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          disabled={loading || !hostSessionReady}
          onClick={() => void refresh()}
          title="Reload status and playlists"
        >
          <RefreshCw className="w-4 h-4" aria-hidden />
          Refresh
        </button>
      </div>

      {!hostSessionReady ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,255,255,0.72)', lineHeight: 1.5 }}>
          Finishing host sign-in… YouTube playlists load here right after your session is ready.
        </p>
      ) : error && !status ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#ff9e9e', lineHeight: 1.5 }}>
          {error}{' '}
          <button type="button" className="btn-secondary" style={{ fontSize: '0.78rem', marginLeft: 8 }} onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      ) : status && status.configured === false ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,220,220,0.88)', lineHeight: 1.5 }}>
          This deployment has{' '}
          <strong style={{ color: '#fff' }}>not</strong> set YouTube Music OAuth (
          <code style={{ fontSize: '0.72rem' }}>YOUTUBE_MUSIC_GOOGLE_CLIENT_ID</code> /{' '}
          <code style={{ fontSize: '0.72rem' }}>YOUTUBE_MUSIC_GOOGLE_CLIENT_SECRET</code>). Add those on the API host and redeploy to merge
          YouTube playlists into the library below.
        </p>
      ) : status && !status.connected ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,220,220,0.88)', lineHeight: 1.5 }}>
          Connect YouTube Music under <strong style={{ color: '#fff' }}>Connection</strong> to merge your playlists into the{' '}
          <strong style={{ color: '#fff' }}>Playlist library</strong> table below (mix checkboxes and round buckets). Item fetch uses video ids;
          in-player playback is still being wired.
        </p>
      ) : loading ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,255,255,0.65)' }}>Loading playlists…</p>
      ) : error ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#ff9e9e', lineHeight: 1.5 }}>
          {error}{' '}
          <button type="button" className="btn-secondary" style={{ fontSize: '0.78rem', marginLeft: 8 }} onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      ) : ytPlaylistCountFromApi === 0 ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255, 214, 160, 0.95)', lineHeight: 1.5 }}>
          <strong style={{ color: '#ffd27a' }}>Connected, but YouTube returned 0 playlists.</strong> Create a playlist on the same Google account in YouTube / YouTube Music, then tap Refresh. If you expected branded-channel playlists, open Connection and reconnect YouTube Music on this host account.
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,255,255,0.72)', lineHeight: 1.5 }}>
          Your YouTube playlists appear in the table below with other sources. Track counts come from YouTube; finalize loads each playlist&apos;s
          videos into the bingo pool.
        </p>
      )}
    </div>
  );
}
