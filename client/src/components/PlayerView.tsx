import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useParams, useSearchParams } from 'react-router-dom';
import io from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { 
  Music, 
  CheckCircle, 
  Circle, 
  Trophy,
  Users,
  Volume2,
  Timer,
  Crown
} from 'lucide-react';

interface BingoSquare {
  position: string;
  songId: string;
  songName: string;
  artistName: string;
  marked: boolean;
}

interface BingoCard {
  id: string;
  squares: BingoSquare[];
}

interface GameState {
  isPlaying: boolean;
  currentSong: Song | null;
  playerCount: number;
  hasBingo: boolean;
  pattern: string;
}

interface Song {
  id: string;
  name: string;
  artist: string;
}

const PlayerView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const [playerName, setPlayerName] = useState<string>(() => {
    const fromStorage = (() => { try { return localStorage.getItem('player_name') || ''; } catch { return ''; } })();
    const fromQuery = searchParams.get('name') || '';
    return fromStorage || fromQuery || '';
  });
  const [clientId] = useState<string>(() => {
    try {
      const existing = localStorage.getItem('client_id');
      if (existing) return existing;
      const next = Math.random().toString(36).slice(2);
      localStorage.setItem('client_id', next);
      return next;
    } catch {
      return Math.random().toString(36).slice(2);
    }
  });

  const [socket, setSocket] = useState<any>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const [bingoCard, setBingoCard] = useState<BingoCard | null>(null);
  const [focusedSquare, setFocusedSquare] = useState<BingoSquare | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const [displayMode, setDisplayMode] = useState<'title' | 'artist'>(() => (localStorage.getItem('display_mode') as 'title' | 'artist') || 'title');
  const [tooltipSquare, setTooltipSquare] = useState<string | null>(null);
  const [tooltipText, setTooltipText] = useState<string>('');
  const [density, setDensity] = useState<'s' | 'm' | 'l'>(() => (localStorage.getItem('text_density') as 's' | 'm' | 'l') || 'm');
  const [focusCard, setFocusCard] = useState<boolean>(() => {
    const stored = localStorage.getItem('focus_card');
    if (stored === '1') return true;
    if (stored === '0') return false;
    try { return (typeof window !== 'undefined') && window.innerWidth < 640; } catch { return false; }
  });
  const [bingoHolding, setBingoHolding] = useState<boolean>(false);
  const bingoHoldTimer = useRef<number | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    currentSong: null,
    playerCount: 0,
    hasBingo: false,
    pattern: 'full_card'
  });

  const countUniqueSongs = (card: BingoCard): number => {
    if (!card || !card.squares) return 0;
    const uniqueSongIds = new Set(card.squares.map(square => square.songId));
    return uniqueSongIds.size;
  };

  useEffect(() => {
    // Initialize socket connection with robust reconnection
    const newSocket = io(SOCKET_URL || undefined, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnectionStatus('connected');
      setReconnectAttempts(0);
      // Join only if we have a name; otherwise wait for user input
      if (playerName && playerName.trim()) {
        newSocket.emit('join-room', { roomId, playerName, isHost: false, clientId });
      }
      // Ask server for state in case game already started
      newSocket.emit('sync-state', { roomId });
    });

    newSocket.on('reconnect_attempt', (attempt: number) => {
      setConnectionStatus('reconnecting');
      setReconnectAttempts(attempt || 1);
    });
    newSocket.on('reconnect', () => {
      setConnectionStatus('connected');
      setReconnectAttempts(0);
    });
    newSocket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });
    newSocket.on('connect_error', () => {
      setConnectionStatus('reconnecting');
    });
    newSocket.on('reconnect_error', () => {
      setConnectionStatus('reconnecting');
    });

    newSocket.on('player-joined', (data: any) => {
      console.log('Player joined:', data);
      setGameState(prev => ({
        ...prev,
        playerCount: data.playerCount
      }));
    });

    newSocket.on('game-started', (data: any) => {
      console.log('Game started:', data);
      setGameState(prev => ({
        ...prev,
        isPlaying: true,
        pattern: data?.pattern || 'full_card'
      }));
    });

    newSocket.on('room-state', (payload: any) => {
      try {
        if (payload?.isPlaying) {
          setGameState(prev => ({
            ...prev,
            isPlaying: true,
            pattern: payload?.pattern || prev.pattern,
            playerCount: typeof payload?.playerCount === 'number' ? payload.playerCount : prev.playerCount,
            currentSong: payload?.currentSong || prev.currentSong
          }));
        } else if (typeof payload?.playerCount === 'number') {
          setGameState(prev => ({ ...prev, playerCount: payload.playerCount }));
        }
      } catch {}
    });

    newSocket.on('song-playing', (data: any) => {
      console.log('Song playing:', data);
      setGameState(prev => ({
        ...prev,
        currentSong: {
          id: data.songId,
          name: data.songName,
          artist: data.artistName
        }
      }));
    });

    newSocket.on('bingo-card', (data: any) => {
      console.log('Received bingo card:', data);
      setBingoCard(data);
    });

    newSocket.on('mix-finalized', (data: any) => {
      console.log('Mix finalized:', data);
      // Cards are now available but game hasn't started yet
    });

    newSocket.on('bingo-called', (data: any) => {
      console.log('Bingo called:', data);
      // Check if this player called bingo
      if (data.playerId === newSocket.id) {
        setGameState(prev => ({
          ...prev,
          hasBingo: true
        }));
      }
    });

    newSocket.on('game-ended', () => {
      setGameState(prev => ({ ...prev, isPlaying: false }));
      console.log('🛑 Game ended');
    });

    newSocket.on('game-reset', () => {
      setGameState({ isPlaying: false, currentSong: null, playerCount: 0, hasBingo: false, pattern: 'full_card' });
      setBingoCard(null);
      console.log('🔁 Game reset');
    });

    newSocket.on('player-left', (data: any) => {
      console.log('Player left:', data);
      setGameState(prev => ({
        ...prev,
        playerCount: data.playerCount
      }));
    });

    // Optional hint reveal to players (disabled for now; we listen but do not change UI)
    newSocket.on('call-revealed', (payload: any) => {
      // If we later want to surface hints to players, gate by payload.revealToPlayers
      // Currently no-op
    });

    // Hard refresh from host
    newSocket.on('force-refresh', (_: any) => {
      try {
        localStorage.clear();
      } catch {}
      window.location.reload();
    });

    // Cleanup socket on unmount
    return () => {
      newSocket.close();
    };
  }, [roomId, playerName]);

  // If name becomes available after initial connect, join the room
  useEffect(() => {
    if (socket && socket.connected && playerName && playerName.trim()) {
      try { socket.emit('join-room', { roomId, playerName, isHost: false, clientId }); } catch {}
    }
  }, [socket, playerName, roomId, clientId]);

  const handleResync = () => {
    if (!socket) return;
    try {
      socket.emit('join-room', { roomId, playerName, isHost: false, clientId });
    } catch (_e) {}
  };

  // Keep screen awake during game using Wake Lock API
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        // @ts-ignore
        if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
          // @ts-ignore
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch (_e) {
        // ignore failures silently
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
    };
    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      try { if (wakeLock && wakeLock.release) wakeLock.release(); } catch {}
    };
  }, []);

  const markSquare = (position: string) => {
    if (!bingoCard || !socket) return;

    const square = bingoCard.squares.find(s => s.position === position);
    if (!square) return;

    // Emit mark-square event to server
    socket.emit('mark-square', {
      roomId,
      songId: square.songId,
      position
    });

    // Update local state optimistically (toggle)
    setBingoCard(prev => {
      if (!prev) return prev;
      const updatedSquares = prev.squares.map(s => s.position === position ? { ...s, marked: !s.marked } : s);
      return { ...prev, squares: updatedSquares };
    });
    if (navigator.vibrate) navigator.vibrate(10);
  };

  // Long-press to reveal a readable bottom sheet on mobile
  const handlePointerDown = (square: BingoSquare, e: React.PointerEvent) => {
    e.preventDefault();
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    const text = displayMode === 'title' ? square.artistName : square.songName;
    longPressTimer.current = window.setTimeout(() => {
      setTooltipSquare(square.position);
      setTooltipText(text);
    }, 350);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setTooltipSquare(null);
  };

  const vibrate = (pattern: number | number[]) => {
    if (navigator.vibrate) navigator.vibrate(pattern);
  };

  const handleDensityChange = (value: 's' | 'm' | 'l') => {
    setDensity(value);
    localStorage.setItem('text_density', value);
  };

  const handleDisplayModeToggle = (checked: boolean) => {
    const mode = checked ? 'artist' : 'title';
    setDisplayMode(mode);
    localStorage.setItem('display_mode', mode);
  };

  const toggleFocusCard = () => {
    const val = !focusCard;
    setFocusCard(val);
    localStorage.setItem('focus_card', val ? '1' : '0');
  };

  const startBingoHold = () => {
    if (bingoHoldTimer.current) window.clearTimeout(bingoHoldTimer.current);
    setBingoHolding(true);
    bingoHoldTimer.current = window.setTimeout(() => {
      if (socket) {
        socket.emit('player-bingo', { roomId });
      }
      vibrate([10, 50, 20]);
      setBingoHolding(false);
    }, 1000);
  };

  const cancelBingoHold = () => {
    if (bingoHoldTimer.current) {
      window.clearTimeout(bingoHoldTimer.current);
      bingoHoldTimer.current = null;
    }
    setBingoHolding(false);
  };

  const checkBingo = (card: BingoCard): boolean => {
    // For full card pattern, check if ALL squares are marked
    if (gameState.pattern === 'full_card') {
      return card.squares.every(square => square.marked);
    }
    
    // For other patterns, check rows, columns, and diagonals
    // Check rows
    for (let row = 0; row < 5; row++) {
      let rowComplete = true;
      for (let col = 0; col < 5; col++) {
        const square = card.squares.find(s => s.position === `${row}-${col}`);
        if (!square || !square.marked) {
          rowComplete = false;
          break;
        }
      }
      if (rowComplete) return true;
    }

    // Check columns
    for (let col = 0; col < 5; col++) {
      let colComplete = true;
      for (let row = 0; row < 5; row++) {
        const square = card.squares.find(s => s.position === `${row}-${col}`);
        if (!square || !square.marked) {
          colComplete = false;
          break;
        }
      }
      if (colComplete) return true;
    }

    // Check diagonals
    let diag1Complete = true;
    let diag2Complete = true;
    for (let i = 0; i < 5; i++) {
      const square1 = card.squares.find(s => s.position === `${i}-${i}`);
      const square2 = card.squares.find(s => s.position === `${i}-${4-i}`);
      
      if (!square1 || !square1.marked) diag1Complete = false;
      if (!square2 || !square2.marked) diag2Complete = false;
    }

    return diag1Complete || diag2Complete;
  };

  const renderBingoCard = () => {
    if (!bingoCard) {
      return (
        <div className="loading-card">
          <p>Waiting for host to start the game...</p>
        </div>
      );
    }

    return (
      <div className="bingo-card">
        <div className={`bingo-card-grid density-${density}`}>
          {bingoCard.squares.map((square) => (
            <motion.div
              key={square.position}
              className={`bingo-square ${square.marked ? 'marked' : ''}`}
              onClick={() => markSquare(square.position)}
              onPointerDown={(e) => handlePointerDown(square, e)}
              onPointerUp={clearLongPress}
              onPointerCancel={clearLongPress}
              onPointerLeave={clearLongPress}
              onContextMenu={(e) => { e.preventDefault(); return false; }}
              draggable={false}
              style={{
                aspectRatio: '1 / 1',
                width: 'clamp(56px, 22vw, 92px)',
                minWidth: 56,
                minHeight: 56,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 6,
                lineHeight: 1.1,
                fontWeight: 700,
                fontSize: 'clamp(12px, 3.4vw, 18px)',
                userSelect: 'none'
              }}
            >
              <div className="square-content">
                {square.isPlayed && (
                  <motion.div 
                    className="played-indicator"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Music className="played-icon" />
                  </motion.div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`player-container ${bingoCard ? 'has-card' : ''} ${focusCard ? 'focus' : ''} density-${density}`} style={{ minHeight: '100svh', overscrollBehavior: 'contain', paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}>
      {/* Name prompt overlay if no name provided */}
      {!playerName || !playerName.trim() ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: 'min(90vw, 520px)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 14, padding: 18 }}>
            <h3 style={{ margin: 0, marginBottom: 12, fontSize: '1.4rem' }}>Enter your name to join</h3>
            <input
              type="text"
              placeholder="Your name"
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (!name) return;
                try { localStorage.setItem('player_name', name); } catch {}
                setPlayerName(name);
                try {
                  const url = new URL(window.location.href);
                  url.searchParams.set('name', name);
                  window.history.replaceState({}, '', url.toString());
                } catch {}
                if (socket && socket.connected) {
                  try { socket.emit('join-room', { roomId, playerName: name, isHost: false, clientId }); } catch {}
                }
              }}
              autoFocus
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(0,0,0,0.3)', color: '#fff' }}
            />
            <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  const el = document.querySelector<HTMLInputElement>('input[placeholder=\"Your name\"]');
                  if (el) el.focus();
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* Header */}
      {!focusCard ? (
        <motion.div 
          className="player-header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="player-header-line">
            <Users className="player-icon" />
            <span className="player-line">{playerName} — Room {roomId}</span>
            <span className="player-count">{gameState.playerCount} players</span>
            {gameState.hasBingo && (
              <span className="player-bingo">BINGO!</span>
            )}
            <span
              className="conn-chip"
              onClick={handleResync}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '2px 8px',
                borderRadius: '12px',
                cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.15)',
                background: connectionStatus === 'connected' ? 'rgba(0,128,0,0.15)'
                  : connectionStatus === 'reconnecting' ? 'rgba(255,165,0,0.15)'
                  : 'rgba(255,0,0,0.15)'
              }}
              title="Tap to resync if you think you missed a call"
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: connectionStatus === 'connected' ? '#1DB954'
                    : connectionStatus === 'reconnecting' ? '#FFA500'
                    : '#FF4D4F'
                }}
              />
              <span style={{ fontSize: '0.8rem', color: '#e0e0e0' }}>
                {connectionStatus === 'connected' && 'Connected'}
                {connectionStatus === 'reconnecting' && `Reconnecting… (${reconnectAttempts})`}
                {connectionStatus === 'disconnected' && 'Disconnected'}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#9aa0a6' }}>Resync</span>
            </span>
          </div>
        </motion.div>
      ) : (
        <div className="focus-topbar" onClick={toggleFocusCard}>
          <span className="focus-room">Room: {roomId}</span>
          <span className="focus-name">{playerName}</span>
        </div>
      )}

      {/* Main Content */}
      <div className="player-content">
        {/* Current song display removed on player per request */}

        {/* Bingo Card */}
        <motion.div 
          className="bingo-section"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className="section-header" style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#b3b3b3' }}>Display</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={displayMode === 'artist'}
                  onChange={(e) => handleDisplayModeToggle(e.target.checked)}
                />
                <span className="slider" />
              </label>
              <span style={{ fontSize: '0.85rem', color: '#b3b3b3', minWidth: 60, textAlign: 'right' }}>
                {displayMode === 'title' ? 'Title' : 'Artist'}
              </span>
              <span style={{ fontSize: '0.85rem', color: '#b3b3b3' }}>| Text</span>
              <div className="density-toggle">
                <button className={`density-btn ${density === 's' ? 'active' : ''}`} onClick={() => handleDensityChange('s')}>S</button>
                <button className={`density-btn ${density === 'm' ? 'active' : ''}`} onClick={() => handleDensityChange('m')}>M</button>
                <button className={`density-btn ${density === 'l' ? 'active' : ''}`} onClick={() => handleDensityChange('l')}>L</button>
              </div>
              <button className="focus-card-btn" onClick={toggleFocusCard}>{focusCard ? 'Show Chrome' : 'Focus Card'}</button>
            </div>
          </div>
          
          {renderBingoCard()}
        </motion.div>

        {/* Game Status and Instructions removed per request */}

        {/* bottom sheet removed per request */}
        <button
          className={`bingo-fab ${bingoHolding ? 'holding' : ''}`}
          onPointerDown={startBingoHold}
          onPointerUp={cancelBingoHold}
          onPointerCancel={cancelBingoHold}
          title="Hold to call BINGO"
          style={{
            position: 'fixed',
            bottom: 18,
            right: 18,
            zIndex: 1000,
            width: 'clamp(90px, 22vw, 140px)',
            height: 'clamp(90px, 22vw, 140px)',
            borderRadius: '50%',
            fontWeight: 1000,
            fontSize: 'clamp(18px, 5.4vw, 28px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, #00ff88 0%, #00cc6d 100%)',
            color: '#061a12',
            border: '2px solid rgba(0,255,136,0.6)',
            boxShadow: '0 12px 26px rgba(0,0,0,0.35), 0 0 24px rgba(0,255,136,0.35)'
          }}
        >
          {bingoHolding ? 'Holding…' : 'BINGO'}
        </button>
      </div>
    </div>
  );
};

export default PlayerView; 