import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, Play, UserPlus, Crown } from 'lucide-react';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  /** Join as remote/online (host can enable hybrid mode so prize waits for in-person bingo) */
  const [joinAsRemote, setJoinAsRemote] = useState(() => searchParams.get('remote') === '1');
  /** Sent with host join; must match server TEMPO_HOST_SECRET when set */
  const [hostAccessCode, setHostAccessCode] = useState(() => {
    try {
      return sessionStorage.getItem('tempo_host_secret') || localStorage.getItem('tempo_host_secret') || '';
    } catch {
      return '';
    }
  });

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

  const showHostSetup = () => {
    setHomeMode('host');
    const next = new URLSearchParams(searchParams);
    next.delete('join');
    next.set('mode', 'host');
    next.delete('player');
    setSearchParams(next, { replace: true });
  };

  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
  };

  const startHosting = () => {
    if (!playerName.trim()) {
      alert('Please enter your name!');
      return;
    }
    try {
      const secret = hostAccessCode.trim();
      sessionStorage.setItem('tempo_host_secret', secret);
      localStorage.setItem('tempo_host_secret', secret);
    } catch {
      /* ignore */
    }
    const id = roomId || Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/host/${id}?name=${encodeURIComponent(playerName)}`);
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
            <p className="home-card-lead">Spotify + room controls.</p>
            
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
                placeholder="Room ID (optional)"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="input"
                autoCapitalize="characters"
                autoCorrect="off"
              />
              <button 
                onClick={generateRoomId}
                className="btn btn-secondary"
              >
                Generate
              </button>
            </div>

            <div className="input-group" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
              <label htmlFor="host-access-code" className="home-host-code-label">
                Host access code
              </label>
              <input
                id="host-access-code"
                type="password"
                placeholder="Required on server"
                value={hostAccessCode}
                onChange={(e) => setHostAccessCode(e.target.value)}
                className="input"
                autoComplete="off"
              />
              <span className="home-host-code-hint">Only hosts with this code can open the host screen when the server is configured.</span>
            </div>

            <button 
              onClick={startHosting}
              className="btn btn-primary"
            >
              <Play className="btn-icon" />
              Start Hosting
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