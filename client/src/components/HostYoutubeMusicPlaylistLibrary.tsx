import React, { useCallback, useEffect, useState } from 'react';
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

/**
 * Manager tab: lists YouTube Music library playlists when the server has OAuth configured and the host has connected.
 */
export function HostYoutubeMusicPlaylistLibrary() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [playlists, setPlaylists] = useState<ApiPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sr = await hostFetch(`${API_BASE || ''}/api/youtube/music/status?_=${Date.now()}`, {
        cache: 'no-store',
      });
      const sdata = (await sr.json().catch(() => ({}))) as StatusPayload;
      if (!sr.ok) {
        setStatus(null);
        setPlaylists([]);
        setError('Could not load YouTube Music status.');
        return;
      }
      setStatus(sdata);

      if (!sdata.configured) {
        setPlaylists([]);
        return;
      }

      if (!sdata.connected) {
        setPlaylists([]);
        return;
      }

      const pr = await hostFetch(`${API_BASE || ''}/api/youtube/music/playlists?_=${Date.now()}`, {
        cache: 'no-store',
      });
      const pdata = (await pr.json().catch(() => ({}))) as {
        success?: boolean;
        playlists?: ApiPlaylist[];
        message?: string;
        error?: string;
      };

      if (!pr.ok) {
        setPlaylists([]);
        if (pr.status === 401 && pdata.error === 'youtube_not_connected') {
          setError(null);
          setStatus({ ...sdata, connected: false });
          return;
        }
        setError(pdata.message || pdata.error || 'Could not load playlists.');
        return;
      }

      if (!pdata.success) {
        setPlaylists([]);
        setError(pdata.message || pdata.error || 'Could not load playlists.');
        return;
      }

      setPlaylists(Array.isArray(pdata.playlists) ? pdata.playlists : []);
    } catch {
      setStatus(null);
      setPlaylists([]);
      setError('Network error loading YouTube Music playlists.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status?.configured) return null;

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
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
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
          YouTube Music playlists
        </h4>
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          disabled={loading || !status.configured}
          onClick={() => void refresh()}
          title="Reload status and playlists"
        >
          <RefreshCw className="w-4 h-4" aria-hidden />
          Refresh
        </button>
      </div>

      {!status.connected ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,220,220,0.88)', lineHeight: 1.5 }}>
          Connect YouTube Music under <strong style={{ color: '#fff' }}>Connection</strong> in the header to load your library
          playlists here. Playback from these lists is still being wired into the game.
        </p>
      ) : loading ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,255,255,0.65)' }}>Loading playlists…</p>
      ) : error ? (
        <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: '#ff9e9e', lineHeight: 1.5 }}>
          {error}{' '}
          <button type="button" className="btn-secondary" style={{ fontSize: '0.78rem', marginLeft: 8 }} onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      ) : playlists.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
          No playlists returned for this Google account (create one in YouTube Music / YouTube and refresh).
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {playlists.map((pl) => {
            const thumb = pl.thumbnails?.medium?.url || pl.thumbnails?.default?.url;
            const countLabel =
              pl.itemCount != null && Number.isFinite(pl.itemCount) ? `${pl.itemCount} videos` : 'Videos —';
            return (
              <li
                key={pl.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {thumb ? (
                  <img src={thumb} alt="" width={56} height={56} style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)',
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#fff', lineHeight: 1.35 }}>{pl.title}</div>
                  <div style={{ fontSize: '0.74rem', color: '#8899aa', marginTop: 2 }}>
                    {countLabel} · <span style={{ fontFamily: 'monospace', fontSize: '0.68rem' }}>{pl.id}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
