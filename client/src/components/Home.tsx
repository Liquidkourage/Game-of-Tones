import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, Play, UserPlus, Crown, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../config';
import { hostFetch, apiOrigin } from '../utils/hostFetch';

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
    let cancelled = false;
    (async () => {
      try {
        const res = await hostFetch(`${API_BASE || ''}/api/auth/me`);
        if (cancelled) return;
        if (!res.ok) {
          setHostSession(null);
          return;
        }
        const data = await res.json();
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

  const showHostSetup = () => {
    setHomeMode('host');
    const next = new URLSearchParams(searchParams);
    next.delete('join');
    next.set('mode', 'host');
    next.delete('player');
    setSearchParams(next, { replace: true });
  };

  const startHosting = async () => {
    if (!hostSession) {
      alert('Sign in with Google first.');
      return;
    }
    const displayName = hostDisplayNameFromSession(hostSession);
    const api = apiOrigin();
    let r: Response;
    try {
      r = await hostFetch(`${API_BASE || ''}/api/host/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (e) {
      alert(`Could not reach the server to create a room. Check your connection. (${String(e)})`);
      return;
    }
    if (r.status === 401) {
      window.location.href = `${api}/api/auth/google`;
      return;
    }
    if (r.status === 503) {
      alert('Host accounts require DATABASE_URL on the server. Set it in Railway (or .env) and redeploy.');
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
    const { roomId: created } = await r.json();
    navigate(`/host/${created}?name=${encodeURIComponent(displayName)}`);
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
              <p className="home-card-lead" style={{ opacity: 0.9 }}>
                <a className="btn btn-secondary" href={`${apiOrigin()}/api/auth/google`} style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Sign in with Google
                </a>
              </p>
            )}

            <button 
              type="button"
              onClick={startHosting}
              className="btn btn-primary"
              disabled={!hostSession || hostSession === undefined}
            >
              <Play className="btn-icon" />
              Create room &amp; host
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