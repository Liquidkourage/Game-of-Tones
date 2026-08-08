import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, Play, UserPlus, Crown, CheckCircle2, AlertTriangle, UserCircle, ListMusic } from 'lucide-react';
import { API_BASE } from '../config';
import { hostFetch, setHostJwt, browserGoogleLoginUrl, clearHostJwt, postHostLogout } from '../utils/hostFetch';
import type { HostGlassNavId } from '../host/hostGlassNav';
import { clearActiveHostRoom, readActiveHostRoom } from '../utils/hostRoomRecovery';

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
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [hybridPrompt, setHybridPrompt] = useState<{ roomCode: string; name: string } | null>(null);
  const [hostSession, setHostSession] = useState<{ id: number; email?: string | null; displayName?: string | null } | null | undefined>(undefined);
  /**
   * Server `POST /api/host/rooms` returns `mode: 'reuse'` when your default code already exists in RAM.
   * If the first click returned `create` but HostView double-emitted `join-room`, you got `room_has_host`,
   * bounced home, then the second click hit `reuse` — modal only on that second response. HostView now
   * emits one join per socket until disconnect/reconnect.
   */
  const [hostRoomReuseModal, setHostRoomReuseModal] = useState<{ roomId: string; tab?: HostGlassNavId } | null>(null);
  const [isCreatingHostRoom, setIsCreatingHostRoom] = useState(false);
  const [hostSignInPageUrl, setHostSignInPageUrl] = useState('');
  const [hostSignInUrlCopied, setHostSignInUrlCopied] = useState(false);
  const [resumeHostRoom, setResumeHostRoom] = useState<{ roomId: string } | null>(null);
  const [hostEvents, setHostEvents] = useState<
    Array<{
      roomId: string;
      updatedAt: string | null;
      roundCount: number;
      savedRoundCount: number;
      roundNames: string[];
      live?: boolean;
    }> | null
  >(null);
  const [hostEventsError, setHostEventsError] = useState<string | null>(null);
  const [deletingEventRoomId, setDeletingEventRoomId] = useState<string | null>(null);

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
          clearHostJwt();
          setHostSession(null);
          return;
        }
        const data = (await res.json()) as {
          user?: { id: number; email?: string | null; displayName?: string | null } | null;
          hostToken?: string;
        };
        if (!data.user) {
          clearHostJwt();
          setHostSession(null);
          return;
        }
        if (data.hostToken && typeof data.hostToken === 'string') setHostJwt(data.hostToken);
        setHostSession(data.user);
      } catch {
        if (!cancelled) {
          clearHostJwt();
          setHostSession(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hostSession) {
      setResumeHostRoom(null);
      return;
    }
    const ptr = readActiveHostRoom();
    if (!ptr?.roomId) {
      setResumeHostRoom(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE || ''}/api/rooms/${encodeURIComponent(ptr.roomId)}`);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) clearActiveHostRoom();
          setResumeHostRoom(null);
          return;
        }
        const data = (await res.json()) as { gameState?: string };
        const gs = data.gameState;
        if (gs === 'ended') {
          clearActiveHostRoom();
          setResumeHostRoom(null);
          return;
        }
        if (gs === 'playing' || gs === 'paused_for_verification') {
          setResumeHostRoom({ roomId: ptr.roomId });
        } else {
          setResumeHostRoom(null);
        }
      } catch {
        if (!cancelled) setResumeHostRoom(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostSession]);

  useEffect(() => {
    if (!hostSession) {
      setHostEvents(null);
      setHostEventsError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await hostFetch(`${API_BASE || ''}/api/host/rooms/prep`);
        if (cancelled) return;
        if (!res.ok) {
          setHostEvents([]);
          setHostEventsError(res.status === 503 ? 'Cloud prep unavailable' : 'Could not load saved events');
          return;
        }
        const data = (await res.json()) as {
          events?: Array<{
            roomId: string;
            updatedAt: string | null;
            roundCount: number;
            savedRoundCount: number;
            roundNames: string[];
            live?: boolean;
          }>;
        };
        setHostEvents(Array.isArray(data.events) ? data.events : []);
        setHostEventsError(null);
      } catch {
        if (!cancelled) {
          setHostEvents([]);
          setHostEventsError('Could not load saved events');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostSession]);

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

  const handleHostLogout = () => {
    postHostLogout();
  };

  const showDevSignInLink = process.env.NODE_ENV === 'development';

  const goToHostRoom = (rid: string, displayName: string, opts?: { tab?: HostGlassNavId }) => {
    const q = new URLSearchParams();
    q.set('name', displayName);
    if (opts?.tab && opts.tab !== 'game') q.set('tab', opts.tab);
    navigate(`/host/${encodeURIComponent(rid)}?${q.toString()}`);
  };

  const deleteSavedEvent = async (rid: string, isLive?: boolean) => {
    const liveNote = isLive
      ? '\n\nThis room is still live — deleting only removes cloud-saved rounds, not the active game.'
      : '';
    const ok = window.confirm(
      `Delete saved event for room ${rid}?\n\nThis removes cloud-saved rounds for this room. It cannot be undone.${liveNote}`,
    );
    if (!ok) return;
    setDeletingEventRoomId(rid);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/host/rooms/${encodeURIComponent(rid)}/prep`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        let msg = 'Could not delete saved event.';
        try {
          const j = raw ? JSON.parse(raw) : {};
          if (j?.message) msg = String(j.message);
        } catch {
          /* ignore */
        }
        alert(msg);
        return;
      }
      try {
        localStorage.removeItem(`event-rounds-${rid}`);
        localStorage.removeItem(`event-rounds-cloud-ack-${rid}`);
      } catch {
        /* ignore */
      }
      setHostEvents((prev) => (prev ? prev.filter((e) => e.roomId !== rid) : prev));
    } finally {
      setDeletingEventRoomId(null);
    }
  };

  const startHosting = async (opts?: { forceNewRoom?: boolean; tab?: HostGlassNavId }) => {
    if (!hostSession) {
      alert('Sign in with Google first.');
      return;
    }
    const displayName = hostDisplayNameFromSession(hostSession);
    const forceNewRoom = opts?.forceNewRoom === true;
    const hostTab = opts?.tab;
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
      if (r.status === 402) {
        const raw = await r.text().catch(() => '');
        let msg = 'Account billing required before hosting.';
        try {
          const j = raw ? JSON.parse(raw) : {};
          if (j && j.message) msg = String(j.message);
        } catch {
          /* ignore */
        }
        if (window.confirm(`${msg}\n\nOpen your organization page?`)) {
          navigate('/org');
        }
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
        setHostRoomReuseModal({ roomId: created, tab: hostTab });
        return;
      }
      setHostRoomReuseModal(null);
      goToHostRoom(created, displayName, hostTab ? { tab: hostTab } : undefined);
    } finally {
      setIsCreatingHostRoom(false);
    }
  };

  const completeJoin = (code: string, name: string, asRemote: boolean) => {
    const q = new URLSearchParams();
    q.set('name', name.trim());
    if (asRemote) q.set('remote', '1');
    navigate(`/player/${encodeURIComponent(code.trim().toUpperCase())}?${q.toString()}`);
  };

  const joinGame = async () => {
    if (!playerName.trim() || !roomId.trim()) {
      alert('Please enter both your name and room ID!');
      return;
    }
    setJoinError(null);
    setJoinBusy(true);
    try {
      const code = roomId.trim().toUpperCase();
      const res = await fetch(`${API_BASE || ''}/api/rooms/${encodeURIComponent(code)}`);
      if (res.status === 404) {
        setJoinError('Room not found. Check the code and try again.');
        return;
      }
      if (!res.ok) {
        setJoinError('Could not look up room. Try again.');
        return;
      }
      const data = (await res.json()) as { hybridInPersonPlusOnline?: boolean };
      const name = playerName.trim();
      if (data.hybridInPersonPlusOnline) {
        setHybridPrompt({ roomCode: code, name });
        return;
      }
      completeJoin(code, name, false);
    } catch {
      setJoinError('Could not reach the server. Check your connection.');
    } finally {
      setJoinBusy(false);
    }
  };

  const confirmHybridJoin = (asRemote: boolean) => {
    if (!hybridPrompt) return;
    const { roomCode, name } = hybridPrompt;
    setHybridPrompt(null);
    completeJoin(roomCode, name, asRemote);
  };

  return (
    <div className="home-container">
      {hybridPrompt ? (
        <div
          className="home-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-hybrid-title"
        >
          <div className="home-modal home-modal--hybrid">
            <h2 id="home-hybrid-title" className="home-modal__title">
              Are you playing remotely?
            </h2>
            <p className="home-modal__body">
              This room has hybrid mode on. In-person bingos count for prizes; online players can still play along.
            </p>
            <div className="home-modal__actions home-modal__actions--stack">
              <button type="button" className="btn btn-primary" onClick={() => confirmHybridJoin(true)}>
                Yes, I&apos;m remote
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => confirmHybridJoin(false)}>
                No, I&apos;m in the room
              </button>
              <button type="button" className="btn btn-secondary home-modal__cancel" onClick={() => setHybridPrompt(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
                  const tab = hostRoomReuseModal.tab;
                  setHostRoomReuseModal(null);
                  goToHostRoom(hostRoomReuseModal.roomId, name, tab ? { tab } : undefined);
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
                  <strong>Not allowlisted.</strong> Ask your organizer, then sign in again.
                </>
              ) : (
                <>
                  <strong>Not approved.</strong> Ask your organizer to allowlist you.
                </>
              )}
            </div>
            <button type="button" className="home-auth-banner__dismiss" onClick={dismissAuthError}>
              Dismiss
            </button>
          </div>
        )}

        <div className="options-grid options-grid--single">
          {homeMode !== 'host' && (
          <motion.div 
            className="option-card join-card"
            whileHover={{ scale: 1.01, y: -2 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="card-header">
              <UserPlus className="card-icon" />
              <h3>Join a game</h3>
            </div>
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

            {joinError ? (
              <p className="home-join-error" role="alert">
                {joinError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void joinGame()}
              className="btn btn-pink"
              disabled={joinBusy}
              aria-busy={joinBusy}
            >
              <UserPlus className="btn-icon" />
              {joinBusy ? 'Checking room…' : 'Join Game'}
            </button>
          </motion.div>
          )}

          {homeMode === 'host' && (
          <motion.div 
            className="option-card host-card"
            whileHover={{ scale: 1.01, y: -2 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="card-header">
              <Crown className="card-icon" />
              <h3>Host a game</h3>
            </div>
            {hostSession === undefined ? (
              <p className="home-card-lead" style={{ opacity: 0.75 }}>Checking sign-in…</p>
            ) : hostSession ? (
              <>
                <div className="home-host-session-bar">
                  <span className="home-host-session-bar__label">
                    Signed in as <strong>{hostSession.email || hostDisplayName}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary home-host-session-bar__signout"
                    onClick={() => void handleHostLogout()}
                  >
                    Sign out
                  </button>
                </div>

                {showDevSignInLink && hostSignInPageUrl ? (
                  <details className="home-host-signin-page-url">
                    <summary>Sign-in link (dev)</summary>
                    <div className="home-host-signin-page-url__body">
                      <code className="home-host-signin-page-url__code">{hostSignInPageUrl}</code>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={copyHostSignInPageUrl}
                      >
                        {hostSignInUrlCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </details>
                ) : null}

                <div className="home-host-account" role="status" aria-live="polite">
                  <div className="home-host-account__title">
                    <CheckCircle2 className="home-host-account__check" aria-hidden />
                    <span>Ready to host</span>
                  </div>
                  <p className="home-host-account__shown-as">
                    Shown as <strong>{hostDisplayName}</strong>
                  </p>
                </div>

                <Link to="/org" className="home-org-link home-org-link--primary btn btn-primary">
                  <UserCircle className="btn-icon" aria-hidden />
                  Account
                </Link>

                {resumeHostRoom ? (
                  <button
                    type="button"
                    className="btn btn-primary home-host-actions__secondary"
                    style={{ width: '100%', marginBottom: 10 }}
                    onClick={() => goToHostRoom(resumeHostRoom.roomId, hostDisplayName)}
                  >
                    <Play className="btn-icon" aria-hidden />
                    Resume active game · {resumeHostRoom.roomId}
                  </button>
                ) : null}

                <div className="home-host-actions">
                  <button
                    type="button"
                    onClick={() => void startHosting()}
                    className="btn btn-primary"
                    disabled={isCreatingHostRoom}
                  >
                    <Play className="btn-icon" />
                    {isCreatingHostRoom ? 'Creating…' : 'Create room & host'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startHosting({ tab: 'rounds' })}
                    className="btn btn-secondary home-host-actions__secondary"
                    disabled={isCreatingHostRoom}
                  >
                    <ListMusic className="btn-icon" aria-hidden />
                    Plan rounds &amp; playlists
                  </button>
                </div>

                <div className="home-host-events" style={{ marginTop: 18, textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Your saved events</h4>
                  {hostEvents === null ? (
                    <p className="home-card-lead" style={{ opacity: 0.7, margin: 0 }}>
                      Loading saved rounds…
                    </p>
                  ) : hostEventsError ? (
                    <p className="home-card-lead" style={{ opacity: 0.75, margin: 0 }}>
                      {hostEventsError}
                    </p>
                  ) : hostEvents.length === 0 ? (
                    <p className="home-card-lead" style={{ opacity: 0.75, margin: 0 }}>
                      No cloud-saved rounds yet. Open a room and Save round — they show up here even after
                      the live room ends.
                    </p>
                  ) : (
                    <ul className="home-host-events__list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {hostEvents.slice(0, 12).map((ev) => {
                        const when = ev.updatedAt ? new Date(ev.updatedAt) : null;
                        const whenLabel =
                          when && !Number.isNaN(when.getTime())
                            ? when.toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })
                            : 'Saved';
                        const names =
                          ev.roundNames.length > 0
                            ? ev.roundNames.join(' · ')
                            : `${ev.roundCount} round${ev.roundCount === 1 ? '' : 's'}`;
                        return (
                          <li
                            key={ev.roomId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                              padding: '10px 0',
                              borderTop: '1px solid rgba(255,255,255,0.1)',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700 }}>
                                Room {ev.roomId}
                                {ev.live ? (
                                  <span
                                    style={{
                                      marginLeft: 8,
                                      fontSize: '0.75rem',
                                      fontWeight: 600,
                                      color: '#00ff88',
                                    }}
                                  >
                                    Live
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ fontSize: '0.82rem', opacity: 0.75, marginTop: 2 }}>
                                {whenLabel}
                                {ev.savedRoundCount > 0
                                  ? ` · ${ev.savedRoundCount} saved`
                                  : ` · ${ev.roundCount} planned`}
                                {names ? ` · ${names}` : ''}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '8px 12px' }}
                                onClick={() =>
                                  goToHostRoom(ev.roomId, hostDisplayName, { tab: 'rounds' })
                                }
                              >
                                Open
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '8px 12px' }}
                                disabled={deletingEventRoomId === ev.roomId}
                                onClick={() => void deleteSavedEvent(ev.roomId, ev.live)}
                              >
                                {deletingEventRoomId === ev.roomId ? 'Deleting…' : 'Delete'}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="home-card-lead">Sign in with Google to create and run bingo games.</p>
                <button type="button" className="btn btn-primary" onClick={goToHostGoogleSignIn}>
                  Sign in with Google
                </button>
              </>
            )}
          </motion.div>
          )}
        </div>
      </motion.main>

    </div>
  );
};

export default Home; 