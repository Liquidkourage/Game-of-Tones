import React, { useState, useEffect, useRef } from 'react';
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
}

interface Song {
  id: string;
  name: string;
  artist: string;
}

const PlayerView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const playerName = searchParams.get('name') || 'Player';

  const [socket, setSocket] = useState<any>(null);
  const [bingoCard, setBingoCard] = useState<BingoCard | null>(null);
  const [focusedSquare, setFocusedSquare] = useState<BingoSquare | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const [displayMode, setDisplayMode] = useState<'title' | 'artist'>(() => (localStorage.getItem('display_mode') as 'title' | 'artist') || 'title');
  const [tooltipSquare, setTooltipSquare] = useState<string | null>(null);
  const [tooltipText, setTooltipText] = useState<string>('');
  const [density, setDensity] = useState<'s' | 'm' | 'l'>(() => (localStorage.getItem('text_density') as 's' | 'm' | 'l') || 'm');
  const [focusCard, setFocusCard] = useState<boolean>(() => localStorage.getItem('focus_card') === '1');
  const [bingoHolding, setBingoHolding] = useState<boolean>(false);
  const bingoHoldTimer = useRef<number | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    currentSong: null,
    playerCount: 0,
    hasBingo: false
  });

  const countUniqueSongs = (card: BingoCard): number => {
    if (!card || !card.squares) return 0;
    const uniqueSongIds = new Set(card.squares.map(square => square.songId));
    return uniqueSongIds.size;
  };

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io(SOCKET_URL || undefined);
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('connect', () => {
      console.log('Connected to server');
      // Join the room
      newSocket.emit('join-room', { 
        roomId, 
        playerName, 
        isHost: false 
      });
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
        isPlaying: true
      }));
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

    newSocket.on('player-left', (data: any) => {
      console.log('Player left:', data);
      setGameState(prev => ({
        ...prev,
        playerCount: data.playerCount
      }));
    });

    // Cleanup socket on unmount
    return () => {
      newSocket.close();
    };
  }, [roomId, playerName]);

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

    // Update local state optimistically
    const updatedSquares = bingoCard.squares.map(s => {
      if (s.position === position) {
        return { ...s, marked: !s.marked };
      }
      return s;
    });

    const updatedCard = { ...bingoCard, squares: updatedSquares };
    setBingoCard(updatedCard);
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
            >
              <div className={`primary-line density-${density}`}>
                {displayMode === 'title' ? square.songName : square.artistName}
              </div>
              {tooltipSquare === square.position && (
                <div className="hover-tooltip">{tooltipText}</div>
              )}
              {square.marked && (
                <motion.div
                  className="mark-indicator"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                >
                  <CheckCircle className="mark-icon" />
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`player-container ${bingoCard ? 'has-card' : ''} ${focusCard ? 'focus' : ''} density-${density}`} style={{ minHeight: 0 }}>
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

        {/* Game Status */}
        {!focusCard && (
        <motion.div 
          className="game-status-section"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="status-card">
            <div className="status-item">
              <Volume2 className="status-icon" />
              <span>Game Status: {gameState.isPlaying ? 'Playing' : 'Waiting'}</span>
            </div>
            <div className="status-item">
              <Users className="status-icon" />
              <span>{gameState.playerCount} players in room</span>
            </div>
            {gameState.hasBingo && (
              <motion.div 
                className="status-item bingo-alert"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                <Crown className="status-icon" />
                <span>🎉 You have BINGO! 🎉</span>
              </motion.div>
            )}
          </div>
        </motion.div>
        )}

        {/* Instructions */}
        {!focusCard && (
        <motion.div 
          className="instructions-section"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div className="instructions-card">
            <h4>How to Play</h4>
            <ul>
              <li>Listen to the song snippets played by the host</li>
              <li>Click on matching songs on your bingo card</li>
              <li>Get 5 in a row (horizontal, vertical, or diagonal) to win!</li>
              <li>Be the first to call BINGO!</li>
            </ul>
          </div>
        </motion.div>
        )}

        {/* bottom sheet removed per request */}
        <button
          className={`bingo-fab ${bingoHolding ? 'holding' : ''}`}
          onPointerDown={startBingoHold}
          onPointerUp={cancelBingoHold}
          onPointerCancel={cancelBingoHold}
          onPointerLeave={cancelBingoHold}
        >
          Hold to Bingo
        </button>
      </div>
    </div>
  );
};

export default PlayerView; 