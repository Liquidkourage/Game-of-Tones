import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useParams, useSearchParams } from 'react-router-dom';
import io from 'socket.io-client';
import { SOCKET_URL } from '../config';
import {
  fetchPlayerSession,
  getPlayerJwt,
  playerLogout,
  updatePlayerDisplayName,
  type PlayerAccountUser,
  type PlayerRoundHistory,
  type PlayerStats,
} from '../utils/playerFetch';
import PlayerAccountGate from './PlayerAccountGate';
import { youtubeBingoSquareDisplay } from '../utils/youtubeTrackDisplay';
import { patchSquaresWithAlias, patchSquaresClearAlias } from '../utils/songAliasDisplay';
import { softHyphenateLongWords, stripSoftHyphens } from '../utils/softHyphenateLongWords';
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

/** Narrow phones / fold cover: title-only cells; artist via long-press. */
const PLAYER_COMPACT_VIEWPORT_PX = 400;
/** Default text scale on first visit when no saved preference (narrow vs desktop). */
const CARD_FONT_DEFAULT_NARROW = 90;
const CARD_FONT_DEFAULT_WIDE = 100;

interface BingoSquare {
  position: string;
  songId: string;
  songName: string;
  customSongName?: string;
  customArtistName?: string;
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

function formatPlayerRoundDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown date';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Unknown date';
  }
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
    const fromUrl = searchParams.get('name') || '';
    return fromUrl.trim() || fromStorage.trim();
  });
  const [joinReady, setJoinReady] = useState(false);
  const [playerAccount, setPlayerAccount] = useState<PlayerAccountUser | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [playerRecentRounds, setPlayerRecentRounds] = useState<PlayerRoundHistory[]>([]);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [displayNameBusy, setDisplayNameBusy] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
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
  const hoverTooltipTimer = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const cardGridRef = useRef<HTMLDivElement | null>(null);
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
  const [optionsOpen, setOptionsOpen] = useState(false);
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
  /** 1×75 mode: stem playlist title(s) from server `oneby75-pool`. */
  const [oneBy75PlaylistNames, setOneBy75PlaylistNames] = useState<string[]>([]);
  const bingoHoldPointerIdRef = useRef<number | null>(null);
  const bingoHoldSubmittedRef = useRef(false);
  const [venueBranding, setVenueBranding] = useState<VenueBranding | null>(null);
  /** Five column letters for card headers (host pref: BINGO, TEMPO, TONES, …). */
  const [bingoColumnLetters, setBingoColumnLetters] = useState<string>('BINGO');
  const [cardTextFitReady, setCardTextFitReady] = useState(false);

  /** User multiplier (70–150) on the automatic square text size (CSS: --player-card-font-scale). */
  const CARD_FONT_STORAGE_KEY = 'player_card_font_percent';
  const CARD_FONT_MIN = 70;
  const CARD_FONT_MAX = 150;
  const CARD_FONT_STEP = 5;

  const [cardFontPercent, setCardFontPercent] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(CARD_FONT_STORAGE_KEY);
      if (raw == null) {
        if (typeof window !== 'undefined' && window.innerWidth <= PLAYER_COMPACT_VIEWPORT_PX) {
          return CARD_FONT_DEFAULT_NARROW;
        }
        return CARD_FONT_DEFAULT_WIDE;
      }
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return CARD_FONT_DEFAULT_WIDE;
      return Math.min(CARD_FONT_MAX, Math.max(CARD_FONT_MIN, n));
    } catch {
      return CARD_FONT_DEFAULT_WIDE;
    }
  });

  const bumpCardFont = (delta: number) => {
    setCardFontPercent((prev) => {
      const current = Number(prev);
      const safe = Number.isFinite(current) ? current : CARD_FONT_DEFAULT_WIDE;
      const next = Math.min(CARD_FONT_MAX, Math.max(CARD_FONT_MIN, safe + delta));
      try {
        localStorage.setItem(CARD_FONT_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  type PlayerCardTheme = 'dark' | 'light';
  const CARD_THEME_STORAGE_KEY = 'player_card_theme';

  const [cardTheme, setCardTheme] = useState<PlayerCardTheme>(() => {
    try {
      const stored = localStorage.getItem(CARD_THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  });

  const chooseCardTheme = (theme: PlayerCardTheme) => {
    setCardTheme(theme);
    try {
      localStorage.setItem(CARD_THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
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

  const [appHeaderHeightPx, setAppHeaderHeightPx] = useState(44);

  const [compactCardCells, setCompactCardCells] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= PLAYER_COMPACT_VIEWPORT_PX;
  });

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      setVisualViewportHeightPx(Math.round(window.innerHeight * 10) / 10);
      setCompactCardCells(window.innerWidth <= PLAYER_COMPACT_VIEWPORT_PX);
      const headerEl = document.querySelector<HTMLElement>('.app-header');
      const headerH = headerEl ? Math.ceil(headerEl.getBoundingClientRect().height) : 44;
      setAppHeaderHeightPx(headerH);
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

      const layoutWidth = Math.round(v.width * 10) / 10;
      const compact = layoutWidth <= PLAYER_COMPACT_VIEWPORT_PX;
      setCompactCardCells((prev) => (prev === compact ? prev : compact));

      const headerEl = document.querySelector<HTMLElement>('.app-header');
      const headerH = headerEl ? Math.ceil(headerEl.getBoundingClientRect().height) : 44;
      setAppHeaderHeightPx((prev) => (prev === headerH ? prev : headerH));
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

  const normalizeCardFreeSpaces = (card: BingoCard | null): BingoCard | null => {
    if (!card) return card;
    return {
      ...card,
      squares: card.squares.map((square) =>
        square.isFreeSpace || square.songId === '__FREE_SPACE__'
          ? { ...square, marked: true, isFreeSpace: true }
          : square,
      ),
    };
  };

  const persistMarks = (card: BingoCard | null) => {
    const normalizedCard = normalizeCardFreeSpaces(card);
    if (!normalizedCard) {
      try {
        localStorage.removeItem(`player_marks_${roomId}`);
      } catch {}
      return;
    }
    try {
      const marks: Record<string, boolean> = {};
      normalizedCard.squares.forEach(square => {
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
    const normalizedCard = normalizeCardFreeSpaces(card);
    if (!normalizedCard) return normalizedCard;
    const storedMarks = getStoredMarks();
    if (Object.keys(storedMarks).length === 0) return normalizedCard;
    
    const updatedSquares = normalizedCard.squares.map(square => ({
      ...square,
      marked:
        square.isFreeSpace ||
        square.songId === '__FREE_SPACE__' ||
        storedMarks[square.position] === true ||
        square.marked
    }));
    return { ...normalizedCard, squares: updatedSquares };
  };

  const countUniqueSongs = (card: BingoCard): number => {
    if (!card || !card.squares) return 0;
    const uniqueSongIds = new Set(card.squares.map(square => square.songId));
    return uniqueSongIds.size;
  };

  useEffect(() => {
    let cancelled = false;
    fetchPlayerSession().then((session) => {
      if (cancelled || !session.user) return;
      setPlayerAccount(session.user);
      setPlayerStats(session.stats);
      setPlayerRecentRounds(session.recentRounds);
      setPlayerName(session.user.displayName);
      try {
        localStorage.setItem('player_name', session.user.displayName);
      } catch {
        /* ignore */
      }
      setJoinReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (playerAccount) setDisplayNameDraft(playerAccount.displayName);
  }, [playerAccount?.id, playerAccount?.displayName]);

  useEffect(() => {
    if (!optionsOpen || !playerAccount) return;
    let cancelled = false;
    void fetchPlayerSession().then((session) => {
      if (cancelled || !session.user) return;
      setPlayerStats(session.stats);
      setPlayerRecentRounds(session.recentRounds);
    });
    return () => {
      cancelled = true;
    };
  }, [optionsOpen, playerAccount?.id]);

  const buildJoinPayload = (name: string) => ({
    roomId,
    playerName: name,
    isHost: false,
    clientId,
    inPerson: inPersonJoin,
    playerPreferences: { cardFontPercent, cardTheme },
    playerToken: getPlayerJwt() || '',
  });

  const finishGuestOrAccountJoin = (
    name: string,
    account?: PlayerAccountUser | null,
    stats?: PlayerStats | null,
    recentRounds?: PlayerRoundHistory[],
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem('player_name', trimmed);
    } catch {
      /* ignore */
    }
    setPlayerName(trimmed);
    if (account) setPlayerAccount(account);
    if (stats !== undefined) setPlayerStats(stats);
    if (recentRounds !== undefined) setPlayerRecentRounds(recentRounds);
    setJoinReady(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('name', trimmed);
      window.history.replaceState({}, '', url.toString());
    } catch {
      /* ignore */
    }
  };

  const saveDisplayName = async () => {
    const trimmed = displayNameDraft.trim();
    if (!trimmed || !playerAccount) return;
    if (trimmed === playerAccount.displayName) return;
    setDisplayNameBusy(true);
    setDisplayNameError(null);
    try {
      const { user } = await updatePlayerDisplayName(trimmed);
      setPlayerAccount(user);
      setDisplayNameDraft(user.displayName);
      finishGuestOrAccountJoin(user.displayName, user, playerStats, playerRecentRounds);
      if (socket && socket.connected) {
        try {
          socket.emit('join-room', buildJoinPayload(user.displayName));
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setDisplayNameError(e instanceof Error ? e.message : String(e));
    } finally {
      setDisplayNameBusy(false);
    }
  };

  useEffect(() => {
    const playerJwt = getPlayerJwt();
    const newSocket = io(SOCKET_URL || undefined, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      auth: playerJwt ? { playerToken: playerJwt } : {},
    });
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnectionStatus('connected');
      setReconnectAttempts(0);
      // Join only if we have a name; otherwise wait for user input
      if (joinReady && playerName && playerName.trim()) {
        newSocket.emit('join-room', buildJoinPayload(playerName.trim()));
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

    newSocket.on('bingo-column-letters-updated', (data: any) => {
      if (typeof data?.letters === 'string' && data.letters.length === 5) {
        setBingoColumnLetters(data.letters.toUpperCase());
      }
    });

    newSocket.on('fiveby15-pool', (data: any) => {
      if (Array.isArray(data?.names) && data.names.length === 5) {
        setBingoColumnPlaylistNames(data.names);
        setOneBy75PlaylistNames([]);
      }
    });

    newSocket.on('oneby75-pool', (data: any) => {
      if (Array.isArray(data?.names) && data.names.length > 0) {
        setOneBy75PlaylistNames(data.names.map((n: unknown) => String(n || '')));
        setBingoColumnPlaylistNames([]);
      }
    });

    newSocket.on('game-started', (data: any) => {
      console.log('Game started:', data);
      setBingoColumnPlaylistNames([]);
      setOneBy75PlaylistNames([]);
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
        if (typeof payload?.bingoColumnLetters === 'string' && payload.bingoColumnLetters.length === 5) {
          setBingoColumnLetters(payload.bingoColumnLetters.toUpperCase());
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

    newSocket.on('song-alias-updated', (data: { songId: string; title: string; artist: string }) => {
      if (!data?.songId) return;
      setBingoCard((prev) => {
        if (!prev?.squares) return prev;
        return {
          ...prev,
          squares: patchSquaresWithAlias(prev.squares, data.songId, data.title, data.artist),
        };
      });
    });

    newSocket.on('song-alias-cleared', (data: { songId: string }) => {
      if (!data?.songId) return;
      setBingoCard((prev) => {
        if (!prev?.squares) return prev;
        return {
          ...prev,
          squares: patchSquaresClearAlias(prev.squares, data.songId),
        };
      });
    });

    newSocket.on('song-playing', (data: any) => {
      console.log('Song playing:', data);
      const displayArtist =
        typeof data.customArtistName === 'string' && data.customArtistName.trim() !== ''
          ? data.customArtistName.trim()
          : data.artistName;
      const displayName =
        typeof data.customSongName === 'string' && data.customSongName.trim() !== ''
          ? data.customSongName.trim()
          : data.songName;
      setGameState(prev => ({
        ...prev,
        currentSong: {
          id: data.songId,
          name: displayName,
          artist: displayArtist
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
          const normalizedCleanCard = normalizeCardFreeSpaces(cleanCard);
          persistMarks(normalizedCleanCard); // Persist blank marks (+ free space)
          return normalizedCleanCard;
        }
        
        // Same card structure - preserve marks from previous card, then apply stored marks
        const mergedSquares = data.squares.map((newSquare: any) => {
          const oldSquare = prev.squares.find((s: any) => s.position === newSquare.position);
          return {
            ...newSquare,
            marked:
              newSquare.isFreeSpace ||
              newSquare.songId === '__FREE_SPACE__' ||
              oldSquare?.marked ||
              false // Preserve mark state from previous card
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
    if (socket && socket.connected && joinReady && playerName && playerName.trim()) {
      try {
        socket.emit('join-room', buildJoinPayload(playerName.trim()));
      } catch {}
    }
  }, [socket, joinReady, playerName, roomId, clientId, inPersonJoin, cardFontPercent, cardTheme]);

  useEffect(() => {
    if (!optionsOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOptionsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [optionsOpen]);

  const cardTextFitSignature = useMemo(() => {
    if (!bingoCard) return '';
    const eventTitle = venueBranding?.eventTitle?.trim() || 'Free space';
    return bingoCard.squares
      .map((square) => {
        const free = square.isFreeSpace || square.songId === '__FREE_SPACE__';
        const vis = youtubeBingoSquareDisplay(square);
        const title = free ? 'FREE' : vis.title;
        const artist = free ? eventTitle : vis.artist;
        return `${square.position}:${title}|${artist}`;
      })
      .join('\n');
  }, [bingoCard?.squares, venueBranding?.eventTitle]);

  useLayoutEffect(() => {
    setCardTextFitReady(false);
  }, [cardTextFitSignature]);

  useLayoutEffect(() => {
    if (!bingoCard || !cardGridRef.current) {
      setCardTextFitReady(false);
      return undefined;
    }

    const gridEl = cardGridRef.current;
    let frame = 0;
    let cancelled = false;
    let fitGeneration = 0;
    let measuring = false;
    let pendingRefit = false;

    /** Title leads. Artist uses its own scale (not × titleScale); hierarchy enforced after fit. */
    const titleOnlyCells = compactCardCells;
    const TITLE_SCALE_MAX = titleOnlyCells ? 1.08 : 1.16;
    const TITLE_SCALE_PREFERRED_MIN = titleOnlyCells ? 0.7 : 0.88;
    const TITLE_SCALE_ABSOLUTE_MIN = titleOnlyCells ? 0.5 : 0.64;
    const ARTIST_PROBE_SCALE = 0.9;
    const ARTIST_SCALE_MIN = titleOnlyCells ? 0.78 : 0.84;
    const ARTIST_SCALE_MAX = 1;
    const ARTIST_SCALE_FLOOR = titleOnlyCells ? 0.8 : 0.86;
    const ARTIST_MAX_TITLE_RATIO = 0.76;

    const getLineCount = (el: HTMLElement) => {
      const computed = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(computed.lineHeight || '0');
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 1;
      return Math.max(1, Math.round(el.getBoundingClientRect().height / lineHeight));
    };
    const getWordCount = (text: string) => {
      const normalized = text.trim();
      return normalized ? normalized.split(/\s+/).length : 0;
    };
    const getLongestWordLength = (text: string) => {
      const words: string[] = text.match(/[A-Za-z]+/g) ?? [];
      return words.reduce((max: number, word: string) => Math.max(max, word.length), 0);
    };
    const derivePreferredTitleMaxLines = (text: string) => {
      const charCount = text.length;
      const wordCount = getWordCount(text);
      const longestWord = getLongestWordLength(text);
      if (titleOnlyCells) {
        if (wordCount <= 2 && charCount <= 14 && longestWord < 8) return 2;
        if (wordCount >= 5 || charCount >= 28 || longestWord >= 11) return 4;
        return 3;
      }
      if (wordCount <= 2 && charCount <= 14 && longestWord < 8) return 2;
      if (wordCount >= 5 || charCount >= 24 || longestWord >= 11) return 4;
      return 3;
    };
    const derivePreferredArtistMaxLines = (text: string) => {
      if (titleOnlyCells || !text.trim()) return 0;
      const charCount = text.length;
      const wordCount = getWordCount(text);
      const longestWord = getLongestWordLength(text);
      if (wordCount <= 2 && charCount <= 16 && longestWord < 10) return 1;
      return 2;
    };

    const fitCardText = () => {
      if (measuring) {
        pendingRefit = true;
        return;
      }
      const gen = ++fitGeneration;
      const squareEls = Array.from(gridEl.querySelectorAll<HTMLElement>('.bingo-square'));
      if (squareEls.length === 0) {
        if (!cancelled) setCardTextFitReady(true);
        return;
      }

      // Measure at 100% user scale — cardFontPercent stays React-owned (no save/restore on the CSS var).
      const playerContainer = gridEl.closest<HTMLElement>('.player-container');
      measuring = true;
      if (playerContainer) {
        playerContainer.setAttribute('data-fit-measuring', '1');
        void playerContainer.offsetHeight;
      }

      type SquareCtx = {
        el: HTMLElement;
        contentEl: HTMLElement;
        titleEl: HTMLElement;
        artistEl: HTMLElement;
        titleMaxLines: number;
        artistMaxLines: number;
      };

      const contexts: SquareCtx[] = [];
      for (const squareEl of squareEls) {
        const contentEl = squareEl.querySelector<HTMLElement>('.square-content');
        const titleEl = squareEl.querySelector<HTMLElement>('.player-square-title');
        const artistEl = squareEl.querySelector<HTMLElement>('.player-square-artist');
        if (!contentEl || !titleEl || !artistEl) continue;
        const titleText = stripSoftHyphens(titleEl.textContent || '').trim();
        const artistText = stripSoftHyphens(artistEl.textContent || '').trim();
        contexts.push({
          el: squareEl,
          contentEl,
          titleEl,
          artistEl,
          titleMaxLines: derivePreferredTitleMaxLines(titleText),
          artistMaxLines: derivePreferredArtistMaxLines(artistText),
        });
      }

      const setScales = (ctx: SquareCtx, titleScale: number, artistScale: number) => {
        ctx.el.style.setProperty('--player-cell-title-scale', titleScale.toFixed(4));
        ctx.el.style.setProperty('--player-cell-artist-scale', artistScale.toFixed(4));
      };

      const fitsAtScales = (
        ctx: SquareCtx,
        titleScale: number,
        artistScale: number,
        titleMaxLines: number,
        artistMaxLines: number,
      ) => {
        setScales(ctx, titleScale, artistScale);
        if (ctx.contentEl.scrollHeight > ctx.contentEl.clientHeight + 1) return false;
        if (ctx.titleEl.scrollWidth > ctx.titleEl.clientWidth + 1) return false;
        if (titleMaxLines > 0 && getLineCount(ctx.titleEl) > titleMaxLines) return false;
        if (titleOnlyCells || artistMaxLines === 0 || !ctx.artistEl.textContent?.trim()) {
          return true;
        }
        if (ctx.artistEl.scrollWidth > ctx.artistEl.clientWidth + 1) return false;
        return getLineCount(ctx.artistEl) <= artistMaxLines;
      };

      const findMaxTitleScale = (ctx: SquareCtx) => {
        let titleLow = TITLE_SCALE_ABSOLUTE_MIN;
        let titleHigh = TITLE_SCALE_MAX;
        const fits = (titleScale: number) =>
          fitsAtScales(ctx, titleScale, ARTIST_PROBE_SCALE, ctx.titleMaxLines, ctx.artistMaxLines);

        if (!fits(titleLow)) return TITLE_SCALE_ABSOLUTE_MIN;

        if (!fits(titleHigh)) {
          for (let i = 0; i < 10; i += 1) {
            const mid = (titleLow + titleHigh) / 2;
            if (fits(mid)) {
              titleLow = mid;
            } else {
              titleHigh = mid;
            }
          }
          return titleLow;
        }

        return TITLE_SCALE_MAX;
      };

      const perSquareTitleScales = contexts.map((ctx) => findMaxTitleScale(ctx));
      let uniformTitleScale = Math.min(...perSquareTitleScales, TITLE_SCALE_MAX);
      uniformTitleScale = Math.max(uniformTitleScale, TITLE_SCALE_PREFERRED_MIN);

      const allFitAtTitle = (titleScale: number) =>
        contexts.every((ctx) =>
          fitsAtScales(ctx, titleScale, ARTIST_PROBE_SCALE, ctx.titleMaxLines, ctx.artistMaxLines),
        );

      if (!allFitAtTitle(uniformTitleScale)) {
        uniformTitleScale = Math.max(Math.min(...perSquareTitleScales), TITLE_SCALE_ABSOLUTE_MIN);
      }

      for (const ctx of contexts) {
        setScales(ctx, uniformTitleScale, ARTIST_PROBE_SCALE);
      }

      if (!titleOnlyCells) {
        const findMaxArtistScale = (ctx: SquareCtx) => {
          if (ctx.artistMaxLines === 0 || !ctx.artistEl.textContent?.trim()) {
            return ARTIST_SCALE_FLOOR;
          }
          let artistLow = ARTIST_SCALE_MIN;
          let artistHigh = ARTIST_SCALE_MAX;
          const fits = (artistScale: number) =>
            fitsAtScales(ctx, uniformTitleScale, artistScale, ctx.titleMaxLines, ctx.artistMaxLines);

          if (!fits(artistLow)) return artistLow;
          if (fits(artistHigh)) return artistHigh;

          for (let i = 0; i < 8; i += 1) {
            const mid = (artistLow + artistHigh) / 2;
            if (fits(mid)) {
              artistLow = mid;
            } else {
              artistHigh = mid;
            }
          }
          return artistLow;
        };

        const perSquareArtistScales = contexts.map((ctx) => findMaxArtistScale(ctx));
        const sortedArtistScales = [...perSquareArtistScales].sort((a, b) => a - b);
        const percentileIndex = Math.min(
          sortedArtistScales.length - 1,
          Math.floor(sortedArtistScales.length * 0.32),
        );
        let uniformArtistScale = sortedArtistScales[percentileIndex] ?? ARTIST_SCALE_FLOOR;
        uniformArtistScale = Math.max(uniformArtistScale, ARTIST_SCALE_FLOOR);
        uniformArtistScale = Math.min(uniformArtistScale, ARTIST_SCALE_MAX);

        const fitsAllAtArtistScale = (artistScale: number) =>
          contexts.every((ctx) =>
            fitsAtScales(ctx, uniformTitleScale, artistScale, ctx.titleMaxLines, ctx.artistMaxLines),
          );

        const respectsTitleHierarchy = (artistScale: number) => {
          for (const ctx of contexts) {
            setScales(ctx, uniformTitleScale, artistScale);
            const titlePx = Number.parseFloat(window.getComputedStyle(ctx.titleEl).fontSize || '0');
            const artistPx = Number.parseFloat(window.getComputedStyle(ctx.artistEl).fontSize || '0');
            if (titlePx > 0 && artistPx > titlePx * ARTIST_MAX_TITLE_RATIO) return false;
          }
          return true;
        };

        while (
          uniformArtistScale > ARTIST_SCALE_MIN + 0.008
          && (!fitsAllAtArtistScale(uniformArtistScale) || !respectsTitleHierarchy(uniformArtistScale))
        ) {
          uniformArtistScale -= 0.02;
        }
        uniformArtistScale = Math.max(uniformArtistScale, ARTIST_SCALE_MIN);

        for (const ctx of contexts) {
          setScales(ctx, uniformTitleScale, uniformArtistScale);
        }
      }

      if (playerContainer) {
        playerContainer.removeAttribute('data-fit-measuring');
      }
      measuring = false;

      if (cancelled || gen !== fitGeneration) return;
      setCardTextFitReady(true);
      if (pendingRefit) {
        pendingRefit = false;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(fitCardText);
      }
    };

    frame = requestAnimationFrame(fitCardText);

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      setCardTextFitReady(false);
      frame = requestAnimationFrame(fitCardText);
    });
    resizeObserver.observe(gridEl);

    const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
    fontsReady?.then(() => {
      cancelAnimationFrame(frame);
      setCardTextFitReady(false);
      frame = requestAnimationFrame(fitCardText);
    }).catch(() => {});

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      gridEl.closest<HTMLElement>('.player-container')?.removeAttribute('data-fit-measuring');
    };
  }, [cardTextFitSignature, visualViewportHeightPx, compactCardCells]);

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

  // Long-press (touch) / hover (mouse): full title + artist in fixed panel.
  const squareTooltipContent = (square: BingoSquare) => {
    const free = square.isFreeSpace || square.songId === '__FREE_SPACE__';
    const vis = youtubeBingoSquareDisplay(square);
    return {
      title: free ? 'Free space' : vis.title,
      artist: free ? '' : vis.artist,
    };
  };

  const showSquareTooltip = (square: BingoSquare) => {
    setLongPressTooltip(squareTooltipContent(square));
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const clearHoverTooltipTimer = () => {
    if (hoverTooltipTimer.current) {
      window.clearTimeout(hoverTooltipTimer.current);
      hoverTooltipTimer.current = null;
    }
  };

  const dismissSquareTooltip = () => {
    setLongPressTooltip(null);
  };

  const handleSquarePointerEnter = (square: BingoSquare, e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clearHoverTooltipTimer();
    hoverTooltipTimer.current = window.setTimeout(() => {
      showSquareTooltip(square);
    }, 400);
  };

  const handleSquarePointerLeave = (e: React.PointerEvent) => {
    clearLongPressTimer();
    if (e.pointerType === 'mouse') {
      clearHoverTooltipTimer();
      dismissSquareTooltip();
      return;
    }
    dismissSquareTooltip();
  };

  const handleSquarePointerUp = (e: React.PointerEvent) => {
    clearLongPressTimer();
    if (e.pointerType === 'mouse') return;
    dismissSquareTooltip();
  };

  const handlePointerDown = (square: BingoSquare, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if (e.pointerType === 'pen') {
      e.preventDefault();
    }
    clearLongPressTimer();
    longPressTimer.current = window.setTimeout(() => {
      showSquareTooltip(square);
      suppressNextClickRef.current = true;
      try {
        if (navigator.vibrate) navigator.vibrate(12);
      } catch {}
    }, 350);
  };

  const handleSquareClick = (position: string) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    markSquare(position);
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

  const startBingoHold = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    bingoHoldSubmittedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
      bingoHoldPointerIdRef.current = e.pointerId;
    } catch {
      /* ignore */
    }

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
        if (socket && !bingoHoldSubmittedRef.current) {
          bingoHoldSubmittedRef.current = true;
          setBingoStatus('checking');
          setBingoMessage('Checking your bingo...');
          socket.emit('player-bingo', { roomId });
        }
        setBingoHolding(false);
        holdStartRef.current = null;
        holdRafRef.current = null;
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick) as any;
    };
    holdRafRef.current = requestAnimationFrame(tick) as any;
  };

  const cancelBingoHold = (e?: React.PointerEvent<HTMLButtonElement>) => {
    if (e) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
      if (bingoHoldPointerIdRef.current === e.pointerId) {
        bingoHoldPointerIdRef.current = null;
      }
    }
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

  const connectionStatusLabel =
    connectionStatus === 'connected'
      ? 'Live sync'
      : connectionStatus === 'reconnecting'
        ? reconnectAttempts > 1
          ? `Reconnecting ${reconnectAttempts}`
          : 'Reconnecting'
        : 'Offline';
  const connectionStatusTone =
    connectionStatus === 'connected'
      ? 'connected'
      : connectionStatus === 'reconnecting'
        ? 'reconnecting'
        : 'disconnected';
  const patternLabelMap: Record<string, string> = {
    line: `${normalizeLinesRequired(gameState.linesRequired ?? 1)} line`,
    full_card: 'Blackout',
    blackout: 'Blackout',
    four_corners: '4 corners',
    x: 'X pattern',
    t: 'T pattern',
    l: 'L pattern',
    u: 'U pattern',
    plus: '+ pattern',
    custom: 'Custom pattern',
    composite: 'Combo pattern',
  };
  const currentPatternLabel = patternLabelMap[gameState.pattern] || 'Pattern live';

  const renderBingoCard = () => {
    const singleOneBy75Playlist =
      oneBy75PlaylistNames.length === 1
        ? stripGotPlaylistPrefix(oneBy75PlaylistNames[0])
        : oneBy75PlaylistNames.length > 1
          ? oneBy75PlaylistNames.map(stripGotPlaylistPrefix).filter(Boolean).join(' · ')
          : '';

    const headerLetters =
      bingoColumnLetters.length === 5 ? bingoColumnLetters.split('') : ['B', 'I', 'N', 'G', 'O'];
    const headerCells = headerLetters.map((letter, colIdx) => {
      const raw = bingoColumnPlaylistNames[colIdx] || '';
      const playlistLabel = stripGotPlaylistPrefix(raw);
      return (
        <div
          key={`${letter}-${colIdx}`}
          className={`bingo-column-headers__cell${playlistLabel ? ' bingo-column-headers__cell--named' : ''}`}
        >
          <span className="bingo-column-headers__letter">{letter}</span>
          {playlistLabel ? (
            <span className="bingo-column-headers__playlist" title={playlistLabel}>
              {playlistLabel}
            </span>
          ) : null}
        </div>
      );
    });

    if (!bingoCard) {
      return (
        <div className="bingo-card bingo-card--empty bingo-card--fit-ready" aria-busy="true">
          {singleOneBy75Playlist ? (
            <div className="bingo-card-playlist-title" title={singleOneBy75Playlist}>
              {singleOneBy75Playlist}
            </div>
          ) : null}
          <div className="bingo-column-headers" aria-hidden="true">
            {headerCells}
          </div>
          <div className="bingo-card-grid bingo-card-grid--placeholder" aria-hidden="true">
            {Array.from({ length: 25 }, (_value, index) => (
              <div key={`placeholder-${index}`} className="bingo-square bingo-square--placeholder" />
            ))}
          </div>
          <div className="bingo-card-empty-note">Waiting for host to start the game...</div>
        </div>
      );
    }

    return (
      <div
        className={`bingo-card ${cardTextFitReady ? 'bingo-card--fit-ready' : 'bingo-card--fit-pending'}`}
        aria-busy={!cardTextFitReady}
      >
        {singleOneBy75Playlist ? (
          <div className="bingo-card-playlist-title" title={singleOneBy75Playlist}>
            {singleOneBy75Playlist}
          </div>
        ) : null}
        <div className="bingo-column-headers" aria-hidden="true">
          {headerCells}
        </div>
        <div ref={cardGridRef} className="bingo-card-grid">
          {bingoCard.squares.map((square) => (
            <motion.div
              key={square.position}
              className={`bingo-square ${square.marked ? 'marked' : ''} ${isPatternSquare(square.position) ? 'pattern-highlight' : ''} ${square.isFreeSpace || square.songId === '__FREE_SPACE__' ? 'free-space' : ''}`}
              data-position={square.position}
              onClick={() => handleSquareClick(square.position)}
              onPointerEnter={(e) => handleSquarePointerEnter(square, e)}
              onPointerDown={(e) => handlePointerDown(square, e)}
              onPointerUp={handleSquarePointerUp}
              onPointerCancel={handleSquarePointerLeave}
              onPointerLeave={handleSquarePointerLeave}
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
              {(() => {
                const free = square.isFreeSpace || square.songId === '__FREE_SPACE__';
                const vis = youtubeBingoSquareDisplay(square);
                const titleText = free ? 'FREE' : softHyphenateLongWords(vis.title || '\u00a0');
                const artistText = free
                  ? (venueBranding?.eventTitle?.trim() || 'Free space')
                  : softHyphenateLongWords(vis.artist || '\u00a0');
                return (
                  <div className="square-content">
                    <div className="player-square-title">
                      {titleText}
                    </div>
                    <div className="player-square-artist">
                      {artistText}
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
    <div
      className={`player-container player-container--v2 ${bingoCard ? 'has-card' : ''}${venueBranding ? ' player-container--venue' : ''}${compactCardCells ? ' player-container--compact-cells' : ''}${cardTheme === 'light' ? ' player-container--light' : ''}`}
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
      {!joinReady ? (
        <PlayerAccountGate
          onGuestContinue={(name) => {
            finishGuestOrAccountJoin(name);
            if (socket && socket.connected) {
              try {
                socket.emit('join-room', buildJoinPayload(name));
              } catch {
                /* ignore */
              }
            }
          }}
          onAccountReady={(user, stats, recentRounds) => {
            finishGuestOrAccountJoin(user.displayName, user, stats, recentRounds);
            if (socket && socket.connected) {
              try {
                socket.emit('join-room', buildJoinPayload(user.displayName));
              } catch {
                /* ignore */
              }
            }
          }}
        />
      ) : null}

      <div className="player-main-column">
        {connectionStatus !== 'connected' ? (
          <div className="player-v2-status-rail" aria-live="polite">
            <span className={`player-v2-pill player-v2-pill--${connectionStatusTone}`}>
              {connectionStatusLabel}
            </span>
          </div>
        ) : null}

        <motion.div
          className="bingo-section player-bingo-stage"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
        >
          <div className="bingo-section-measure">{renderBingoCard()}</div>
        </motion.div>

        {(bingoStatus !== 'idle' || bingoMessage) && (
          <motion.div
            className={`player-bingo-status-toast player-bingo-status-toast--${bingoStatus !== 'idle' ? bingoStatus : 'info'}`}
            role="alert"
            aria-live={bingoStatus === 'failed' ? 'assertive' : 'polite'}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
          >
            {bingoStatus === 'checking' && (
              <motion.span
                className="player-bingo-status-toast__spinner"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                aria-hidden
              >
                ⏳
              </motion.span>
            )}
            {bingoStatus === 'success' && (
              <span className="player-bingo-status-toast__icon" aria-hidden>
                🏆
              </span>
            )}
            {bingoStatus === 'failed' && (
              <span className="player-bingo-status-toast__icon" aria-hidden>
                ❌
              </span>
            )}
            <span className="player-bingo-status-toast__text">{bingoMessage}</span>
          </motion.div>
        )}

        <div className="player-rest">
          <div className="player-chrome player-chrome--v2">
            {bingoCard ? (
              <motion.div
                className="player-v2-action-bar"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.05 }}
              >
                <div className="player-v2-action-row">
                <button
                  type="button"
                  className={`bingo-fab bingo-fab--canvas player-v2-call-button ${bingoHolding ? 'holding' : ''} ${hasValidBingo ? 'ready' : 'disabled'}`}
                  aria-label={hasValidBingo ? 'Hold to call BINGO' : 'Hold to call BINGO'}
                  onPointerDown={startBingoHold}
                  onPointerUp={cancelBingoHold}
                  onPointerCancel={cancelBingoHold}
                  onPointerLeave={cancelBingoHold}
                  onClick={(e) => e.preventDefault()}
                  onContextMenu={(e) => { e.preventDefault(); return false; }}
                  title={hasValidBingo ? 'Hold to call BINGO' : 'Hold to call BINGO'}
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
                    className="player-v2-call-outline"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 'inherit',
                      border: '1px solid rgba(255,255,255,0.12)',
                      pointerEvents: 'none',
                    }}
                  />
                  <span
                    className="bingo-fab-hold-track player-v2-call-track"
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
                      background: 'rgba(0,0,0,0.28)',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        width: `${Math.max(0, holdProgress) * 100}%`,
                        background: 'linear-gradient(90deg, #00ff88 0%, #8b5cf6 100%)',
                        borderRadius: '0 2px 0 0',
                      }}
                    />
                  </span>
                  <span
                    className="bingo-fab-label player-v2-call-label-wrap"
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
                    <span className="player-v2-call-label player-v2-call-label--long">
                      Hold to call BINGO
                    </span>
                    <span className="player-v2-call-label player-v2-call-label--short">
                      Hold · BINGO
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="player-v2-options-button"
                  onClick={() => setOptionsOpen(true)}
                  aria-label="Card options"
                >
                  Options
                </button>
                </div>
              </motion.div>
            ) : null}

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

        {longPressTooltip && (
          <div className="player-longpress-tooltip" role="status" aria-live="polite">
            <div className="player-longpress-tooltip-heading">Title</div>
            <div className="player-longpress-tooltip-line player-longpress-tooltip-primary">{longPressTooltip.title}</div>
            <div className="player-longpress-tooltip-heading">Artist</div>
            <div className="player-longpress-tooltip-line player-longpress-tooltip-artist">{longPressTooltip.artist}</div>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>

    {optionsOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={`player-v2-sheet-portal player-container--v2${cardTheme === 'light' ? ' player-container--light' : ''}${venueBranding ? ' player-container--venue' : ''}`}
          >
            <div
              className="player-v2-sheet-backdrop"
              onClick={() => setOptionsOpen(false)}
            >
              <motion.div
                className="player-v2-sheet player-v2-glass-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="player-v2-sheet-title"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="player-v2-sheet-handle" aria-hidden />
                <div className="player-v2-sheet-header">
                  <div className="player-v2-sheet-header-copy">
                    <div className="player-v2-sheet-title" id="player-v2-sheet-title">
                      Options
                    </div>
                  </div>
                  <button
                    type="button"
                    className="player-v2-sheet-done"
                    onClick={() => setOptionsOpen(false)}
                  >
                    Done
                  </button>
                </div>

                <div className="player-v2-sheet-row">
                  <div className="player-v2-sheet-copy">
                    <div className="player-v2-sheet-label">Game status</div>
                    <div className="player-v2-sheet-note">
                      {currentPatternLabel}
                      {gameState.isPlaying
                        ? ` · Song ${Math.max(songsPlayed, playedSongIds.length)} / 75`
                        : ''}
                    </div>
                  </div>
                </div>

                {playerAccount ? (
                  <>
                    <div className="player-v2-sheet-row player-v2-sheet-row--stacked">
                      <div className="player-v2-sheet-copy">
                        <div className="player-v2-sheet-label">Your account</div>
                        <div className="player-v2-sheet-note">{playerAccount.email}</div>
                      </div>
                      <label className="player-v2-profile-name-field">
                        <span className="player-v2-profile-name-label">Display name</span>
                        <div className="player-v2-profile-name-row">
                          <input
                            type="text"
                            className="player-v2-profile-input"
                            value={displayNameDraft}
                            maxLength={80}
                            onChange={(e) => {
                              setDisplayNameDraft(e.target.value);
                              setDisplayNameError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveDisplayName();
                            }}
                          />
                          <button
                            type="button"
                            className="player-v2-inline-button player-v2-profile-save"
                            disabled={
                              displayNameBusy
                              || !displayNameDraft.trim()
                              || displayNameDraft.trim() === playerAccount.displayName
                            }
                            onClick={() => void saveDisplayName()}
                          >
                            {displayNameBusy ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </label>
                      {displayNameError ? (
                        <p className="player-v2-profile-error" role="alert">
                          {displayNameError}
                        </p>
                      ) : null}
                    </div>

                    {playerStats ? (
                      <div className="player-v2-sheet-note-block player-v2-stats-panel">
                        <div className="player-v2-sheet-label">Lifetime stats</div>
                        <div className="player-v2-stats-grid">
                          <div className="player-v2-stat-cell">
                            <span className="player-v2-stat-value">{playerStats.gamesJoined}</span>
                            <span className="player-v2-stat-label">Games</span>
                          </div>
                          <div className="player-v2-stat-cell">
                            <span className="player-v2-stat-value">{playerStats.marksMade}</span>
                            <span className="player-v2-stat-label">Marks</span>
                          </div>
                          <div className="player-v2-stat-cell">
                            <span className="player-v2-stat-value">{playerStats.bingosCalled}</span>
                            <span className="player-v2-stat-label">Called</span>
                          </div>
                          <div className="player-v2-stat-cell">
                            <span className="player-v2-stat-value">{playerStats.bingosWon}</span>
                            <span className="player-v2-stat-label">Wins</span>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {playerRecentRounds.length > 0 ? (
                      <div className="player-v2-sheet-note-block player-v2-stats-panel">
                        <div className="player-v2-sheet-label">Recent games</div>
                        <ul className="player-v2-round-list">
                          {playerRecentRounds.map((round) => {
                            const outcome = round.bingoWon
                              ? 'Won'
                              : round.bingoCalled
                                ? 'Called bingo'
                                : 'Played';
                            return (
                              <li
                                key={`${round.roomId}-${round.roundToken || round.startedAt || 'round'}`}
                                className="player-v2-round-item"
                              >
                                <div className="player-v2-round-main">
                                  <span className="player-v2-round-room">{round.roomId}</span>
                                  <span className="player-v2-round-date">
                                    {formatPlayerRoundDate(round.startedAt)}
                                  </span>
                                </div>
                                <div className="player-v2-round-meta">
                                  {round.marksCount} marks · {outcome}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}

                    <div className="player-v2-sheet-row">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          void playerLogout().then(() => {
                            setPlayerAccount(null);
                            setPlayerStats(null);
                            setPlayerRecentRounds([]);
                            setJoinReady(false);
                          });
                        }}
                      >
                        Sign out
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="player-v2-sheet-row">
                    <div className="player-v2-sheet-copy">
                      <div className="player-v2-sheet-label">Player account</div>
                    </div>
                    <button type="button" className="btn-secondary" onClick={() => setJoinReady(false)}>
                      Sign in
                    </button>
                  </div>
                )}

                <div className="player-v2-sheet-row">
                  <div className="player-v2-sheet-copy">
                    <div className="player-v2-sheet-label">Card appearance</div>
                  </div>
                  <div className="player-v2-theme-toggle" role="group" aria-label="Card appearance">
                    <button
                      type="button"
                      className={`player-v2-theme-btn${cardTheme === 'dark' ? ' player-v2-theme-btn--active' : ''}`}
                      aria-pressed={cardTheme === 'dark'}
                      onClick={() => chooseCardTheme('dark')}
                    >
                      Dark
                    </button>
                    <button
                      type="button"
                      className={`player-v2-theme-btn${cardTheme === 'light' ? ' player-v2-theme-btn--active' : ''}`}
                      aria-pressed={cardTheme === 'light'}
                      onClick={() => chooseCardTheme('light')}
                    >
                      Light
                    </button>
                  </div>
                </div>

                <div className="player-v2-sheet-row">
                  <div className="player-v2-sheet-copy">
                    <div className="player-v2-sheet-label">Text size</div>
                  </div>
                  <div className="player-v2-font-controls">
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

                {venueBranding?.logoUrl ? (
                  <div className="player-v2-sheet-venue">
                    <img src={venueBranding.logoUrl} alt="" className="player-v2-sheet-venue-logo" />
                  </div>
                ) : null}

                {venueBranding?.footerText ? (
                  <div className="player-v2-sheet-note-block">{venueBranding.footerText}</div>
                ) : null}

                {venueBranding?.runbookUrl ? (
                  <a
                    href={venueBranding.runbookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="player-v2-sheet-link"
                  >
                    Event runbook
                  </a>
                ) : null}
              </motion.div>
            </div>
          </div>,
          document.body,
        )
      : null}
    </>
  );
};

export default PlayerView; 