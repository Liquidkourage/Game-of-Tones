import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useParams, useSearchParams } from 'react-router-dom';
import io from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { 
  Music, 
  Users, 
  Trophy, 
  Crown,
  Volume2,
  Timer,
  Play,
  Pause,
  Sparkles,
  List,
  Grid3X3
} from 'lucide-react';

interface GameState {
  isPlaying: boolean;
  currentSong: Song | null;
  playerCount: number;
  winners: Winner[];
  snippetLength: number;
  playedSongs: Song[];
  bingoCard: BingoCard;
}

interface Song {
  id: string;
  name: string;
  artist: string;
}

interface Winner {
  playerName: string;
  timestamp: number;
}

interface BingoCard {
  squares: BingoSquare[];
  size: number;
}

interface BingoSquare {
  song: Song;
  isPlayed: boolean;
  position: { row: number; col: number };
}

const PublicDisplay: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const showNowPlaying = (searchParams.get('np') === '1') || (searchParams.get('nowPlaying') === '1');
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [currentWinningLine, setCurrentWinningLine] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    currentSong: null,
    playerCount: 0,
    winners: [],
    snippetLength: 30,
    playedSongs: [],
    bingoCard: {
      squares: [],
      size: 5
    }
  });
  const [countdownMs, setCountdownMs] = useState<number>(0);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  // 1x75 call list state
  const [oneBy75Ids, setOneBy75Ids] = useState<string[] | null>(null);
  const oneBy75IdsRef = useRef<string[] | null>(null);
  const playedOrderRef = useRef<string[]>([]);

  useEffect(() => {
    const socket = io(SOCKET_URL || undefined);
    socket.on('connect', () => {
      socket.emit('join-room', { roomId, playerName: 'Display', isHost: false });
      ensureGrid();
    });

    socket.on('player-joined', (data: any) => {
      const count = Math.max(0, Number(data.playerCount || 0));
      setGameState(prev => ({ ...prev, playerCount: count }));
      window.dispatchEvent(new CustomEvent('display-player-count', { detail: { playerCount: count } }));
    });
    socket.on('player-left', (data: any) => {
      const count = Math.max(0, Number(data.playerCount || 0));
      setGameState(prev => ({ ...prev, playerCount: count }));
      window.dispatchEvent(new CustomEvent('display-player-count', { detail: { playerCount: count } }));
    });

    // Receive 1x75 pool ordering (ids only)
    socket.on('oneby75-pool', (data: any) => {
      if (Array.isArray(data?.ids) && data.ids.length === 75) {
        setOneBy75Ids(data.ids);
        oneBy75IdsRef.current = data.ids;
        playedOrderRef.current = [];
      }
    });

    socket.on('bingo-card', (card: any) => {
      const squares = (card.squares || []).map((s: any) => ({
        song: { id: s.songId, name: s.songName, artist: s.artistName },
        isPlayed: false,
        position: { row: parseInt(s.position.split('-')[0], 10), col: parseInt(s.position.split('-')[1], 10) }
      }));
      setGameState(prev => ({ ...prev, bingoCard: { squares, size: 5 } }));
    });

    socket.on('song-playing', (data: any) => {
      const song = { id: data.songId, name: data.songName, artist: data.artistName };
      setGameState(prev => ({
        ...prev,
        isPlaying: true,
        currentSong: song,
        snippetLength: Number(data.snippetLength) || prev.snippetLength,
        playedSongs: [...prev.playedSongs, song].slice(-25)
      }));
      // Track played order for reveal lag
      const ids = oneBy75IdsRef.current;
      if (ids && ids.includes(song.id)) {
        const arr = playedOrderRef.current;
        if (!arr.includes(song.id)) {
          playedOrderRef.current = [...arr, song.id];
        }
      }
      // reset countdown timer
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      const total = (Number(data.snippetLength) || 30) * 1000;
      setCountdownMs(total);
      countdownRef.current = setInterval(() => {
        setCountdownMs((ms) => {
          const next = Math.max(0, ms - 100);
          if (next === 0 && countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return next;
        });
      }, 100);
    });

    socket.on('game-started', () => {
      setGameState(prev => ({ ...prev, isPlaying: true }));
      ensureGrid();
    });

    socket.on('bingo-called', (data: any) => {
      setGameState(prev => ({ ...prev, winners: data.winners || prev.winners }));
    });

    socket.on('mix-finalized', () => { ensureGrid(); });

    socket.on('game-ended', () => {
      setGameState(prev => ({ ...prev, isPlaying: false }));
      console.log('🛑 Game ended (display)');
    });

    socket.on('game-reset', () => {
      setGameState({
        isPlaying: false,
        currentSong: null,
        playerCount: 0,
        winners: [],
        snippetLength: 30,
        playedSongs: [],
        bingoCard: { squares: [], size: 5 }
      });
      ensureGrid();
      console.log('🔁 Game reset (display)');
    });

    // Staged reveal event: show name/artist hints without changing the bingo grid
    socket.on('call-revealed', (payload: any) => {
      if (payload?.revealToDisplay) {
        // For now, just update the header Now Playing banner content without marking grid
        setGameState(prev => ({
          ...prev,
          currentSong: {
            id: payload.songId || prev.currentSong?.id,
            name: payload.songName || prev.currentSong?.name || '',
            artist: payload.artistName || prev.currentSong?.artist || ''
          }
        }));
      }
    });

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      socket.close();
    };
  }, [roomId]);

  // Optional runtime scale: /display/:roomId?scale=1.5 (approximate visual sizing)
  useEffect(() => {
    const p = searchParams.get('scale') || searchParams.get('patternScale');
    const scale = p ? parseFloat(p) : NaN;
    if (displayRef.current && !Number.isNaN(scale) && scale > 0) {
      displayRef.current.style.setProperty('--bingo-scale', String(scale));
    }
  }, [searchParams]);

  useEffect(() => { ensureGrid(); }, []);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Ensure a visible 5x5 grid exists even if no card received yet
  const ensureGrid = () => {
    setGameState(prev => {
      const squares = prev.bingoCard?.squares || [];
      if (squares.length === 25) return prev;
      const placeholders: BingoSquare[] = Array.from({ length: 25 }, (_, index) => ({
        song: { id: String(index), name: '', artist: '' },
        isPlayed: false,
        position: { row: Math.floor(index / 5), col: index % 5 }
      }));
      return { ...prev, bingoCard: { squares: placeholders, size: 5 } };
    });
  };

  // Function to get the overall pattern name
  const getPatternName = () => {
    return 'Pattern: Single Line (any direction)';
  };

  // Function to check if a square is part of the current winning line
  const isWinningSquare = (row: number, col: number) => {
    // 12 possible winning lines: 5 horizontal, 5 vertical, 2 diagonal
    const winningLines = [
      // Horizontal lines (rows 0-4)
      (r: number, c: number) => r === 0, // Row 0
      (r: number, c: number) => r === 1, // Row 1
      (r: number, c: number) => r === 2, // Row 2
      (r: number, c: number) => r === 3, // Row 3
      (r: number, c: number) => r === 4, // Row 4
      // Vertical lines (columns 0-4)
      (r: number, c: number) => c === 0, // Column 0
      (r: number, c: number) => c === 1, // Column 1
      (r: number, c: number) => c === 2, // Column 2
      (r: number, c: number) => c === 3, // Column 3
      (r: number, c: number) => c === 4, // Column 4
      // Diagonal lines
      (r: number, c: number) => r === c, // Top-left to bottom-right
      (r: number, c: number) => r + c === 4 // Top-right to bottom-left
    ];
    
    return winningLines[currentWinningLine](row, col);
  };

  // Cycle through winning lines every 0.2 seconds - start immediately
  useEffect(() => {
    console.log('Setting up interval for winning lines');
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    intervalRef.current = setInterval(() => {
      console.log('Current winning line:', currentWinningLine);
      setCurrentWinningLine((prev) => {
        const next = (prev + 1) % 12;
        console.log('Changing from', prev, 'to', next);
        return next;
      });
    }, 800);
    
    return () => {
      console.log('Clearing interval');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const renderBingoCard = () => {
    const { bingoCard } = gameState;
    console.log('Winners section rendering, winners:', gameState.winners);
    const grid = [];
    
    for (let row = 0; row < bingoCard.size; row++) {
      const rowSquares = [];
      for (let col = 0; col < bingoCard.size; col++) {
        const square = bingoCard.squares.find(s => 
          s.position.row === row && s.position.col === col
        );
        
        if (square) {
          // Check if this square is part of the current winning line
          const isWinningLine = isWinningSquare(row, col);
          rowSquares.push(
            <motion.div
              key={`${row}-${col}`}
              className={`bingo-square ${square.isPlayed ? 'played' : ''} ${isWinningLine ? 'winning' : ''}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: (row + col) * 0.05 }}
              whileHover={{ scale: 1.05 }}
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
          );
        }
      }
      grid.push(
        <div key={row} className="bingo-row">
          {rowSquares}
        </div>
      );
    }
    
    return grid;
  };

  const renderOneBy75Columns = () => {
    if (!oneBy75Ids) return null;
    const played = new Set(playedOrderRef.current);
    // Only include songs that have played, preserving pool order
    const visibleIds = oneBy75Ids.filter(id => played.has(id));
    const cols = [0,1,2,3,4].map(c => visibleIds.slice(c*15, c*15 + 15));
    const revealThreshold = Math.max(0, playedOrderRef.current.length - 5);
    return (
      <div className="call-list-content">
        <div className="call-columns-header">
          {['','','','',''].map((c, i) => (
            <div key={i} className="call-col-title">&nbsp;</div>
          ))}
        </div>
        <div className="call-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {cols.map((col, ci) => (
            <div key={ci} className="call-col" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.map((id, ri) => {
                // Find original pool index and played index
                const poolIdx = oneBy75Ids.indexOf(id);
                const playedIdx = playedOrderRef.current.indexOf(id);
                const revealed = playedIdx > -1 && playedIdx < revealThreshold;
                const text = revealed ? (gameState.playedSongs.find(s => s.id === id)?.name || 'Unknown') : '??????';
                return (
                  <div key={id} className="call-item" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
                    <div className="call-number">{poolIdx + 1}</div>
                    <div className="call-song-info">
                      <div className="call-song-name">{text}</div>
                      {/* Artist hidden per request; future: staged reveal could set artist */}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div ref={displayRef} className="public-display">
      {/* Main Content - 16:10 Layout */}
      <div className="display-content">
        {/* Two Column Layout: Left (pattern + info/winners), Right (call list) */}
        <div className="bottom-row">
          <div className="left-col">
            {/* Bingo Card Visualization (upper-left, fixed to ~25% viewport width) */}
            <motion.div 
              className="bingo-card-display"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <div className="bingo-card-header center">
                <Grid3X3 className="bingo-card-icon" />
                <h2>{getPatternName()}</h2>
                {showNowPlaying && gameState.currentSong && (
                  <div className="now-playing-banner" style={{ marginTop: 6, fontSize: '0.95rem' }}>
                    Now Playing: {gameState.currentSong.name} — {gameState.currentSong.artist}
                    {countdownMs > 0 && (
                      <span style={{ marginLeft: 8, opacity: 0.8 }}>
                        ({Math.ceil(countdownMs / 1000)}s)
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="bingo-card-content">
                <div className="bingo-grid">
                  {renderBingoCard()}
                </div>
              </div>
            </motion.div>
            {/* Under pattern: side-by-side Quick Stats and Winners */}
            <div className="info-grid">
              <motion.div 
                className="quick-stats"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.25 }}
              >
                <div className="stat-item">
                  <Volume2 className="stat-icon" />
                  <span className="stat-value">{gameState.playerCount}</span>
                  <span className="stat-label">Players</span>
                </div>
                <div className="stat-item">
                  <Trophy className="stat-icon" />
                  <span className="stat-value">{gameState.winners.length}</span>
                  <span className="stat-label">Winners</span>
                </div>
                <div className="stat-item">
                  <List className="stat-icon" />
                  <span className="stat-value">{gameState.playedSongs.length}</span>
                  <span className="stat-label">Songs</span>
                </div>
              </motion.div>

              <motion.div 
                className="winners-display"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.35 }}
              >
                <div className="winners-header">
                  <Trophy className="winners-icon" />
                  <h2>Winners</h2>
                </div>
                <div className="winners-list">
                  {(gameState.winners || []).slice(0, 3).map((winner, index) => (
                    <motion.div
                      key={index}
                      className="winner-item"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 0.45 + index * 0.1 }}
                    >
                      <div className="winner-rank">
                        <Crown className="crown-icon" />
                        <span>#{index + 1}</span>
                      </div>
                      <div className="winner-info">
                        <h3>{winner.playerName}</h3>
                        <p>{formatTime(winner.timestamp)}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>

          <div className="call-col">
            {/* Tall Call List */}
            <motion.div 
              className="call-list-display"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <div className="call-list-header">
                <List className="call-list-icon" />
                <h2>Call List</h2>
                <span className="call-count">{gameState.playedSongs.length}</span>
              </div>
              {oneBy75Ids ? renderOneBy75Columns() : (
                <div className="call-list-content">
                  <div className="call-columns-header">
                    {['B','I','N','G','O'].map((c) => (
                      <div key={c} className="call-col-title">{c}</div>
                    ))}
                  </div>
                  <div className="call-list">
                    {gameState.playedSongs.length > 0 && (
                      gameState.playedSongs.slice(-10).map((song, index) => (
                        <motion.div
                          key={song.id + '-' + index}
                          className="call-item"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4, delay: 0.3 + index * 0.05 }}
                        >
                          <div className="call-number">#{gameState.playedSongs.length - (Math.min(10, gameState.playedSongs.length) - 1) + index}</div>
                          <div className="call-song-info">
                            <div className="call-song-name">{song.name}</div>
                            <div className="call-song-artist">{song.artist}</div>
                          </div>
                          <Music className="call-icon" />
                        </motion.div>
                      ))
                    )}
                  </div>
                  {gameState.playedSongs.length === 0 && (
                    <div className="no-calls">
                      <p>No songs played yet</p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicDisplay; 