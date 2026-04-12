import React, { useEffect, useState } from 'react';
import { API_BASE } from '../config';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Music, AlertCircle } from 'lucide-react';

/** Decode JWT payload segment (base64url) — UTF-8 safe; latin-only atob can break some payloads. */
function parseJwtPayloadJson<T = unknown>(segment: string): T | null {
  try {
    const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Spotify sends `state` as a signed JWT (not the room code). Extract `rid` from payload only. */
function roomIdFromSpotifyOAuthState(state: string | null | undefined): string | null {
  if (!state || typeof state !== 'string') return null;
  const parts = state.split('.');
  if (parts.length < 2) return null;
  const json = parseJwtPayloadJson<{ typ?: string; rid?: string | number | null }>(parts[1]);
  if (!json || json.typ !== 'spotify_oauth' || json.rid == null || json.rid === '') return null;
  const rid = String(json.rid).trim();
  return /^[A-Za-z0-9_-]+$/.test(rid) ? rid : null;
}

function buildHostSpotifyReturn(roomId: string): string {
  const r = roomId.trim();
  if (!r || !/^[A-Za-z0-9_-]+$/.test(r)) return '';
  const qs = new URLSearchParams();
  qs.set('spotify', 'connected');
  return `/host/${encodeURIComponent(r)}?${qs.toString()}`;
}

/**
 * Where to send the host after Spotify OAuth.
 * Prefer `state` JWT `rid` first — Spotify always returns `state`; storage may be empty after redirect.
 */
function resolveSpotifyReturnDestination(searchParams: URLSearchParams): string {
  const fromState = roomIdFromSpotifyOAuthState(searchParams.get('state')?.trim());
  if (fromState) {
    const dest = buildHostSpotifyReturn(fromState);
    if (dest) return dest;
  }

  const roomFromStorage =
    localStorage.getItem('spotify_room_id')?.trim() ||
    sessionStorage.getItem('spotify_room_id')?.trim() ||
    localStorage.getItem('spotify_oauth_pending_room')?.trim() ||
    sessionStorage.getItem('spotify_oauth_pending_room')?.trim();
  if (roomFromStorage) {
    const dest = buildHostSpotifyReturn(roomFromStorage);
    if (dest) return dest;
  }

  const fromLs = localStorage.getItem('spotify_return_url');
  const fromSs = sessionStorage.getItem('spotify_return_url');
  const candidate = (fromLs || fromSs || '').trim();
  if (candidate.startsWith('/host/') && !candidate.includes('undefined')) {
    const m = candidate.match(/^\/host\/([^/?#]+)/);
    if (m?.[1]) {
      const dest = buildHostSpotifyReturn(decodeURIComponent(m[1]));
      if (dest) return dest;
    }
    const sep = candidate.includes('?') ? '&' : '?';
    return candidate.includes('spotify=') ? candidate : `${candidate}${sep}spotify=connected`;
  }

  return '/?mode=host';
}

function cleanupSpotifyReturnMarkers(codeForSnap?: string | null) {
  try {
    localStorage.removeItem('spotify_return_url');
    localStorage.removeItem('spotify_room_id');
    localStorage.removeItem('spotify_oauth_pending_room');
    sessionStorage.removeItem('spotify_return_url');
    sessionStorage.removeItem('spotify_room_id');
    sessionStorage.removeItem('spotify_oauth_pending_room');
    if (codeForSnap) {
      sessionStorage.removeItem(`spotify_oauth_dest_snap_${codeForSnap}`);
    }
  } catch {
    /* ignore */
  }
}

/** React Strict Mode + async fetch can double-invoke; OAuth codes are single-use so only one navigation should win. */
function navigateOnceToDest(
  navigate: (to: string, opts?: { replace?: boolean }) => void,
  dest: string,
  code: string | null
) {
  if (code) {
    try {
      const k = `spotify_oauth_nav_done_${code}`;
      if (sessionStorage.getItem(k) === '1') return;
      sessionStorage.setItem(k, '1');
    } catch {
      /* ignore */
    }
  }
  navigate(dest, { replace: true });
}

/**
 * Exchanges OAuth code via API then redirects to the host (no success “confirmation” step).
 * For zero intermediate UI, set SPOTIFY_REDIRECT_URI to your API /api/spotify/callback and PUBLIC_APP_URL
 * so Spotify hits the server and receives an HTTP redirect to /host/:room.
 */
const SpotifyCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting Spotify…');

  useEffect(() => {
    const code = searchParams.get('code');
    const oauthError = searchParams.get('error');

    /** Second Strict Mode effect: wait for the first handler to finish (OAuth codes are single-use). */
    if (code && sessionStorage.getItem('spotify_oauth_inflight') === code) {
      const doneKey = `spotify_oauth_handled_${code}`;
      const tid = window.setInterval(() => {
        if (sessionStorage.getItem(doneKey) === '1') {
          window.clearInterval(tid);
          const dest =
            sessionStorage.getItem(`spotify_oauth_dest_${code}`) ||
            sessionStorage.getItem(`spotify_oauth_dest_snap_${code}`) ||
            resolveSpotifyReturnDestination(new URLSearchParams(window.location.search));
          navigateOnceToDest(navigate, dest, code);
        }
      }, 40);
      const timeout = window.setTimeout(() => window.clearInterval(tid), 20000);
      return () => {
        window.clearInterval(tid);
        window.clearTimeout(timeout);
      };
    }

    let cancelled = false;

    const handleCallback = async () => {
      if (oauthError) {
        if (!cancelled) {
          setStatus('error');
          setMessage('Spotify authorization failed. Please try again.');
        }
        const dest = resolveSpotifyReturnDestination(searchParams);
        cleanupSpotifyReturnMarkers();
        console.warn('Spotify auth error param:', oauthError, '→', dest);
        window.setTimeout(() => navigateOnceToDest(navigate, dest, searchParams.get('code')), 1800);
        return;
      }

      if (!code) {
        if (!cancelled) {
          setStatus('error');
          setMessage('No authorization code received.');
        }
        const dest = resolveSpotifyReturnDestination(searchParams);
        cleanupSpotifyReturnMarkers();
        window.setTimeout(() => navigateOnceToDest(navigate, dest, null), 1800);
        return;
      }

      const pendingDest = resolveSpotifyReturnDestination(searchParams);
      try {
        sessionStorage.setItem('spotify_pending_oauth_dest', pendingDest);
        sessionStorage.setItem(`spotify_oauth_dest_snap_${code}`, pendingDest);
      } catch {
        /* ignore */
      }

      sessionStorage.setItem('spotify_oauth_inflight', code);

      const doneKey = `spotify_oauth_handled_${code}`;
      const destKey = `spotify_oauth_dest_${code}`;

      try {
        const stateParam = searchParams.get('state');
        const qs = new URLSearchParams();
        qs.set('code', code);
        if (stateParam) qs.set('state', stateParam);
        const response = await fetch(`${API_BASE || ''}/api/spotify/callback?${qs.toString()}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const data = await response.json();

        if (data.success) {
          if (data.tokens) {
            try {
              localStorage.setItem('spotify_tokens', JSON.stringify(data.tokens));
            } catch {
              /* ignore */
            }
          }

          const dest = pendingDest;
          sessionStorage.setItem(doneKey, '1');
          sessionStorage.setItem(destKey, dest);
          sessionStorage.removeItem('spotify_oauth_inflight');
          try {
            sessionStorage.removeItem('spotify_pending_oauth_dest');
          } catch {
            /* ignore */
          }
          cleanupSpotifyReturnMarkers(code);

          if (!cancelled) {
            navigateOnceToDest(navigate, dest, code);
          }
        } else {
          const dest =
            sessionStorage.getItem('spotify_pending_oauth_dest') || pendingDest;
          sessionStorage.setItem(doneKey, '1');
          sessionStorage.setItem(destKey, dest);
          sessionStorage.removeItem('spotify_oauth_inflight');
          if (!cancelled) {
            setStatus('error');
            setMessage('Failed to connect to Spotify. Please try again.');
          }
          window.setTimeout(() => navigateOnceToDest(navigate, dest, code), 2000);
        }
      } catch (error) {
        console.error('Error handling Spotify callback:', error);
        const dest =
          sessionStorage.getItem('spotify_pending_oauth_dest') || pendingDest;
        sessionStorage.setItem(doneKey, '1');
        sessionStorage.setItem(destKey, dest);
        sessionStorage.removeItem('spotify_oauth_inflight');
        if (!cancelled) {
          setStatus('error');
          setMessage('An error occurred while connecting to Spotify.');
        }
        window.setTimeout(() => navigateOnceToDest(navigate, dest, code), 2000);
      }
    };

    void handleCallback();

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  if (status === 'error') {
    return (
      <div className="spotify-callback spotify-callback--minimal">
        <div className="callback-container">
          <div className="callback-content">
            <AlertCircle className="callback-icon error" aria-hidden />
            <h2>Spotify connection</h2>
            <p>{message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="spotify-callback spotify-callback--minimal" aria-busy="true" aria-live="polite">
      <div className="callback-container">
        <div className="callback-content">
          <Music className="callback-icon loading" aria-hidden />
          <p className="spotify-callback-hint">Connecting Spotify…</p>
        </div>
      </div>
    </div>
  );
};

export default SpotifyCallback;
