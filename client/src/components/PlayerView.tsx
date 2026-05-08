import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useParams, useSearchParams } from 'react-router-dom';
import io from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { Music, Users } from 'lucide-react';
import { youtubeBingoSquareDisplay } from '../utils/youtubeTrackDisplay';
import {
  STANDARD_BINGO_POSITIONS,
  validateBingoCardGrid,
  type PatternCompositeSpec,
  normalizePatternComposite,
  evaluateCompositeVisual,
  evaluateCompositeStrict,
  unionCompositeHighlightPositions,
  normalizeLinesRequired,
  countCompletedLinesVisual,
  countCompletedLinesStrict,
  evaluateCustomPatternVisual,
  evaluateCustomPatternStrict,
  customMaskHighlightPositions,
} from '../patternDefinitions';

interface BingoSquare {
  position: string;
  songId: string;
  songName: string;
  customSongName?: string;
  artistName: string;
  marked: boolean;
  /** YouTube Music row — channel is not shown as artist; title split from video title. */
  youtubeMusic?: boolean;
  /** Server: center square pre-marked for classic bingo */
  isFreeSpace?: boolean;
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
  /** Combined AND/OR pattern from server when pattern === 'composite' */
  patternComposite?: PatternCompositeSpec | null;
  /** When pattern === 'line': distinct complete lines required (1–12). */
  linesRequired?: number;
  /** Custom pattern orientation (server / host). */
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
}

interface Song {
  id: string;
  name: string;
  artist: string;
}

interface VenueBranding {
  eventTitle?: string;
  sponsorLine?: string;
  footerText?: string;
  runbookUrl?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  defaultSnippetLength?: number;
  volumeCap?: number;
}

/** Match public display: trim optional "GoT" playlist prefix for column headers. */
function stripGotPlaylistPrefix(raw: string): string {
  return raw.replace(/^\s*GoT\s*[-–:]*\s*/i, '').trim();
}

/**
 * Canonical player UI (CSS px). Uniformly scaled to fit viewport — same layout on every device.
 */
/** Bingo grid must stay large in logical px — never repeat 120px “minimum” bug. */
const PlayerView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  /** false when joined with ?remote=1 — server treats as online-only for hybrid prize rules */
  const inPersonJoin = searchParams.get('remote') !== '1';
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
  const [hybridPrizeInPersonOnly, setHybridPrizeInPersonOnly] = useState(false);
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
  /** 5×15 mode: playlist name per column (from server `fiveby15-pool`). */
  const [bingoColumnPlaylistNames, setBingoColumnPlaylistNames] = useState<string[]>([]);
  const [venueBranding, setVenueBranding] = useState<VenueBranding | null>(null);

  /** User multiplier (70–150) on the automatic square text size (CSS: --player-card-font-scale). */
  const CARD_FONT_STORAGE_KEY = 'player_card_font_percent';
  const CARD_FONT_MIN = 70;
  const CARD_FONT_MAX = 150;
  const CARD_FONT_STEP = 5;

  const [cardFontPercent, setCardFontPercent] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(CARD_FONT_STORAGE_KEY);
      if (raw == null) return 100;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return 100;
      return Math.min(CARD_FONT_MAX, Math.max(CARD_FONT_MIN, n));
    } catch {
      return 100;
    }
  });

  const bumpCardFont = (delta: number) => {
    setCardFontPercent((prev) => {
      const next = Math.min(CARD_FONT_MAX, Math.max(CARD_FONT_MIN, prev + delta));
      try {
        localStorage.setItem(CARD_FONT_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  /** Extra bottom inset when browser UI (e.g. Safari toolbar) overlaps the layout viewport — not covered by safe-area alone. */
  const [visualBottomGapPx, setVisualBottomGapPx] = useState(0);

  /**
   * Real visible viewport height (px). 100dvh on iOS Safari is often larger than the visual viewport,
   * which oversized the card and clipped the bottom grid row. We drive --player-vh-budget from visualViewport.height.
   */
  const [visualViewportHeightPx, setVisualViewportHeightPx] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const vv = window.visualViewport;
    if (vv) return Math.round(vv.height * 10) / 10;
    return window.innerHeight;
  });

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      setVisualViewportHeightPx(Math.round(window.innerHeight * 10) / 10);
      return undefined;
    }

    /** Raw layout-vs-visual gap; on iOS Safari this is often ~0 even when the bottom bar covers content. */
    const RAW_GAP_NEAR_ZERO_PX = 8;
    /** Used when raw gap is unreliable — balance clearing Safari UI vs excess empty band */
    const IOS_MOBILE_SAFARI_FALLBACK_PX = 48;

    const isIosTouchDevice = (): boolean => {
      if (typeof navigator === 'undefined') return false;
      const ua = navigator.userAgent;
      return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    };

    const isHomeScreenPwa = (): boolean =>
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    const measure = () => {
      const v = window.visualViewport;
      if (!v) return;
      const innerH = window.innerHeight;
      const rawGap = Math.max(0, innerH - v.height - v.offsetTop);

      let applied = rawGap;
      if (rawGap < RAW_GAP_NEAR_ZERO_PX && isIosTouchDevice() && !isHomeScreenPwa()) {
        applied = Math.max(rawGap, IOS_MOBILE_SAFARI_FALLBACK_PX);
      }

      const vh = Math.round(v.height * 10) / 10;
      setVisualViewportHeightPx((prev) => (Math.abs(prev - vh) < 0.5 ? prev : vh));

      if (process.env.NODE_ENV === 'development') {
        console.debug('[PlayerView] visualViewport', {
          vvHeightPx: vh,
          rawGap,
          applied,
          usedFallback: applied > rawGap,
          innerH,
          vvOffsetTop: v.offsetTop,
        });
      }

      setVisualBottomGapPx((prev) => {
        const next = Math.round(applied * 10) / 10;
        return Math.abs(prev - next) < 0.5 ? prev : next;
      });
    };

    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
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
        newSocket.emit('join-room', { roomId, playerName, isHost: false, clientId, inPerson: inPersonJoin });
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

    newSocket.on('room-joined', (data: any) => {
      if (data?.venueBranding !== undefined) {
        setVenueBranding(data.venueBranding ?? null);
      }
    });

    newSocket.on('venue-branding', (data: any) => {
      if (data && 'venueBranding' in data) {
        setVenueBranding(data.venueBranding ?? null);
      }
    });

    newSocket.on('player-joined', (data: any) => {
      console.log('Player joined:', data);
      setGameState(prev => ({
        ...prev,
        playerCount: data.playerCount
      }));
    });

    newSocket.on('fiveby15-pool', (data: any) => {
      if (Array.isArray(data?.names) && data.names.length === 5) {
        setBingoColumnPlaylistNames(data.names);
      }
    });

    newSocket.on('game-started', (data: any) => {
      console.log('Game started:', data);
      setBingoColumnPlaylistNames([]);
      const lr =
        data?.pattern === 'line' && data?.linesRequired != null ? normalizeLinesRequired(data.linesRequired) : undefined;
      const cre =
        data?.pattern === 'custom'
          ? { rot: !!data.customMatchAllowRotation, mir: !!data.customMatchAllowMirror }
          : { rot: false, mir: false };
      setGameState((prev) => ({
        ...prev,
        isPlaying: true,
        pattern: data?.pattern || 'full_card',
        customPattern:
          data?.pattern === 'custom' && Array.isArray(data?.customMask) && data.customMask.length > 0
            ? data.customMask
            : undefined,
        patternComposite:
          data?.pattern === 'composite'
            ? normalizePatternComposite(data.patternComposite) ?? undefined
            : undefined,
        ...(lr !== undefined ? { linesRequired: lr } : {}),
        ...(data?.pattern === 'custom'
          ? {
              customMatchAllowRotation: cre.rot,
              customMatchAllowMirror: cre.mir,
            }
          : {
              customMatchAllowRotation: false,
              customMatchAllowMirror: false,
            }),
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
        if (payload?.venueBranding !== undefined) {
          setVenueBranding(payload.venueBranding ?? null);
        }
        if (typeof payload?.hybridInPersonPlusOnline === 'boolean') {
          setHybridPrizeInPersonOnly(payload.hybridInPersonPlusOnline);
        }
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
          const pat = typeof payload?.pattern === 'string' && payload.pattern.length > 0 ? payload.pattern : undefined;
          setGameState((prev) => {
            const effectivePat = pat || prev.pattern;
            const lr =
              effectivePat === 'line' && payload?.linesRequired != null
                ? normalizeLinesRequired(payload.linesRequired)
                : undefined;
            return {
              ...prev,
              isPlaying: true,
              pattern: effectivePat,
              playerCount: typeof payload?.playerCount === 'number' ? payload.playerCount : prev.playerCount,
              currentSong: payload?.currentSong || prev.currentSong,
              customPattern:
                effectivePat === 'custom' &&
                Array.isArray(payload?.customMask) &&
                payload.customMask.length > 0
                  ? payload.customMask
                  : effectivePat === 'custom'
                    ? prev.customPattern
                    : undefined,
              patternComposite:
                effectivePat === 'composite'
                  ? normalizePatternComposite(payload.patternComposite) ?? prev.patternComposite
                  : pat && pat !== 'composite'
                    ? undefined
                    : prev.patternComposite,
              ...(lr !== undefined ? { linesRequired: lr } : {}),
              ...(effectivePat === 'custom'
                ? {
                    customMatchAllowRotation: !!payload.customMatchAllowRotation,
                    customMatchAllowMirror: !!payload.customMatchAllowMirror,
                  }
                : {
                    customMatchAllowRotation: false,
                    customMatchAllowMirror: false,
                  }),
            };
          });
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
    newSocket.on('hybrid-mode-updated', (data: any) => {
      if (typeof data?.hybridInPersonPlusOnline === 'boolean') {
        setHybridPrizeInPersonOnly(data.hybridInPersonPlusOnline);
      }
    });

    newSocket.on('pattern-updated', (data: any) => {
      console.log('Pattern updated:', data);
      const p = typeof data?.pattern === 'string' && data.pattern.length > 0 ? data.pattern : undefined;
      setGameState((prev) => {
        const nextPat = p ?? prev.pattern;
        const lr =
          nextPat === 'line' && data?.linesRequired != null
            ? normalizeLinesRequired(data.linesRequired)
            : undefined;
        return {
          ...prev,
          pattern: nextPat,
          customPattern: Array.isArray(data?.customMask)
            ? data.customMask.length > 0
              ? data.customMask
              : undefined
            : p === 'custom'
              ? prev.customPattern
              : undefined,
          patternComposite:
            p === 'composite'
              ? normalizePatternComposite(data.patternComposite) ?? prev.patternComposite
              : p && p !== 'composite'
                ? undefined
                : prev.patternComposite,
          ...(lr !== undefined ? { linesRequired: lr } : {}),
          ...(nextPat === 'custom'
            ? {
                customMatchAllowRotation: !!data.customMatchAllowRotation,
                customMatchAllowMirror: !!data.customMatchAllowMirror,
              }
            : {
                customMatchAllowRotation: false,
                customMatchAllowMirror: false,
              }),
        };
      });
    });

    // Handle bingo validation result (for the caller)
    newSocket.on('bingo-result', (data: any) => {
      console.log('Bingo result:', data);
      if (data.success) {
        setBingoStatus('success');
        setBingoMessage(
          data.hybridUnofficial
            ? data.message || 'Pattern complete! (Online — round continues for in-person prize.)'
            : data.message || 'BINGO! You win!'
        );
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
        const msg = data.message || data.reason || 'Invalid bingo pattern';
        setBingoMessage(msg);
        if (data.rejected || data.superseded) {
          setGameState((prev) => ({ ...prev, hasBingo: false }));
        }
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
  }, [roomId, playerName, inPersonJoin]);

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
      try { socket.emit('join-room', { roomId, playerName, isHost: false, clientId, inPerson: inPersonJoin }); } catch {}
    }
  }, [socket, playerName, roomId, clientId, inPersonJoin]);

  const handleResync = () => {
    if (!socket) return;
    try {
      socket.emit('join-room', { roomId, playerName, isHost: false, clientId, inPerson: inPersonJoin });
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
    if (square.isFreeSpace || square.songId === '__FREE_SPACE__') return;

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
    const vis = youtubeBingoSquareDisplay(square);
    const title = vis.title;
    const artist = vis.artist;
    longPressTimer.current = window.setTimeout(() => {
      const free = square.isFreeSpace || square.songId === '__FREE_SPACE__';
      setLongPressTooltip({
        title: free ? 'Free space' : title,
        artist: free ? '' : artist,
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
  }, [
    bingoCard,
    gameState.pattern,
    gameState.customPattern,
    gameState.patternComposite,
    gameState.linesRequired,
    gameState.customMatchAllowRotation,
    gameState.customMatchAllowMirror,
  ]);

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
    
    // Full card / blackout — real 5×5 grid, then every cell marked (fail closed if card is truncated/duplicate)
    if (pattern === 'full_card' || pattern === 'blackout') {
      if (!validateBingoCardGrid(card)) return false;
      return STANDARD_BINGO_POSITIONS.every((pos) => {
        const square = card.squares.find((s) => s.position === pos);
        return square ? isSquareMarked(square) : false;
      });
    }

    if (pattern === 'composite' && gameState.patternComposite) {
      return evaluateCompositeVisual(card, gameState.patternComposite);
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
    
    // Line pattern — host sets how many complete lines are required
    if (pattern === 'line') {
      const need = normalizeLinesRequired(gameState.linesRequired ?? 1);
      return countCompletedLinesVisual(card) >= need;
    }

    // Custom pattern — optional rotations / mirrors when matching
    if (pattern === 'custom' && gameState.customPattern?.length) {
      return evaluateCustomPatternVisual(card, gameState.customPattern, {
        matchAllowRotation: gameState.customMatchAllowRotation,
        matchAllowMirror: gameState.customMatchAllowMirror,
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
    
    // Helper function to check if a marked square corresponds to a played song (or free space)
    const isMarkedSquareValid = (square: BingoSquare): boolean => {
      const isFree = !!(square.isFreeSpace || square.songId === '__FREE_SPACE__');
      const isValid = square.marked && (isFree || playedSongIds.includes(square.songId));
      if (square.marked && !isValid) {
        console.log('❌ Invalid mark:', square.position, square.songId, 'not in played list');
      }
      return isValid;
    };
    
    // Full card / blackout — grid integrity + every cell marked with a played song (matches server 0-0…4-4 loop)
    if (pattern === 'full_card' || pattern === 'blackout') {
      if (!validateBingoCardGrid(card)) return false;
      return STANDARD_BINGO_POSITIONS.every((pos) => {
        const square = card.squares.find((s) => s.position === pos);
        return square ? isMarkedSquareValid(square) : false;
      });
    }
    
    if (pattern === 'composite' && gameState.patternComposite) {
      return evaluateCompositeStrict(card, gameState.patternComposite, playedSongIds);
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
    
    // Line pattern — host sets how many complete lines are required (each with legit marks)
    if (pattern === 'line') {
      const need = normalizeLinesRequired(gameState.linesRequired ?? 1);
      return countCompletedLinesStrict(card, playedSongIds) >= need;
    }

    // Custom pattern with optional rotations / mirrors
    if (pattern === 'custom' && gameState.customPattern?.length) {
      return evaluateCustomPatternStrict(card, gameState.customPattern, playedSongIds, {
        matchAllowRotation: gameState.customMatchAllowRotation,
        matchAllowMirror: gameState.customMatchAllowMirror,
      });
    }

    // Default fallback
    return false;
  };

  // Helper function to determine if a square should be highlighted based on pattern
  const isPatternSquare = (position: string): boolean => {
    const pattern = gameState.pattern;

    if (pattern === 'composite' && gameState.patternComposite) {
      return unionCompositeHighlightPositions(gameState.patternComposite).includes(position);
    }

    // Any row, column, or diagonal can win - every cell can belong to some winning line.
    // Full card (blackout): every cell is required.
    if (pattern === 'line' || pattern === 'full_card' || pattern === 'blackout') {
      return true;
    }

    if (pattern === 'custom' && gameState.customPattern?.length) {
      return customMaskHighlightPositions(gameState.customPattern, {
        matchAllowRotation: gameState.customMatchAllowRotation,
        matchAllowMirror: gameState.customMatchAllowMirror,
      }).includes(position);
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

    return (
      <div className="bingo-card">
        <div className="bingo-column-headers" aria-hidden="true">
          {(['B', 'I', 'N', 'G', 'O'] as const).map((letter, colIdx) => {
            const raw = bingoColumnPlaylistNames[colIdx] || '';
            const playlistLabel = stripGotPlaylistPrefix(raw);
            return (
              <div key={letter} className="bingo-column-headers__cell">
                <span className="bingo-column-headers__letter">{letter}</span>
                {playlistLabel ? (
                  <span className="bingo-column-headers__playlist" title={playlistLabel}>
                    {playlistLabel}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="bingo-card-grid">
          {bingoCard.squares.map((square) => (
            <motion.div
              key={square.position}
              className={`bingo-square ${square.marked ? 'marked' : ''} ${isPatternSquare(square.position) ? 'pattern-highlight' : ''} ${square.isFreeSpace || square.songId === '__FREE_SPACE__' ? 'free-space' : ''}`}
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
                  {square.isFreeSpace || square.songId === '__FREE_SPACE__'
                    ? 'FREE'
                    : (() => {
                        const vis = youtubeBingoSquareDisplay(square);
                        return displayMode === 'title' ? vis.title : vis.artist;
                      })()}
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
    <div
      className={`player-container ${bingoCard ? 'has-card' : ''}${venueBranding ? ' player-container--venue' : ''}`}
      style={{
        '--player-card-font-scale': cardFontPercent / 100,
        '--player-visual-bottom-gap': `${visualBottomGapPx}px`,
        ...(visualViewportHeightPx > 0
          ? { '--player-vh-budget': `${visualViewportHeightPx}px` }
          : {}),
        ...(venueBranding?.primaryColor ? { '--venue-primary': venueBranding.primaryColor } : {}),
        ...(venueBranding?.accentColor ? { '--venue-accent': venueBranding.accentColor } : {}),
      } as React.CSSProperties}
    >
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
                  try { socket.emit('join-room', { roomId, playerName: name, isHost: false, clientId, inPerson: inPersonJoin }); } catch {}
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

      {/* 1) Card first: width-led square (CSS). 2) Chrome below — grouped in .player-main-column for vertical centering on tall viewports. */}
      <div className="player-main-column">
        {venueBranding &&
          (venueBranding.logoUrl || venueBranding.eventTitle || venueBranding.sponsorLine) && (
            <div className="player-venue-strip">
              {venueBranding.logoUrl ? (
                <img src={venueBranding.logoUrl} alt="" className="player-venue-logo" />
              ) : null}
              <div className="player-venue-titles">
                {venueBranding.eventTitle ? (
                  <div className="player-venue-event">{venueBranding.eventTitle}</div>
                ) : null}
                {venueBranding.sponsorLine ? (
                  <div className="player-venue-sponsor">{venueBranding.sponsorLine}</div>
                ) : null}
              </div>
            </div>
          )}
        <motion.div
          className="bingo-section player-bingo-stage"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.08 }}
        >
          <div className="bingo-section-measure">{renderBingoCard()}</div>
        </motion.div>

        <div className="player-rest">
        <div className="player-chrome">
          <motion.div
            className="player-header"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="player-header-bar">
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
            <div className="player-header-bingo-row">
              <div className="player-header-bingo-slot">
                <button
                  type="button"
                  className={`bingo-fab bingo-fab--canvas bingo-fab--chrome ${bingoHolding ? 'holding' : ''} ${hasValidBingo ? 'ready' : 'disabled'}`}
                  aria-label={hasValidBingo ? 'Hold to call BINGO' : 'Complete a winning pattern, then hold to call BINGO'}
                  onPointerDown={startBingoHold}
                  onPointerUp={cancelBingoHold}
                  onPointerCancel={cancelBingoHold}
                  onTouchStart={(e) => { e.preventDefault(); startBingoHold(); }}
                  onTouchEnd={(e) => { e.preventDefault(); cancelBingoHold(); }}
                  onTouchCancel={(e) => { e.preventDefault(); cancelBingoHold(); }}
                  onContextMenu={(e) => { e.preventDefault(); return false; }}
                  onMouseDown={(e) => { e.preventDefault(); }}
                  title={hasValidBingo ? 'Hold to call BINGO' : 'Complete a winning pattern to call BINGO'}
                  style={{
                    zIndex: 2,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    touchAction: 'none',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 'inherit',
                      border: '2px solid rgba(255,255,255,0.12)',
                      pointerEvents: 'none',
                    }}
                  />
                  <span
                    className="bingo-fab-hold-track"
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 6,
                      borderRadius: '0 0 999px 999px',
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      background: 'rgba(0,0,0,0.25)',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        width: `${Math.max(0, holdProgress) * 100}%`,
                        background: 'linear-gradient(90deg, #0b3, #1aff8c)',
                        borderRadius: '0 2px 0 0',
                      }}
                    />
                  </span>
                  <span
                    className="bingo-fab-label"
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      MozUserSelect: 'none',
                      msUserSelect: 'none',
                      pointerEvents: 'none',
                    }}
                  >
                    Hold to call BINGO
                  </span>
                </button>
              </div>
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
              <span className="player-controls-label">Text scale</span>
              <div className="player-controls-slot player-font-size-controls">
                <button
                  type="button"
                  className="player-font-btn"
                  onClick={() => bumpCardFont(-CARD_FONT_STEP)}
                  disabled={cardFontPercent <= CARD_FONT_MIN}
                  aria-label="Decrease text scale"
                  title="Smaller"
                >
                  −
                </button>
                <span
                  className="font-size-readout"
                  title="Relative to the automatic size for this bingo card (70–150%)"
                  aria-label={`Text scale ${cardFontPercent} percent`}
                >
                  {cardFontPercent}%
                </span>
                <button
                  type="button"
                  className="player-font-btn"
                  onClick={() => bumpCardFont(CARD_FONT_STEP)}
                  disabled={cardFontPercent >= CARD_FONT_MAX}
                  aria-label="Increase text scale"
                  title="Larger"
                >
                  +
                </button>
              </div>
            </div>
          </motion.div>

          {hybridPrizeInPersonOnly && !inPersonJoin && (
            <div
              className="player-hybrid-hint"
              style={{
                margin: '0 auto 10px',
                maxWidth: 520,
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: '0.82rem',
                lineHeight: 1.45,
                color: 'rgba(230,240,255,0.92)',
                background: 'rgba(0, 180, 255, 0.12)',
                border: '1px solid rgba(0, 200, 255, 0.35)',
                textAlign: 'center',
              }}
            >
              <strong>Online player:</strong> you can play along; when the host enables hybrid mode, the prize and round only finish when an <strong>in-person</strong> player wins.
            </div>
          )}

          {connectionToast && (
            <motion.div
              className="player-connection-toast"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              style={{
                background: connectionToast.includes('missed')
                  ? 'linear-gradient(135deg, #ffaa00, #ff8800)'
                  : connectionToast.includes('Reconnected')
                    ? 'linear-gradient(135deg, #00ff88, #00cc6d)'
                    : 'rgba(255,255,255,0.15)',
              }}
            >
              {connectionToast}
            </motion.div>
          )}

          {venueBranding?.footerText ? (
            <footer className="player-venue-footer">{venueBranding.footerText}</footer>
          ) : null}
          {venueBranding?.runbookUrl ? (
            <a
              href={venueBranding.runbookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="player-venue-runbook"
            >
              Event runbook
            </a>
          ) : null}
        </div>

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

        {longPressTooltip && (
          <div className="player-longpress-tooltip" role="status" aria-live="polite">
            <div className="player-longpress-tooltip-heading">Title</div>
            <div className="player-longpress-tooltip-line player-longpress-tooltip-primary">{longPressTooltip.title}</div>
            <div className="player-longpress-tooltip-heading">Artist</div>
            <div className="player-longpress-tooltip-line">{longPressTooltip.artist}</div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default PlayerView; 