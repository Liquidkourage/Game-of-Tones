import React, { useEffect, useState } from 'react';
import { API_BASE } from '../config';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Music, AlertCircle } from 'lucide-react';

/** Where to send the host after Spotify OAuth (localStorage can be empty on callback if origin changed). */
function resolveSpotifyReturnDestination(searchParams: URLSearchParams): string {
  const fromLs = localStorage.getItem('spotify_return_url');
  const fromSs = sessionStorage.getItem('spotify_return_url');
  const candidate = (fromLs || fromSs || '').trim();
  if (candidate.startsWith('/host/') && !candidate.includes('undefined')) {
    return candidate;
  }
  const state = searchParams.get('state')?.trim();
  if (state) {
    return `/host/${state}`;
  }
  const roomId =
    localStorage.getItem('spotify_room_id')?.trim() ||
    sessionStorage.getItem('spotify_room_id')?.trim();
  if (roomId) {
    return `/host/${roomId}`;
  }
  return '/';
}

function cleanupSpotifyReturnMarkers() {
  try {
    localStorage.removeItem('spotify_return_url');
    localStorage.removeItem('spotify_room_id');
    sessionStorage.removeItem('spotify_return_url');
    sessionStorage.removeItem('spotify_room_id');
  } catch {
    /* ignore */
  }
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
            resolveSpotifyReturnDestination(searchParams);
          navigate(dest, { replace: true });
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
        window.setTimeout(() => navigate(dest, { replace: true }), 1800);
        return;
      }

      if (!code) {
        if (!cancelled) {
          setStatus('error');
          setMessage('No authorization code received.');
        }
        const dest = resolveSpotifyReturnDestination(searchParams);
        cleanupSpotifyReturnMarkers();
        window.setTimeout(() => navigate(dest, { replace: true }), 1800);
        return;
      }

      const pendingDest = resolveSpotifyReturnDestination(searchParams);
      try {
        sessionStorage.setItem('spotify_pending_oauth_dest', pendingDest);
      } catch {
        /* ignore */
      }

      sessionStorage.setItem('spotify_oauth_inflight', code);

      const doneKey = `spotify_oauth_handled_${code}`;
      const destKey = `spotify_oauth_dest_${code}`;

      try {
        const response = await fetch(`${API_BASE || ''}/api/spotify/callback?code=${encodeURIComponent(code)}`);
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
          cleanupSpotifyReturnMarkers();

          if (!cancelled) {
            navigate(dest, { replace: true });
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
          window.setTimeout(() => navigate(dest, { replace: true }), 2000);
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
        window.setTimeout(() => navigate(dest, { replace: true }), 2000);
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
