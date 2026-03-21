import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useParams, useSearchParams } from 'react-router-dom';
import io from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { Music, Users } from 'lucide-react';
import { cleanSongTitle } from '../utils/songTitleCleaner';
import { STANDARD_BINGO_POSITIONS, validateBingoCardGrid } from '../patternDefinitions';

interface BingoSquare {
  position: string;
  songId: string;
  songName: string;
  customSongName?: string;
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
  customPattern?: string[]; // Array of positions like ['0-0', '2-2', '4-4']
}

interface Song {
  id: string;
  name: string;
  artist: string;
}

/**
 * Canonical player UI (CSS px). Uniformly scaled to fit viewport — same layout on every device.
 */
/** Bingo grid must stay large in logical px — never repeat 120px “minimum” bug. */
const BINGO_CARD_PAD = 16;
const BINGO_CARD_MIN_SIDE = 140;

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
  const [longPressTooltip, setLongPressTooltip] = useState<{
    title: string;
    artist: string;
  } | null>(null);
  const [bingoHolding, setBingoHolding] = useState<boolean>(false);
  const bingoHoldTimer = useRef<number | null>(null);
  const [holdProgress, setHoldProgress] = useState<number>(0); // 0..1
  const holdStartRef = useRef<number | null>(null);
  const holdRafRef = useRef<number | null>(null);
  const [bingoStatus, setBingoStatus] = useState<'idle' | 'checking' | 'success' | 'failed'>('idle');
  const [bingoMessage, setBingoMessage] = useState<string>('');
  const [hasValidBingo, setHasValidBingo] = useState<boolean>(false);
  const [playedSongIds, setPlayedSongIds] = useState<string[]>([]);
  const [connectionToast, setConnectionToast] = useState<string>('');
  const previousPlayedSongIdsRef = useRef<string[]>([]); // Track previous state for missed songs calculation
  const wasReconnectingRef = useRef<boolean>(false); // Track if we're in a reconnection state
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    currentSong: null,
    playerCount: 0,
    hasBingo: false,
    pattern: 'full_card'
  });
  const [songsPlayed, setSongsPlayed] = useState<number>(0);

  /** Measured flex area → square card side (px). Guarantees equal 5×5 cells on all viewports. */
  const bingoCardAreaRef = useRef<HTMLDivElement>(null);
  const [bingoCardSidePx, setBingoCardSidePx] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('font_size_percent', '100');
    } catch {}
  }, []);

  // Mark persistence functions
  const getStoredMarks = (): Record<string, boolean> => {
    try {
      const stored = localStorage.getItem(`player_marks_${roomId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      }
    } catch {}
    return {};
  };

  const persistMarks = (card: BingoCard | null) => {
    if (!card) {
      try {
        localStorage.removeItem(`player_marks_${roomId}`);
      } catch {}
      return;
    }
    try {
      const marks: Record<string, boolean> = {};
      card.squares.forEach(square => {
        if (square.marked) {
          marks[square.position] = true;
        }
      });
      localStorage.setItem(`player_marks_${roomId}`, JSON.stringify(marks));
    } catch (e) {
      console.warn('Failed to persist marks:', e);
    }
  };

  const applyStoredMarks = (card: BingoCard | null): BingoCard | null => {
    if (!card) return card;
    const storedMarks = getStoredMarks();
    if (Object.keys(storedMarks).length === 0) return card;
    
    const updatedSquares = card.squares.map(square => ({
      ...square,
      marked: storedMarks[square.position] === true || square.marked
    }));
    return { ...card, squares: updatedSquares };
  };

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
      // This will trigger room-state which will calculate missed songs
      newSocket.emit('sync-state', { roomId });
      
      // Show reconnected toast if we were reconnecting
      if (wasReconnectingRef.current && gameState.isPlaying) {
        // Toast will be shown by room-state handler after calculating missed songs
        // But show immediate feedback
        setConnectionToast('🔄 Reconnecting...');
      }
    });

    newSocket.on('reconnect_attempt', (attempt: number) => {
      setConnectionStatus('reconnecting');
      setReconnectAttempts(attempt || 1);
      wasReconnectingRef.current = true;
    });
    newSocket.on('reconnect', () => {
      setConnectionStatus('connected');
      setReconnectAttempts(0);
      // Request sync to get latest state and calculate missed songs
      newSocket.emit('sync-state', { roomId });
    });
    newSocket.on('disconnect', () => {
      setConnectionStatus('disconnected');
      wasReconnectingRef.current = true;
      // Save current playedSongIds before disconnect to compare later
      previousPlayedSongIdsRef.current = [...playedSongIds];
      // Show disconnect toast
      if (gameState.isPlaying) {
        setConnectionToast('⚠️ Connection lost - attempting to reconnect...');
        setTimeout(() => setConnectionToast(''), 5000);
      }
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
      // Reset songs played counter when game starts
      setSongsPlayed(0);
      // CRITICAL: Reset playedSongIds to empty array (server will sync via room-state)
      setPlayedSongIds([]);
      // Reset reconnection tracking for new game
      previousPlayedSongIdsRef.current = [];
      wasReconnectingRef.current = false;
    });

    newSocket.on('room-state', (payload: any) => {
      try {
        // CRITICAL: Sync playedSongIds from server (single source of truth)
        // This is the ONLY place where playedSongIds should be updated
        if (Array.isArray(payload?.playedSongIds)) {
          setPlayedSongIds(prev => {
            // Validate sync: compare local vs server state
            const serverCount = payload.playedSongIds.length;
            const localCount = prev.length;
            
            // Calculate missed songs if reconnecting
            if (wasReconnectingRef.current && previousPlayedSongIdsRef.current.length > 0) {
              const missedSongs = payload.playedSongIds.filter(
                (id: string) => !previousPlayedSongIdsRef.current.includes(id)
              );
              if (missedSongs.length > 0) {
                setConnectionToast(`🔄 Reconnected! You missed ${missedSongs.length} song${missedSongs.length > 1 ? 's' : ''} while disconnected`);
                setTimeout(() => setConnectionToast(''), 6000);
                console.log(`🔄 Reconnected: Missed ${missedSongs.length} songs`);
              } else {
                setConnectionToast('✅ Reconnected successfully');
                setTimeout(() => setConnectionToast(''), 3000);
              }
              // Reset reconnection flag after handling
              wasReconnectingRef.current = false;
            }
            
            if (serverCount !== localCount) {
              console.log(`🔄 Sync detected mismatch: local=${localCount}, server=${serverCount} - syncing from server`);
            }
            // Always use server state as source of truth
            return payload.playedSongIds;
          });
          console.log(`🔄 Synced ${payload.playedSongIds.length} played songs from server`);
        }
        
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
      // Increment songs played counter
      setSongsPlayed(prev => prev + 1);
    });

    newSocket.on('bingo-card', (data: any) => {
      console.log('Received bingo card:', data);
      // Check if this is a new card (different song IDs) vs an update to existing card
      setBingoCard(prev => {
        // Check if server explicitly marked this as a new card, or if it's actually a new card
        const isExplicitNewCard = data.isNewCard === true;
        const isNoPreviousCard = !prev;
        
        // Check if this is a new card (different songs) vs an update (same songs)
        let isNewCardByContent = false;
        if (prev && data.squares) {
          const prevSongIds = new Set(prev.squares.map(s => s.songId));
          const newSongIds = new Set(data.squares.map((s: any) => s.songId));
          isNewCardByContent = prevSongIds.size !== newSongIds.size || 
                                !Array.from(prevSongIds).every(id => newSongIds.has(id));
        }
        
        if (isNoPreviousCard || isExplicitNewCard || isNewCardByContent) {
          // Brand new card - start with blank marks (don't apply stored marks from previous round)
          console.log('🔄 New card detected - clearing all marks', { isNoPreviousCard, isExplicitNewCard, isNewCardByContent });
          // Clear any persisted marks for this room
          try {
            localStorage.removeItem(`player_marks_${roomId}`);
          } catch {}
          // Remove isNewCard flag from card data before storing
          const cleanCard = { ...data };
          delete cleanCard.isNewCard;
          persistMarks(cleanCard); // Persist blank marks
          return cleanCard;
        }
        
        // Same card structure - preserve marks from previous card, then apply stored marks
        const mergedSquares = data.squares.map((newSquare: any) => {
          const oldSquare = prev.squares.find((s: any) => s.position === newSquare.position);
          return {
            ...newSquare,
            marked: oldSquare?.marked || false // Preserve mark state from previous card
          };
        });
        const mergedCard = { ...data, squares: mergedSquares };
        // Remove isNewCard flag if present
        delete mergedCard.isNewCard;
        // Apply stored marks (localStorage takes precedence for persistence)
        const cardWithStoredMarks = applyStoredMarks(mergedCard);
        persistMarks(cardWithStoredMarks);
        return cardWithStoredMarks;
      });
    });

    newSocket.on('mix-finalized', (data: any) => {
      console.log('Mix finalized:', data);
      // Cards are now available but game hasn't started yet
    });

    // Listen for pattern updates
    newSocket.on('pattern-updated', (data: any) => {
      console.log('Pattern updated:', data);
      setGameState((prev) => ({
        ...prev,
        pattern:
          typeof data?.pattern === 'string' && data.pattern.length > 0 ? data.pattern : prev.pattern,
        customPattern: Array.isArray(data?.customMask)
          ? data.customMask.length > 0
            ? data.customMask
            : undefined
          : prev.customPattern,
      }));
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

    // Listen for mark confirmation from server to ensure sync
    newSocket.on('mark-confirmed', (data: any) => {
      const { position, songId, marked } = data;
      if (!position || !songId) return;
      
      setBingoCard(prev => {
        if (!prev) return prev;
        const square = prev.squares.find(s => s.position === position && s.songId === songId);
        if (square && square.marked !== marked) {
          // Server state differs from local - sync to server state
          console.log(`🔄 Mark sync: Server says position ${position} should be ${marked ? 'marked' : 'unmarked'}, updating local state`);
          const updatedSquares = prev.squares.map(s => 
            s.position === position && s.songId === songId ? { ...s, marked: marked } : s
          );
          const updatedCard = { ...prev, squares: updatedSquares };
          persistMarks(updatedCard);
          return updatedCard;
        }
        return prev;
      });
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
      // Reset songs played counter
      setSongsPlayed(0);
      // CRITICAL: Reset playedSongIds to empty array (server will sync via room-state)
      setPlayedSongIds([]);
      
      // For new round: clear card entirely (will be regenerated with new playlists)
      // For restart: reset marks but keep card structure
      if (data.message && data.message.includes('New round starting')) {
        // New round - clear card completely and clear persisted marks
        setBingoCard(null);
        try {
          localStorage.removeItem(`player_marks_${roomId}`);
        } catch {}
        setBingoMessage('🔄 New round starting - waiting for new card...');
      } else {
        // Regular restart - reset marks but keep card
        if (bingoCard && bingoCard.squares) {
          const resetCard = {
            ...bingoCard,
            squares: bingoCard.squares.map(square => ({
              ...square,
              marked: false
            }))
          };
          // Clear persisted marks
          try {
            localStorage.removeItem(`player_marks_${roomId}`);
          } catch {}
          persistMarks(resetCard); // Persist empty marks
          setBingoCard(resetCard);
        }
        setBingoMessage('🔄 Game restarted by host');
      }
      setTimeout(() => setBingoMessage(''), 5000);
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
      // Clear persisted marks
      try {
        localStorage.removeItem(`player_marks_${roomId}`);
      } catch {}
      // Reset songs played counter
      setSongsPlayed(0);
      // CRITICAL: Reset playedSongIds to empty array (server will sync via room-state)
      setPlayedSongIds([]);
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

  // Bingo card: measure flex slot, set square side = min(w,h) - pad for full-width/height square.
  useEffect(() => {
    const el = bingoCardAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, r.width);
      const h = Math.max(0, r.height);
      const raw = Math.floor(Math.min(w, h) - BINGO_CARD_PAD);
      const side = Math.max(BINGO_CARD_MIN_SIDE, Math.min(raw, 4096));
      setBingoCardSidePx((prev) => (side !== prev ? side : prev));
    };

    const schedule = () => window.requestAnimationFrame(measure);
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("resize", schedule);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);

    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("resize", schedule);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
    };
  }, []);


  // Periodic sync during gameplay to ensure state stays in sync with server
  useEffect(() => {
    if (!socket || !gameState.isPlaying) return;
    
    // Request sync every 30 seconds during gameplay
    const syncInterval = setInterval(() => {
      if (socket && socket.connected && gameState.isPlaying) {
        socket.emit('sync-state', { roomId });
        console.log('🔄 Periodic sync requested');
      }
    }, 30000); // 30 seconds
    
    return () => clearInterval(syncInterval);
  }, [socket, gameState.isPlaying, roomId]);

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
    // Server will send mark-confirmed event to ensure sync
    setBingoCard(prev => {
      if (!prev) return prev;
      const updatedSquares = prev.squares.map(s => s.position === position ? { ...s, marked: !s.marked } : s);
      const updatedCard = { ...prev, squares: updatedSquares };
      // Persist marks to localStorage immediately
      persistMarks(updatedCard);
      return updatedCard;
    });
    if (navigator.vibrate) navigator.vibrate(10);
  };

  // Long-press: show title + artist (fixed panel; in-cell tooltips were clipped by overflow on the card).
  const handlePointerDown = (square: BingoSquare, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      e.preventDefault();
    }
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    const title = square.customSongName || cleanSongTitle(square.songName);
    const artist = square.artistName;
    longPressTimer.current = window.setTimeout(() => {
      setLongPressTooltip({
        title,
        artist,
      });
      try {
        if (navigator.vibrate) navigator.vibrate(12);
      } catch {}
    }, 350);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setLongPressTooltip(null);
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

  const handleDisplayModeToggle = (checked: boolean) => {
    const mode = checked ? 'artist' : 'title';
    setDisplayMode(mode);
    localStorage.setItem('display_mode', mode);
  };

  const startBingoHold = () => {
    // TEMPORARILY DISABLED: Allow bingo calls even without valid pattern (host will verify)
    // if (!hasValidBingo) {
    //   setBingoMessage('No valid bingo pattern completed!');
    //   setTimeout(() => setBingoMessage(''), 2000);
    //   return;
    // }

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

  // Auto-detect bingo when card, pattern, or played songs change
  useEffect(() => {
    if (bingoCard && gameState.pattern) {
      // Use visual pattern check for button enablement (allows calls even with invalid marks)
      const hasVisualPattern = checkVisualPattern(bingoCard);
      setHasValidBingo(hasVisualPattern);
      
      // Update game state hasBingo for UI consistency
      if (hasVisualPattern !== gameState.hasBingo) {
        setGameState(prev => ({ ...prev, hasBingo: hasVisualPattern }));
      }
    }
  }, [bingoCard, gameState.pattern, gameState.customPattern]);

  // Check if a visual pattern is complete (only checks if squares are marked, not if songs played)
  const checkVisualPattern = (card: BingoCard): boolean => {
    const pattern = gameState.pattern;
    
    console.log('🎯 checkVisualPattern called:', {
      pattern,
      markedSquares: card.squares.filter(s => s.marked).length
    });
    
    // Helper function to check if a square is marked (visual check only)
    const isSquareMarked = (square: BingoSquare): boolean => {
      return square && square.marked === true;
    };
    
    // Full card — real 5×5 grid, then every cell marked (fail closed if card is truncated/duplicate)
    if (pattern === 'full_card') {
      if (!validateBingoCardGrid(card)) return false;
      return STANDARD_BINGO_POSITIONS.every((pos) => {
        const square = card.squares.find((s) => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }
    
    // Four corners pattern - all 4 corners must be marked
    if (pattern === 'four_corners') {
      const corners = ['0-0', '0-4', '4-0', '4-4'];
      return corners.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }
    
    // X pattern - both diagonals must be marked
    if (pattern === 'x') {
      let diag1Complete = true;
      let diag2Complete = true;
      for (let i = 0; i < 5; i++) {
        const square1 = card.squares.find(s => s.position === `${i}-${i}`);
        const square2 = card.squares.find(s => s.position === `${i}-${4-i}`);
        
        if (!square1 || !isSquareMarked(square1)) diag1Complete = false;
        if (!square2 || !isSquareMarked(square2)) diag2Complete = false;
      }
      return diag1Complete && diag2Complete;
    }
    
    // T pattern - top row + middle column must be marked
    if (pattern === 't') {
      const tPositions = ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'];
      return tPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }
    
    // L pattern - left column + bottom row must be marked
    if (pattern === 'l') {
      const lPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'];
      return lPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }
    
    // U pattern - left column + right column + bottom row must be marked
    if (pattern === 'u') {
      const uPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'];
      return uPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }
    
    // Plus pattern - middle row + middle column must be marked
    if (pattern === 'plus') {
      const plusPositions = ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'];
      return plusPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }
    
    // Line pattern - any row, column, or diagonal (all squares must be marked)
    if (pattern === 'line') {
      // Check rows
      for (let row = 0; row < 5; row++) {
        let rowComplete = true;
        for (let col = 0; col < 5; col++) {
          const square = card.squares.find(s => s.position === `${row}-${col}`);
          if (!square || !isSquareMarked(square)) {
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
          if (!square || !isSquareMarked(square)) {
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
        
        if (!square1 || !isSquareMarked(square1)) diag1Complete = false;
        if (!square2 || !isSquareMarked(square2)) diag2Complete = false;
      }
      if (diag1Complete || diag2Complete) return true;
    }
    
    // Custom pattern - check if all custom positions are marked
    if (pattern === 'custom' && gameState.customPattern) {
      const customPositions = Array.isArray(gameState.customPattern) 
        ? gameState.customPattern 
        : Array.from(gameState.customPattern);
      return customPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }
    
    return false;
  };

  // Server-side validation check (checks if marked squares correspond to played songs)
  const checkBingo = (card: BingoCard): boolean => {
    const pattern = gameState.pattern;
    
    console.log('🎯 checkBingo called:', {
      pattern,
      playedSongIds: playedSongIds.length,
      markedSquares: card.squares.filter(s => s.marked).length
    });
    
    // Helper function to check if a marked square corresponds to a played song
    const isMarkedSquareValid = (square: BingoSquare): boolean => {
      const isValid = square.marked && playedSongIds.includes(square.songId);
      if (square.marked && !isValid) {
        console.log('❌ Invalid mark:', square.position, square.songId, 'not in played list');
      }
      return isValid;
    };
    
    // Full card — grid integrity + every cell marked with a played song (matches server 0-0…4-4 loop)
    if (pattern === 'full_card') {
      if (!validateBingoCardGrid(card)) return false;
      return STANDARD_BINGO_POSITIONS.every((pos) => {
        const square = card.squares.find((s) => s.position === pos);
        return square ? isMarkedSquareValid(square) : false;
      });
    }
    
    // Four corners pattern - all 4 corners must be marked AND correspond to played songs
    if (pattern === 'four_corners') {
      const corners = ['0-0', '0-4', '4-0', '4-4'];
      return corners.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square && isMarkedSquareValid(square);
      });
    }
    
    // X pattern - both diagonals must be marked AND correspond to played songs
    if (pattern === 'x') {
      let diag1Complete = true;
      let diag2Complete = true;
      for (let i = 0; i < 5; i++) {
        const square1 = card.squares.find(s => s.position === `${i}-${i}`);
        const square2 = card.squares.find(s => s.position === `${i}-${4-i}`);
        
        if (!square1 || !isMarkedSquareValid(square1)) diag1Complete = false;
        if (!square2 || !isMarkedSquareValid(square2)) diag2Complete = false;
      }
      return diag1Complete && diag2Complete;
    }
    
    // T pattern - top row + middle column must be marked AND correspond to played songs
    if (pattern === 't') {
      const tPositions = ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'];
      return tPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square && isMarkedSquareValid(square);
      });
    }
    
    // L pattern - left column + bottom row must be marked AND correspond to played songs
    if (pattern === 'l') {
      const lPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'];
      return lPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square && isMarkedSquareValid(square);
      });
    }
    
    // U pattern - left column + right column + bottom row must be marked AND correspond to played songs
    if (pattern === 'u') {
      const uPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'];
      return uPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square && isMarkedSquareValid(square);
      });
    }
    
    // Plus pattern - middle row + middle column must be marked AND correspond to played songs
    if (pattern === 'plus') {
      const plusPositions = ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'];
      return plusPositions.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square && isMarkedSquareValid(square);
      });
    }
    
    // Line pattern - any row, column, or diagonal (all marked squares must correspond to played songs)
    if (pattern === 'line') {
      // Check rows
      for (let row = 0; row < 5; row++) {
        let rowComplete = true;
        for (let col = 0; col < 5; col++) {
          const square = card.squares.find(s => s.position === `${row}-${col}`);
          if (!square || !isMarkedSquareValid(square)) {
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
          if (!square || !isMarkedSquareValid(square)) {
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
        
        if (!square1 || !isMarkedSquareValid(square1)) diag1Complete = false;
        if (!square2 || !isMarkedSquareValid(square2)) diag2Complete = false;
      }
      return diag1Complete || diag2Complete;
    }
    
    // Custom pattern - check if all required positions are marked AND correspond to played songs
    if (pattern === 'custom' && gameState.customPattern) {
      return gameState.customPattern.every(pos => {
        const square = card.squares.find(s => s.position === pos);
        return square && isMarkedSquareValid(square);
      });
    }
    
    // Default fallback
    return false;
  };

  // Helper function to determine if a square should be highlighted based on pattern
  const isPatternSquare = (position: string): boolean => {
    const pattern = gameState.pattern;

    // Any row, column, or diagonal can win - every cell can belong to some winning line.
    // Full card (blackout): every cell is required.
    if (pattern === 'line' || pattern === 'full_card') {
      return true;
    }

    if (pattern === 'custom' && gameState.customPattern?.length) {
      return gameState.customPattern.includes(position);
    }
    
    if (pattern === 'four_corners') {
      return ['0-0', '0-4', '4-0', '4-4'].includes(position);
    }
    
    if (pattern === 'x') {
      const [row, col] = position.split('-').map(Number);
      return row === col || row + col === 4; // Diagonal positions
    }
    
    if (pattern === 't') {
      const tPositions = ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'];
      return tPositions.includes(position);
    }
    
    if (pattern === 'l') {
      const lPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'];
      return lPositions.includes(position);
    }
    
    if (pattern === 'u') {
      const uPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'];
      return uPositions.includes(position);
    }
    
    if (pattern === 'plus') {
      const plusPositions = ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'];
      return plusPositions.includes(position);
    }
    
    return false;
  };

  const renderBingoCard = () => {
    if (!bingoCard) {
      return (
        <div className="loading-card">
          <p>Waiting for host to start the game...</p>
        </div>
      );
    }

    /* Fallback width until ResizeObserver sets bingoCardSidePx — avoids collapsed / invisible grid. */
    const sidePx = bingoCardSidePx ?? 280;
    const cardBoxStyle: React.CSSProperties = {
      width: sidePx,
      height: sidePx,
      flex: "none",
      boxSizing: "border-box",
      marginInline: "auto",
    };

    return (
      <div className="bingo-card" style={cardBoxStyle}>
        <div className="bingo-card-grid">
          {bingoCard.squares.map((square) => (
            <motion.div
              key={square.position}
              className={`bingo-square ${square.marked ? 'marked' : ''} ${isPatternSquare(square.position) ? 'pattern-highlight' : ''}`}
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
                padding: 0,
                lineHeight: 1.12,
                fontWeight: 700,
                userSelect: 'none'
              }}
            >
              <div className="square-content">
                {/* Display song title or artist based on display mode */}
                <div className="square-text">
                  {displayMode === 'title' ? (square.customSongName || cleanSongTitle(square.songName)) : square.artistName}
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
    <div className={`player-container ${bingoCard ? 'has-card' : ''}`} style={{ minHeight: '100svh', overscrollBehavior: 'contain', paddingBottom: 'env(safe-area-inset-bottom)', display: 'flex', flexDirection: 'column' }}>
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
      <div className="player-chrome">
        <motion.div
          className="player-header"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="player-header-top">
            <div className="player-header-identity">
              <Users className="player-icon" aria-hidden />
              <span className="player-line">{playerName}</span>
            </div>
            <button
              type="button"
              className={`conn-chip conn-chip-compact conn-status-${connectionStatus}`}
              onClick={handleResync}
              title={
                connectionStatus === 'connected'
                  ? 'Connected — tap to resync if you missed a call'
                  : connectionStatus === 'reconnecting'
                    ? `Reconnecting (${reconnectAttempts}) — tap to resync`
                    : 'Disconnected — tap to resync'
              }
            >
              <span
                className="conn-dot"
                style={{
                  background: connectionStatus === 'connected' ? '#1DB954'
                    : connectionStatus === 'reconnecting' ? '#FFA500'
                    : '#FF4D4F'
                }}
              />
              <span className="conn-chip-label">Resync</span>
            </button>
          </div>
          <div className="player-header-meta">
            <span className="player-meta-line">
              {gameState.playerCount} players
              {gameState.isPlaying ? ` · ${songsPlayed} played` : ''}
            </span>
            {gameState.hasBingo ? (
              <span className="player-bingo">BINGO!</span>
            ) : (
              <span className="player-bingo-spacer" aria-hidden />
            )}
          </div>
        </motion.div>

        <motion.div
          className="player-controls player-controls-strip"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
        >
          {bingoCard && (
            <div className="player-controls-row player-controls-row-display">
              <span className="player-controls-label">Display</span>
              <div className="player-controls-slot">
                <span className="player-controls-hint">{displayMode === 'title' ? 'Title' : 'Artist'}</span>
                <label className="toggle-switch toggle-switch--compact">
                  <input
                    type="checkbox"
                    checked={displayMode === 'artist'}
                    onChange={(e) => handleDisplayModeToggle(e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>
          )}

          <div
            className={`player-controls-row player-controls-row-textsize${!bingoCard ? ' player-controls-row-full' : ''}`}
          >
            <span className="player-controls-label">Text</span>
            <div className="player-controls-slot player-controls-slot-textlocked">
              <span className="player-font-hint player-font-hint-inline" title="Same layout on every device">
                Locked
              </span>
              <span className="font-size-readout">100%</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="player-content">
        <motion.div
          ref={bingoCardAreaRef}
          className="bingo-section"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.15 }}
        >
          {renderBingoCard()}
        </motion.div>

        {/* Game Status and Instructions removed per request */}

        {/* Connection Status Toast */}
        {connectionToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '12px 20px',
              borderRadius: '25px',
              fontWeight: 600,
              fontSize: 14,
              zIndex: 1200,
              textAlign: 'center',
              minWidth: 200,
              maxWidth: 312,
              background: connectionToast.includes('missed') 
                ? 'linear-gradient(135deg, #ffaa00, #ff8800)'
                : connectionToast.includes('Reconnected')
                ? 'linear-gradient(135deg, #00ff88, #00cc6d)'
                : 'rgba(255,255,255,0.15)',
              color: connectionToast.includes('missed') || connectionToast.includes('Reconnected')
                ? '#ffffff'
                : '#ffffff',
              border: '2px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
            }}
          >
            {connectionToast}
          </motion.div>
        )}

        {/* Bingo Status Feedback */}
        {(bingoStatus !== 'idle' || bingoMessage) && (
          <motion.div
            className="player-bingo-status-toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '12px 20px',
              borderRadius: '25px',
              fontWeight: 700,
              fontSize: 15,
              zIndex: 1150,
              textAlign: 'center',
              minWidth: 200,
              maxWidth: 312,
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

        {/* Long-press: title + artist (fixed; avoids overflow clip) */}
        {longPressTooltip && (
          <div className="player-longpress-tooltip" role="status" aria-live="polite">
            <div className="player-longpress-tooltip-heading">Title</div>
            <div className="player-longpress-tooltip-line player-longpress-tooltip-primary">{longPressTooltip.title}</div>
            <div className="player-longpress-tooltip-heading">Artist</div>
            <div className="player-longpress-tooltip-line">{longPressTooltip.artist}</div>
          </div>
        )}

        {/* bottom sheet removed per request — FAB in flow so it scales with the logical canvas */}
        <div className="player-fab-row">
        <button
          type="button"
          className={`bingo-fab bingo-fab--canvas ${bingoHolding ? 'holding' : ''} ${hasValidBingo ? 'ready' : 'disabled'}`}
          aria-label={hasValidBingo ? 'Hold to call bingo' : 'Complete a winning pattern to call bingo'}
          onPointerDown={startBingoHold}
          onPointerUp={cancelBingoHold}
          onPointerCancel={cancelBingoHold}
          onTouchStart={(e) => { e.preventDefault(); startBingoHold(); }}
          onTouchEnd={(e) => { e.preventDefault(); cancelBingoHold(); }}
          onTouchCancel={(e) => { e.preventDefault(); cancelBingoHold(); }}
          onContextMenu={(e) => { e.preventDefault(); return false; }}
          onMouseDown={(e) => { e.preventDefault(); }}
          title={hasValidBingo ? "Hold to call BINGO!" : "Complete a pattern to call BINGO"}
          style={{
            zIndex: 1100,
            background: hasValidBingo 
              ? 'linear-gradient(180deg, #00ff88 0%, #00cc6d 100%)'
              : 'linear-gradient(180deg, #666666 0%, #444444 100%)',
            color: hasValidBingo ? '#061a12' : '#cccccc',
            border: hasValidBingo 
              ? '2px solid rgba(0,255,136,0.6)'
              : '2px solid rgba(102,102,102,0.6)',
            boxShadow: hasValidBingo 
              ? '0 12px 26px rgba(0,0,0,0.35), 0 0 24px rgba(0,255,136,0.35)'
              : '0 8px 16px rgba(0,0,0,0.25)',
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
          <span className="bingo-fab-label" style={{ 
            position: 'relative', 
            zIndex: 1, 
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none',
            pointerEvents: 'none',
          }}>
            {bingoHolding ? 'Holding…' : 
             bingoStatus === 'checking' ? 'Checking...' :
             bingoStatus === 'success' ? 'WINNER!' :
             hasValidBingo ? 'BINGO READY!' : 'No pattern'}
          </span>
        </button>
        </div>
      </div>
    </div>
  );
};

export default PlayerView; 