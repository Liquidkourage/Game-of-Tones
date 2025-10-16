import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
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
  Grid3X3,
  QrCode
} from 'lucide-react';
import { API_BASE } from '../config';

interface GameState {
  isPlaying: boolean;
  currentSong: Song | null;
  playerCount: number;
  winners: Winner[];
  snippetLength: number;
  playedSongs: Song[];
  bingoCard: BingoCard;
  currentRound?: {
    name: string;
    number: number;
    playlistCount?: number;
    songCount?: number;
    status?: string;
    startedAt?: number;
  };
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
  const navigate = useNavigate();
  const [connectCode, setConnectCode] = useState<string>('');
  const [searchParams] = useSearchParams();
  const showNowPlaying = (searchParams.get('np') === '1') || (searchParams.get('nowPlaying') === '1');
  const debugMode = (searchParams.get('debug') === '1') || (searchParams.get('dbg') === '1');
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [roomInfo, setRoomInfo] = useState<{ id: string; playerCount: number } | null>(null);
  // Splash/intro overlay (can disable with ?splash=0)
  const splashEnabled = (searchParams.get('splash') !== '0');
  const [showSplash, setShowSplash] = useState<boolean>(splashEnabled);
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
  const [pattern, setPattern] = useState<string>('full_card');
  const [countdownMs, setCountdownMs] = useState<number>(0);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const [totalPlayedCount, setTotalPlayedCount] = useState<number>(0);
  const [isVerificationPending, setIsVerificationPending] = useState<boolean>(false);
  // Visible carousel columns (default 3; can be overridden via ?cols=5)
  const visibleCols = (() => {
    const p = Number.parseInt(searchParams.get('cols') || '', 10);
    if (Number.isFinite(p) && p >= 1 && p <= 5) return p;
    return 5;
  })();
  // 1x75 call list state
  const [oneBy75Ids, setOneBy75Ids] = useState<string[] | null>(null);
  const oneBy75IdsRef = useRef<string[] | null>(null);
  const [fiveBy15Columns, setFiveBy15Columns] = useState<string[][] | null>(null);
  const idToColumnRef = useRef<Record<string, number>>({});
  const pendingPlacementRef = useRef<Set<string>>(new Set());
  const playedOrderRef = useRef<string[]>([]);
  const idMetaRef = useRef<Record<string, { name: string; artist: string }>>({});
  const currentIndexRef = useRef<number>(-1);
  const revealSequenceRef = useRef<string[]>([]);
  const songBaselineRef = useRef<Record<string, number>>({});
  const playedSeqRef = useRef<Record<string, number>>({});
  const playedSeqCounterRef = useRef<number>(0);
  // Carousel state for grouped 15x5 columns (show 3 at a time)
  const [carouselIndex, setCarouselIndex] = useState<number>(0);
  const [animating, setAnimating] = useState<boolean>(true); // kept for compatibility but no longer toggled
  const carouselViewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  const [playlistNames, setPlaylistNames] = useState<string[]>([]);
  // 5x15 vertical scroll state
  const [vertIndex, setVertIndex] = useState<number>(0);
  const [vertIndices, setVertIndices] = useState<number[]>([0,0,0,0,0]);
  const vertViewportRef = useRef<HTMLDivElement | null>(null);
  const [rowHeightPx, setRowHeightPx] = useState<number>(0);
  // Toast for revealed letter
  const [revealToast, setRevealToast] = useState<string | null>(null);
  const [customMask, setCustomMask] = useState<Set<string>>(new Set());
  const revealToastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showWinnerBanner, setShowWinnerBanner] = useState<boolean>(false);
  const [winnerName, setWinnerName] = useState<string>('');
  // Connection status and sync management
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [socket, setSocket] = useState<any>(null);
  // Global scroll phase to keep columns aligned + freeze control
  const [phasePx, setPhasePx] = useState<number>(0);
  const rafRef = useRef<number | null>(null);
  const [freezeAll, setFreezeAll] = useState<boolean>(false);
  const [frozenCols, setFrozenCols] = useState<boolean[]>([false, false, false, false, false]);
  const [freezeRows, setFreezeRows] = useState<number[]>([0, 0, 0, 0, 0]);
  // Per-ball animation seeds (stable for component lifetime)
  const ballAnimSeedsRef = useRef<Array<{
    dx: number; dy: number; rz: number; rx: number; ry: number;
    dur: number; delay: number; shadeDur: number; hiliteDur: number; hiliteDelay: number;
    sparkleDX: number; sparkleDY: number; shadowAmp: number;
  }>>([]);
  if (ballAnimSeedsRef.current.length === 0) {
    // Generate small random jitters so each ball feels unique but cohesive
    for (let i = 0; i < 5; i++) {
      const rand = (min: number, max: number) => min + Math.random() * (max - min);
      ballAnimSeedsRef.current.push({
        dx: rand(-3, 3),
        dy: rand(-3, 3),
        rz: rand(-1.2, 1.2),
        rx: rand(-2, 2),
        ry: rand(-2.5, 2.5),
        dur: rand(3.4, 4.8),
        delay: rand(0, 0.35) + i * 0.1,
        shadeDur: rand(5.0, 7.0),
        hiliteDur: rand(5.8, 7.6),
        hiliteDelay: rand(0.0, 0.35) + i * 0.12,
        sparkleDX: rand(-2, 3),
        sparkleDY: rand(-2, 2),
        shadowAmp: rand(2, 6)
      });
    }
  }

  // Audio feedback for public celebrations
  const playPublicCelebrationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Grand celebration fanfare
      const playNote = (freq: number, startTime: number, duration: number, volume: number = 0.3) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      
      const now = audioContext.currentTime;
      
      // Victory fanfare progression
      playNote(523.25, now, 0.4, 0.25);        // C5
      playNote(659.25, now + 0.1, 0.4, 0.25);  // E5
      playNote(783.99, now + 0.2, 0.4, 0.25);  // G5
      playNote(1046.5, now + 0.3, 0.6, 0.3);   // C6
      playNote(1318.5, now + 0.5, 0.8, 0.35);  // E6 - big finish
    } catch (error) {
      console.log('Audio not supported');
    }
  };

  // Manual refresh function for host control
  const handleManualRefresh = () => {
    console.log('🔄 Manual refresh requested');
    if (socket) {
      socket.emit('sync-state', { roomId });
      setLastSyncTime(Date.now());
    }
  };

  useEffect(() => {
    console.log('🖥️ PublicDisplay: Initializing socket connection');
    
    // Initialize socket with robust reconnection
    const newSocket = io(SOCKET_URL || undefined, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    setSocket(newSocket);

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('🖥️ PublicDisplay: Connected to server');
      setConnectionStatus('connected');
      setReconnectAttempts(0);
      
      // Join room as display
      newSocket.emit('join-room', { roomId, playerName: 'Display', isHost: false });
      
      // Request current state sync
      newSocket.emit('sync-state', { roomId });
      setLastSyncTime(Date.now());
      
      ensureGrid();
    });

    newSocket.on('reconnect_attempt', (attempt: number) => {
      console.log(`🖥️ PublicDisplay: Reconnection attempt ${attempt}`);
      setConnectionStatus('reconnecting');
      setReconnectAttempts(attempt || 1);
    });

    newSocket.on('reconnect', () => {
      console.log('🖥️ PublicDisplay: Reconnected successfully');
      setConnectionStatus('connected');
      setReconnectAttempts(0);
      
      // Re-sync state after reconnection
      newSocket.emit('sync-state', { roomId });
      setLastSyncTime(Date.now());
    });

    newSocket.on('disconnect', (reason: string) => {
      console.log('🖥️ PublicDisplay: Disconnected:', reason);
      setConnectionStatus('disconnected');
    });

    newSocket.on('connect_error', (error: any) => {
      console.warn('🖥️ PublicDisplay: Connection error:', error?.message || error);
      setConnectionStatus('reconnecting');
    });

    newSocket.on('reconnect_error', (error: any) => {
      console.warn('🖥️ PublicDisplay: Reconnection error:', error?.message || error);
      setConnectionStatus('reconnecting');
    });

    // State sync handler
    newSocket.on('room-state', (payload: any) => {
      console.log('🖥️ PublicDisplay: Received room state sync:', payload);
      try {
        if (payload) {
          setGameState(prev => ({
            ...prev,
            isPlaying: !!payload.isPlaying,
            currentSong: payload.currentSong || null,
            playerCount: payload.playerCount || 0,
            snippetLength: payload.snippetLength || 30,
            winners: payload.winners || prev.winners,
            playedSongs: payload.playedSongs || prev.playedSongs,
            currentRound: payload.currentRound || prev.currentRound
          }));
          
          if (payload.pattern) {
            setPattern(payload.pattern);
          }
          
          if (Array.isArray(payload.customMask)) {
            setCustomMask(new Set(payload.customMask));
          }
          
          // Update total played count for display sync
          if (typeof payload.totalPlayedCount === 'number') {
            setTotalPlayedCount(payload.totalPlayedCount);
          }
          
          // Sync played songs to internal tracking
          if (Array.isArray(payload.playedSongs)) {
            const playedIds = payload.playedSongs.map((song: any) => song.id);
            playedOrderRef.current = playedIds;
            
            // Update metadata cache
            payload.playedSongs.forEach((song: any) => {
              if (song.id && song.name) {
                idMetaRef.current[song.id] = {
                  name: song.name,
                  artist: song.artist || ''
                };
              }
            });
          }
          
          // Use server timestamp if available, otherwise current time
          setLastSyncTime(payload.syncTimestamp || Date.now());
          
          console.log(`🖥️ PublicDisplay: Synced ${payload.totalPlayedCount || 0} played songs, ${payload.playerCount || 0} players`);
        }
      } catch (error) {
        console.error('🖥️ PublicDisplay: Error processing room state:', error);
      }
    });

    newSocket.on('player-joined', (data: any) => {
      const count = Math.max(0, Number(data.playerCount || 0));
      setGameState(prev => ({ ...prev, playerCount: count }));
      window.dispatchEvent(new CustomEvent('display-player-count', { detail: { playerCount: count } }));
      setRoomInfo(prev => (prev ? { ...prev, playerCount: count } : prev));
    });
    newSocket.on('player-left', (data: any) => {
      const count = Math.max(0, Number(data.playerCount || 0));
      setGameState(prev => ({ ...prev, playerCount: count }));
      window.dispatchEvent(new CustomEvent('display-player-count', { detail: { playerCount: count } }));
      setRoomInfo(prev => (prev ? { ...prev, playerCount: count } : prev));
    });

    // Receive 1x75 pool ordering (ids only)
    newSocket.on('oneby75-pool', (data: any) => {
      if (Array.isArray(data?.ids) && data.ids.length === 75) {
        setOneBy75Ids(data.ids);
        oneBy75IdsRef.current = data.ids;
        // Do not clear playedOrder; preserve any songs already recorded
        revealSequenceRef.current = [];
        songBaselineRef.current = {};
        setCarouselIndex(0);
        setFiveBy15Columns(null);
        // Do not auto-seed played list by pool order; rely on actual song-playing events
      }
    });

    // Receive 5x15 pool as 5 columns of 15 ids
    newSocket.on('fiveby15-pool', (data: any) => {
      if (Array.isArray(data?.columns) && data.columns.length === 5 && data.columns.every((c: any) => Array.isArray(c))) {
        try {
          const cols = data.columns.map((col: any) => col.slice(0, 15));
          setFiveBy15Columns(cols);
          if (Array.isArray(data?.names)) setPlaylistNames(data.names);
          // Preload metadata for revealed titles to avoid 'Unknown'
          if (data?.meta && typeof data.meta === 'object') {
            Object.entries(data.meta).forEach(([id, m]: any) => {
              idMetaRef.current[id] = { name: m?.name || 'Unknown', artist: m?.artist || '' };
            });
          }
          // Flatten for meta resolution and baseline tracking order
          const flat = ([] as string[]).concat(...cols);
          setOneBy75Ids(flat);
          oneBy75IdsRef.current = flat;
          // Preserve playedOrder; do not clear
          revealSequenceRef.current = [];
          songBaselineRef.current = {};
          setCarouselIndex(0);
          // Do not seed by flattened pool; rely solely on actual play events
          // Reconcile any pending placements now that columns are known
          try {
            if (pendingPlacementRef.current.size > 0) {
              pendingPlacementRef.current.forEach((pid) => {
                if (idToColumnRef.current[pid] === undefined) {
                  for (let c = 0; c < cols.length; c++) {
                    if (cols[c].includes(pid)) { idToColumnRef.current[pid] = c; break; }
                  }
                }
                if (idToColumnRef.current[pid] !== undefined) pendingPlacementRef.current.delete(pid);
              });
            }
          } catch {}
        } catch {}
      }
    });

    // Receive explicit id->column map (authoritative placement)
    newSocket.on('fiveby15-map', (data: any) => {
      if (data && data.idToColumn && typeof data.idToColumn === 'object') {
        idToColumnRef.current = data.idToColumn;
        // Reconcile pending after receiving authoritative map
        try {
          if (pendingPlacementRef.current.size > 0) {
            pendingPlacementRef.current.forEach((pid) => {
              if (idToColumnRef.current[pid] !== undefined) pendingPlacementRef.current.delete(pid);
            });
          }
        } catch {}
      }
    });

    newSocket.on('bingo-card', (card: any) => {
      const squares = (card.squares || []).map((s: any) => ({
        song: { id: s.songId, name: s.songName, artist: s.artistName },
        isPlayed: false,
        position: { row: parseInt(s.position.split('-')[0], 10), col: parseInt(s.position.split('-')[1], 10) }
      }));
      setGameState(prev => ({ ...prev, bingoCard: { squares, size: 5 } }));
    });

    newSocket.on('pattern-updated', (data: any) => {
      try {
        const p = data?.pattern;
        if (p) setPattern(p);
      } catch {}
    });

    newSocket.on('song-playing', (data: any) => {
      const song = { id: data.songId, name: data.songName, artist: data.artistName };
      // cache metadata for reveal lookups
      idMetaRef.current[song.id] = { name: song.name, artist: song.artist };
      if (typeof data.currentIndex === 'number') {
        currentIndexRef.current = data.currentIndex;
      }
      setTotalPlayedCount(prev => (typeof data.currentIndex === 'number' ? (data.currentIndex + 1) : prev + 1));
      setGameState(prev => ({
        ...prev,
        isPlaying: true,
        currentSong: song,
        snippetLength: Number(data.snippetLength) || prev.snippetLength,
        playedSongs: [...prev.playedSongs, song].slice(-25)
      }));
      // Track played order for reveal lag
      {
        // Record a stable per-song play sequence for sorting within columns
        if (playedSeqRef.current[song.id] === undefined) {
          playedSeqCounterRef.current = playedSeqCounterRef.current + 1;
          playedSeqRef.current[song.id] = playedSeqCounterRef.current;
        }
        // If we don't yet know the column for this id, attempt to derive it
        if (idToColumnRef.current[song.id] === undefined) {
          let derived: number | undefined = undefined;
          try {
            if (fiveBy15Columns && oneBy75IdsRef.current) {
              // Prefer explicit columns list
              for (let c = 0; c < fiveBy15Columns.length; c++) {
                if (fiveBy15Columns[c].includes(song.id)) { derived = c; break; }
              }
            }
            if (derived === undefined) {
              // As fallback use server-emitted map if present
              const mapCol = idToColumnRef.current[song.id];
              if (mapCol !== undefined) derived = mapCol;
            }
            if (derived === undefined && Array.isArray(oneBy75IdsRef.current)) {
              const idx = oneBy75IdsRef.current.indexOf(song.id);
              if (idx >= 0) derived = Math.floor(idx / 15);
            }
          } catch {}
          if (derived !== undefined && derived >= 0 && derived < 5) {
            idToColumnRef.current[song.id] = derived;
          } else {
            pendingPlacementRef.current.add(song.id);
          }
        }
        // Append only the current song id for this tick (actual playback order)
        if (!playedOrderRef.current.includes(song.id)) {
          playedOrderRef.current = [...playedOrderRef.current, song.id];
        }
        if (debugMode) {
          const col = idToColumnRef.current[song.id];
          try { console.log('[Display] song-playing', { index: currentIndexRef.current, id: song.id, col, name: song.name }); } catch {}
        }
        // Snap + freeze: if column now has >5 items, snap newest to bottom and freeze global scroll
        try {
          const colIdx = idToColumnRef.current[song.id];
          if (typeof colIdx === 'number' && fiveBy15Columns && rowHeightPx > 0) {
            const colList = fiveBy15Columns[colIdx] || [];
            const playedInCol = colList.filter(id => playedOrderRef.current.includes(id));
            if (playedInCol.length > 5) {
              const targetRows = playedInCol.length - 5;
              // Freeze only this column and snap its offset so the newest is at bottom
              setFrozenCols([0,1,2,3,4].map((_, i) => i === colIdx));
              setFreezeRows((prev) => prev.map((v, i) => (i === colIdx ? targetRows : v)));
            } else {
              // Unfreeze all if not yet over 5
              setFrozenCols([false,false,false,false,false]);
              setFreezeRows([0,0,0,0,0]);
            }
          }
        } catch {}
        // Set baseline when song starts so letters revealed before it started stay hidden on that song
        if (songBaselineRef.current[song.id] === undefined) {
          songBaselineRef.current[song.id] = revealSequenceRef.current.length;
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

    newSocket.on('game-started', (data: any) => {
      setGameState(prev => ({ ...prev, isPlaying: true }));
      // Hide splash when a game starts
      setShowSplash(false);
      if (data?.pattern) {
        setPattern(data.pattern);
        if (Array.isArray(data?.customMask)) {
          try { setCustomMask(new Set<string>(data.customMask as string[])); } catch {}
        } else {
          setCustomMask(new Set());
        }
        // Emit pattern to header
        window.dispatchEvent(new CustomEvent('display-pattern', { detail: { pattern: data.pattern } }));
      }
      // New round/game start: reset played/reveal sequencing so old entries don't leak
      playedOrderRef.current = [];
      revealSequenceRef.current = [];
      songBaselineRef.current = {};
      playedSeqRef.current = {} as any;
      playedSeqCounterRef.current = 0;
      ensureGrid();
    });

    newSocket.on('pattern-updated', (data: any) => {
      try {
        if (data?.pattern) setPattern(data.pattern);
        if (Array.isArray(data?.customMask)) {
          setCustomMask(new Set<string>(data.customMask as string[]));
        } else {
          setCustomMask(new Set());
        }
      } catch {}
    });

    // Handle bingo verification pending (someone called bingo, awaiting host verification)
    newSocket.on('bingo-verification-pending', (data: any) => {
      // Don't show winner banner yet, just acknowledge the call
      setIsVerificationPending(true);
      console.log(`${data.playerName} called BINGO - awaiting verification`);
    });

    // Handle confirmed bingo wins (after host verification)
    newSocket.on('bingo-called', (data: any) => {
      // Only show winner if this is a verified/confirmed bingo
      if (data.verified && !data.awaitingVerification) {
        setIsVerificationPending(false); // Clear verification pending state
        setGameState(prev => ({ ...prev, winners: data.winners || prev.winners }));
        try {
          if (data.playerName) {
            // Enhanced winner announcement
            const isFirstWinner = data.isFirstWinner;
            const totalWinners = data.totalWinners || 1;
            
            if (isFirstWinner) {
              setWinnerName(`🏆 BINGO! ${data.playerName} WINS!`);
            } else {
              setWinnerName(`🎉 Another BINGO! ${data.playerName} also wins! (${totalWinners} total)`);
            }
            
            setShowWinnerBanner(true);
            
            // Play celebration sound
            playPublicCelebrationSound();
            
            // Longer celebration for first winner, shorter for additional winners
            const celebrationTime = isFirstWinner ? 6000 : 4000;
            setTimeout(() => setShowWinnerBanner(false), celebrationTime);
          }
        } catch {}
      }
    });

    newSocket.on('mix-finalized', (payload: any) => {
      try {
        const names = Array.isArray(payload?.playlists) ? payload.playlists.map((p: any) => String(p?.name || '')) : [];
        setPlaylistNames(names);
      } catch {}
      ensureGrid();
    });

    newSocket.on('game-ended', () => {
      setGameState(prev => ({ ...prev, isPlaying: false }));
      setIsVerificationPending(false);
      console.log('🛑 Game ended (display)');
    });

    newSocket.on('game-resumed', () => {
      setIsVerificationPending(false);
      console.log('▶️ Game resumed (display)');
    });

    newSocket.on('game-restarted', (data: any) => {
      console.log('Game restarted:', data);
      // Reset display state
      setGameState({
        isPlaying: false,
        currentSong: null,
        playerCount: 0,
        winners: [],
        snippetLength: 30,
        playedSongs: [],
        bingoCard: { squares: [], size: 5 }
      });
      setShowWinnerBanner(false);
      setWinnerName('');
      
      // Show restart notification briefly
      setWinnerName('🔄 Game Restarted');
      setShowWinnerBanner(true);
      setTimeout(() => {
        setShowWinnerBanner(false);
        setWinnerName('');
      }, 3000);
    });

    newSocket.on('game-reset', () => {
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
      revealSequenceRef.current = [];
      songBaselineRef.current = {};
    });

    // Round update handler
    newSocket.on('round-updated', (data: any) => {
      console.log('🎯 PublicDisplay: Round updated:', data.roundInfo);
      if (data.roundInfo) {
        try {
          console.log('🧹 Resetting display for new round');
          
          // Update game state with new round info and minimal reset
          setGameState(prev => ({
            ...prev,
            currentRound: data.roundInfo,
            // Only reset essential game state
            isPlaying: false,
            currentSong: null,
            winners: [],
            playedSongs: []
            // Keep bingoCard structure intact to prevent render errors
          }));
          
          // Clear playlist names to remove old category headers
          setPlaylistNames([]);
          
          // Reset counters and UI state
          setTotalPlayedCount(0);
          setShowWinnerBanner(false);
          setWinnerName('');
          
          // Clear internal tracking refs
          playedOrderRef.current = [];
          idMetaRef.current = {};
          revealSequenceRef.current = [];
          songBaselineRef.current = {};
          pendingPlacementRef.current = new Set();
          playedSeqRef.current = {};
          playedSeqCounterRef.current = 0;
          currentIndexRef.current = -1;
          
          console.log('✅ Display reset for new round');
        } catch (error) {
          console.error('❌ Error resetting display for new round:', error);
          // Minimal fallback: just update the round info
          setGameState(prev => ({
            ...prev,
            currentRound: data.roundInfo,
            isPlaying: false
          }));
        }
      }
    });

    // Staged reveal event: show name/artist hints without changing the bingo grid
    newSocket.on('call-revealed', (payload: any) => {
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
      console.log('🖥️ PublicDisplay: Cleaning up socket connection');
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      newSocket.close();
    };
  }, [roomId]);

  // Time-based letter reveal every 10 seconds (weighted by unrevealed frequency across played songs)
  useEffect(() => {
    if (!gameState.isPlaying || isVerificationPending) return;
    const interval = setInterval(() => {
      try {
        const ids = playedOrderRef.current;
        if (!ids || ids.length === 0) return;
        const weights: Record<string, number> = {};
        for (let i = 0; i < ids.length; i++) {
          const pid = ids[i];
          const meta = idMetaRef.current[pid];
          if (!meta) continue;
          const baseline = songBaselineRef.current[pid] ?? 0;
          const visibleForSong = new Set(revealSequenceRef.current.slice(baseline));
          const textUpper = (`${meta.name || ''} ${meta.artist || ''}`).toUpperCase();
          for (let j = 0; j < textUpper.length; j++) {
            const ch = textUpper[j];
            if (!/^[A-Z0-9]$/.test(ch)) continue;
            if (!visibleForSong.has(ch)) {
              weights[ch] = (weights[ch] || 0) + 1;
            }
          }
        }
        const entries = Object.entries(weights);
        if (entries.length === 0) return;
        const total = entries.reduce((sum, [, w]) => sum + w, 0);
        let r = Math.random() * total;
        let revealedChar = entries[0][0];
        for (let k = 0; k < entries.length; k++) {
          const [ch, w] = entries[k];
          if (r < w) { revealedChar = ch; break; }
          r -= w;
        }
        revealSequenceRef.current.push(revealedChar);
        if (revealToastTimerRef.current) { clearTimeout(revealToastTimerRef.current); revealToastTimerRef.current = null; }
        setRevealToast(revealedChar);
        revealToastTimerRef.current = setTimeout(() => {
          setRevealToast(null);
          revealToastTimerRef.current = null;
        }, 3000);
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [gameState.isPlaying, isVerificationPending]);

  // Auto-advance the 15x5 grouped columns carousel
  useEffect(() => {
    const ids = oneBy75IdsRef.current;
    if (!ids) return;
    const interval = setInterval(() => {
      const effectivePlayed = Math.max(
        Math.max(0, (currentIndexRef.current ?? -1) + 1),
        playedOrderRef.current.length
      );
      const totalGroups = Math.ceil(Math.min(effectivePlayed, 75) / 5);
      if (totalGroups > visibleCols) {
        setCarouselIndex((prev) => {
          const next = prev + 1;
          if (next > totalGroups) {
            // seamless wrap: snap to 0 without animation; next tick resumes anim
            setAnimating(false);
            requestAnimationFrame(() => setAnimating(true));
            return 0;
          }
          return next;
        });
      } else {
        setCarouselIndex(0);
      }
    // Tick period = shift duration (~1s) + desired pause (5s) ⇒ 6000ms
    }, 6000);
    return () => clearInterval(interval);
  }, [oneBy75Ids, visibleCols]);

  // Measure viewport width for pixel-perfect slides (one column per step)
  useEffect(() => {
    const el = carouselViewportRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth || 0);
    update();
    window.addEventListener('resize', update);
    const RO: any = (window as any).ResizeObserver;
    const ro = RO ? new RO(update) : null;
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
    };
  }, [visibleCols]);

  // Measure per-column viewport height to derive row height (5 visible rows)
  useEffect(() => {
    const el = vertViewportRef.current;
    if (!el) return;
    const compute = () => {
      const h = el.clientHeight || 0;
      if (h > 0) setRowHeightPx((h / 5) * 0.95); // 5% slimmer to ensure 5 fit
    };
    compute();
    window.addEventListener('resize', compute);
    const RO2: any = (window as any).ResizeObserver;
    const ro = RO2 ? new RO2(compute) : null;
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', compute);
      if (ro) ro.disconnect();
    };
  }, [vertViewportRef.current]);

  // Global smooth phase driver (keeps columns aligned)
  useEffect(() => {
    const secondsPerRow = 6; // 1 row every 6s
    let last = performance.now();
    let running = true;
    const step = (now: number) => {
      if (!running) return;
      const dt = (now - last) / 1000;
      last = now;
      if (!freezeAll && rowHeightPx > 0) {
        const delta = (rowHeightPx / secondsPerRow) * dt;
        setPhasePx((p) => p + delta);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [rowHeightPx, freezeAll]);

  // Auto-advance vertical index for 5x15 (per column; show 5 at a time, scroll by 1)
  useEffect(() => {
    const ids = oneBy75IdsRef.current;
    if (!ids) return;
    // Only run when in 5x15 context
    if (!fiveBy15Columns) { setVertIndex(0); setVertIndices([0,0,0,0,0]); return; }
    // Use ONLY explicitly tracked played order to avoid phantom pool-seeded entries
    const played = new Set<string>(playedOrderRef.current);
    // Compute per-column max index
    const perColLengths = fiveBy15Columns.map(col => col.filter(id => played.has(id)).length);
    const perColMax = perColLengths.map(len => Math.max(0, len - 5));
    // Reset indices if no scrolling needed
    if (perColMax.every(m => m === 0)) { setVertIndex(0); setVertIndices([0,0,0,0,0]); return; }
    const interval = setInterval(() => {
      setVertIndices((prev) => {
        const next = [...prev];
        for (let i = 0; i < 5; i++) {
          const maxI = perColMax[i] || 0;
          if (maxI > 0) {
            const cur = (prev[i] || 0);
            next[i] = cur >= maxI ? 0 : (cur + 1);
          } else {
            next[i] = 0;
          }
        }
        return next;
      });
    }, 6000);
    return () => clearInterval(interval);
  }, [oneBy75Ids, totalPlayedCount, fiveBy15Columns]);

  // Fetch initial room info for display card
  useEffect(() => {
    const fetchRoom = async () => {
      if (!roomId) return;
      try {
        const res = await fetch(`${API_BASE || ''}/api/rooms/${roomId}`);
        if (res.ok) {
          const data = await res.json();
          setRoomInfo({ id: data.id, playerCount: data.playerCount });
        }
      } catch {}
    };
    fetchRoom();
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

  // Shared helper: render masked text with per-song reveal baseline and optional highlight
  const renderMaskedText = (text: string, set: Set<string>, highlightChar: string | null) => {
    if (!text) return null;
    const tokens = text.split(/(\s+)/); // keep whitespace tokens
    return (
      <span>
        {tokens.map((token, ti) => {
          // Preserve whitespace exactly
          if (/^\s+$/.test(token)) {
            return <span key={`ws-${ti}`}>{token}</span>;
          }
          const chars = Array.from(token);
          // Wrap each word in a no-wrap span so it never splits across lines
          return (
            <span key={`w-${ti}`} style={{ whiteSpace: 'nowrap', display: 'inline-block' }}>
              {chars.map((ch, ci) => {
                const u = ch.toUpperCase();
                if (/^[A-Z0-9]$/.test(u)) {
                  const revealed = set.has(u);
                  if (revealed) {
                    const isHighlight = !!highlightChar && u === highlightChar;
                    return (
                      <span key={`c-${ti}-${ci}`} style={isHighlight ? { color: '#f5d061', textShadow: '0 0 6px rgba(245,208,97,0.6)' } : undefined}>{ch}</span>
                    );
                  }
                  return (
                    <span
                      key={`c-${ti}-${ci}`}
                      style={{
                        display: 'inline-block',
                        width: '0.75em',
                        height: '1.0em',
                        border: '0.1em solid rgba(255,255,255,0.8)',
                        borderRadius: '0.14em',
                        verticalAlign: '-0.12em',
                        margin: '0 0.08em',
                        boxSizing: 'border-box',
                        background: 'rgba(255,255,255,0.12)'
                      }}
                    />
                  );
                }
                return <span key={`c-${ti}-${ci}`}>{ch}</span>;
              })}
            </span>
          );
        })}
      </span>
    );
  };

  // Function to get the overall pattern name
  const getPatternName = () => {
    switch (pattern) {
      case 'full_card':
        return 'Pattern: Full Card';
      case 'four_corners':
        return 'Pattern: Four Corners';
      case 'x':
        return 'Pattern: X';
      case 'custom':
        return 'Pattern: Custom';
      case 'line':
      default:
    return 'Pattern: Single Line (any direction)';
    }
  };

  // Function to check if a square is part of the current winning line
  const isWinningSquare = (row: number, col: number) => {
    if (pattern === 'full_card') {
      // For full card, all squares are winning squares
      return true;
    }
    if (pattern === 'custom' && customMask && customMask.size > 0) {
      return customMask.has(`${row}-${col}`);
    }
    
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

  // Cycle winning line only for single-line pattern
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (pattern !== 'line') return;
    intervalRef.current = setInterval(() => {
      setCurrentWinningLine((prev) => ((prev + 1) % 12));
    }, 800);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pattern]);

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
              animate={{ 
                opacity: 1, 
                scale: 1,
                ...(isWinningLine && pattern === 'full_card' && {
                  boxShadow: [
                    '0 0 0 rgba(0, 255, 136, 0.3)',
                    '0 0 20px rgba(0, 255, 136, 0.6)',
                    '0 0 0 rgba(0, 255, 136, 0.3)'
                  ]
                })
              }}
              transition={{ 
                duration: 0.3, 
                delay: (row + col) * 0.05,
                ...(isWinningLine && pattern === 'full_card' && {
                  boxShadow: {
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }
                })
              }}
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
    // In 5x15 mode, wait until columns arrive to avoid misplacement
    const requestedFiveByFifteen = (searchParams.get('mode') === '5x15') || !!fiveBy15Columns;
    if (requestedFiveByFifteen && !fiveBy15Columns) return (
      <div className="call-list-content"><div className="no-calls"><p>Initializing columns…</p></div></div>
    );
    if (!oneBy75Ids) return null;
    const played = new Set(playedOrderRef.current);
    // If we have explicit 5x15 columns, respect those per-column lists; otherwise derive from flat pool
    // Build base columns from authoritative map if available, else fallback
    let baseCols: string[][];
    if (fiveBy15Columns) {
      baseCols = fiveBy15Columns;
    } else if (idToColumnRef.current && Object.keys(idToColumnRef.current).length > 0) {
      const colsInit: string[][] = [[], [], [], [], []];
      for (const id of oneBy75Ids) {
        const col = idToColumnRef.current[id];
        if (col >= 0 && col < 5) colsInit[col].push(id);
      }
      baseCols = colsInit;
    } else {
      baseCols = [0,1,2,3,4].map(c => oneBy75Ids.slice(c*15, c*15 + 15));
    }
    // Build visible columns: filter by played and sort by per-song play sequence so new items append
    const cols = baseCols.map(col => col
      .filter(id => played.has(id))
      .sort((a, b) => {
        const sa = playedSeqRef.current[a] ?? Number.MAX_SAFE_INTEGER;
        const sb = playedSeqRef.current[b] ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        // fallback to original column order
        return col.indexOf(a) - col.indexOf(b);
      })
    );
    if (debugMode) {
      try {
        console.log('[Display] columns snapshot', {
          playedCount: playedOrderRef.current.length,
          perColCounts: cols.map(c => c.length)
        });
      } catch {}
    }
    // Helper: Wheel-of-Fortune style masking using per-song baseline
    const renderMaskedText = (text: string, set: Set<string>, highlightChar: string | null) => {
      if (!text) return null;
      const tokens = text.split(/(\s+)/);
      return (
        <span>
          {tokens.map((token, ti) => {
            if (/^\s+$/.test(token)) return <span key={`wsp-${ti}`}>{token}</span>;
            const chars = Array.from(token);
            return (
              <span key={`word-${ti}`} style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'baseline' }}>
                {chars.map((ch, ci) => {
                  const u = ch.toUpperCase();
                  if (/^[A-Z0-9]$/.test(u)) {
                    const revealed = set.has(u);
                    if (revealed) {
                      const isHighlight = !!highlightChar && u === highlightChar;
                      return <span key={`c-${ti}-${ci}`} style={isHighlight ? { color: '#f5d061', textShadow: '0 0 6px rgba(245,208,97,0.6)' } : undefined}>{ch}</span>;
                    }
                    return <span key={`c-${ti}-${ci}`} style={{ display: 'inline-block', width: '0.52em', height: '0.70em', border: '0.072em solid rgba(255,255,255,0.8)', borderRadius: '0.11em', verticalAlign: '-0.06em', margin: '0 0.05em', boxSizing: 'border-box', background: 'rgba(255,255,255,0.12)' }} />;
                  }
                  return <span key={`c-${ti}-${ci}`}>{ch}</span>;
                })}
              </span>
            );
          })}
        </span>
      );
    };
    return (
      <div className="call-list-content">
        <div className="call-columns-header" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          {[0,1,2,3,4].map((i) => {
            const raw = playlistNames[i] || '';
            const name = raw.replace(/^\s*GoT\s*[-–:]*\s*/i, '').trim();
            const bingoLetter = ['B', 'I', 'N', 'G', 'O'][i];
            
            // Calculate dynamic font size based on text length
            const fullText = name ? `${bingoLetter} - ${name}` : bingoLetter;
            const textLength = fullText.length;
            let fontSize = '2.4rem'; // Default size
            
            if (textLength > 30) {
              fontSize = '1.0rem';
            } else if (textLength > 25) {
              fontSize = '1.2rem';
            } else if (textLength > 22) {
              fontSize = '1.4rem';
            } else if (textLength > 18) {
              fontSize = '1.6rem';
            } else if (textLength > 15) {
              fontSize = '1.8rem';
            } else if (textLength > 12) {
              fontSize = '2.0rem';
            } else if (textLength > 8) {
              fontSize = '2.2rem';
            }
            
            return (
              <div key={i} className="call-col-title" style={{ textAlign: 'center' }}>
                {name ? (
                  <div style={{ 
                    fontSize, 
                    fontWeight: 900, 
                    opacity: 0.95, 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                    maxWidth: '100%'
                  }}>
                    <span style={{ color: '#00ff88', marginRight: '0.3em' }}>{bingoLetter}</span>
                    <span style={{ color: '#ffffff', margin: '0 0.2em' }}>-</span>
                    <span style={{ color: '#ffffff' }}>{name}</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '2.4rem', fontWeight: 900, opacity: 0.95, color: '#00ff88', textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
                    {bingoLetter}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="call-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, height: '100%' }}>
          {cols.map((col, ci) => (
            <div
              key={ci}
              className="call-col"
              style={{ position: 'relative', overflow: 'hidden', height: '100%' }}
              {...(ci === 0 ? { ref: vertViewportRef as any } : {})}
            >
              {(() => {
                const shouldScroll = col.length > 5 && rowHeightPx > 0;
                // Build display items duplicated for seamless wrap
                const displayItems = shouldScroll ? [...col, ...col] : col;
                // Determine how many rows we need to offset to ensure no gap
                let yPx = 0;
                if (shouldScroll) {
                  if (Array.isArray(frozenCols) && frozenCols[ci]) {
                    const rows = Math.max(0, (freezeRows?.[ci] || (col.length - 5)));
                    yPx = rows * rowHeightPx;
                  } else {
                    const loopPx = Math.max(1, col.length * rowHeightPx);
                    yPx = phasePx % loopPx;
                  }
                }
                return (
                  <div
                    className="call-vert-track"
                    style={{ position: 'absolute', left: 0, right: 0, top: 0, willChange: 'transform', transform: `translateY(${-yPx}px)` }}
                  >
                {displayItems.map((id, ri) => {
                  const poolIdx = Array.isArray(oneBy75Ids) ? oneBy75Ids.indexOf(id) : -1;
                  const meta = idMetaRef.current[id] || { name: '', artist: '' };
                  const isCurrent = gameState.currentSong?.id === id;
                  const baseline = songBaselineRef.current[id] ?? 0;
                  const revealedForThisSong = new Set(revealSequenceRef.current.slice(baseline));
                  const title = renderMaskedText(meta?.name || 'Unknown', revealedForThisSong, revealToast);
                  const artist = renderMaskedText(meta?.artist || '', revealedForThisSong, revealToast);
                  return (
                    <motion.div
                      key={id + '-' + ri}
                      className="call-item"
                      initial={false}
                      animate={{
                        backgroundColor: isCurrent ? 'rgba(0,255,136,0.12)' : 'rgba(255,255,255,0.05)',
                        boxShadow: isCurrent ? '0 0 16px rgba(0,255,136,0.35)' : 'none',
                        borderColor: isCurrent ? 'rgba(0,255,136,0.35)' : 'rgba(255,255,255,0.1)'
                      }}
                      transition={{ duration: 0.25 }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, height: rowHeightPx ? `${rowHeightPx}px` : undefined, overflow: 'hidden', background: 'rgba(255,255,255,0.08)', boxSizing: 'border-box' }}
                    >
                      {/* Numeric badge: play order index */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                        <div
                          className="call-number"
                          style={{
                            minWidth: 34,
                            height: 34,
                            borderRadius: 8,
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 900,
                            color: '#e6e6e6'
                          }}
                        >
                          {(() => {
                            const idx = playedOrderRef.current.indexOf(id);
                            return idx >= 0 ? (idx + 1) : '';
                          })()}
                        </div>
                        <div className="call-song-info" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <AnimatePresence mode="popLayout" initial={false}>
                          <motion.div
                            key={(meta?.name || '') + '-' + ri}
                            initial={{ opacity: 0, y: 6, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.98 }}
                            transition={{ duration: 0.25 }}
                            className="call-song-name"
                            style={{ fontWeight: 900, lineHeight: 1.12, fontSize: (() => { const rh = rowHeightPx || 0; const px = Math.round(rh * 0.50); return Math.min(48, Math.max(24, px)); })() + 'px', color: '#ffffff', textShadow: '0 2px 4px rgba(0,0,0,0.8)', whiteSpace: 'normal', wordBreak: 'keep-all', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          >
                            {title}
                          </motion.div>
                          <motion.div
                            key={(meta?.artist || '') + '-' + ri}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 0.85, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.25 }}
                            className="call-song-artist"
                            style={{ fontSize: (() => { const rh = rowHeightPx || 0; const px = Math.round(rh * 0.40); return Math.min(40, Math.max(18, px)); })() + 'px', color: '#e0e0e0', lineHeight: 1.14, fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.6)', whiteSpace: 'normal', wordBreak: 'keep-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          >
                            {artist}
                          </motion.div>
                          </AnimatePresence>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // New: 15 groups of 5, auto-scrolling horizontally with 3 columns visible
  const renderOneBy75GroupedColumns = () => {
    if (!oneBy75Ids) return null;
    const playedCount = Math.max(0, (currentIndexRef.current ?? -1) + 1);
    const played = new Set(oneBy75Ids.slice(0, playedCount));
    // Build 15 groups from the full pool, then filter to only played IDs within each group
    const groups: string[][] = Array.from({ length: 15 }, (_, g) => {
      const start = g * 5;
      const slice = oneBy75Ids.slice(start, start + 5);
      return slice.filter((id) => played.has(id));
    });
    const visibleGroups = groups.filter(g => g.length > 0);
    const total = visibleGroups.length;
    const shouldScroll = total > visibleCols;
    // Duplicate first N for smooth wrap
    const extendedGroups: string[][] = shouldScroll ? [...visibleGroups, ...visibleGroups.slice(0, visibleCols)] : visibleGroups;
    // Wheel-of-Fortune style: use the dynamically built revealed sequence
    const currentRevealed = new Set(revealSequenceRef.current);

    const maskByLetterSet = (text: string, set: Set<string>) => {
      if (!text) return '';
      const chars = Array.from(text);
      return chars.map((ch) => {
        const u = ch.toUpperCase();
        if (/^[A-Z0-9]$/.test(u)) {
          return set.has(u) ? ch : '•';
        }
        return ch;
      }).join('');
    };

    // Each column is 1/3 of the viewport width; compute translate as percentage
    const wrap = shouldScroll ? total : 1;
    const effectiveIndex = shouldScroll ? Math.min(carouselIndex, total) : 0;
    const colWidth = viewportWidth > 0 ? viewportWidth / visibleCols : 0;
    const xPx = -(effectiveIndex * colWidth);
    const xPercent = -(effectiveIndex * (100 / visibleCols));

    return (
      <div className="call-list-content">
        <div ref={carouselViewportRef} className="call-carousel-viewport" style={{ ['--carousel-visible-cols' as any]: String(visibleCols) }}>
          <motion.div
            className="call-carousel-track"
            animate={{ x: shouldScroll ? (colWidth > 0 ? xPx : xPercent + '%') : 0 }}
            transition={{ duration: animating && shouldScroll ? 1 : 0, ease: 'easeInOut' }}
          >
            {extendedGroups.map((group, gi) => (
              <div key={gi} className="call-carousel-col">
                <div className="call-carousel-col-inner">
                  {group.map((id) => {
                    const poolIdx = oneBy75Ids.indexOf(id);
                    const playedIdx = playedOrderRef.current.indexOf(id);
                    const meta = idMetaRef.current[id];
                    const isCurrent = gameState.currentSong?.id === id;
                    // Use baseline for that song so letters revealed before it started are not shown
                    const baseline = songBaselineRef.current[id] ?? 0;
                    // Show only letters revealed AFTER this song started
                    const revealedForThisSong = new Set(revealSequenceRef.current.slice(baseline));
                    const title = renderMaskedText(meta?.name || 'Unknown', revealedForThisSong, revealToast);
                    const artist = renderMaskedText(meta?.artist || '', revealedForThisSong, revealToast);
                    return (
                      <motion.div
                        key={id}
                        className="call-item"
                        initial={false}
                        animate={{
                          backgroundColor: isCurrent ? 'rgba(0,255,136,0.12)' : 'rgba(255,255,255,0.05)',
                          boxShadow: isCurrent ? '0 0 16px rgba(0,255,136,0.35)' : 'none',
                          borderColor: isCurrent ? 'rgba(0,255,136,0.35)' : 'rgba(255,255,255,0.1)'
                        }}
                        transition={{ duration: 0.25 }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 14px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, height: '100%', overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}
                      >
                        <div className="call-number" style={{ fontSize: '1.6rem', minWidth: 38, fontWeight: 900, lineHeight: 1 }}>{poolIdx + 1}</div>
                        <div className="call-song-info" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.div
                              key={(meta?.name || '')}
                              initial={{ opacity: 0, y: 6, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.98 }}
                              transition={{ duration: 0.25 }}
                              className="call-song-name"
                              style={{ fontWeight: 900, lineHeight: 1.25, fontSize: '3.2rem', color: '#ffffff', textShadow: '0 2px 6px rgba(0,0,0,0.8)', whiteSpace: 'normal', wordBreak: 'keep-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                            >
                              {title}
                            </motion.div>
                            <motion.div
                              key={(meta?.artist || '')}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 0.85, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.25 }}
                              className="call-song-artist"
                              style={{ fontSize: '2.2rem', color: '#e0e0e0', lineHeight: 1.14, fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.6)', whiteSpace: 'normal', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                            >
                              {artist}
                            </motion.div>
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    );
  };

  // If no room code is present, render a landing form to connect
  if (!roomId) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #1d1b3a 0%, #10283a 60%, #0b1e2d 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: 'min(92vw, 680px)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontWeight: 1000, fontSize: 'clamp(2.2rem, 6vw, 3.2rem)', marginBottom: 8, letterSpacing: '0.04em' }}>TEMPO – Public Display</div>
          <div style={{ opacity: 0.9, marginBottom: 18 }}>Enter a room code to connect the display</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <input
              value={connectCode}
              onChange={(e) => setConnectCode(e.target.value.toUpperCase())}
              placeholder="Room code"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const code = connectCode.trim();
                  if (code) navigate(`/display/${code}`);
                }
              }}
              style={{
                width: 'min(72vw, 360px)',
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(0,0,0,0.35)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)',
                fontWeight: 900,
                letterSpacing: '0.04em',
                textAlign: 'center'
              }}
            />
            <button
              className="btn-secondary"
              onClick={() => { const code = connectCode.trim(); if (code) navigate(`/display/${code}`); }}
              style={{ padding: '12px 16px', fontWeight: 900 }}
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={displayRef} className="public-display">

      <AnimatePresence>
        {showWinnerBanner && (
          <motion.div
            key="winner-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'fixed',
              top: 80,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'linear-gradient(180deg, rgba(0,255,136,0.25), rgba(0,255,136,0.1))',
              border: '1px solid rgba(0,255,136,0.5)',
              color: '#eafff5',
              padding: '12px 18px',
              borderRadius: 12,
              fontWeight: 900,
              letterSpacing: '0.03em',
              zIndex: 2200
            }}
          >
            🏆 Winner: {winnerName}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 2000,
              background: 'linear-gradient(135deg, #1d1b3a 0%, #10283a 60%, #0b1e2d 100%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: 40
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: 44 }}>
              <div
                style={{
                  fontSize: 'clamp(5rem, 11vw, 9rem)',
                  fontWeight: 1000,
                  letterSpacing: '0.05em',
                  backgroundImage: 'linear-gradient(90deg,#00ffa3 0%, #7bffd9 35%, #ffffff 50%, #7bffd9 65%, #00ffa3 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  textShadow: '0 10px 36px rgba(0,255,170,0.55), 0 0 28px rgba(0,255,170,0.3)',
                  display: 'none'
                }}
              >
                Tempo - Music Bingo
              </div>
              <div style={{ fontSize: 'clamp(1.8rem, 3.8vw, 2.6rem)', opacity: 0.98, marginTop: 18, display: 'none' }}>The game is on, the volume is up, the win is yours.</div>
              {/* TEMPO balls row with enhanced 3D floating animation (colored, angular motion) */}
              <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginTop: 16, perspective: '1200px', position: 'relative' }}>
                {['T','E','M','P','O'].map((ch, i) => {
                  const glow = ['rgba(0,255,163,0.45)','rgba(0,215,255,0.45)','rgba(158,123,255,0.45)','rgba(255,110,199,0.45)','rgba(255,209,102,0.45)'][i];
                  const rimInner = ['rgba(0,255,170,0.28)','rgba(0,215,255,0.28)','rgba(158,123,255,0.28)','rgba(255,110,199,0.28)','rgba(255,209,102,0.28)'][i];
                  const rimOuter = ['rgba(0,255,170,0.18)','rgba(0,215,255,0.18)','rgba(158,123,255,0.18)','rgba(255,110,199,0.18)','rgba(255,209,102,0.18)'][i];
                  const tintGradients = [
                    'radial-gradient(circle at 35% 30%, #f6fffb 10%, #b7f4df 55%, #6ee7c1 100%)', // mint (darker)
                    'radial-gradient(circle at 35% 30%, #f3faff 10%, #a6dcff 55%, #5ec7ff 100%)', // aqua (darker)
                    'radial-gradient(circle at 35% 30%, #f8f5ff 10%, #c5b6ff 55%, #957dff 100%)', // lavender (darker)
                    'radial-gradient(circle at 35% 30%, #fff4fa 10%, #ffb1cf 55%, #ff82b8 100%)', // pink (darker)
                    'radial-gradient(circle at 35% 30%, #fff3d2 10%, #ffcf6e 55%, #ffb020 100%)'  // gold (darker)
                  ];
                  // Per-ball motion parameters to desynchronize and add light randomness
                  const seed = ballAnimSeedsRef.current[i] || { dx:0,dy:0,rz:0,rx:0,ry:0,dur:4,delay:0,shadeDur:6,hiliteDur:6.5,hiliteDelay:0.1,sparkleDX:1,sparkleDY:-1,shadowAmp:4 };
                  const ampX = 6 + (i * 2) + seed.dx;
                  const ampY = 10 + ((i % 3) * 2) + seed.dy;
                  const rotX = 3 + i + seed.rx; // degrees
                  const rotY = 4 + ((i % 2) * 2) + seed.ry;
                  const rotZ = 1 + (i % 2) + seed.rz;
                  const dur = (3.6 + i * 0.45) + (seed.dur - 4);
                  const delay = (i * 0.18) + seed.delay;
                  const shadeDur = (5.5 + i * 0.5) + (seed.shadeDur - 6);
                  const highlightDur = (6.4 + i * 0.4) + (seed.hiliteDur - 6.5);
                  const highlightDelay = (0.1 + i * 0.22) + seed.hiliteDelay;
                  const sparkleDelay = (0.15 + i * 0.17) + seed.delay;
                  const shadowAmp = Math.round((ampX * 0.6) + seed.shadowAmp);
                  return (
                    <motion.div
                      key={i}
                      initial={{ y: 0, rotateZ: 0, rotateX: 0, rotateY: 0, scale: 1 }}
                      animate={{
                        x: [-ampX, ampX, -ampX],
                        y: [0, -ampY, 0],
                        rotateZ: [-rotZ, rotZ, -rotZ],
                        rotateX: [-rotX, rotX, -rotX],
                        rotateY: [-rotY, rotY, -rotY]
                      }}
                      transition={{ duration: dur, delay, repeat: Infinity, ease: 'easeInOut' }}
                      style={{
                        width: 256, height: 256, borderRadius: '50%', position: 'relative', transformStyle: 'preserve-3d',
                        background: (() => {
                          const base = tintGradients[i] || 'radial-gradient(circle at 35% 30%, #ffffff, #eef4fb 38%, #d2deea 62%, #b0c4d8 100%)';
                          const highlight = 'radial-gradient(120% 120% at 30% 28%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 18%, rgba(255,255,255,0.08) 40%, rgba(0,0,0,0) 42%)';
                          const shadow = 'radial-gradient(140% 140% at 72% 78%, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.6) 35%, rgba(0,0,0,0.0) 60%)';
                          const vignette = 'radial-gradient(100% 100% at 50% 50%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.06) 55%, rgba(0,0,0,0) 62%)';
                          return `${highlight}, ${shadow}, ${vignette}, ${base}`;
                        })(),
                        boxShadow: `0 28px 44px rgba(0,0,0,0.35), inset 0 -18px 24px rgba(0,0,0,0.22), inset 0 20px 26px rgba(255,255,255,0.55), 0 0 44px ${glow}`,
                        border: '1px solid rgba(0,0,0,0.06)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#102436', fontWeight: 1000, fontSize: '6rem'
                      }}
                    >
                      {/* colored glow rim */}
                      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `radial-gradient(circle, transparent 66%, ${rimInner} 85%, ${rimOuter} 100%)`, pointerEvents: 'none' }} />
                      {/* subtle rotating conic shade to simulate spherical turn */}
                      <motion.div
                        initial={{ rotate: -8, opacity: 0.32 }}
                        animate={{ rotate: [-8, 8, -8], opacity: [0.32, 0.26, 0.32] }}
                        transition={{ duration: shadeDur, delay, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ position: 'absolute', inset: 0, borderRadius: '50%', mixBlendMode: 'multiply', background: 'conic-gradient(from 0deg, rgba(0,0,0,0.10) 0deg, rgba(255,255,255,0.06) 90deg, rgba(0,0,0,0.18) 200deg, rgba(0,0,0,0.10) 360deg)' }}
                      />
                      {/* specular highlight */}
                      <motion.div
                        initial={{ x: '-20%', y: '0%', opacity: 0.8 }}
                        animate={{ x: ['-10%', '55%', '-10%'], y: ['2%', '-6%', '2%'], opacity: [0.85, 0.5, 0.85] }}
                        transition={{ duration: highlightDur, delay: highlightDelay, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ position: 'absolute', width: '30%', height: '30%', borderRadius: '50%', top: '12%', left: 0, background: 'radial-gradient(circle, rgba(255,255,255,0.95), rgba(255,255,255,0.1) 60%, transparent 70%)', filter: 'blur(1px)', mixBlendMode: 'screen', pointerEvents: 'none' }}
                      />
                      {/* secondary moving highlight for parallax */}
                      <motion.div
                        initial={{ x: '60%', y: '62%', opacity: 0.3 }}
                        animate={{ x: ['60%','40%','60%'], y: ['62%','58%','62%'], opacity: [0.3,0.22,0.3] }}
                        transition={{ duration: 5.2 + i * 0.35, delay: delay * 0.8, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ position: 'absolute', width: '18%', height: '18%', borderRadius: '50%', bottom: '12%', right: '12%', background: 'radial-gradient(circle, rgba(255,255,255,0.6), rgba(255,255,255,0.05) 60%, transparent 70%)', filter: 'blur(0.6px)', mixBlendMode: 'screen', pointerEvents: 'none' }}
                      />
                      {/* rim light */}
                      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 16px rgba(255,255,255,0.45)' }} />
                      {/* sparkle */}
                      <motion.div
                        initial={{ opacity: 0.0 }}
                        animate={{ opacity: [0.0, 0.9, 0.0], x: [0, 4, 0], y: [0, -3, 0] }}
                        transition={{ duration: 2.8 + i * 0.3, delay: sparkleDelay, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ position: 'absolute', top: '18%', right: '16%', width: 20, height: 20, borderRadius: '50%', background: 'radial-gradient(circle, #ffffff, rgba(255,255,255,0.1) 60%, transparent 70%)', filter: 'blur(0.5px)', pointerEvents: 'none' }}
                      />
                      {/* floating shadow */}
                      <motion.div
                        initial={{ opacity: 0.5, x: 0 }}
                        animate={{ opacity: [0.5, 0.35, 0.5], x: [-shadowAmp, shadowAmp, -shadowAmp] }}
                        transition={{ duration: dur, delay, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ position: 'absolute', bottom: -28, left: 28, right: 28, height: 28, borderRadius: 28, background: 'rgba(0,0,0,0.55)', filter: 'blur(12px)', zIndex: -1 }}
                      />
                      {ch}
                    </motion.div>
                  );
                })}
              </div>
              {/* Music Bingo subtitle and byline under hero TEMPO */}
              <div style={{
                marginTop: 18,
                fontSize: 'clamp(3.6rem, 9vw, 7rem)',
                fontWeight: 1000,
                letterSpacing: '0.02em',
                backgroundImage: 'linear-gradient(90deg,#7bffd9 0%, #ffffff 50%, #7bffd9 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textShadow: '0 6px 22px rgba(123,255,217,0.45), 0 0 16px rgba(255,255,255,0.18)'
              }}>Music Bingo</div>
              <div style={{ fontSize: 'clamp(2.2rem, 5vw, 3.6rem)', opacity: 0.96, marginTop: 12 }}>The game is on, the volume is up, the win is yours.</div>
              <motion.div
                initial={{ x: '-40%' }}
                animate={{ x: ['-40%', '140%'] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: 'linear' }}
                style={{ height: 3, width: '60%', margin: '12px auto 0', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)', borderRadius: 2, opacity: 0.8 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 56, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
              {roomId && (
                <div style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: 18,
                  padding: 26,
                  width: 'clamp(410px, 56vw, 720px)',
                  textAlign: 'center'
                }}>
                  <img
                    alt="Join QR"
                    style={{ width: '100%', aspectRatio: '1/1', objectFit: 'contain', borderRadius: 14, border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}
                    src={`${API_BASE || ''}/api/qr?size=800&data=${encodeURIComponent((typeof window !== 'undefined' ? window.location.origin : '') + '/player/' + roomId)}`}
                  />
                  <div style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.6rem)', fontWeight: 1000, marginTop: 16, opacity: 1 }}>Scan to Join</div>
                </div>
              )}
              <div style={{ minWidth: 260, textAlign: 'center' }}>
                <div style={{ fontSize: 'clamp(1.8rem, 3.6vw, 2.6rem)', opacity: 0.98 }}>Room</div>
                <div style={{ fontSize: 'clamp(5rem, 9vw, 7.2rem)', fontWeight: 1000, color: '#00ffb0', textShadow: '0 9px 36px rgba(0,255,170,0.7)' }}>{roomInfo?.id || roomId || '—'}</div>
                <div style={{ fontSize: 'clamp(1.8rem, 3.6vw, 2.6rem)', opacity: 0.98, marginTop: 24 }}>Go to</div>
                <div style={{ fontSize: 'clamp(2.6rem, 6vw, 4rem)', fontWeight: 1000, textShadow: '0 6px 24px rgba(0,0,0,0.35)' }}>tempo.liquidkourage.com</div>
                {/* Removed equalizer bars to reduce motion */}
                {/* Ticker removed per request */}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Subtle confetti when winner banner shows */}
      <AnimatePresence>
        {showWinnerBanner && (
          <motion.div
            key="confetti"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2100 }}
          >
            {Array.from({ length: 60 }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ x: Math.random() * window.innerWidth, y: -20, rotate: 0, opacity: 0.9 }}
                animate={{ y: window.innerHeight + 40, rotate: 360 * (Math.random() > 0.5 ? 1 : -1) }}
                transition={{ duration: 1.2 + Math.random() * 0.6, ease: 'easeIn' }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: 6,
                  height: 10,
                  borderRadius: 2,
                  background: ['#00ff88', '#7bffd9', '#fff', '#ffd166', '#ff6b6b'][i % 5],
                  transform: `translateX(${Math.random() * 100}px)`
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Main Content - 16:10 Layout */}
      <div className="display-content">
        <AnimatePresence>
          {revealToast && (
            <motion.div
              key={`toast-${revealToast}-${totalPlayedCount}`}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', color: '#00ff88', padding: '14px 18px', borderRadius: 12, fontWeight: 900, letterSpacing: '0.06em', fontSize: '2.0rem', boxShadow: '0 8px 28px rgba(0,0,0,0.5)', zIndex: 1000, border: '1px solid rgba(0,255,136,0.35)' }}
            >
              Revealed: {revealToast}
            </motion.div>
          )}
        </AnimatePresence>
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
              <div className="bingo-card-header center" style={{ justifyContent: 'center' }}>
                <Grid3X3 className="bingo-card-icon" />
                <h2 style={{ fontSize: '3.2rem', fontWeight: 900, textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}>{getPatternName()}</h2>
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
            {/* Under pattern: Info (room + stats) */}
            <div className="info-grid">
              <motion.div 
                className="quick-stats"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}
              >
                {/* Removed redundant INFO header */}
                
                {/* Room code and stats in same row */}
                <div style={{ display: 'flex', flexDirection: 'row', gap: 20, alignItems: 'center', justifyContent: 'space-around' }}>
                  {/* Room code */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.8rem', color: '#b3b3b3', textAlign: 'center' }}>Room Number:</div>
                    <div style={{ fontWeight: 900, fontSize: '3.2rem', color: '#00ff88', textAlign: 'center' }}>{roomInfo?.id || roomId}</div>
                </div>
                  
                  {/* Players */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Users className="stat-icon" />
                    <div>
                      <div style={{ fontSize: '2.8rem', fontWeight: 900 }}>{gameState.playerCount}</div>
                      <div style={{ fontSize: '1.8rem', color: '#b3b3b3' }}>Players</div>
                </div>
                </div>
                  
                  {/* Songs */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <List className="stat-icon" />
                    <div>
                      <div style={{ fontSize: '2.8rem', fontWeight: 900 }}>{totalPlayedCount}</div>
                      <div style={{ fontSize: '1.8rem', color: '#b3b3b3' }}>Songs</div>
                </div>
                      </div>
                      
                  {/* Round Info */}
                  {gameState.currentRound && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Crown className="stat-icon" />
                      <div>
                        <div style={{ fontSize: '2.8rem', fontWeight: 900 }}>{gameState.currentRound.number}</div>
                        <div style={{ fontSize: '1.8rem', color: '#b3b3b3' }}>Round</div>
                      </div>
                    </div>
                  )}
                      </div>
                {/* QR code below stats - fills remaining space */}
                {roomId && (
                  <div style={{ 
                    flex: 1,
                    textAlign: 'center', 
                    background: 'rgba(255,255,255,0.06)', 
                    border: '1px solid rgba(255,255,255,0.12)', 
                    borderRadius: 12, 
                    padding: 8, 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    minHeight: 0
                  }}>
                    <img
                      alt="Join QR"
                      style={{ 
                        width: '100%', 
                        height: 'calc(100% - 24px)', 
                        aspectRatio: '1 / 1', 
                        objectFit: 'contain', 
                        borderRadius: 8, 
                        border: '1px solid rgba(255,255,255,0.15)' 
                      }}
                      src={`${API_BASE || ''}/api/qr?size=800&data=${encodeURIComponent((typeof window !== 'undefined' ? window.location.origin : '') + '/player/' + roomId)}`}
                    />
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#ddd', lineHeight: 1 }}>Scan to join</div>
                </div>
                )}
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
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, minHeight: 0 }}>
              {/* Removed call count header and redundant BINGO row; playlist titles shown above columns */}
              {oneBy75Ids ? ((fiveBy15Columns || (searchParams.get('mode') === '5x15')) ? renderOneBy75Columns() : renderOneBy75GroupedColumns()) : (
                  <div className="call-list-content" style={{ height: '100%' }}>
                  {/* Column headers moved to App header to free vertical space */}
                    <div className="call-list" style={{ height: '100%' }}>
                      {totalPlayedCount > 0 && (
                    gameState.playedSongs.slice(-10).map((song, index) => (
                      <motion.div
                        key={song.id + '-' + index}
                        className="call-item"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, delay: 0.3 + index * 0.05 }}
                      >
                            <div className="call-number">#{Math.max(1, totalPlayedCount - (Math.min(10, gameState.playedSongs.length) - 1) + index)}</div>
                        <div className="call-song-info">
                          <div className="call-song-name">{song.name}</div>
                          <div className="call-song-artist">{song.artist}</div>
                        </div>
                        <Music className="call-icon" />
                      </motion.div>
                    ))
                  )}
                </div>
                    {totalPlayedCount === 0 && (
                  <div className="no-calls">
                    <p>No songs played yet</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicDisplay; 