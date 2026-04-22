import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, Play, UserPlus, Crown, CheckCircle2, AlertTriangle, Link2 } from 'lucide-react';
import { API_BASE } from '../config';
import { hostFetch, setHostJwt, browserGoogleLoginUrl, clearHostJwt } from '../utils/hostFetch';

/** Express/HTML error pages are not JSON; show a short message instead of raw markup. */
function formatHttpErrorBody(raw: string, status: number): string {
  const t = raw.trim();
  if (t.startsWith('<!DOCTYPE') || t.startsWith('<html')) {
    const m = t.match(/<pre>([^<]*)<\/pre>/i);
    if (m) return `Server error (${m[1].trim()}). Try again.`;
    return `Server error (HTTP ${status}). Try again.`;
  }
  return t.slice(0, 200);
}

/** Label shown to players — from Google profile on the server (no manual host name field). */
function hostDisplayNameFromSession(session: {
  id: number;
  email?: string | null;
  displayName?: string | null;
}): string {
  const d = session.displayName?.trim();
  if (d) return d;
  const local = session.email?.split('@')[0]?.trim();
  if (local) return local;
  return `Host #${session.id}`;
}

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  /** Join as remote/online (host can enable hybrid mode so prize waits for in-person bingo) */
  const [joinAsRemote, setJoinAsRemote] = useState(() => searchParams.get('remote') === '1');
  const [hostSession, setHostSession] = useState<{ id: number; email?: string | null; displayName?: string | null } | null | undefined>(undefined);
  /**
   * Server `POST /api/host/rooms` returns `mode: 'reuse'` when your default code already exists in RAM.
   * If the first click returned `create` but HostView double-emitted `join-room`, you got `room_has_host`,
   * bounced home, then the second click hit `reuse` — modal only on that second response. HostView now
   * emits one join per socket until disconnect/reconnect.
   */
  const [hostRoomReuseModal, setHostRoomReuseModal] = useState<{ roomId: string } | null>(null);
  const [isCreatingHostRoom, setIsCreatingHostRoom] = useState(false);
  const [hostSignInPageUrl, setHostSignInPageUrl] = useState('');
  const [hostSignInUrlCopied, setHostSignInUrlCopied] = useState(false);

  /** Player / QR links: ?join, ?mode=player, ?player=1 — hide host path unless explicitly opened */
  const joinOnly = useMemo(() => {
    if (searchParams.has('join')) return true;
    const m = searchParams.get('mode');
    if (m === 'player' || m === 'join') return true;
    if (searchParams.get('player') === '1') return true;
    return false;
  }, [searchParams]);

  const [homeMode, setHomeMode] = useState<'join' | 'host'>(() => {
    const m = searchParams.get('mode');
    if (m === 'host' || searchParams.get('host') === '1') return 'host';
    return 'join';
  });

  useEffect(() => {
    const m = searchParams.get('mode');
    if (m === 'host' || searchParams.get('host') === '1') setHomeMode('host');
    else if (joinOnly) setHomeMode('join');
  }, [searchParams, joinOnly]);

  useEffect(() => {
    const pre = searchParams.get('prefillRoom')?.trim();
    if (pre) setRoomId((r) => r || pre.toUpperCase());
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHostSignInPageUrl(`${window.location.origin.replace(/\/$/, '')}/api/auth/google`);
  }, []);

  /** ?mode=host&prefillRoom= — enter /host/:room once auth check finishes (signed-in or not). Skip when HostView set skip_prefill_host_nav after host-join-denied (avoids /host ↔ home loop). */
  useEffect(() => {
    if (hostSession === undefined) return;
    if (joinOnly) return;
    if (homeMode !== 'host') return;
    const pre = searchParams.get('prefillRoom')?.trim();
    if (!pre || !/^[A-Za-z0-9_-]+$/.test(pre)) return;
    let skip = false;
    try {
      if (sessionStorage.getItem('skip_prefill_host_nav') === '1') {
        sessionStorage.removeItem('skip_prefill_host_nav');
        skip = true;
      }
    } catch {
      /* ignore */
    }
    if (skip) {
      const next = new URLSearchParams(searchParams);
      next.delete('prefillRoom');
      setSearchParams(next, { replace: true });
      return;
    }
    const name = hostSession ? hostDisplayNameFromSession(hostSession) : '';
    const qs = name ? `?name=${encodeURIComponent(name)}` : '';
    navigate(`/host/${encodeURIComponent(pre)}${qs}`, { replace: true });
  }, [hostSession, joinOnly, homeMode, searchParams, navigate, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hostFetch(`${API_BASE || ''}/api/auth/me`);
        if (cancelled) return;
        if (!res.ok) {
          setHostSession(null);
          return;
        }
        const data = (await res.json()) as {
          user?: { id: number; email?: string | null; displayName?: string | null } | null;
          hostToken?: string;
        };
        if (data.hostToken && typeof data.hostToken === 'string') setHostJwt(data.hostToken);
        setHostSession(data.user ?? null);
      } catch {
        if (!cancelled) setHostSession(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hostDisplayName = useMemo(
    () => (hostSession ? hostDisplayNameFromSession(hostSession) : ''),
    [hostSession]
  );

  const authError = useMemo(() => searchParams.get('auth_error')?.trim() || '', [searchParams]);

  const dismissAuthError = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('auth_error');
    setSearchParams(next, { replace: true });
  };

  const goToHostGoogleSignIn = () => {
    try {
      sessionStorage.setItem('tempo_post_auth_return', '/?mode=host');
    } catch {
      /* ignore */
    }
    window.location.href = browserGoogleLoginUrl();
  };

  const copyHostSignInPageUrl = async () => {
    if (!hostSignInPageUrl) return;
    try {
      await navigator.clipboard.writeText(hostSignInPageUrl);
      setHostSignInUrlCopied(true);
      window.setTimeout(() => setHostSignInUrlCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleHostLogout = async () => {
    try {
      await hostFetch(`${API_BASE || ''}/api/auth/logout`, { method: 'POST' });
    } catch {
      /* still clear local session */
    }
    clearHostJwt();
    setHostSession(null);
  };

  const showHostSetup = () => {
    setHomeMode('host');
    const next = new URLSearchParams(searchParams);
    next.delete('join');
    next.set('mode', 'host');
    next.delete('player');
    setSearchParams(next, { replace: true });
  };

  const goToHostRoom = (rid: string, displayName: string) => {
    navigate(`/host/${encodeURIComponent(rid)}?name=${encodeURIComponent(displayName)}`);
  };

  const startHosting = async (opts?: { forceNewRoom?: boolean }) => {
    if (!hostSession) {
      alert('Sign in with Google first.');
      return;
    }
    const displayName = hostDisplayNameFromSession(hostSession);
    const forceNewRoom = opts?.forceNewRoom === true;
    setIsCreatingHostRoom(true);
    try {
      let r: Response;
      try {
        r = await hostFetch(`${API_BASE || ''}/api/host/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceNewRoom }),
        });
      } catch (e) {
        alert(`Could not reach the server to create a room. Check your connection. (${String(e)})`);
        return;
      }
      if (r.status === 401) {
        try {
          sessionStorage.setItem('tempo_post_auth_return', '/?mode=host');
        } catch {
          /* ignore */
        }
        window.location.href = browserGoogleLoginUrl();
        return;
      }
      if (r.status === 503) {
        alert('Host accounts require DATABASE_URL on the server. Set it in Railway (or .env) and redeploy.');
        return;
      }
      if (r.status === 403) {
        const raw = await r.text().catch(() => '');
        let msg = 'This account is not approved to host games.';
        try {
          const j = raw ? JSON.parse(raw) : {};
          if (j && j.message) msg = String(j.message);
        } catch {
          /* ignore */
        }
        alert(msg);
        return;
      }
      if (!r.ok) {
        const raw = await r.text().catch(() => '');
        let msg = '';
        try {
          const j = raw ? JSON.parse(raw) : {};
          msg = (j && (j.message || j.error)) || '';
        } catch {
          msg = formatHttpErrorBody(raw, r.status);
        }
        alert(msg || `Could not create room (HTTP ${r.status}). Try again.`);
        return;
      }
      const data = (await r.json()) as { roomId: string; mode?: string };
      const { roomId: created, mode } = data;
      if (mode === 'reuse' && !forceNewRoom) {
        setHostRoomReuseModal({ roomId: created });
        return;
      }
      setHostRoomReuseModal(null);
      goToHostRoom(created, displayName);
    } finally {
      setIsCreatingHostRoom(false);
    }
  };

  const joinGame = () => {
    if (!playerName.trim() || !roomId.trim()) {
      alert('Please enter both your name and room ID!');
      return;
    }
    const q = new URLSearchParams();
    q.set('name', playerName.trim());
    if (joinAsRemote) q.set('remote', '1');
    navigate(`/player/${roomId}?${q.toString()}`);
  };

  return (
    <div className="home-container">
      {hostRoomReuseModal && hostSession && (
        <div
          className="home-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-room-reuse-title"
        >
          <div className="home-modal">
            <div className="home-modal__icon">
              <AlertTriangle className="home-modal__icon-svg" aria-hidden />
            </div>
            <h2 id="home-room-reuse-title" className="home-modal__title">
              Room already running
            </h2>
            <p className="home-modal__body">
              Your room code <strong>{hostRoomReuseModal.roomId}</strong> is already active on the server (for example another tab
              may still be connected as host). Opening it again can fail if that session is still there.
            </p>
            <p className="home-modal__body home-modal__body--muted">
              Continue to try the host screen for this code, or create a <strong>new</strong> room with a different code.
            </p>
            <div className="home-modal__actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isCreatingHostRoom}
                onClick={() => setHostRoomReuseModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isCreatingHostRoom}
                onClick={() => {
                  void startHosting({ forceNewRoom: true });
                }}
              >
                Create new room
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isCreatingHostRoom}
                onClick={() => {
                  const name = hostDisplayNameFromSession(hostSession);
                  setHostRoomReuseModal(null);
                  goToHostRoom(hostRoomReuseModal.roomId, name);
                }}
              >
                Continue to host
              </button>
            </div>
          </div>
        </div>
      )}
      <motion.header
        className="home-hero"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <Sparkles className="home-hero__mark" aria-hidden />
        <h1 className="home-hero__title">TEMPO</h1>
        <p className="home-hero__tagline">Music bingo</p>
      </motion.header>

      <motion.main
        className="home-main"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.08 }}
      >
        {(authError === 'not_invited' || authError === 'host_not_approved') && (
          <div className="home-auth-banner" role="alert">
            <AlertTriangle className="home-auth-banner__icon" aria-hidden />
            <div className="home-auth-banner__text">
              {authError === 'not_invited' ? (
                <>
                  <strong>Host sign-in not enabled for this account.</strong> Ask your organizer to add your email, then try signing
                  in again with Google.
                </>
              ) : (
                <>
                  <strong>Not approved to host.</strong> Ask your organizer to add your email to the host allowlist, then refresh
                  and try again.
                </>
              )}
            </div>
            <button type="button" className="home-auth-banner__dismiss" onClick={dismissAuthError}>
              Dismiss
            </button>
          </div>
        )}
        {!joinOnly && (
          <div className="home-mode-tabs" role="tablist" aria-label="How are you joining?">
            <button
              type="button"
              role="tab"
              aria-selected={homeMode === 'join'}
              className={`home-mode-tab ${homeMode === 'join' ? 'home-mode-tab--active' : ''}`}
              onClick={() => setHomeMode('join')}
            >
              <UserPlus className="home-mode-tab-icon" aria-hidden />
              Join
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={homeMode === 'host'}
              className={`home-mode-tab ${homeMode === 'host' ? 'home-mode-tab--active' : ''}`}
              onClick={() => setHomeMode('host')}
            >
              <Crown className="home-mode-tab-icon" aria-hidden />
              Host
            </button>
          </div>
        )}

        {joinOnly && <p className="home-join-only-hint">Name and room code from your host.</p>}

        <div className="options-grid options-grid--single">
          {(joinOnly || homeMode === 'join') && (
          <motion.div 
            className="option-card join-card"
            whileHover={{ scale: 1.01, y: -2 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="card-header">
              <UserPlus className="card-icon" />
              <h3>Join</h3>
            </div>
            <p className="home-card-lead">Room code from the host.</p>
            
            <div className="input-group">
              <input
                type="text"
                placeholder="Your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="input"
                autoComplete="nickname"
              />
            </div>

            <div className="input-group">
              <input
                type="text"
                placeholder="Room code"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="input"
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </div>

            <label className="home-remote-opt">
              <input
                type="checkbox"
                checked={joinAsRemote}
                onChange={(e) => setJoinAsRemote(e.target.checked)}
              />
              <span>
                Playing <strong>online</strong> (hybrid events: prize goes to in-person winner first)
              </span>
            </label>

            <button 
              onClick={joinGame}
              className="btn btn-pink"
            >
              <UserPlus className="btn-icon" />
              Join Game
            </button>

            {joinOnly && (
              <button type="button" className="home-host-reveal" onClick={showHostSetup}>
                I'm hosting — open host setup
              </button>
            )}
          </motion.div>
          )}

          {!joinOnly && homeMode === 'host' && (
          <motion.div 
            className="option-card host-card"
            whileHover={{ scale: 1.01, y: -2 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="card-header">
              <Crown className="card-icon" />
              <h3>Host</h3>
            </div>
            <p className="home-card-lead">Sign in, connect Spotify on the host screen, then run your game.</p>

            {hostSession !== undefined && (
              <div
                className="home-host-session-bar"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginBottom: 14,
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(0,200,150,0.25)',
                }}
              >
                <span style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.9)', lineHeight: 1.4 }}>
                  {hostSession ? (
                    <>
                      <strong>Host</strong> signed in as{' '}
                      <strong style={{ color: '#a8ffd9' }}>{hostSession.email || hostDisplayName}</strong>
                    </>
                  ) : (
                    <>No host sign-in on this device — hosting uses Google; there is no separate sign-up.</>
                  )}
                </span>
                {hostSession ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleHostLogout()}
                    style={{ fontSize: '0.86rem', padding: '8px 16px' }}
                  >
                    Sign out
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={goToHostGoogleSignIn}
                    style={{ fontSize: '0.86rem', padding: '8px 16px' }}
                  >
                    Sign in with Google
                  </button>
                )}
              </div>
            )}

            {hostSignInPageUrl && (
              <div
                className="home-host-signin-page-url"
                style={{
                  marginBottom: 14,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.28)',
                  border: '1px solid rgba(0,255,170,0.2)',
                }}
              >
                <p
                  className="home-card-lead"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    margin: '0 0 8px',
                    fontSize: '0.88rem',
                    opacity: 0.95,
                    lineHeight: 1.45,
                  }}
                >
                  <Link2 size={16} style={{ opacity: 0.85, flexShrink: 0 }} aria-hidden />
                  <span>
                    <strong>Optional:</strong> bookmark or share this link — you never have to copy it. When you are not signed in,
                    use <strong>Sign in with Google</strong> below (or paste this URL in the address bar).{' '}
                    {hostSession ? (
                      <span style={{ opacity: 0.85 }}>You are signed in on this device; the link is for another browser or a co-host.</span>
                    ) : null}
                  </span>
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  <code
                    style={{
                      fontSize: '0.78rem',
                      wordBreak: 'break-all',
                      flex: '1 1 200px',
                      color: '#7dffc8',
                      background: 'rgba(0,0,0,0.35)',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {hostSignInPageUrl}
                  </code>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={copyHostSignInPageUrl}
                    style={{ fontSize: '0.85rem', padding: '8px 14px' }}
                  >
                    {hostSignInUrlCopied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              </div>
            )}

            {hostSession === undefined ? (
              <p className="home-card-lead" style={{ opacity: 0.75 }}>Checking sign-in…</p>
            ) : hostSession ? (
              <div className="home-host-account" role="status" aria-live="polite">
                <div className="home-host-account__title">
                  <CheckCircle2 className="home-host-account__check" aria-hidden />
                  <span>Tempo host account active</span>
                </div>
                <p className="home-host-account__blurb">
                  Your Google sign-in is linked on this server. Host ID and Spotify tokens are tied to this account.
                </p>
                <dl className="home-host-account__meta">
                  <div>
                    <dt>Host ID</dt>
                    <dd>#{hostSession.id}</dd>
                  </div>
                  {hostSession.displayName ? (
                    <div>
                      <dt>Name</dt>
                      <dd>{hostSession.displayName}</dd>
                    </div>
                  ) : null}
                  {hostSession.email ? (
                    <div>
                      <dt>Email</dt>
                      <dd>{hostSession.email}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className="home-host-account__shown-as">
                  Players will see you as <strong>{hostDisplayName}</strong>
                </p>
              </div>
            ) : (
              <div className="home-host-signin" role="region" aria-label="Host sign in">
                <p className="home-card-lead" style={{ marginBottom: 14, opacity: 0.95, lineHeight: 1.5 }}>
                  Sign in with Google to create a room. Your Spotify link and host controls stay on this account.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={goToHostGoogleSignIn}
                >
                  Sign in with Google
                </button>
              </div>
            )}

            <button 
              type="button"
              onClick={() => void startHosting()}
              className="btn btn-primary"
              disabled={!hostSession || hostSession === undefined || isCreatingHostRoom}
            >
              <Play className="btn-icon" />
              {isCreatingHostRoom ? 'Creating…' : 'Create room & host'}
            </button>
          </motion.div>
          )}
        </div>
      </motion.main>

      <footer className="home-playbook" aria-label="How it works">
        <p className="home-playbook__title">How it works</p>
        <ol className="home-playbook__flow">
          <li><span className="home-playbook__n">1</span> Host builds playlists & room</li>
          <li><span className="home-playbook__n">2</span> Players join with the code</li>
          <li><span className="home-playbook__n">3</span> Snippets play — mark your card</li>
          <li><span className="home-playbook__n">4</span> Call bingo — host verifies</li>
        </ol>
      </footer>
    </div>
  );
};

export default Home; 