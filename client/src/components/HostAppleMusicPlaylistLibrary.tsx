import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Music2, RefreshCw } from 'lucide-react';
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
  artworkUrl?: string | null;
};

/** Rows merged into HostView playlist library (`appleMusic: true`). */
export type AppleMixPlaylistRow = {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  appleMusic?: boolean;
};

function mapApiToMixRows(api: ApiPlaylist[]): AppleMixPlaylistRow[] {
  return api.map((pl) => ({
    id: pl.id,
    name: pl.title || '',
    tracks:
      pl.itemCount != null && Number.isFinite(Number(pl.itemCount))
        ? Math.max(0, Number(pl.itemCount))
        : 0,
    description: pl.description,
    appleMusic: true as const,
  }));
}

type Props = {
  onMixPlaylistsChange?: (rows: AppleMixPlaylistRow[]) => void;
  hostSessionReady?: boolean;
  refreshNonce?: number;
};

/**
 * Loads Apple Music library playlists into the shared host mix table.
 */
export function HostAppleMusicPlaylistLibrary({
  onMixPlaylistsChange,
  hostSessionReady = true,
  refreshNonce = 0,
}: Props) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playlistCountFromApi, setPlaylistCountFromApi] = useState<number | null>(null);
  const refreshGenRef = useRef(0);

  const pushMixRows = useCallback(
    (rows: AppleMixPlaylistRow[]) => {
      onMixPlaylistsChange?.(rows);
    },
    [onMixPlaylistsChange],
  );

  const refresh = useCallback(async () => {
    const myGen = ++refreshGenRef.current;
    const stale = () => myGen !== refreshGenRef.current;

    setLoading(true);
    setError(null);
    let waitingForHostSession = false;

    try {
      const sr = await hostFetch(`${API_BASE || ''}/api/apple/music/status?_=${Date.now()}`, {
        cache: 'no-store',
      });
      if (stale()) return;

      const sdata = (await sr.json().catch(() => ({}))) as StatusPayload & { error?: string };
      if (!sr.ok) {
        setStatus(null);
        pushMixRows([]);
        setPlaylistCountFromApi(null);
        setError(
          sdata.error === 'login_required'
            ? 'Sign in as host first, then refresh.'
            : 'Could not load Apple Music status.',
        );
        return;
      }
      setStatus(sdata);

      if (!sdata.configured) {
        pushMixRows([]);
        setPlaylistCountFromApi(null);
        return;
      }

      if (!sdata.connected) {
        pushMixRows([]);
        setPlaylistCountFromApi(null);
        return;
      }

      if (!hostSessionReady) {
        waitingForHostSession = true;
        return;
      }

      const pr = await hostFetch(`${API_BASE || ''}/api/apple/music/playlists?_=${Date.now()}`, {
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
        setPlaylistCountFromApi(null);
        if (pr.status === 401 && pdata.error === 'apple_not_connected') {
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
        setPlaylistCountFromApi(null);
        setError(pdata.message || pdata.error || 'Could not load playlists.');
        return;
      }

      const rows = mapApiToMixRows(Array.isArray(pdata.playlists) ? pdata.playlists : []);
      setPlaylistCountFromApi(rows.length);
      pushMixRows(rows);
    } catch {
      if (!stale()) {
        pushMixRows([]);
        setPlaylistCountFromApi(null);
        setError('Could not load Apple Music playlists.');
      }
    } finally {
      if (!stale() && !waitingForHostSession) setLoading(false);
      else if (!stale() && waitingForHostSession) setLoading(false);
    }
  }, [hostSessionReady, pushMixRows]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshNonce]);

  if (!status?.configured && !loading && !error) return null;

  return (
    <div className="host-apple-music-playlist-library" style={{ marginTop: 12 }}>
      {error ? (
        <p style={{ color: 'rgba(255,160,160,0.95)', fontSize: '0.85rem', marginBottom: 8 }}>{error}</p>
      ) : null}
      {status?.connected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <Music2 className="w-4 h-4" style={{ color: '#fc3c44' }} aria-hidden />
          <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>
            {loading
              ? 'Loading Apple Music playlists…'
              : playlistCountFromApi != null
                ? `${playlistCountFromApi} Apple Music playlist${playlistCountFromApi === 1 ? '' : 's'} in library`
                : 'Apple Music connected'}
          </span>
          <button
            type="button"
            className="btn-secondary btn"
            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden style={{ marginRight: 6 }} />
            Refresh
          </button>
        </div>
      ) : null}
    </div>
  );
}
