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
  const [holdProgress, setHoldProgress] = useState<number>(0); // 0..1
  const holdStartRef = useRef<number | null>(null);
  const holdRafRef = useRef<number | null>(null);
  const [bingoStatus, setBingoStatus] = useState<'idle' | 'checking' | 'success' | 'failed'>('idle');
  const [bingoMessage, setBingoMessage] = useState<string>('');
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

    // Handle bingo validation result (for the caller)
    newSocket.on('bingo-result', (data: any) => {
      console.log('Bingo result:', data);
      if (data.success) {
        setBingoStatus('success');
        setBingoMessage(data.message || 'BINGO! You win!');
        setGameState(prev => ({ ...prev, hasBingo: true }));
        // Play success sound
        playSuccessSound();
        // Vibrate celebration
        vibrate([100, 50, 100, 50, 100]);
        // Clear status after celebration
        setTimeout(() => {
          setBingoStatus('idle');
          setBingoMessage('');
        }, 5000);
      } else {
        setBingoStatus('failed');
        setBingoMessage(data.reason || 'Invalid bingo pattern');
        // Play error sound
        playErrorSound();
        // Single vibration for failed bingo
        vibrate([200]);
        // Clear status after showing error
        setTimeout(() => {
          setBingoStatus('idle');
          setBingoMessage('');
        }, 3000);
      }
    });

    // Handle bingo verification pending
    newSocket.on('bingo-verification-pending', (data: any) => {
      console.log('Bingo verification pending:', data);
      // Check if this is someone else's bingo call
      if (data.playerId !== newSocket.id) {
        // Play notification sound for other players
        playNotificationSound();
        // Show verification message (not celebration yet)
        setBingoMessage(`🤔 ${data.playerName} called BINGO - awaiting verification...`);
        setTimeout(() => setBingoMessage(''), 5000);
      }
    });

    // Handle confirmed bingo wins
    newSocket.on('bingo-called', (data: any) => {
      console.log('Bingo confirmed:', data);
      // Only celebrate if this is a verified/confirmed bingo
      if (data.verified && !data.awaitingVerification) {
        // Check if this is someone else's verified bingo
        if (data.playerId !== newSocket.id) {
          // Play celebration sound for other players
          playNotificationSound();
          // Show celebration message
          setBingoMessage(`🏆 ${data.playerName} WINS BINGO!`);
          setTimeout(() => setBingoMessage(''), 3000);
        }
      }
    });

    newSocket.on('game-ended', () => {
      setGameState(prev => ({ ...prev, isPlaying: false }));
      console.log('🛑 Game ended');
    });

    newSocket.on('game-restarted', (data: any) => {
      console.log('Game restarted:', data);
      // Reset player state
      setGameState(prev => ({
        ...prev,
        isPlaying: false,
        hasBingo: false
      }));
      setBingoStatus('idle');
      setBingoMessage('');
      
      // Reset bingo card marked state
      if (bingoCard && bingoCard.squares) {
        const resetCard = {
          ...bingoCard,
          squares: bingoCard.squares.map(square => ({
            ...square,
            marked: false
          }))
        };
        setBingoCard(resetCard);
      }
      
      // Show restart notification
      setBingoMessage('🔄 Game restarted by host');
      setTimeout(() => setBingoMessage(''), 3000);
    });

    newSocket.on('pattern-complete', (data: any) => {
      console.log('Pattern complete:', data);
      setGameState(prev => ({ ...prev, hasBingo: true }));
      setBingoMessage('🎯 BINGO PATTERN READY! Hold button to call it!');
      setTimeout(() => setBingoMessage(''), 5000);
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

  // DYNAMIC FONT SIZING: Apply to all cells when bingo card changes
  useEffect(() => {
    if (!bingoCard) return;
    
    console.log('🎯 DYNAMIC FONT SIZING: Starting font sizing for', bingoCard.squares.length, 'squares');
    console.log('🔍 Display mode:', displayMode);
    
    // Longer delay to ensure DOM is fully rendered and cells have final dimensions
    const timer = setTimeout(() => {
      bingoCard.squares.forEach((square) => {
        const squareElement = document.querySelector(`[data-position="${square.position}"]`);
        if (squareElement) {
          const textElement = squareElement.querySelector('.square-text') as HTMLElement;
          
          if (textElement) {
            const text = displayMode === 'title' ? square.songName : square.artistName;
            const isArtist = displayMode === 'artist';
            console.log(`🔍 Processing cell ${square.position}: "${text}" (${text.length} chars)`);
            fitTextToCell(textElement, text, isArtist);
          } else {
            console.log(`🚫 No .square-text element found for position ${square.position}`);
          }
        }
      });
    }, 500); // Longer delay to ensure DOM is fully rendered and styled
    
    return () => clearTimeout(timer);
  }, [bingoCard, displayMode]);

  // DYNAMIC FONT SIZING: Re-calculate on window resize
  useEffect(() => {
    const handleResize = () => {
      if (!bingoCard) return;
      
      // Debounce resize events and allow time for layout recalculation
      setTimeout(() => {
        bingoCard.squares.forEach((square) => {
          const squareElement = document.querySelector(`[data-position="${square.position}"]`);
          if (squareElement) {
            const textElement = squareElement.querySelector('.square-text') as HTMLElement;
            
            if (textElement) {
              const text = displayMode === 'title' ? square.songName : square.artistName;
              const isArtist = displayMode === 'artist';
              fitTextToCell(textElement, text, isArtist);
            }
          }
        });
      }, 500); // Longer delay to ensure DOM is fully rendered and styled
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [bingoCard, displayMode]);

  // DYNAMIC FONT SIZING: Fit text to fill cell as much as possible without overflow
  const fitTextToCell = (textElement: HTMLElement, text: string, isArtist: boolean = false) => {
    if (!textElement || !text) {
      console.log('🚫 fitTextToCell: Missing element or text', { element: !!textElement, text });
      return;
    }
    
    // Find the actual constraining container (.bingo-square)
    const squareElement = textElement.closest('.bingo-square') as HTMLElement;
    if (!squareElement) {
      console.log('🚫 fitTextToCell: Could not find .bingo-square container');
      return;
    }
    
    // Get the actual available space from the bingo square
    const squareRect = squareElement.getBoundingClientRect();
    const availableWidth = squareRect.width - 30; // More padding for comfortable reading
    const availableHeight = squareRect.height - 30; // More padding for comfortable reading
    
    if (availableWidth <= 0 || availableHeight <= 0) {
      console.log('🚫 fitTextToCell: Invalid available space', { availableWidth, availableHeight });
      return;
    }
    
    console.log(`🔍 Measuring cell: available space ${availableWidth}×${availableHeight}px for "${text.substring(0, 20)}..."`);
    
    // Start with a more conservative range to prevent mid-word breaks
    let minFontSize = 8;
    let maxFontSize = Math.min(availableHeight * 0.4, 20); // Much more conservative max
    let bestFontSize = minFontSize;
    
    // Set width constraint to force proper text wrapping
    textElement.style.setProperty('width', availableWidth + 'px', 'important');
    textElement.style.setProperty('max-width', availableWidth + 'px', 'important');
    
    // First pass: Try normal word wrapping (no mid-word breaks)
    let foundFit = false;
    for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 0.5) {
      textElement.style.setProperty('font-size', fontSize + 'px', 'important');
      textElement.style.setProperty('line-height', '1.2', 'important');
      textElement.style.setProperty('word-wrap', 'normal', 'important'); // Prevent mid-word breaks
      textElement.style.setProperty('overflow-wrap', 'normal', 'important');
      textElement.style.setProperty('word-break', 'normal', 'important');
      textElement.style.setProperty('hyphens', 'none', 'important');
      
      // Force layout recalculation
      void textElement.offsetHeight;
      
      const currentScrollHeight = textElement.scrollHeight;
      
      // Check if text fits with comfortable spacing
      if (currentScrollHeight <= (availableHeight * 0.9)) {
        bestFontSize = fontSize;
        foundFit = true;
        break;
      }
    }
    
    // Second pass: If no fit found, allow word breaking as fallback
    if (!foundFit) {
      console.log(`⚠️ Long text overflow detected for "${text.substring(0, 20)}...", trying word-break fallback`);
      
      for (let fontSize = Math.min(maxFontSize, 14); fontSize >= 6; fontSize -= 0.5) { // Lower range for overflow cases
        textElement.style.setProperty('font-size', fontSize + 'px', 'important');
        textElement.style.setProperty('line-height', '1.1', 'important'); // Tighter line height
        textElement.style.setProperty('word-wrap', 'break-word', 'important'); // Allow word breaking
        textElement.style.setProperty('overflow-wrap', 'break-word', 'important');
        textElement.style.setProperty('word-break', 'break-word', 'important');
        textElement.style.setProperty('hyphens', 'auto', 'important'); // Allow hyphenation
        
        // Force layout recalculation
        void textElement.offsetHeight;
        
        const currentScrollHeight = textElement.scrollHeight;
        
        // More lenient check for overflow cases
        if (currentScrollHeight <= availableHeight) {
          bestFontSize = fontSize;
          foundFit = true;
          break;
        }
      }
    }
    
    // Apply the best fitting font size
    textElement.style.setProperty('font-size', bestFontSize + 'px', 'important');
    
    // Debug log to verify it's working
    const finalScrollHeight = textElement.scrollHeight;
    const wordCount = text.split(' ').length;
    const method = foundFit ? (bestFontSize >= minFontSize ? 'normal' : 'word-break') : 'failed';
    console.log(`🎯 FITTED: "${text.substring(0, 15)}..." (${wordCount} words) → ${bestFontSize}px [${method}] (height: ${finalScrollHeight}/${availableHeight})`);
  };

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
    // Only prevent default for actual pointer events, not touch scrolling
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      e.preventDefault();
    }
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
    setTooltipText('');
  };

  const vibrate = (pattern: number | number[]) => {
    if (navigator.vibrate) navigator.vibrate(pattern);
  };

  // Audio feedback functions
  const playSuccessSound = () => {
    try {
      // Create success sound using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Happy celebration chord progression
      const playNote = (freq: number, startTime: number, duration: number) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.2, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      
      const now = audioContext.currentTime;
      // Play celebratory chord progression
      playNote(523.25, now, 0.3);     // C5
      playNote(659.25, now + 0.1, 0.3); // E5
      playNote(783.99, now + 0.2, 0.4); // G5
      playNote(1046.5, now + 0.3, 0.5); // C6
    } catch (error) {
      console.log('Audio not supported');
    }
  };

  const playErrorSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Error sound - descending tone
      const now = audioContext.currentTime;
      oscillator.frequency.setValueAtTime(400, now);
      oscillator.frequency.exponentialRampToValueAtTime(200, now + 0.3);
      
      gainNode.gain.setValueAtTime(0.3, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (error) {
      console.log('Audio not supported');
    }
  };

  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Gentle notification - two soft tones
      const playNote = (freq: number, startTime: number, duration: number) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.15, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      
      const now = audioContext.currentTime;
      playNote(659.25, now, 0.2);       // E5
      playNote(783.99, now + 0.15, 0.2); // G5
    } catch (error) {
      console.log('Audio not supported');
    }
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
    if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current as any);
    holdStartRef.current = performance.now();
    setHoldProgress(0);
    setBingoHolding(true);
    const tick = (now: number) => {
      if (!holdStartRef.current) return;
      const elapsed = now - holdStartRef.current;
      const p = Math.min(1, elapsed / 1000);
      setHoldProgress(p);
      if (p >= 1) {
        // Completed hold
        if (socket) {
          setBingoStatus('checking');
          setBingoMessage('Checking your bingo...');
          socket.emit('player-bingo', { roomId });
        }
        // Removed premature haptic - only vibrate on actual bingo success/failure
        setBingoHolding(false);
        holdStartRef.current = null;
        holdRafRef.current = null;
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick) as any;
    };
    holdRafRef.current = requestAnimationFrame(tick) as any;
  };

  const cancelBingoHold = () => {
    if (bingoHoldTimer.current) { window.clearTimeout(bingoHoldTimer.current); bingoHoldTimer.current = null; }
    if (holdRafRef.current) { cancelAnimationFrame(holdRafRef.current as any); holdRafRef.current = null; }
    holdStartRef.current = null;
    setHoldProgress(0);
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
              data-position={square.position}
              onClick={() => markSquare(square.position)}
              onPointerDown={(e) => handlePointerDown(square, e)}
              onPointerUp={clearLongPress}
              onPointerCancel={clearLongPress}
              onPointerLeave={clearLongPress}
              onContextMenu={(e) => { 
                // Only prevent context menu on long press, allow normal scrolling
                if (longPressTimer.current) {
                  e.preventDefault(); 
                  return false; 
                }
              }}
              draggable={false}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 3,
                lineHeight: 1.0,
                fontWeight: 700,
                userSelect: 'none'
              }}
              data-density={density}
            >
              <div className="square-content">
                {/* Display song title or artist based on display mode */}
                <div className="square-text">
                  {displayMode === 'title' ? square.songName : square.artistName}
                </div>
                {square.marked && (
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

        {/* Bingo Status Feedback */}
        {(bingoStatus !== 'idle' || bingoMessage) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            style={{
              position: 'fixed',
              bottom: 'calc(140px + env(safe-area-inset-bottom))',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '12px 20px',
              borderRadius: '25px',
              fontWeight: 700,
              fontSize: '1rem',
              zIndex: 999,
              textAlign: 'center',
              minWidth: '200px',
              maxWidth: '90vw',
              background: 
                bingoStatus === 'success' ? 'linear-gradient(135deg, #00ff88, #00cc6d)' :
                bingoStatus === 'failed' ? 'linear-gradient(135deg, #ff4444, #cc3333)' :
                bingoStatus === 'checking' ? 'linear-gradient(135deg, #ffaa00, #ff8800)' :
                'rgba(255,255,255,0.1)',
              color: 
                bingoStatus === 'success' ? '#001a0d' :
                bingoStatus === 'failed' ? '#ffffff' :
                bingoStatus === 'checking' ? '#ffffff' :
                '#ffffff',
              border: '2px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
            }}
          >
            {bingoStatus === 'checking' && (
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                style={{ display: 'inline-block', marginRight: '8px' }}
              >
                ⏳
              </motion.span>
            )}
            {bingoStatus === 'success' && '🏆 '}
            {bingoStatus === 'failed' && '❌ '}
            {bingoMessage}
          </motion.div>
        )}

        {/* bottom sheet removed per request */}
        <button
          className={`bingo-fab ${bingoHolding ? 'holding' : ''}`}
          onPointerDown={startBingoHold}
          onPointerUp={cancelBingoHold}
          onPointerCancel={cancelBingoHold}
          onTouchStart={(e) => { e.preventDefault(); startBingoHold(); }}
          onTouchEnd={(e) => { e.preventDefault(); cancelBingoHold(); }}
          onTouchCancel={(e) => { e.preventDefault(); cancelBingoHold(); }}
          onContextMenu={(e) => { e.preventDefault(); return false; }}
          onMouseDown={(e) => { e.preventDefault(); }}
          title="Hold to call BINGO"
          style={{
            position: 'fixed',
            bottom: 'calc(24px + env(safe-area-inset-bottom))',
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
            boxShadow: '0 12px 26px rgba(0,0,0,0.35), 0 0 24px rgba(0,255,136,0.35)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none',
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'none'
          }}
        >
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '6px solid rgba(255,255,255,0.15)' }} />
          <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,0.18)" strokeWidth="8" fill="none" />
            <circle cx="50" cy="50" r="44" stroke="#0b3" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${Math.max(0.01, holdProgress) * 276} 276`} />
          </svg>
          <span style={{ 
            position: 'relative', 
            zIndex: 1, 
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none',
            pointerEvents: 'none'
          }}>
            {bingoHolding ? 'Holding…' : 
             bingoStatus === 'checking' ? 'Checking...' :
             bingoStatus === 'success' ? 'WINNER!' :
             gameState.hasBingo ? 'BINGO!' : 'Hold to BINGO'}
          </span>
        </button>
      </div>
    </div>
  );
};

export default PlayerView; 