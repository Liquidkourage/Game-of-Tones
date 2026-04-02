import React, { useEffect, useState } from 'react';
import { API_BASE } from '../config';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, CheckCircle, AlertCircle } from 'lucide-react';

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

const SpotifyCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting to Spotify...');

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
          navigate(dest);
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
        window.setTimeout(() => navigate(dest), 2000);
        return;
      }

      if (!code) {
        if (!cancelled) {
          setStatus('error');
          setMessage('No authorization code received.');
        }
        const dest = resolveSpotifyReturnDestination(searchParams);
        cleanupSpotifyReturnMarkers();
        window.setTimeout(() => navigate(dest), 2000);
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
            setStatus('success');
            setMessage('Spotify connected successfully!');
            window.setTimeout(() => navigate(dest), 800);
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
          window.setTimeout(() => navigate(dest), 2000);
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
        window.setTimeout(() => navigate(dest), 2000);
      }
    };

    void handleCallback();

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  return (
    <div className="spotify-callback">
      <motion.div
        className="callback-container"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="callback-content">
          {status === 'loading' && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Music className="callback-icon loading" />
            </motion.div>
          )}

          {status === 'success' && <CheckCircle className="callback-icon success" />}

          {status === 'error' && <AlertCircle className="callback-icon error" />}

          <h2>Spotify Connection</h2>
          <p>{message}</p>

          {status === 'success' && (
            <div className="success-actions">
              <button type="button" onClick={() => navigate('/')} className="btn-primary">
                Go to Home
              </button>
              <button
                type="button"
                onClick={() => {
                  const roomId =
                    searchParams.get('state')?.trim() ||
                    localStorage.getItem('spotify_room_id') ||
                    sessionStorage.getItem('spotify_room_id');
                  if (roomId) {
                    navigate(`/host/${roomId}`);
                  } else {
                    navigate('/');
                  }
                }}
                className="btn-secondary"
              >
                Go to Host View
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default SpotifyCallback;
