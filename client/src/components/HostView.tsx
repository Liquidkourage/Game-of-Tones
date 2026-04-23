import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Play,
  Pause,
  SkipForward,
  Music,
  Trophy,
  Plus,
  X,
  LayoutDashboard,
  Gamepad2,
  Link2,
  Grid3x3,
  Monitor,
  BookOpen,
  Image as ImageIcon,
  ListMusic,
  List,
  Library,
  ListPlus,
  ListChecks,
  CalendarRange,
  RotateCcw,
  Trash2,
  Sliders,
  Volume2,
  VolumeX,
  Users,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  PartyPopper,
  Flag,
  Pencil,
  Maximize2,
  AppWindow,
  Check,
  Sparkles,
  Radio,
} from 'lucide-react';
import io from 'socket.io-client';
import { API_BASE, SOCKET_URL } from '../config';
import { hostFetch, getHostJwt, setHostJwt, clearHostJwt, apiOrigin, browserGoogleLoginUrl } from '../utils/hostFetch';
import { BingoPattern, PATTERN_OPTIONS, BINGO_PATTERNS, getPatternDisplayName, getSavedCustomPatterns, saveCustomPattern, SavedCustomPattern } from '../patternDefinitions';
import CustomPatternModal from './CustomPatternModal';
import SongTitleEditModal from './SongTitleEditModal';
import RoundPlanner from './RoundPlanner';
import { SpotifyExplicitBadge } from './SpotifyExplicitBadge';
import { cleanSongTitle } from '../utils/songTitleCleaner';
import { validateSongTitle, validateSongTitleSync, getValidationMessage, getValidationColor } from '../utils/songTitleValidator';
import { runExplicitStatsWithRetries } from '../utils/explicitPlaylistStatsBatch';
import './HostView.css';

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  public?: boolean;
  collaborative?: boolean;
  owner?: string;
}

interface Song {
  id: string;
  name: string;
  artist: string;
  duration?: number; // Make duration optional
  /** Spotify: track has explicit content */
  explicit?: boolean;
  sourcePlaylistId?: string;
  sourcePlaylistName?: string;
}

interface EventRound {
  id: string;
  name: string;
  playlistIds: string[];
  playlistNames: string[];
  songCount: number;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  startedAt?: number;
  completedAt?: number;
}

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  hasBingo: boolean;
}

interface Device {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
}

interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  currentSong: Song | null;
  queue: Song[];
  currentQueueIndex: number;
}

/** Center free space is never in the played-song list but counts as valid for verification UI. */
function isBingoFreeSpaceSquare(square: { isFreeSpace?: boolean; songId?: string } | null | undefined): boolean {
  return !!(square && (square.isFreeSpace || square.songId === '__FREE_SPACE__'));
}

/** Stable fingerprint for host player-card payloads so we detect mark changes, not only played-song count. */
function hostPlayerCardSnapshot(cardData: { card?: { squares?: Array<{ position?: string; marked?: boolean }> }; playedSongs?: string[] }) {
  const played = [...(cardData.playedSongs || [])].sort().join(',');
  const marks = (cardData.card?.squares || [])
    .map((s) => `${s.position ?? ''}:${s.marked ? 1 : 0}`)
    .sort()
    .join('|');
  return `${played}#${marks}`;
}

/** Spotify may return HTML in playlist descriptions; strip tags for display. */
function stripPlaylistDescriptionHtml(raw: string): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Match public display: trim optional "GoT" playlist prefix for column headers. */
function stripGotPlaylistPrefix(raw: string): string {
  return raw.replace(/^\s*GoT\s*[-�:]*\s*/i, '').trim();
}

/** Persisted before Spotify/Google redirects so return URL without ?name= still shows the right host label. */
const HOST_DISPLAY_NAME_KEY = 'tempo_host_display_name';

/** Stable empty ref for useMemo playlist id lists (avoids re-running effects every render). */
const NO_PLAYLIST_IDS: string[] = [];

/** Spotify playlist ids are strings; rounds/API may store numbers — normalize for Set lookups. */
function normalizeSpotifyPlaylistId(id: unknown): string {
  if (id == null || id === '') return '';
  return String(id).trim();
}

/** GoT mix library filter (same rules as visible playlist effect). */
function filterBasePlaylistsForMix(playlists: Playlist[], showAllPlaylists: boolean): Playlist[] {
  if (!showAllPlaylists) {
    return playlists.filter((p: Playlist) => {
      const nameLower = p.name.toLowerCase();
      if (nameLower.includes('game of tones output') || nameLower.includes('gameoftones output')) {
        return false;
      }
      const startsWithGot = /^got\s*[-�:]*\s*/i.test(p.name);
      const containsGameOfTones = nameLower.includes('game of tones') || nameLower.includes('gameoftones');
      return startsWithGot || containsGameOfTones;
    });
  }
  return playlists;
}

const HostView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostPlayerName = searchParams.get('name')?.trim() || 'Host';

  useEffect(() => {
    if (!roomId) return;
    if (searchParams.get('name')?.trim()) return;
    try {
      const saved = sessionStorage.getItem(HOST_DISPLAY_NAME_KEY)?.trim();
      if (saved) {
        const next = new URLSearchParams(searchParams);
        next.set('name', saved);
        setSearchParams(next, { replace: true });
      }
    } catch {
      /* ignore */
    }
  }, [roomId, searchParams, setSearchParams]);
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
  const [gameState, setGameState] = useState<'waiting' | 'playing' | 'ended'>('waiting');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Playlist[]>([]);
  const [snippetLength, setSnippetLength] = useState(() => {
    const saved = localStorage.getItem('game-snippet-length');
    return saved ? parseInt(saved) : 30;
  });
  const [winners, setWinners] = useState<Player[]>([]);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
  const [isSpotifyConnecting, setIsSpotifyConnecting] = useState(false);
  const [pendingVerification, setPendingVerification] = useState<any>(null);
  const [gamePaused, setGamePaused] = useState(false);
  const [mixFinalized, setMixFinalized] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [randomStarts, setRandomStarts] = useState<'none' | 'early' | 'random'>(() => {
    const saved = localStorage.getItem('game-random-starts');
    return (saved as 'none' | 'early' | 'random') || 'none';
  });
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [playedSoFar, setPlayedSoFar] = useState<Array<{ id: string; name: string; artist: string }>>([]);
  const [revealMode, setRevealMode] = useState<'off' | 'artist' | 'title' | 'full'>('off');
  const [pattern, setPattern] = useState<BingoPattern>('line');
  const [freeSpaceEnabled, setFreeSpaceEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bingo-free-space') === '1';
    } catch {
      return false;
    }
  });
  const [publicDisplayFontSize, setPublicDisplayFontSize] = useState<number>(1.0); // Multiplier for public display font sizes
  /** Matches server / public display: 5×15 BINGO columns vs 1×75 carousel vs mix/URL default. */
  const [publicDisplayCallListMode, setPublicDisplayCallListMode] = useState<'auto' | 'grouped' | '5x15'>('auto');

  // Handler to update public display font size
  const updatePublicDisplayFontSize = (newSize: number) => {
    const clampedSize = Math.max(0.5, Math.min(3.0, newSize));
    setPublicDisplayFontSize(clampedSize);
    if (socket && roomId) {
      socket.emit('set-public-display-font-size', { roomId, fontSize: clampedSize });
    }
  };
  const updatePublicDisplayCallListMode = (mode: 'auto' | 'grouped' | '5x15') => {
    setPublicDisplayCallListMode(mode);
    if (socket && roomId) {
      socket.emit('set-public-display-call-list-mode', { roomId, mode });
    }
  };
  const [selectedCustomPattern, setSelectedCustomPattern] = useState<SavedCustomPattern | null>(null);
  const [savedCustomPatterns, setSavedCustomPatterns] = useState<SavedCustomPattern[]>([]);
  const [showCustomPatternModal, setShowCustomPatternModal] = useState<boolean>(false);
  
  // Song title editing
  const [showSongTitleModal, setShowSongTitleModal] = useState(false);
  const [editingSong, setEditingSong] = useState<{id: string, title: string, artist: string} | null>(null);
  const [customSongTitles, setCustomSongTitles] = useState<Record<string, string>>({});
  const [showSetup, setShowSetup] = useState<boolean>(false);
  const [preQueueEnabled, setPreQueueEnabled] = useState<boolean>(false);
  const [preQueueWindow, setPreQueueWindow] = useState<number>(5);
  const [isProcessingVerification, setIsProcessingVerification] = useState<boolean>(false);
  /** Clears stuck "Processing..." if server never responds (e.g. silent verify-bingo failure) */
  const verificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [roundComplete, setRoundComplete] = useState<any>(null);
  const [roundWinners, setRoundWinners] = useState<Array<any>>([]);
  const [stripGoTPrefix, setStripGoTPrefix] = useState<boolean>(true);
  const [customMask, setCustomMask] = useState<string[]>([]);
  const [customPattern, setCustomPattern] = useState<string[]>([]);
  const [showSongList, setShowSongList] = useState(false);
  const [playedInOrder, setPlayedInOrder] = useState<Array<{ id: string; name: string; artist: string }>>([]);
  const [superStrict, setSuperStrict] = useState<boolean>(false);
  const [showRooms, setShowRooms] = useState<boolean>(false);
  const [rooms, setRooms] = useState<Array<any>>([]);
  const [playerCards, setPlayerCards] = useState<Map<string, any>>(new Map());
  const [playerCardsVersion, setPlayerCardsVersion] = useState<number>(0); // Force re-render trigger
  const [playerCardsFullscreen, setPlayerCardsFullscreen] = useState<boolean>(false);
  /** When overlay is open: false = centered modal, true = viewport-filling panel */
  const [playerCardsMaximized, setPlayerCardsMaximized] = useState<boolean>(false);
  /** 5�15 mode: playlist title per column (from `fiveby15-pool`, else five selected playlists). */
  const [bingoColumnPlaylistNames, setBingoColumnPlaylistNames] = useState<string[]>([]);
  const [showRoundManager, setShowRoundManager] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'play'>('setup');
  /** In-person + online: only in-person verified bingos end the round / prize */
  const [hybridInPersonPlusOnline, setHybridInPersonPlusOnline] = useState(false);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [spotifyInitialCheckDone, setSpotifyInitialCheckDone] = useState(false);
  const initialConnectionPromptRef = useRef(false);
  const prevSpotifyConnectedRef = useRef<boolean | undefined>(undefined);
  /** Google-linked host profile from server (`users` table via /api/auth/me). */
  const [hostAccount, setHostAccount] = useState<{
    id: number;
    email?: string | null;
    displayName?: string | null;
  } | null | undefined>(undefined);
  /** After /api/auth/me finishes (and optional hostToken → localStorage), socket can use Bearer + hostToken. */
  const [hostAuthBootstrapDone, setHostAuthBootstrapDone] = useState(false);

  // Pause position tracking
  const [pausePosition, setPausePosition] = useState<number>(0);
  const [isPausedByInterface, setIsPausedByInterface] = useState(false);

  // Round management state
  interface EventRound {
    id: string;
    name: string;
    playlistIds: string[];
    playlistNames: string[];
    songCount: number;
    status: 'completed' | 'active' | 'planned' | 'unplanned';
    startedAt?: number;
    completedAt?: number;
  }

  const [eventRounds, setEventRounds] = useState<EventRound[]>([
    {
      id: 'round-1',
      name: 'Round 1',
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned'
    }
  ]);
  const eventRoundsRef = useRef(eventRounds);
  useEffect(() => {
    eventRoundsRef.current = eventRounds;
  }, [eventRounds]);
  /** Set when GET /playlists returns inline explicit stats; effect consumes to skip duplicate priority fetches. */
  const explicitStatsPrefetchFromPlaylistsRef = useRef<Record<string, { total: number; explicitCount: number }> | null>(
    null
  );
  const [currentRoundIndex, setCurrentRoundIndex] = useState<number>(-1);
  
  // License key management
  const [licenseKey, setLicenseKey] = useState<string>(() => {
    const saved = localStorage.getItem('tempo-license-key');
    return saved || '';
  });
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [isJoiningRoom, setIsJoiningRoom] = useState<boolean>(false);
  const [isLicenseValidated, setIsLicenseValidated] = useState<boolean>(false);

  /** Dev / audit trail - host log goes to browser console only */
  const addLog = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const line = `[TEMPO host] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  // Show toast notification to host
  const showToast = (message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const toast = document.createElement('div');
    const icons = { info: 'i', success: 'OK', warn: '!', error: '!' };
    const colors = { 
      info: '#00aaff', 
      success: '#00ff88', 
      warn: '#ffaa00', 
      error: '#ff4444' 
    };
    
    toast.textContent = `${icons[type]} ${message}`;
    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: colors[type],
      color: type === 'warn' ? '#000' : '#fff',
      padding: '12px 20px',
      borderRadius: '8px',
      fontWeight: 'bold',
      fontSize: '14px',
      zIndex: '10000',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      animation: 'slideIn 0.3s ease-out'
    });
    
    document.body.appendChild(toast);
    setTimeout(() => { 
      try { 
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => document.body.removeChild(toast), 300);
      } catch {} 
    }, 3000);
  };

  // Handle license key changes
  const handleLicenseKeyChange = useCallback((newLicenseKey: string) => {
    setLicenseKey(newLicenseKey);
    localStorage.setItem('tempo-license-key', newLicenseKey);
    
    // Reset validation state when key changes
    if (newLicenseKey !== licenseKey) {
      setIsLicenseValidated(false);
    }
    
    // If we have a socket and room, try to rejoin with new license key
    if (socket && roomId && newLicenseKey.trim()) {
      console.log('Attempting to join room with license key:', newLicenseKey.trim());
      setIsJoiningRoom(true);
      setLicenseError(null);
      socket.emit('join-room', {
        roomId,
        playerName: hostPlayerName,
        isHost: true,
        licenseKey: newLicenseKey.trim(),
        clientId,
        hostSecret: '',
        hostToken: getHostJwt() || '',
        inPerson: true
      });
      
      // Add timeout fallback in case server doesn't respond
      setTimeout(() => {
        if (isJoiningRoom) {
          console.log('Join timeout - clearing connecting state');
          setIsJoiningRoom(false);
          setLicenseError('Connection timeout. Please try again.');
        }
      }, 10000); // 10 second timeout
    }
  }, [socket, roomId, isJoiningRoom, licenseKey, hostPlayerName, clientId]);

  // Advanced playback states
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 100, // Always start at 100% volume
    playbackRate: 1,
    currentSong: null,
    queue: [],
    currentQueueIndex: 0
  });
   
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(100);
  const [songList, setSongList] = useState<Song[]>([]);
  const [finalizedOrder, setFinalizedOrder] = useState<Song[] | null>(null);
  // Playlists state
  const [visiblePlaylists, setVisiblePlaylists] = useState<Playlist[]>([]);
  const [playlistQuery, setPlaylistQuery] = useState('');
  /** false = GoT-oriented picks only; true = full Spotify library list */
  const [showAllPlaylists, setShowAllPlaylists] = useState<boolean>(false);
  /** Playlist table: Spotify order until user sorts by name or track count */
  const [playlistSort, setPlaylistSort] = useState<{
    key: 'none' | 'name' | 'tracks';
    dir: 'asc' | 'desc';
  }>({ key: 'none', dir: 'asc' });
  /** Spotify explicit counts per playlist id (batch API) */
  const [playlistExplicitStats, setPlaylistExplicitStats] = useState<
    Record<string, { total: number; explicitCount: number }>
  >({});
  const [playlistExplicitStatsLoading, setPlaylistExplicitStatsLoading] = useState(false);
  /** Set when batch returns no usable stats after retries (host can still play; labels may be missing). */
  const [playlistExplicitStatsError, setPlaylistExplicitStatsError] = useState<string | null>(null);
  /** Increment to re-run explicit-stats fetch (same playlist ids, e.g. after fixing Spotify auth). */
  const [explicitStatsRefreshNonce, setExplicitStatsRefreshNonce] = useState(0);
  // const [playedInOrder, setPlayedInOrder] = useState<Array<{ id: string; name: string; artist: string }>>([]); // duplicate removed
  
  // Pause position tracking (duplicates removed below)
  // const [pausePosition, setPausePosition] = useState<number>(0);
  // const [isPausedByInterface, setIsPausedByInterface] = useState(false);

  // Pre-queue profiles (persisted locally)
  const [profiles, setProfiles] = useState<Array<{ name: string; snippet: number; random: boolean | 'none' | 'early' | 'random'; window: number }>>(() => {
    try {
      const raw = localStorage.getItem('prequeue_profiles_v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(p => p && typeof p.name === 'string');
      return [];
    } catch {
      return [];
    }
  });
  const persistProfiles = (list: Array<{ name: string; snippet: number; random: boolean | 'none' | 'early' | 'random'; window: number }>) => {
    setProfiles(list as Array<{ name: string; snippet: number; random: boolean | 'none' | 'early' | 'random'; window: number }>);
    try { localStorage.setItem('prequeue_profiles_v1', JSON.stringify(list)); } catch {}
  };
  const saveCurrentAsProfile = () => {
    const name = prompt('Save profile as:');
    if (!name) return;
    const next = profiles.filter(p => p.name.toLowerCase() !== name.toLowerCase());
    next.push({ name, snippet: snippetLength, random: randomStarts, window: preQueueWindow });
    persistProfiles(next);
  };
  const applyProfile = (name: string) => {
    const p = profiles.find(x => x.name === name);
    if (!p) return;
    setSnippetLength(p.snippet);
    // Handle migration from old boolean values to new string values
    if (typeof p.random === 'boolean') {
      setRandomStarts(p.random ? 'random' : 'none');
    } else {
      setRandomStarts(p.random);
    }
    // Pre-queue removed, only snippet and random settings apply
  };
  const deleteProfile = (name: string) => {
    const next = profiles.filter(p => p.name !== name);
    persistProfiles(next);
  };

  const loadPlaylists = useCallback(async () => {
    try {
      console.log('Loading playlists...');
      const assignedForQuery = eventRoundsRef.current
        .flatMap((r) => r.playlistIds || [])
        .map((id) => String(id))
        .filter(Boolean);
      const qs = new URLSearchParams();
      qs.set('includeExplicitStats', '1');
      if (assignedForQuery.length > 0) {
        qs.set('assigned', assignedForQuery.join(','));
      }
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/playlists?${qs.toString()}`);
      if (response.status === 401) {
        console.warn('Spotify not connected (401) while loading playlists');
        // Don't override isSpotifyConnected here - let status endpoint be authoritative
        console.log('?? loadPlaylists got 401, but not overriding connection state');
        setSpotifyError('Spotify is not connected. Open Connection in the header to connect.');
        setPlaylists([]);
        return;
      }
      if (response.status === 429) {
        let retryMin = '';
        try {
          const d = (await response.json()) as { retryAfterSec?: number; message?: string };
          if (d && typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0) {
            retryMin = ` (retry in about ${Math.max(1, Math.ceil(d.retryAfterSec / 60))} min)`;
          }
        } catch {
          /* ignore */
        }
        setSpotifyError(
          `Spotify is rate-limiting this app right now${retryMin}. Wait and tap Refresh, or check your app in the Spotify Developer Dashboard (quota / usage).`
        );
        return;
      }
      const data = await response.json();
      
      if (data.success) {
        // Filter out temporary TEMPO playlists (store all others in state)
        const allPlaylists = data.playlists.filter((playlist: Playlist) => 
          !playlist.name.startsWith('TEMPO')
        );
        
        // Filter to only Game of Tones playlists for default view
        // Match playlists that start with "got" (with optional separator) or contain "game of tones" or "gameoftones"
        // BUT exclude output playlists (generated when starting a round)
        const gotPlaylists = allPlaylists.filter((playlist: Playlist) => {
          const nameLower = playlist.name.toLowerCase();
          // Exclude output playlists
          if (nameLower.includes('game of tones output') || nameLower.includes('gameoftones output')) {
            return false;
          }
          // Match "got" at the start of the name (with optional separator like "got -", "got:", etc.)
          const startsWithGot = /^got\s*[-�:]*\s*/i.test(playlist.name);
          // Match "game of tones" or "gameoftones" anywhere in the name
          const containsGameOfTones = nameLower.includes('game of tones') || nameLower.includes('gameoftones');
          return startsWithGot || containsGameOfTones;
        });
        
        // Debug: log some matched playlists to see what's being matched
        console.log(`? Sample matched GoT playlists (first 20):`, gotPlaylists.slice(0, 20).map((p: Playlist) => `"${p.name}"`));
        
        // Debug: verify ALL matched playlists actually match the pattern
        const suspicious = gotPlaylists.filter((p: Playlist) => {
          const nameLower = p.name.toLowerCase();
          // Check if it's an output playlist (should be excluded)
          if (nameLower.includes('game of tones output') || nameLower.includes('gameoftones output')) {
            return true; // This shouldn't be in the list
          }
          const startsWithGot = /^got\s*[-�:]*\s*/i.test(p.name);
          const containsGameOfTones = nameLower.includes('game of tones') || nameLower.includes('gameoftones');
          return !startsWithGot && !containsGameOfTones;
        });
        if (suspicious.length > 0) {
          console.warn(`?? Found ${suspicious.length} playlists that don't match GoT pattern or are output playlists:`, suspicious.slice(0, 20).map((p: Playlist) => `"${p.name}"`));
        } else {
          console.log(`? All ${gotPlaylists.length} matched playlists verified (GoT pattern, excluding output playlists)`);
        }
        
        // Debug: show some examples of what will be displayed (with prefix stripped)
        if (stripGoTPrefix) {
          const displayExamples = gotPlaylists.slice(0, 10).map((p: Playlist) => {
            const displayName = p.name.replace(/^GoT\s*[-�:]*\s*/i, '');
            return `"${p.name}" ? "${displayName}"`;
          });
          console.log(`?? Display examples (with prefix stripped):`, displayExamples);
        }
        
        setPlaylists(allPlaylists);
        // Reset filter to GoT-only by default when playlists are reloaded
        setShowAllPlaylists(false);
        // Don't set visiblePlaylists here - let the useEffect handle it to ensure consistency
        console.log('Playlists loaded:', gotPlaylists.length, 'GoT playlists will be shown by default (from', allPlaylists.length, 'total playlists)');

        const inline = data.explicitStatsByPlaylistId as
          | Record<string, { total?: number; explicitCount?: number }>
          | undefined;
        if (inline && typeof inline === 'object') {
          const cleaned: Record<string, { total: number; explicitCount: number }> = {};
          for (const [pid, v] of Object.entries(inline)) {
            if (v && typeof v.total === 'number' && typeof v.explicitCount === 'number') {
              cleaned[pid] = { total: v.total, explicitCount: v.explicitCount };
            }
          }
          if (Object.keys(cleaned).length > 0) {
            explicitStatsPrefetchFromPlaylistsRef.current = cleaned;
            setPlaylistExplicitStats((prev) => ({ ...prev, ...cleaned }));
          }
        }
      } else {
        console.error('Failed to load playlists:', data.error);
        if (data && data.error === 'spotify_rate_limited') {
          const ra = typeof data.retryAfterSec === 'number' ? data.retryAfterSec : null;
          const retryMin = ra != null && ra > 0 ? ` (retry in about ${Math.max(1, Math.ceil(ra / 60))} min)` : '';
          setSpotifyError(
            `Spotify is rate-limiting this app${retryMin}. Wait and refresh, or check the Developer Dashboard.`
          );
        }
      }
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  }, []);


  /** Assigned-to-round ids as strings so Spotify id === round id always matches. */
  const assignedPlaylistIds = useMemo(
    () => new Set(eventRounds.flatMap((round) => round.playlistIds || []).map((id) => String(id))),
    [eventRounds]
  );

  /** Same inclusion rules as the effect that sets `visiblePlaylists`, computed synchronously (no race with playlist load). */
  const playlistIdsForExplicitStats = useMemo(() => {
    if (!playlists?.length) return NO_PLAYLIST_IDS;
    const basePlaylists = filterBasePlaylistsForMix(playlists, showAllPlaylists);
    return basePlaylists
      .filter((p) => {
        const pid = normalizeSpotifyPlaylistId(p.id);
        return pid !== '' && !assignedPlaylistIds.has(pid);
      })
      .map((p) => normalizeSpotifyPlaylistId(p.id));
  }, [playlists, showAllPlaylists, assignedPlaylistIds]);

  // Filter playlists by query and exclude already assigned playlists
  const filteredPlaylists = useMemo(() => {
    if (playlistQuery) {
      const q = playlistQuery.toLowerCase();
      return visiblePlaylists.filter((p) => {
        const pid = normalizeSpotifyPlaylistId(p.id);
        return (
          !assignedPlaylistIds.has(pid) &&
          ((p.name || '').toLowerCase().includes(q) ||
            (p.owner || '').toLowerCase().includes(q) ||
            (p.description || '').toLowerCase().includes(q))
        );
      });
    }
    return visiblePlaylists.filter((p) => !assignedPlaylistIds.has(normalizeSpotifyPlaylistId(p.id)));
  }, [visiblePlaylists, playlistQuery, assignedPlaylistIds]);

  const sortedFilteredPlaylists = useMemo(() => {
    const rows = [...filteredPlaylists];
    if (playlistSort.key === 'none') return rows;
    const m = playlistSort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (playlistSort.key === 'tracks') {
        return (a.tracks - b.tracks) * m;
      }
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }) * m;
    });
    return rows;
  }, [filteredPlaylists, playlistSort]);

  /**
   * Union of library + table row ids, with visible rows first so the first batch request
   * paints explicit badges on-screen before the rest of the library finishes.
   */
  const allPlaylistIdsForExplicitStats = useMemo(() => {
    const rowIds = sortedFilteredPlaylists
      .map((p) => normalizeSpotifyPlaylistId(p.id))
      .filter(Boolean);
    const uniqueRow = Array.from(new Set(rowIds));
    const rowSet = new Set(uniqueRow);
    const rest = playlistIdsForExplicitStats.filter((id) => !rowSet.has(id));
    return [...uniqueRow, ...rest];
  }, [playlistIdsForExplicitStats, sortedFilteredPlaylists]);

  const allPlaylistIdsForExplicitStatsKey = useMemo(
    () => JSON.stringify(allPlaylistIdsForExplicitStats),
    [allPlaylistIdsForExplicitStats]
  );

  const togglePlaylistSort = useCallback((key: 'name' | 'tracks') => {
    setPlaylistSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hostFetch(`${API_BASE || ''}/api/auth/me`);
        if (cancelled) return;
        if (!res.ok) {
          clearHostJwt();
          setHostAccount(null);
          return;
        }
        const data = (await res.json()) as {
          user?: { id: number; email?: string | null; displayName?: string | null } | null;
          hostToken?: string;
        };
        if (!data.user) {
          clearHostJwt();
          setHostAccount(null);
          return;
        }
        if (data.hostToken && typeof data.hostToken === 'string') setHostJwt(data.hostToken);
        setHostAccount(data.user);
      } catch {
        if (!cancelled) {
          clearHostJwt();
          setHostAccount(null);
        }
      } finally {
        if (!cancelled) setHostAuthBootstrapDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Update visible playlists when rounds change to exclude newly assigned playlists, or when filter mode changes
  useEffect(() => {
    if (playlists && playlists.length > 0) {
      const basePlaylists = filterBasePlaylistsForMix(playlists, showAllPlaylists);

      console.log(`?? Filter applied: showAllPlaylists=${showAllPlaylists}, total playlists=${playlists.length}, filtered to=${basePlaylists.length}`);
      if (!showAllPlaylists && basePlaylists.length > 0) {
        console.log(`? Sample filtered playlists (first 10):`, basePlaylists.slice(0, 10).map((p: Playlist) => p.name));
      }

      const availablePlaylists = basePlaylists.filter((p: Playlist) => {
        const pid = normalizeSpotifyPlaylistId(p.id);
        return pid !== '' && !assignedPlaylistIds.has(pid);
      });

      console.log(`?? Final visible playlists: ${availablePlaylists.length} (after excluding ${assignedPlaylistIds.size} assigned)`);

      setVisiblePlaylists(availablePlaylists);
    } else if (playlists && playlists.length === 0) {
      setVisiblePlaylists([]);
    }
  }, [assignedPlaylistIds, playlists, showAllPlaylists]);

  /** Load Spotify explicit vs total counts for playlists in the Manager list (chunked batch API, retries). */
  useEffect(() => {
    if (!hostAuthBootstrapDone || !isSpotifyConnected) {
      if (!isSpotifyConnected) {
        setPlaylistExplicitStats({});
        setPlaylistExplicitStatsLoading(false);
        setPlaylistExplicitStatsError(null);
      }
      return;
    }
    let allIds: string[] = [];
    try {
      allIds = JSON.parse(allPlaylistIdsForExplicitStatsKey) as string[];
    } catch {
      allIds = [];
    }
    if (!Array.isArray(allIds) || allIds.length === 0) {
      setPlaylistExplicitStats({});
      setPlaylistExplicitStatsLoading(false);
      setPlaylistExplicitStatsError(null);
      return;
    }
    let cancelled = false;
    setPlaylistExplicitStatsLoading(true);
    setPlaylistExplicitStatsError(null);

    /** First N ids are visible rows (see allPlaylistIdsForExplicitStats) — finish those first so labels appear quickly. */
    const PRIORITY_COUNT = 20;

    (async () => {
      try {
        const priorityIds = allIds.slice(0, PRIORITY_COUNT);
        const restIds = allIds.slice(PRIORITY_COUNT);
        let acc: Record<string, { total: number; explicitCount: number }> = {};

        const pref = explicitStatsPrefetchFromPlaylistsRef.current;
        explicitStatsPrefetchFromPlaylistsRef.current = null;
        if (pref && priorityIds.length > 0) {
          for (const id of priorityIds) {
            const v = pref[id];
            if (v && typeof v.total === 'number' && typeof v.explicitCount === 'number') {
              acc[id] = v;
            }
          }
          if (Object.keys(acc).length > 0 && !cancelled) {
            setPlaylistExplicitStats((prev) => ({ ...prev, ...acc }));
            setPlaylistExplicitStatsLoading(false);
          }
        }

        const needPriority = priorityIds.filter((id) => !acc[id]);
        if (needPriority.length > 0) {
          if (cancelled) return;
          const mergedP = await runExplicitStatsWithRetries(needPriority);
          acc = { ...acc, ...mergedP };
          if (!cancelled) {
            setPlaylistExplicitStats((prev) => ({ ...prev, ...mergedP }));
            setPlaylistExplicitStatsLoading(false);
          }
        }

        if (restIds.length > 0 && !cancelled) {
          setPlaylistExplicitStatsLoading(true);
          if (cancelled) return;
          const m2 = await runExplicitStatsWithRetries(restIds);
          if (!cancelled) {
            acc = { ...acc, ...m2 };
            setPlaylistExplicitStats((prev) => ({ ...prev, ...m2 }));
          }
        }

        if (!cancelled) {
          setPlaylistExplicitStatsLoading(false);
          const okCount = Object.keys(acc).length;
          if (okCount === 0 && allIds.length > 0) {
            setPlaylistExplicitStatsError('Could not load explicit track counts from Spotify. Check connection and try refreshing playlists.');
          } else {
            setPlaylistExplicitStatsError(null);
          }
        }
      } catch (e) {
        console.error('explicit-stats batch failed', e);
        if (!cancelled) {
          setPlaylistExplicitStats({});
          setPlaylistExplicitStatsError('Failed to load explicit counts.');
        }
      } finally {
        if (!cancelled) setPlaylistExplicitStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostAuthBootstrapDone, isSpotifyConnected, allPlaylistIdsForExplicitStatsKey, explicitStatsRefreshNonce]);

  // Auto-switch tabs based on game state (do not depend on eventRounds � round-bucket updates
  // should not yank the host back to Manager; see handleStartRound ? Game tab).
  useEffect(() => {
    if (gameState === 'playing') {
      setActiveTab('play');
    } else if (gameState === 'waiting' && mixFinalized) {
      setActiveTab('play');
    } else {
      setActiveTab('setup');
    }
  }, [gameState, mixFinalized]);

  /** After first Spotify status check: prompt once if not connected. */
  useEffect(() => {
    if (!spotifyInitialCheckDone || isSpotifyConnected) return;
    if (!initialConnectionPromptRef.current) {
      initialConnectionPromptRef.current = true;
      setShowConnectionModal(true);
    }
  }, [spotifyInitialCheckDone, isSpotifyConnected]);

  /** Spotify disconnected ? reopen modal; reconnected ? close. */
  useEffect(() => {
    const prev = prevSpotifyConnectedRef.current;
    if (prev === true && isSpotifyConnected === false) {
      setShowConnectionModal(true);
    }
    if (prev === false && isSpotifyConnected === true) {
      setShowConnectionModal(false);
    }
    prevSpotifyConnectedRef.current = isSpotifyConnected;
  }, [isSpotifyConnected]);

  useEffect(() => {
    if (!showConnectionModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConnectionModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showConnectionModal]);

  useEffect(() => {
    if (!showConnectionModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showConnectionModal]);

  const refreshRooms = useCallback(async () => {
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/rooms`);
      const data = await res.json();
      setRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    } catch {
      setRooms([]);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      setIsLoadingDevices(true);
      console.log('Loading Spotify devices...');
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/devices`);
      if (response.status === 401) {
        console.warn('Spotify not connected (401) while loading devices');
        setIsSpotifyConnected(false);
        setIsSpotifyConnecting(false);
        setSpotifyError('Spotify is not connected. Open Connection in the header to connect.');
        setDevices([]);
        return;
      }
      const data = await response.json();
      
      if (data.devices) {
        setDevices(data.devices);
        console.log('Devices loaded:', data.devices.length, 'devices');
        console.log('Device details:', data.devices);
        if (data.currentDevice) {
          console.log('Current playback device:', data.currentDevice.name, data.currentDevice.id);
        }
        
        // Auto-select the saved device if available, otherwise first device
        if (data.savedDevice) {
          const savedDevice = data.devices.find((d: Device) => d.id === data.savedDevice.id);
          if (savedDevice) {
            setSelectedDevice(savedDevice);
            console.log('Auto-selected saved device:', savedDevice.name);
          }
        } else if (data.currentDevice) {
          // Prefer the device currently in playback
          const current = data.devices.find((d: Device) => d.id === data.currentDevice.id);
          if (current) {
            setSelectedDevice(current);
            console.log('Auto-selected current playback device:', current.name);
          } else if (data.devices.length > 0 && !selectedDevice) {
            setSelectedDevice(data.devices[0]);
          }
        } else if (data.devices.length > 0 && !selectedDevice) {
          setSelectedDevice(data.devices[0]);
        }
      } else {
        console.error('Failed to load devices:', data.error);
      }
    } catch (error) {
      console.error('Error loading devices:', error);
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  /** After server-side Spotify OAuth redirect (?spotify=connected), refresh status and clean URL. */
  useEffect(() => {
    if (searchParams.get('spotify') !== 'connected') return;
    const ac = new AbortController();
    const next = new URLSearchParams(searchParams);
    next.delete('spotify');
    setSearchParams(next, { replace: true });

    const fetchStatus = async () => {
      const cacheBuster = Date.now();
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
      const data = await response.json();
      return data.connected === true;
    };

    let deviceRetryTimer: number | null = null;
    const refresh = async () => {
      try {
        // Give session + Spotify token propagation a moment after full-page redirect (avoids racing the socket effect's status check).
        await new Promise((r) => setTimeout(r, 750));
        if (ac.signal.aborted) return;
        let ok = await fetchStatus();
        if (!ok && !ac.signal.aborted) {
          await new Promise((r) => setTimeout(r, 1500));
          if (!ac.signal.aborted) ok = await fetchStatus();
        }
        if (ac.signal.aborted) return;
        if (ok) {
          setIsSpotifyConnected(true);
          setIsSpotifyConnecting(false);
          await loadPlaylists();
          await loadDevices();
          // Devices often appear a few seconds after Spotify app / Web Player activates.
          deviceRetryTimer = window.setTimeout(() => {
            if (!ac.signal.aborted) void loadDevices();
          }, 2000);
        } else {
          setSpotifyError(
            'Spotify did not report connected yet. Wait a few seconds and use Connect Spotify again, or refresh the page.'
          );
        }
      } catch (e) {
        console.error('Post-Spotify OAuth refresh failed:', e);
      } finally {
        if (!ac.signal.aborted) setSpotifyInitialCheckDone(true);
      }
    };
    void refresh();
    return () => {
      if (deviceRetryTimer) clearTimeout(deviceRetryTimer);
      ac.abort();
    };
  }, [searchParams, setSearchParams, loadPlaylists, loadDevices]);

  const fetchPlaybackState = useCallback(async () => {
    try {
      const resp = await hostFetch(`${API_BASE || ''}/api/spotify/current-playback`);
      if (!resp.ok) {
        if (resp.status >= 500) return; // ignore transient 5xx
        return;
      }
      const data = await resp.json();
      if (data.success && data.playbackState) {
        // Shuffle/repeat state removed - not used in UI
        // setShuffleEnabled(!!data.playbackState.shuffle_state);
        // const rep = (data.playbackState.repeat_state || 'off') as 'off' | 'track' | 'context';
        // setRepeatState(rep);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const disconnectSpotify = useCallback(async () => {
    try {
      await hostFetch(`${API_BASE || ''}/api/spotify/clear`, { method: 'POST' });
      setIsSpotifyConnected(false);
      setPlaylists([]);
      setSpotifyError(null);
      setPlaylistExplicitStats({});
      setPlaylistExplicitStatsLoading(false);
      setPlaylistExplicitStatsError(null);
    } catch (error) {
      console.error('Error disconnecting Spotify:', error);
    }
  }, []);

  /** Mirrors connection state for unload handlers (avoid stale closures). */
  const isSpotifyConnectedRef = useRef(false);
  /** Back off host polling of /api/spotify/current-playback when server returns 429. */
  const spotifyPollBackoffUntilRef = useRef(0);
  /** Throttle getUserPlaylists on socket reconnect to avoid piling on Spotify (429) next to OAuth / status checks. */
  const lastLoadPlaylistsOnSocketReconnectAtRef = useRef(0);
  useEffect(() => {
    isSpotifyConnectedRef.current = isSpotifyConnected;
  }, [isSpotifyConnected]);

  // Intentionally no pagehide -> /api/spotify/clear: it fired on bfcache/navigation, wiped DB tokens, and caused
  // constant disconnect/reconnect + extra Web API load. Use the header Disconnect control to clear tokens.

  const saveSelectedDevice = useCallback(async () => {
    if (!selectedDevice) {
      alert('Please select a device first');
      return;
    }

    try {
      console.log('Saving device:', selectedDevice.name);
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/save-device`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device: selectedDevice })
      });

      const data = await response.json();
      if (data.success) {
        console.log('Device saved successfully:', data.message);
        alert(`Device saved: ${selectedDevice.name}`);
      } else {
        console.error('Failed to save device:', data.error);
        alert('Failed to save device');
      }
    } catch (error) {
      console.error('Error saving device:', error);
      alert('Error saving device');
    }
  }, [selectedDevice]);

  useEffect(() => {
    if (!hostAuthBootstrapDone) return;

    console.log('HostView useEffect triggered');
    console.log('Current window.location.pathname:', window.location.pathname);
    console.log('Current window.location.href:', window.location.href);
    console.log('Room ID from params:', roomId);

    // Load saved custom patterns
    setSavedCustomPatterns(getSavedCustomPatterns());
    
    // Request all custom song titles
    if (socket) {
      socket.emit('get-all-custom-titles');
    }

    // Initialize socket connection
    const hostJwt = getHostJwt();
    const newSocket = io(SOCKET_URL || undefined, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      auth: { token: hostJwt || '' },
    });
    setSocket(newSocket);
    /** One retry if first host join failed host-secret check (e.g. JWT not ready yet). */
    let hostSecretRetryOnce = false;
    /**
     * Only one join-room as host per socket lifecycle until disconnect/reconnect.
     * Without this, `connect` + `if (already connected)` (and Strict Mode remount overlap) can emit twice;
     * the second join hits room_has_host and kicks the user home — feels like a loop and skips the reuse modal.
     */
    let hostJoinEmitted = false;
    /** Set below; reconnect calls this after reset so host re-enters the room socket. */
    let emitHostJoinImpl: () => void = () => {};

    // Auto-refresh host player-card snapshot (debounced; replaces manual Request Player Cards)
    let playerCardsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const schedulePlayerCardsRefresh = (delayMs = 500) => {
      if (!roomId) return;
      if (playerCardsRefreshTimer) clearTimeout(playerCardsRefreshTimer);
      playerCardsRefreshTimer = setTimeout(() => {
        playerCardsRefreshTimer = null;
        try {
          newSocket.emit('request-player-cards', { roomId });
        } catch {
          /* ignore */
        }
      }, delayMs);
    };

    // Socket event listeners
    newSocket.on('player-joined', (data: any) => {
      console.log('Player joined:', data);
      schedulePlayerCardsRefresh(450);
    });
    newSocket.on('prequeue-updated', (data: any) => {
      setPreQueueEnabled(!!data?.enabled);
      if (typeof data?.window === 'number') setPreQueueWindow(data.window);
      addLog(`Pre-queue ${data?.enabled ? 'enabled' : 'disabled'} (window=${data?.window ?? preQueueWindow})`, 'info');
    });

    // Bingo verification: single handler (avoid duplicate listeners / double state updates)
    newSocket.on('bingo-verification-needed', (data: any) => {
      console.log('?? Bingo verification needed:', data?.playerName);
      setPendingVerification(data);
      setGamePaused(true);
      addLog(`?? ${data.playerName} called BINGO - verification needed!`, 'warn');
      playHostAlertSound();
      schedulePlayerCardsRefresh(120);
    });

    newSocket.on('bingo-verified', (data: any) => {
      if (verificationTimeoutRef.current) {
        clearTimeout(verificationTimeoutRef.current);
        verificationTimeoutRef.current = null;
      }
      console.log('Bingo verified:', data);
      setPendingVerification(null);
      setIsProcessingVerification(false);

      if (data.error === 'player_not_found' || data.error === 'no_room' || data.error === 'not_host') {
        addLog(data.reason || 'Could not complete verification.', 'error');
        setGamePaused(false);
        return;
      }
      if (data.approved) {
        if (data.roundComplete) {
          setRoundComplete(data);
          setGamePaused(true);
          setIsPlaying(false);
          setCurrentSong(null);
          addLog(`Round ${data.roundNumber} complete - ${data.playerName} wins!`, 'info');
          console.log('Round complete, showing options to host');
        } else if (data.gameEnded) {
          addLog(`Game ended - ${data.playerName} wins!`, 'info');
          setGameState('ended');
          setIsPlaying(false);
          setGamePaused(false);
        } else {
          addLog(`? Bingo approved for ${data.playerName}`, 'info');
        }
      } else {
        addLog(`? Bingo rejected for ${data.playerName}: ${data.reason || 'Invalid pattern'}`, 'warn');
        setGamePaused(false);
      }
    });

    newSocket.on('game-started', (data: any) => {
      console.log('?? GAME-STARTED EVENT RECEIVED:', data);
      setGameState('playing');
      console.log('?? SET GAME STATE TO PLAYING');
      setIsStartingGame(false);
      setBingoColumnPlaylistNames([]);
      addLog('Game started - state set to playing', 'info');
      // Auto-collapse lists during gameplay
      setShowSongList(false);
      schedulePlayerCardsRefresh(800);
    });

    // Receive the finalized shuffled order for 5x15
    newSocket.on('finalized-order', (data: any) => {
      try {
        const arr = Array.isArray(data?.order) ? data.order.map((o: any) => ({ id: o.id, name: o.name, artist: o.artist })) : [];
        if (arr.length > 0) {
          setFinalizedOrder(arr);
          addLog(`Finalized order received (${arr.length} tracks)`, 'info');
        }
      } catch (e) {
        console.warn('Failed to parse finalized order:', e);
      }
    });

    newSocket.on('song-playing', (data: any) => {
      setCurrentSong({
        id: data.songId,
        name: data.songName,
        artist: data.artistName,
        explicit: data.explicit === true,
      });
      lastSongEventAtRef.current = Date.now();
      setIsPlaying(true);
      setPlaybackState(prev => ({
        ...prev,
        isPlaying: true,
        currentSong: {
          id: data.songId,
          name: data.songName,
          artist: data.artistName,
          explicit: data.explicit === true,
        },
        duration: data.snippetLength * 1000, // Convert to milliseconds
        currentTime: 0
      }));
      setPlayedInOrder(prev => {
        if (prev.find(p => p.id === data.songId)) return prev; // prevent dupes
        return [...prev, { id: data.songId, name: data.songName, artist: data.artistName }];
      });
      
      // Reset pause tracking for new song
      setPausePosition(0);
      setIsPausedByInterface(false);
      
      console.log('Song playing:', data);
      addLog(`Now playing: ${data.songName} � ${data.artistName}`, 'info');
      
      // Sync volume when song starts playing to ensure it matches interface
      setTimeout(() => {
        syncVolumeToSpotify();
      }, 500);
      schedulePlayerCardsRefresh(550);
    });

    // Handle bingo verification pending
    newSocket.on('bingo-verification-pending', (data: any) => {
      console.log('Bingo verification pending:', data.playerName);
        setGamePaused(true);
        // Play alert sound for host
        playHostAlertSound();
    });

    // Handle confirmed bingo wins (for winner tracking)
    newSocket.on('bingo-called', (data: any) => {
      // Only update winners list if this is a verified bingo
      if (data.verified && !data.awaitingVerification) {
        setWinners(prev => [...prev, data]);
        console.log('Bingo confirmed for:', data.playerName);
      }
    });

    // Handle round-complete event (sent to all clients)
    newSocket.on('round-complete', (data: any) => {
      console.log('Round complete event received:', data);
      if (data.roundWinners) {
        setRoundWinners(data.roundWinners);
      }
      // Don't set roundComplete here - it's set by bingo-verified for host only
    });

    newSocket.on('game-resumed', () => {
      setGamePaused(false);
      // Sync volume after resume to ensure it matches interface
      setTimeout(() => {
        syncVolumeToSpotify();
      }, 500);
    });

    // Custom song title events
    newSocket.on('custom-song-title-updated', (data: any) => {
      setCustomSongTitles(prev => ({
        ...prev,
        [data.songId]: data.customTitle
      }));
    });

    newSocket.on('all-custom-titles-response', (data: any) => {
      setCustomSongTitles(data);
    });

    newSocket.on('game-ended', () => {
      setGamePaused(false);
      setIsPlaying(false);
      setGameState('ended');
      void disconnectSpotify();
    });

    newSocket.on('game-restarted', (data: any) => {
      console.log('Game restarted:', data);
      // Reset host state
      setWinners([]);
      setRoundWinners([]);
      setRoundComplete(null);
      setIsPlaying(false);
      setGamePaused(false);
      setPendingVerification(null);
      setCurrentSong(null);
      addLog('Game restarted by host', 'info');
    });

    newSocket.on('song-replaced', (data: any) => {
      console.log('Song replaced:', data);
      // Update the song list with the new song
      setSongList(prev => {
        const newList = [...prev];
        const index = newList.findIndex(s => s.id === data.oldSongId);
        if (index !== -1) {
          newList[index] = data.newSong;
        }
        return newList;
      });
      
      // Update finalized order if it exists
      setFinalizedOrder(prev => {
        if (!prev) return prev;
        const newOrder = [...prev];
        const index = newOrder.findIndex(s => s.id === data.oldSongId);
        if (index !== -1) {
          newOrder[index] = data.newSong;
        }
        return newOrder;
      });
      
      addLog(`Song replaced: ${data.newSong.name} by ${data.newSong.artist}`, 'info');
    });

    // NEW: Handle next round reset (back to setup)
    newSocket.on('next-round-reset', (data: any) => {
      console.log('Next round reset to setup:', data);
      // CRITICAL: Clear round complete modal and pending verification
      setRoundComplete(null);
      setPendingVerification(null);
      setIsProcessingVerification(false);
      
      // Reset all game state
      setWinners([]);
      setGamePaused(false);
      setIsPlaying(false);
      setCurrentSong(null);
      setMixFinalized(false);
      setPlaylists([]);
      setSelectedPlaylists([]);
      setPattern('line');
      setSnippetLength(30);
      setRandomStarts('none');
      setRevealMode('off');
      setPlayedSoFar([]);
      setSongList([]);
      setFinalizedOrder([]);
      
      // Preserve round winners history
      if (data.roundWinners) {
        setRoundWinners(data.roundWinners);
      }
      
      addLog(`Round ${data.roundNumber} - Fresh setup ready! Select playlists to start.`, 'info');
      console.log('? Host UI reset complete - ready for new round setup');
    });

    // NEW: Handle game session ended
    newSocket.on('game-session-ended', (data: any) => {
      console.log('Game session ended:', data);
      setRoundComplete(null);
      setGameState('ended');
      setIsPlaying(false);
      void disconnectSpotify();
      if (data.roundWinners) {
        setRoundWinners(data.roundWinners);
      }
      addLog(`Game session ended after ${data.totalRounds} rounds`, 'info');
    });

    newSocket.on('sync-state-response', (data: any) => {
      console.log('Sync state response:', data);
      if (data.gameState) {
        setGameState(data.gameState);
        addLog(`Synced game state to: ${data.gameState}`, 'info');
      }
      if (data.currentSong) {
        setCurrentSong(data.currentSong);
      }
      if (data.isPlaying !== undefined) {
        setIsPlaying(data.isPlaying);
      }
    });

    newSocket.on('player-left', (data: any) => {
      console.log('Player left:', data);
    });

    newSocket.on('super-strict-updated', (data: any) => {
      setSuperStrict(!!data?.enabled);
      addLog(`Super-Strict Lock ${data?.enabled ? 'enabled' : 'disabled'}`, 'warn');
    });

    newSocket.on('hybrid-mode-updated', (data: any) => {
      if (typeof data?.hybridInPersonPlusOnline === 'boolean') {
        setHybridInPersonPlusOnline(data.hybridInPersonPlusOnline);
      }
    });

    // Listen for pattern updates
    newSocket.on('pattern-updated', (data: any) => {
      if (data?.pattern) {
        setPattern(data.pattern);
        addLog(`Pattern updated to ${data.pattern}`, 'info');
      }
    });

    newSocket.on('public-display-font-size-updated', (data: any) => {
      if (typeof data?.fontSize === 'number') {
        setPublicDisplayFontSize(data.fontSize);
      }
    });

    newSocket.on('public-display-call-list-mode-updated', (data: any) => {
      const m = data?.mode;
      if (m === 'grouped' || m === '5x15' || m === 'auto') {
        setPublicDisplayCallListMode(m);
      }
    });

    newSocket.on('room-state', (payload: any) => {
      if (
        payload?.publicDisplayCallListMode === 'grouped' ||
        payload?.publicDisplayCallListMode === '5x15' ||
        payload?.publicDisplayCallListMode === 'auto'
      ) {
        setPublicDisplayCallListMode(payload.publicDisplayCallListMode);
      }
      if (typeof payload?.publicDisplayFontSize === 'number') {
        setPublicDisplayFontSize(payload.publicDisplayFontSize);
      }
    });

    newSocket.on('fiveby15-pool', (data: any) => {
      if (Array.isArray(data?.names) && data.names.length === 5) {
        setBingoColumnPlaylistNames(data.names);
      }
    });

    // Listen for player card updates
    newSocket.on('player-cards-update', (data: any) => {
      try {
        console.log('?? Received player-cards-update:', data);
        if (data && typeof data === 'object') {
          const newPlayerCards = new Map();
          Object.entries(data).forEach(([playerId, cardData]: [string, any]) => {
            if (cardData && cardData.card) {
              console.log(`?? Host received player card for ${cardData.playerName}:`, {
                playedSongs: cardData.playedSongs,
                playedSongsLength: cardData.playedSongs?.length || 0,
                cardSquares: cardData.card.squares?.length || 0
              });
              newPlayerCards.set(playerId, {
                playerName: cardData.playerName || 'Unknown',
                card: cardData.card,
                playedSongs: cardData.playedSongs || [] // Ensure playedSongs is included
              });
            }
          });
          setPlayerCards((prev) => {
            let hasChanged =
              prev.size !== newPlayerCards.size ||
              Array.from(newPlayerCards.keys()).some((id) => {
                const old = prev.get(id);
                const updated = newPlayerCards.get(id);
                if (!old || !updated) return true;
                return hostPlayerCardSnapshot(old) !== hostPlayerCardSnapshot(updated);
              });
            if (!hasChanged) {
              const removed = Array.from(prev.keys()).some((id) => !newPlayerCards.has(id));
              if (removed) hasChanged = true;
            }
            if (!hasChanged) return prev;
            console.log('?? Updating playerCards map:', newPlayerCards.size, 'cards (was', prev.size, ')');
            if (prev.size === 0 && newPlayerCards.size > 0) {
              showToast(`Player cards loaded: ${newPlayerCards.size} players`, 'success');
            }
            setPlayerCardsVersion((v) => v + 1);
            return newPlayerCards;
          });

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const element = document.querySelector('.player-cards-section');
              console.log('?? Post-update DOM check (.player-cards-section):', element ? 'FOUND' : 'NOT FOUND');
            });
          });
        } else {
          console.log('?? No valid player cards data received');
        }
      } catch (e) {
        console.warn('Failed to parse player cards:', e);
      }
    });

    newSocket.on('playback-update', (data: any) => {
      setPlaybackState(prev => ({
        ...prev,
        currentTime: data.currentTime,
        isPlaying: data.isPlaying,
        volume: data.volume
      }));
    });

    newSocket.on('queue-update', (data: any) => {
      setPlaybackState(prev => ({
        ...prev,
        queue: data.queue,
        currentQueueIndex: data.currentIndex
      }));
    });

    newSocket.on('error', (data: any) => {
      const msg = data?.message || 'Unknown server error';
      console.error('Socket error:', msg);
      setIsStartingGame(false);
      alert(`Server error: ${msg}`);
      addLog(`Server error: ${msg}`, 'error');
    });

    newSocket.on('connect_error', (err: any) => {
      console.error('Socket connect_error:', err?.message || err);
    });

    newSocket.on('disconnect', (reason: string) => {
      hostJoinEmitted = false;
      console.warn('Socket disconnected:', reason);
      if (reason !== 'io client disconnect') {
        showToast('Connection lost - reconnecting...', 'warn');
      }
    });
    newSocket.io.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnecting socket (attempt ${attempt})...`);
    });
    newSocket.io.on('reconnect', () => {
      console.log('Socket reconnected. Refreshing Spotify status and devices.');
      hostJoinEmitted = false;
      emitHostJoinImpl();
      showToast('Connection restored', 'success');
      lastReconnectAtRef.current = Date.now();
      ignorePollingUntilRef.current = Date.now() + 15000; // ignore polling flips for 15s
      if (roomId && gameState === 'playing') {
        const now = Date.now();
        if (now - lastResumePingAtRef.current > 10000) {
          lastResumePingAtRef.current = now;
          setTimeout(() => {
            try { newSocket.emit('resume-song', { roomId }); } catch {}
          }, 500);
        }
      }
      (async () => {
        await fetchPlaybackState();
        await loadDevices();
        const now = Date.now();
        if (now - lastLoadPlaylistsOnSocketReconnectAtRef.current > 90_000) {
          lastLoadPlaylistsOnSocketReconnectAtRef.current = now;
          await loadPlaylists();
        }
        // Re-request player cards after reconnection to restore UI state
        setTimeout(() => {
          schedulePlayerCardsRefresh(300);
        }, 1000);
      })();
    });
    newSocket.io.on('reconnect_error', (err: any) => {
      console.warn('Reconnection error:', err?.message || err);
    });

    newSocket.on('game-reset', () => {
      setIsPlaying(false);
      setGameState('waiting');
      setCurrentSong(null);
      setWinners([]);
      setMixFinalized(false);
      setSongList([]);
      console.log('?? Game reset');
    });

    newSocket.on('playback-error', (data: any) => {
      const msg = data?.message || 'Playback error: Could not start on locked device.';
      const type = data?.type || 'general';
      const suggestions = data?.suggestions || [];
      
      console.error('Playback error:', msg);
      setSpotifyError(msg);
      
      if (type === 'restriction' && suggestions.length > 0) {
        const suggestionText = suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n');
        alert(`${msg}\n\nPossible solutions:\n${suggestionText}\n\nTip: Ensure Spotify is open and active on your chosen device, then use Transfer Playback in the Spotify app.`);
      } else {
        alert(msg + '\n\nTip: Ensure Spotify is open and active on your chosen device, then use Transfer Playback in the Spotify app.');
      }
      
      addLog(`Playback error: ${msg}`, 'error');
    });

    newSocket.on('playback-warning', (data: any) => {
      const msg = data?.message || 'Playback warning occurred';
      const type = data?.type || 'general';
      const suggestions = data?.suggestions || [];
      
      console.warn('Playback warning:', msg);
      addLog(`Playback warning: ${msg}`, 'warn');
      
      // Show helpful suggestions for restriction warnings
      if (type === 'restriction' && suggestions.length > 0) {
        const suggestionText = suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n');
        console.log(`Restriction suggestions:\n${suggestionText}`);
        // Non-blocking toast instead of alert to avoid desync
        try {
          const toast = document.createElement('div');
          toast.textContent = msg;
          Object.assign(toast.style, {
            position: 'fixed', bottom: '14px', left: '14px', maxWidth: '70vw',
            background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
            padding: '10px 12px', borderRadius: '10px', zIndex: 9999, fontWeight: 700
          } as unknown as CSSStyleDeclaration);
          document.body.appendChild(toast);
          setTimeout(() => { try { document.body.removeChild(toast); } catch {} }, 3000);
        } catch {}
      }
    });

    newSocket.on('playback-diagnostic', (diag: any) => {
      try {
        const payload = JSON.stringify(diag, null, 2);
        addLog(`Playback diagnostic: ${payload}`, 'warn');
        // Also print to console for devs
        console.log('?? Playback diagnostic', diag);
      } catch {}
    });

    // Handle 5x15 deduplication warnings
    newSocket.on('mode-warning', (data: any) => {
      const msg = data?.message || 'Mode warning occurred';
      console.warn('Mode warning:', msg);
      addLog(`Mode warning: ${msg}`, 'warn');
      if (data?.details && Array.isArray(data.details)) {
        data.details.forEach((detail: string) => {
          addLog(`  ${detail}`, 'warn');
        });
      }
      // Show toast notification
      try {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
          position: 'fixed', bottom: '14px', left: '14px', maxWidth: '70vw',
          background: 'rgba(255,193,7,0.1)', color: '#fff', border: '1px solid rgba(255,193,7,0.5)',
          padding: '10px 12px', borderRadius: '10px', zIndex: 9999, fontWeight: 700
        } as unknown as CSSStyleDeclaration);
        document.body.appendChild(toast);
        setTimeout(() => { try { document.body.removeChild(toast); } catch {} }, 5000);
      } catch {}
    });

    // Handle successful deduplication notifications
    newSocket.on('deduplication-success', (data: any) => {
      if (data?.totalDuplicatesRemoved > 0) {
        const msg = `Removed ${data.totalDuplicatesRemoved} duplicate songs across playlists for 5x15 mode`;
        console.log('Deduplication success:', msg);
        addLog(`? ${msg}`, 'info');
        if (data?.playlistDetails && Array.isArray(data.playlistDetails)) {
          data.playlistDetails.forEach((detail: any) => {
            if (detail.duplicatesRemoved > 0) {
              addLog(`  ${detail.name}: ${detail.originalCount} ? ${detail.finalCount} songs (${detail.duplicatesRemoved} duplicates removed)`, 'info');
            }
          });
        }
      }
    });

    // Acknowledge reveal events
    newSocket.on('call-revealed', (data: any) => {
      addLog(`Call revealed: ${data.hint || 'full'} ${data.songName ? '— ' + data.songName : ''} ${data.artistName ? '— ' + data.artistName : ''}`, 'info');
    });

    // Handle join errors (license key validation)
    newSocket.on('join-error', (data: any) => {
      console.log('Join error:', data);
      setLicenseError(data.error || 'Failed to join room');
      setIsJoiningRoom(false);
    });

    newSocket.on('host-join-denied', (data: any) => {
      console.warn('host-join-denied:', data);
      setIsJoiningRoom(false);
      addLog(data.message || 'This room already has a host.', 'error');
      if (data.reason === 'host_not_approved') {
        try {
          sessionStorage.setItem('skip_prefill_host_nav', '1');
        } catch {
          /* ignore */
        }
        navigate(`/?mode=host&auth_error=host_not_approved`);
        return;
      }
      if (data.reason === 'invalid_host_secret') {
        const jwt = getHostJwt();
        if (jwt && !hostSecretRetryOnce) {
          hostSecretRetryOnce = true;
          newSocket.emit('join-room', {
            roomId,
            playerName: hostPlayerName,
            isHost: true,
            clientId,
            hostSecret: '',
            hostToken: jwt,
            inPerson: true,
          });
          return;
        }
        try {
          sessionStorage.setItem('skip_prefill_host_nav', '1');
        } catch {
          /* ignore */
        }
        navigate(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
        return;
      }
      if (data.reason === 'not_room_owner') {
        try {
          sessionStorage.setItem('skip_prefill_host_nav', '1');
        } catch {
          /* ignore */
        }
        navigate(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
        return;
      }
      /** Room already has an active host socket (other tab, other device, or race). Never send the host UI to /player — that was confusing and looked like a random redirect. */
      if (data.reason === 'room_has_host') {
        try {
          sessionStorage.setItem('skip_prefill_host_nav', '1');
        } catch {
          /* ignore */
        }
        navigate(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
        return;
      }
      try {
        sessionStorage.setItem('skip_prefill_host_nav', '1');
      } catch {
        /* ignore */
      }
      if (roomId) {
        navigate(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
      } else {
        navigate('/?mode=host');
      }
    });

    // Handle successful room join
    newSocket.on('room-joined', (data: any) => {
      console.log('Successfully joined room:', data);
      setIsJoiningRoom(false);
      setLicenseError(null);
      setIsLicenseValidated(true);
      if (typeof data?.hybridInPersonPlusOnline === 'boolean') {
        setHybridInPersonPlusOnline(data.hybridInPersonPlusOnline);
      }
      addLog(`Joined room ${roomId} successfully`, 'info');
      
      // Force check Spotify status after joining room
      setTimeout(async () => {
        console.log('?? Rechecking Spotify status after room join...');
        try {
          const cacheBuster = Date.now();
          const response = await hostFetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
          const data = await response.json();
          console.log('?? Recheck response:', data);
          console.log('?? Recheck response details:', JSON.stringify(data, null, 2));
          
          if (data.connected) {
            console.log('? Spotify found connected after room join!');
            setIsSpotifyConnected(true);
            setIsSpotifyConnecting(false);
          }
        } catch (error) {
          console.error('Error rechecking Spotify status:', error);
        }
      }, 1000);
    });

    // Join as host after the socket is connected so the handshake runs first; re-read JWT at emit time.
    const onConnectJoin = () => emitHostJoinImpl();
    emitHostJoinImpl = () => {
      if (!roomId || hostJoinEmitted) return;
      hostJoinEmitted = true;
      console.log('?? License validation disabled - joining room as host');
      newSocket.emit('join-room', {
        roomId,
        playerName: hostPlayerName,
        isHost: true,
        clientId,
        hostSecret: '',
        hostToken: getHostJwt() || '',
        inPerson: true,
      });
    };
    newSocket.on('connect', onConnectJoin);
    if (newSocket.connected) emitHostJoinImpl();

    // Check Spotify status and load playlists if connected
    const checkSpotifyStatus = async () => {
      try {
        // Returning from Spotify OAuth: dedicated effect handles status + loads (with delay/retry). Avoid duplicate API calls and false "not connected".
        try {
          if (new URLSearchParams(window.location.search).get('spotify') === 'connected') {
            return;
          }
        } catch {
          /* ignore */
        }
        console.log('Host view loaded, checking Spotify status...');
        // Add cache-busting parameter to force fresh request
        const cacheBuster = Date.now();
        const response = await hostFetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
        const data = await response.json();

        if (data.connected) {
          console.log('Spotify already connected, loading playlists...');
          console.log('?? Status API returned connected=true, setting state to true');
          setIsSpotifyConnected(true);
          setIsSpotifyConnecting(false);
          await loadPlaylists();
          await loadDevices(); // Load devices when connected
          
          // Sync volume when Spotify connects to ensure it matches interface
          setTimeout(() => {
            syncVolumeToSpotify();
          }, 1000);
        } else {
          console.log('Spotify not connected');
          console.log('?? Status API returned connected=false, setting state to false');
          setIsSpotifyConnected(false);
          setIsSpotifyConnecting(false);
        }
      } catch (error) {
        console.error('Error checking Spotify status:', error);
        setIsSpotifyConnected(false);
        setIsSpotifyConnecting(false);
      } finally {
        setSpotifyInitialCheckDone(true);
      }
    };

    checkSpotifyStatus();

    // Cleanup socket on unmount
    return () => {
      newSocket.off('connect', onConnectJoin);
      if (playerCardsRefreshTimer) clearTimeout(playerCardsRefreshTimer);
      newSocket.close();
      // Clear any pending volume timeout
      if (volumeTimeout) {
        clearTimeout(volumeTimeout);
      }
    };
  }, [
    hostAuthBootstrapDone,
    roomId,
    loadPlaylists,
    loadDevices,
    hostPlayerName,
    clientId,
    navigate,
    disconnectSpotify,
  ]);



  const connectSpotify = useCallback(async () => {
    try {
      console.log('Initiating Spotify connection...');
      setIsSpotifyConnecting(true);
      setSpotifyError(null);
      
      // Check if Spotify is already connected (with cache-busting)
      const cacheBuster = Date.now();
      const statusResponse = await hostFetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
      const statusData = await statusResponse.json();
      
      if (statusData.connected) {
        console.log('Spotify already connected, loading playlists...');
        setIsSpotifyConnected(true);
        setIsSpotifyConnecting(false);
        await loadPlaylists();
        return;
      }
      
      // If not connected, initiate OAuth flow (server puts signed JWT in ?state= including roomId)
        const appOrigin =
          typeof window !== 'undefined' ? `&appOrigin=${encodeURIComponent(window.location.origin)}` : '';
        const response = await hostFetch(
        `${API_BASE || ''}/api/spotify/auth?roomId=${encodeURIComponent(roomId || '')}${appOrigin}`
      );
      const data = (await response.json().catch(() => ({}))) as {
        authUrl?: string;
        error?: string;
        message?: string;
        loginUrl?: string;
      };

      if (response.status === 401 || data.error === 'login_required') {
        try {
          const qs = new URLSearchParams();
          const n = searchParams.get('name');
          if (n) qs.set('name', n);
          const q = qs.toString();
          sessionStorage.setItem(
            'tempo_post_auth_return',
            `/host/${encodeURIComponent(roomId || '')}${q ? `?${q}` : ''}`
          );
          sessionStorage.setItem(HOST_DISPLAY_NAME_KEY, hostPlayerName);
        } catch {
          /* ignore */
        }
        window.location.href = browserGoogleLoginUrl();
        setIsSpotifyConnecting(false);
        return;
      }

      if (!response.ok) {
        setSpotifyError(
          data.message ||
            data.error ||
            `Could not start Spotify login (HTTP ${response.status}). Check server logs.`
        );
        setIsSpotifyConnecting(false);
        return;
      }

      if (data.authUrl) {
        if (!roomId) {
          setSpotifyError('Missing room code. Go back to home and start hosting again.');
          setIsSpotifyConnecting(false);
          return;
        }

        const returnUrl = `/host/${roomId}`;
        localStorage.setItem('spotify_return_url', returnUrl);
        try {
          sessionStorage.setItem('spotify_return_url', returnUrl);
        } catch {
          /* ignore */
        }
        localStorage.setItem('spotify_room_id', roomId);
        try {
          sessionStorage.setItem('spotify_room_id', roomId);
        } catch {
          /* ignore */
        }
        try {
          localStorage.setItem('spotify_oauth_pending_room', roomId);
          sessionStorage.setItem('spotify_oauth_pending_room', roomId);
        } catch {
          /* ignore */
        }
        try {
          sessionStorage.setItem(HOST_DISPLAY_NAME_KEY, hostPlayerName);
        } catch {
          /* ignore */
        }

        // Do not append &state= here — the server already set state to a signed JWT (room is inside it).
        window.location.href = data.authUrl;
      } else {
        console.error('Failed to get Spotify authorization URL', response.status, data);
        setSpotifyError(
          data.message ||
            data.error ||
            'Failed to get Spotify authorization URL. Please try again.'
        );
        setIsSpotifyConnecting(false);
      }
    } catch (error) {
      console.error('Error connecting to Spotify:', error);
      setSpotifyError('Failed to connect to Spotify. Please check your internet connection and try again.');
      setIsSpotifyConnecting(false);
    }
  }, [roomId, searchParams, hostPlayerName]);




  /** Returns true when server confirms mix-finalized (or already finalized on client). */
  const finalizeMix = async (): Promise<boolean> => {
    if (!socket || selectedPlaylists.length === 0) return false;
    if (mixFinalized) return true;

    try {
      // Check if songs have playlist information, if not regenerate
      const needsRegeneration = songList.length > 0 && !songList[0]?.sourcePlaylistId;
      if (needsRegeneration) {
        console.log('?? Songs missing playlist info, regenerating...');
        await generateSongList();
        // Wait a moment for the song list to update
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log('?? Finalizing mix with songList:', {
        length: songList.length,
        hasPlaylistInfo: songList.length > 0 ? !!songList[0]?.sourcePlaylistId : false,
        firstSong: songList.length > 0 ? {
          id: songList[0].id,
          name: songList[0].name,
          sourcePlaylistId: songList[0].sourcePlaylistId,
          sourcePlaylistName: songList[0].sourcePlaylistName
        } : null
      });

      // Include current host-side songList ordering to enforce 1x75 pool deterministically
      console.log('?? Finalizing mix - Playlist order being sent to server:');
      selectedPlaylists.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.name} (will be column ${i})`);
      });

      return await new Promise<boolean>((resolve) => {
        const timeoutMs = 25000;
        const t = window.setTimeout(() => {
          socket.off('mix-finalized', onFinalized);
          console.warn('finalize-mix timed out');
          resolve(false);
        }, timeoutMs);

        const onFinalized = (data: any) => {
          window.clearTimeout(t);
          socket.off('mix-finalized', onFinalized);
          console.log('Mix finalized:', data);
          setMixFinalized(true);
          setTimeout(() => {
            requestPlayerCards({ announce: true });
          }, 500);
          resolve(true);
        };

        socket.on('mix-finalized', onFinalized);
        socket.emit('finalize-mix', {
          roomId: roomId,
          playlists: selectedPlaylists,
          songList,
          freeSpace: freeSpaceEnabled
        });
      });
    } catch (error) {
      console.error('Error finalizing mix:', error);
      return false;
    }
  };

  const startGame = async () => {
    if (selectedPlaylists.length === 0) {
      alert('Please select at least one playlist');
      return;
    }

    if (!selectedDevice) {
      alert(
        'Please select a Spotify playback device first.\n\nOpen Connection (header button), pick a device in Playback device, or open Spotify on your target device and tap Refresh devices.'
      );
      return;
    }

    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    if (!isSpotifyConnected) {
      alert('Spotify is not connected. Open Connection in the header and connect Spotify first.');
      return;
    }

    if (songList.length === 0) {
      alert('No songs loaded from playlists. Ensure Spotify is connected and playlists have tracks, then try again.');
      return;
    }

    try {
      if (!mixFinalized) {
        addLog('Finalizing mix before start...', 'info');
        const ok = await finalizeMix();
        if (!ok) {
          alert(
            'Could not finalize the mix in time. Try the Finalize Mix button, wait for the confirmation, then Start Game.'
          );
          return;
        }
      }

      console.log('Starting game with playlists:', selectedPlaylists);
      setIsStartingGame(true);
      socket.emit('start-game', {
        roomId,
        playlists: selectedPlaylists,
        snippetLength,
        deviceId: selectedDevice.id, // Require the selected device ID
        songList: songList, // Send the shuffled song list to ensure server uses same order
        randomStarts,
        pattern,
        customMask,
        freeSpace: freeSpaceEnabled
      });
      
      // Safety timeout in case no response comes back
      setTimeout(() => setIsStartingGame(false), 8000);
    } catch (error) {
      console.error('Error starting game:', error);
      setIsStartingGame(false);
    }
  };

  const endGame = () => {
    if (!socket || !roomId) return;
    socket.emit('end-game', { roomId, stopPlayback: true });
    addLog('End game requested', 'info');
  };

  const requestPlayerCards = (opts?: { announce?: boolean }) => {
    if (!socket || !roomId) {
      console.log('? Cannot request player cards: socket or roomId missing', { socket: !!socket, roomId });
      if (opts?.announce) showToast('Cannot request cards - not connected', 'error');
      return;
    }
    console.log('?? Requesting player cards for room:', roomId);
    socket.emit('request-player-cards', { roomId });
    if (opts?.announce) {
      showToast('Refreshing player cards…', 'info');
      addLog('Requested player cards', 'info');
    }
  };

  // Calculate win progress for a player's card based on actual patterns
  const calculateWinProgress = (card: any, currentPattern: string, playedSongs: string[] = []) => {
    if (!card || !card.squares) return { marked: 0, legitimate: 0, needed: 5, progress: 0, patternProgress: 0 };
    
    const squares = card.squares;
    let markedCount = 0;
    let legitimateMarkedCount = 0;
    
    // Count all marked squares and legitimate marks
    squares.forEach((square: any) => {
      if (square.marked) {
        markedCount++;
        if (square.isFreeSpace || square.songId === '__FREE_SPACE__' || playedSongs.includes(square.songId)) {
          legitimateMarkedCount++;
        }
      }
    });
    
    // Helper function to check if a square is legitimately marked
    const isLegitimatelyMarked = (square: any) => {
      if (!square?.marked) return false;
      if (square.isFreeSpace || square.songId === '__FREE_SPACE__') return true;
      return playedSongs.includes(square.songId);
    };
    
    // Calculate pattern-specific progress
    let patternProgress = 0;
    let totalNeeded = 5;
    let bestProgress = 0;
    
    if (currentPattern === 'line') {
      // Check rows, columns, and diagonals for the best progress
      let maxProgress = 0;
      
      // Check rows
      for (let row = 0; row < 5; row++) {
        let rowProgress = 0;
        for (let col = 0; col < 5; col++) {
          const square = squares.find((s: any) => s.position === `${row}-${col}`);
          if (square && isLegitimatelyMarked(square)) {
            rowProgress++;
          }
        }
        maxProgress = Math.max(maxProgress, rowProgress);
      }
      
      // Check columns
      for (let col = 0; col < 5; col++) {
        let colProgress = 0;
        for (let row = 0; row < 5; row++) {
          const square = squares.find((s: any) => s.position === `${row}-${col}`);
          if (square && isLegitimatelyMarked(square)) {
            colProgress++;
          }
        }
        maxProgress = Math.max(maxProgress, colProgress);
      }
      
      // Check diagonals
      let diag1Progress = 0;
      let diag2Progress = 0;
      for (let i = 0; i < 5; i++) {
        const square1 = squares.find((s: any) => s.position === `${i}-${i}`);
        const square2 = squares.find((s: any) => s.position === `${i}-${4-i}`);
        
        if (square1 && isLegitimatelyMarked(square1)) diag1Progress++;
        if (square2 && isLegitimatelyMarked(square2)) diag2Progress++;
      }
      maxProgress = Math.max(maxProgress, diag1Progress, diag2Progress);
      
      patternProgress = maxProgress;
      bestProgress = maxProgress;
    } else if (currentPattern === 'full_card') {
      patternProgress = legitimateMarkedCount;
      totalNeeded = 25;
      bestProgress = legitimateMarkedCount;
    } else if (currentPattern === 'four_corners') {
      const corners = ['0-0', '0-4', '4-0', '4-4'];
      let cornerProgress = 0;
      corners.forEach(pos => {
        const square = squares.find((s: any) => s.position === pos);
        if (square && isLegitimatelyMarked(square)) {
          cornerProgress++;
        }
      });
      patternProgress = cornerProgress;
      totalNeeded = 4;
      bestProgress = cornerProgress;
    } else if (currentPattern === 'x') {
      let xProgress = 0;
      for (let i = 0; i < 5; i++) {
        const square1 = squares.find((s: any) => s.position === `${i}-${i}`);
        const square2 = squares.find((s: any) => s.position === `${i}-${4-i}`);
        
        if (square1 && isLegitimatelyMarked(square1)) xProgress++;
        if (square2 && isLegitimatelyMarked(square2)) xProgress++;
      }
      patternProgress = xProgress;
      totalNeeded = 9;
      bestProgress = xProgress;
    } else if (currentPattern === 'custom') {
      // For custom patterns, we'd need the custom mask from the server
      // For now, fall back to line logic
      patternProgress = legitimateMarkedCount;
      bestProgress = legitimateMarkedCount;
    }
    
    const needed = Math.max(0, totalNeeded - bestProgress);
    const progress = totalNeeded > 0 ? Math.round((bestProgress / totalNeeded) * 100) : 0;
    
    return { 
      marked: markedCount, 
      legitimate: legitimateMarkedCount,
      needed, 
      progress,
      patternProgress: bestProgress,
      totalNeeded
    };
  };

  const hostBingoColumnHeaders = useMemo(() => {
    if (bingoColumnPlaylistNames.length === 5) return bingoColumnPlaylistNames;
    if (selectedPlaylists.length === 5) return selectedPlaylists.map((p) => p.name);
    return [];
  }, [bingoColumnPlaylistNames, selectedPlaylists]);

  /** Shared player-card grid for inline host view and full-screen overlay (compact = inline strip). */
  const renderHostPlayerCardsGrid = (compact: boolean) => {
    const cellFont = compact ? '0.7rem' : '0.88rem';
    const innerMax = compact ? '300px' : 'min(400px, 38vw)';
    const labelMax = compact ? 12 : 20;
    const outerGridCols = compact
      ? 'repeat(auto-fit, minmax(320px, 1fr))'
      : 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))';

    return (
      <div
        key={`host-pc-grid-${playerCardsVersion}-${compact ? 'c' : 'fs'}`}
        style={{
          display: 'grid',
          gridTemplateColumns: outerGridCols,
          gap: compact ? 16 : 22
        }}
      >
        {Array.from(playerCards.entries()).map(([playerId, playerData]) => (
          <div
            key={playerId}
            style={{
              background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
              border: '1px solid rgba(0,255,136,0.3)',
              borderRadius: '12px',
              padding: compact ? '16px' : '18px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            }}
          >
            <div
              style={{
                fontWeight: 'bold',
                marginBottom: '8px',
                color: '#00ff88',
                fontSize: compact ? '1rem' : '1.15rem',
                textAlign: 'center'
              }}
            >
              {playerData.playerName}
            </div>

            {(() => {
              const progress = calculateWinProgress(playerData.card, pattern, playerData.playedSongs || []);
              const progressColor =
                progress.needed === 0
                  ? '#00ff88'
                  : progress.needed <= 2
                    ? '#ffaa00'
                    : progress.progress >= 50
                      ? '#66ccff'
                      : '#888';
              const progressText =
                progress.needed === 0
                  ? 'BINGO!'
                  : progress.needed === 1
                    ? '1 more needed!'
                    : `${progress.needed} more needed`;
              const cheatingCount = progress.marked - progress.legitimate;
              const patternText = `${progress.patternProgress}/${progress.totalNeeded} in pattern (${progress.progress}%)`;

              return (
                <div
                  style={{
                    marginBottom: '12px',
                    textAlign: 'center',
                    fontSize: compact ? '0.85rem' : '0.95rem'
                  }}
                >
                  <div
                    style={{
                      color: progressColor,
                      fontWeight: 600,
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {progress.needed === 0 && <Trophy className="w-4 h-4" style={{ color: progressColor }} aria-hidden />}
                    {progressText}
                  </div>
                  {cheatingCount > 0 && (
                    <div
                      style={{
                        color: '#ff4444',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <AlertTriangle className="w-4 h-4" aria-hidden />
                      {cheatingCount} invalid mark{cheatingCount > 1 ? 's' : ''}
                    </div>
                  )}
                  <div
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      height: '6px',
                      overflow: 'hidden',
                      margin: '0 auto',
                      maxWidth: compact ? '200px' : '260px'
                    }}
                  >
                    <div
                      style={{
                        background: progressColor,
                        height: '100%',
                        width: `${progress.progress}%`,
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: compact ? '0.75rem' : '0.8rem',
                      color: '#b3b3b3',
                      marginTop: '2px'
                    }}
                  >
                    {patternText}
                    {progress.marked !== progress.legitimate && (
                      <span style={{ color: '#ff8888', marginLeft: '4px' }}>
                        ({progress.marked} total marked)
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
            <div style={{ maxWidth: innerMax, margin: '0 auto', width: '100%' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '4px',
                  marginBottom: compact ? 3 : 4,
                }}
                aria-hidden
              >
                {(['B', 'I', 'N', 'G', 'O'] as const).map((letter, colIdx) => {
                  const raw = hostBingoColumnHeaders[colIdx] || '';
                  const playlistLabel = stripGotPlaylistPrefix(raw);
                  return (
                    <div
                      key={letter}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        gap: compact ? 2 : 3,
                        minWidth: 0,
                        userSelect: 'none',
                      }}
                    >
                      <span
                        style={{
                          fontSize: compact ? '0.58rem' : '0.7rem',
                          fontWeight: 800,
                          letterSpacing: '0.06em',
                          color: 'rgba(0, 255, 163, 0.95)',
                          lineHeight: 1.1,
                        }}
                      >
                        {letter}
                      </span>
                      {playlistLabel ? (
                        <span
                          title={playlistLabel}
                          style={{
                            fontSize: compact ? '0.5rem' : '0.6rem',
                            fontWeight: 600,
                            lineHeight: 1.15,
                            color: 'rgba(220, 230, 240, 0.9)',
                            wordBreak: 'break-word',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical' as const,
                            overflow: 'hidden',
                            width: '100%',
                          }}
                        >
                          {playlistLabel}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '4px',
                  aspectRatio: '1/1',
                }}
              >
              {playerData.card.squares.map((square: any) => {
                const isFree = !!(square.isFreeSpace || square.songId === '__FREE_SPACE__');
                const isPlayed = (playerData.playedSongs || []).includes(square.songId);
                const isMarked = square.marked;
                const isLegitimate = isMarked && (isFree || isPlayed);

                let bgColor: string;
                let borderColor: string;
                let textColor: string;
                let icon: string;
                let statusText: string;

                if (isLegitimate) {
                  bgColor = 'linear-gradient(135deg, #00ff88, #00cc6d)';
                  borderColor = '#00ff88';
                  textColor = '#001a0d';
                  icon = '?';
                  statusText = isFree ? 'Free space' : 'Legitimate';
                } else if (isMarked && !isFree && !isPlayed) {
                  bgColor = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
                  borderColor = '#ff4757';
                  textColor = '#ffffff';
                  icon = '?';
                  statusText = 'Invalid - Not played yet!';
                } else if (!isMarked && isPlayed) {
                  bgColor = 'linear-gradient(135deg, #4dabf7, #339af0)';
                  borderColor = '#339af0';
                  textColor = '#ffffff';
                  icon = '?';
                  statusText = 'Played but not marked';
                } else {
                  bgColor = 'rgba(255,255,255,0.1)';
                  borderColor = 'rgba(255,255,255,0.3)';
                  textColor = '#ffffff';
                  icon = '';
                  statusText = 'Not played';
                }

                return (
                  <div
                    key={square.position}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: bgColor,
                      border: `2px solid ${borderColor}`,
                      borderRadius: '8px',
                      padding: '4px',
                      fontSize: cellFont,
                      fontWeight: isMarked ? 700 : 400,
                      color: textColor,
                      textAlign: 'center',
                      lineHeight: 1.1,
                      overflow: 'hidden'
                    }}
                    title={`${isFree ? 'FREE' : square.songName} — ${isFree ? '' : square.artistName}\nStatus: ${statusText}`}
                  >
                    {icon && <span style={{ marginRight: 2 }}>{icon}</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(() => {
                        const label = isFree ? 'FREE' : square.songName;
                        return label.length > labelMax ? label.substring(0, labelMax) + '...' : label;
                      })()}
                    </span>
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  useEffect(() => {
    if (!playerCardsFullscreen) {
      setPlayerCardsMaximized(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlayerCardsFullscreen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [playerCardsFullscreen]);

  const openPlayerCardsModal = () => {
    setPlayerCardsMaximized(false);
    setPlayerCardsFullscreen(true);
  };

  const openPlayerCardsFullscreen = () => {
    setPlayerCardsMaximized(true);
    setPlayerCardsFullscreen(true);
  };

  const closePlayerCardsOverlay = () => {
    setPlayerCardsFullscreen(false);
    setPlayerCardsMaximized(false);
  };

  const resetDisplayLetters = () => {
    if (!socket || !roomId) return;
    socket.emit('display-reset-letters', { roomId });
    showToast('Resetting letters on public display...', 'info');
    addLog('Display letters reset', 'info');
  };

  // Round management functions



  const resetEvent = () => {
    if (window.confirm('Reset entire event?\n\nThis will:\n• Reset all rounds to unplanned status\n• Clear all round progress\n• End the current game if running\n• Allow you to replay from Round 1\n\nThis cannot be undone. Continue?')) {
      // End current game if running
      if (gameState === 'playing') {
        endGame();
      }
      
      // Reset all rounds to unplanned status
      const resetRounds = eventRounds.map((round, index) => ({
        ...round,
        status: 'unplanned' as const,
        startedAt: undefined,
        completedAt: undefined
      }));
      
      // Update rounds and reset current round index
      setEventRounds(resetRounds);
      setCurrentRoundIndex(-1);
      
      // Save to localStorage
      if (roomId) {
        localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(resetRounds));
      }
      
      // Clear selected playlists and reset game state
      setSelectedPlaylists([]);
      setMixFinalized(false);
      setSongList([]);
      setGameState('waiting');
      
      addLog('?? Event reset - All rounds returned to unplanned status', 'info');
    }
  };


  const updatePattern = (next: BingoPattern) => {
    setPattern(next);
    if (socket && roomId) {
      socket.emit('set-pattern', { roomId, pattern: next, customMask });
      addLog(`Pattern set to ${next}`, 'info');
    }
  };

  const handleCustomPatternSelect = (customPattern: SavedCustomPattern) => {
    setSelectedCustomPattern(customPattern);
    setPattern('custom');
    setCustomPattern(customPattern.positions);
    if (socket && roomId) {
      socket.emit('set-pattern', { roomId, pattern: 'custom', customMask: customPattern.positions });
      addLog(`Custom pattern set to ${customPattern.name}`, 'info');
    }
  };

  const handleNewCustomPattern = () => {
    setShowCustomPatternModal(true);
  };

  const handleSaveCustomPattern = (patternData: { name: string; positions: string[] }) => {
    const savedPattern = saveCustomPattern(patternData);
    setSavedCustomPatterns(getSavedCustomPatterns());
    handleCustomPatternSelect(savedPattern);
    setShowCustomPatternModal(false);
  };

  // Song title editing functions
  const handleEditSongTitle = (song: {id: string, title: string, artist: string}) => {
    setEditingSong(song);
    setShowSongTitleModal(true);
  };

  const handleSaveSongTitle = (songId: string, customTitle: string) => {
    if (socket) {
      socket.emit('set-custom-song-title', { songId, customTitle });
    }
  };

  const getDisplaySongTitle = (songId: string, originalTitle: string) => {
    // If there's a custom title, use it; otherwise use auto-cleaned original title
    return customSongTitles[songId] || cleanSongTitle(originalTitle);
  };

  const playSong = async (song: Song) => {
    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    try {
      // If we're already playing this song, justResume
      if (isPlaying && currentSong?.id === song.id) {
        socket.emit('resume-song', { roomId });
        setIsPlaying(true);
        setPlaybackState(prev => ({ ...prev, isPlaying: true }));
        console.log('Resumed song via socket');
      } else {
        // Check if we were paused by the interface and need toResume from exact position
        if (isPausedByInterface && currentSong?.id === song.id) {
          console.log(`??? Resuming from exact pause position: ${pausePosition}ms`);
          socket.emit('resume-song', { 
            roomId, 
            resumePosition: pausePosition 
          });
          setIsPlaying(true);
          setPlaybackState(prev => ({ 
            ...prev, 
            isPlaying: true,
            currentTime: pausePosition 
          }));
          setIsPausedByInterface(false);
        } else {
          // For new songs or external changes, justResume normally
          socket.emit('resume-song', { roomId });
          setIsPlaying(true);
          setPlaybackState(prev => ({ ...prev, isPlaying: true }));
          console.log('Started/resumed song via socket');
        }
      }
    } catch (error) {
      console.error('Error playing song:', error);
    }
  };

  const pauseSong = async () => {
    try {
      if (socket) {
        if (isPlaying) {
          // Pause the song
          setPausePosition(playbackState.currentTime);
          setIsPausedByInterface(true);
          
          socket.emit('pause-song', { roomId });
          setIsPlaying(false);
          setPlaybackState(prev => ({ ...prev, isPlaying: false }));
          console.log(`?? Paused song at position: ${playbackState.currentTime}ms`);
        } else {
          // Resume the song
          if (isPausedByInterface && currentSong) {
            console.log(`?? Resuming from exact pause position: ${pausePosition}ms`);
            socket.emit('resume-song', { 
              roomId, 
              resumePosition: pausePosition 
            });
            setIsPlaying(true);
            setPlaybackState(prev => ({ 
              ...prev, 
              isPlaying: true,
              currentTime: pausePosition 
            }));
            setIsPausedByInterface(false);
          } else {
            // Resume normally
            socket.emit('resume-song', { roomId });
            setIsPlaying(true);
            setPlaybackState(prev => ({ ...prev, isPlaying: true }));
            console.log('?? Resumed song');
          }
        }
      }
    } catch (error) {
      console.error('Error pausing/resuming song:', error);
    }
  };

  const skipSong = async () => {
    try {
      if (socket) {
        socket.emit('skip-song', { roomId });
        console.log('Skipped to next track via socket');
      }
    } catch (error) {
      console.error('Error skipping song:', error);
    }
  };


  // Host alert sound for bingo calls
  const playHostAlertSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Urgent attention-getting sound
      const playNote = (freq: number, startTime: number, duration: number) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.4, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      
      const now = audioContext.currentTime;
      // Attention-getting pattern
      playNote(800, now, 0.15);
      playNote(1000, now + 0.2, 0.15);
      playNote(800, now + 0.4, 0.15);
    } catch (error) {
      console.log('Audio not supported');
    }
  };

  const handleVerifyBingo = (approved: boolean, reason?: string) => {
    if (!pendingVerification) {
      console.error('No pending verification to process');
      addLog('Error: No bingo verification pending', 'error');
      return;
    }
    
    if (!socket) {
      console.error('Socket not connected');
      addLog('Error: Connection lost - please refresh page', 'error');
      return;
    }
    
    console.log(`Sending verification: ${approved ? 'APPROVED' : 'REJECTED'} for ${pendingVerification.playerName}`);
    addLog(`${approved ? 'Approving' : 'Rejecting'} ${pendingVerification.playerName}'s bingo`, 'info');
    
    setIsProcessingVerification(true);
    
    if (verificationTimeoutRef.current) {
      clearTimeout(verificationTimeoutRef.current);
      verificationTimeoutRef.current = null;
    }
    socket.emit('verify-bingo', {
      roomId,
      playerId: pendingVerification.playerId,
      playerName: pendingVerification.playerName,
      approved,
      reason: reason || (approved ? 'Valid pattern' : 'Invalid pattern')
    });
    verificationTimeoutRef.current = setTimeout(() => {
      verificationTimeoutRef.current = null;
      console.warn('Verification response timeout - clearing modal');
      addLog('Verification response timeout - modal cleared', 'warn');
      setPendingVerification(null);
      setGamePaused(false);
      setIsProcessingVerification(false);
    }, 15000);
  };

  // Removed handleContinueOrEnd - games now end automatically on first verified bingo

  // NEW: Multi-round system handlers
  const handleStartNextRound = () => {
    if (!socket || !roomId) {
      console.error('?? Cannot start next round: socket or roomId missing', { socket: !!socket, roomId });
      addLog('Error: Cannot start next round - connection issue', 'error');
      return;
    }
    
    const confirmed = window.confirm(
      'Start next round with fresh setup?\n\n' +
      'This will:\n' +
      '• Keep all players connected\n' +
      '• Keep Spotify connection\n' +
      '• Reset to setup screen for new playlists/pattern\n' +
      '• Clear all bingo cards\n\n' +
      'Click OK to proceed.'
    );
    
    if (confirmed) {
      console.log('?? Starting next round with full reset for room:', roomId);
      try {
        socket.emit('start-next-round', { roomId, fullReset: true });
        addLog(`Starting fresh round setup...`, 'info');
        // Optimistically close modal (will be confirmed by next-round-reset event)
        setRoundComplete(null);
      } catch (error) {
        console.error('? Error starting next round:', error);
        addLog('Error starting next round - please try again', 'error');
      }
    }
  };

  const handleEndGameSession = () => {
    if (!socket) return;
    
    const confirmed = window.confirm(
      'Are you sure you want to end the entire game session?\n\n' +
      'This will permanently end the game for all players.'
    );
    
    if (confirmed) {
      console.log('Ending game session...');
      socket.emit('end-game-session', { roomId });
      addLog('Ending game session', 'info');
    }
  };





  const selectPlaylist = (playlist: Playlist) => {
    setSelectedPlaylists(prev => {
      const isSelected = prev.find(p => p.id === playlist.id);
      if (isSelected) {
        return prev.filter(p => p.id !== playlist.id);
      } else {
        return [...prev, playlist];
      }
    });
  };

  // Generate and shuffle song list from selected playlists
  const generateSongList = useCallback(async () => {
    if (!isSpotifyConnected) {
      console.warn('Cannot generate song list: Spotify not connected');
      console.log('?? isSpotifyConnected state is currently:', isSpotifyConnected);
      setSongList([]);
      return;
    }
    if (selectedPlaylists.length === 0) {
      setSongList([]);
      return;
    }

    try {
      const allSongs: Song[] = [];
      
      for (const playlist of selectedPlaylists) {
        const response = await hostFetch(`${API_BASE || ''}/api/spotify/playlist-tracks/${playlist.id}`);
        const data = await response.json();
        
        if (data.success && data.tracks) {
          allSongs.push(...data.tracks);
        }
      }

      // Deduplicate songs by ID (fix for duplicate songs appearing in output playlist)
      const seen = new Set<string>();
      const uniqueSongs = allSongs.filter(song => {
        if (seen.has(song.id)) {
          console.log(`?? Duplicate song removed: "${song.name}" by ${song.artist} (ID: ${song.id})`);
          return false;
        }
        seen.add(song.id);
        return true;
      });

      // Shuffle the songs using Fisher-Yates algorithm
      const shuffledSongs = [...uniqueSongs];
      for (let i = shuffledSongs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledSongs[i], shuffledSongs[j]] = [shuffledSongs[j], shuffledSongs[i]];
      }

      setSongList(shuffledSongs);
      console.log(`Generated ${shuffledSongs.length} shuffled songs`);
    } catch (error) {
      console.error('Error generating song list:', error);
    }
  }, [selectedPlaylists]);

  // Advanced playback functions
  const [volumeTimeout, setVolumeTimeout] = useState<NodeJS.Timeout | null>(null);

  // Function to fetch current Spotify volume
  const fetchCurrentVolume = useCallback(async () => {
    try {
      const resp = await hostFetch(`${API_BASE || ''}/api/spotify/current-playback`);
      if (!resp.ok) return;
      const data = await resp.json();
        if (data.success && data.playbackState) {
        const spotifyVolume = (data.playbackState.device?.volume_percent ?? 100) as number;
          setPlaybackState(prev => ({ ...prev, volume: spotifyVolume }));
          console.log(`?? Synced volume from Spotify: ${spotifyVolume}%`);
        }
    } catch {
      // ignore
    }
  }, []);

  // Function to ensure Spotify volume matches interface volume
  const syncVolumeToSpotify = useCallback(async () => {
    if (!selectedDevice?.id) return;
    
    try {
      const currentVolume = playbackState.volume;
      console.log(`?? Syncing interface volume (${currentVolume}%) to Spotify`);
      
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/volume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          volume: currentVolume,
          deviceId: selectedDevice.id,
          roomId: roomId
        })
      });
      
      if (response.ok) {
        console.log(`? Volume synced to Spotify: ${currentVolume}%`);
      } else {
        console.warn('?? Failed to sync volume to Spotify');
      }
    } catch (error) {
      console.error('Error syncing volume to Spotify:', error);
    }
  }, [selectedDevice?.id, playbackState.volume, roomId]);

  const transferToSelectedDevice = useCallback(async () => {
    if (!selectedDevice) {
      alert('Please select a device first');
      return;
    }
    try {
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDevice.id, play: false })
      });
      if (response.ok) {
        console.log('? Transferred playback to selected device');
        await fetchPlaybackState();
        // NudgeResume to ensure correct track/context
        if (socket && roomId) {
          socket.emit('resume-song', { roomId });
        }
      } else {
        let msg = 'Failed to transfer playback';
        try {
          const err = await response.json();
          if (err?.error) msg = String(err.error);
        } catch {}
        console.error('? Failed to transfer playback:', msg);
        alert(`Transfer failed: ${msg}`);
      }
    } catch (e) {
      console.error('? Error transferring playback:', e);
    }
  }, [selectedDevice, fetchPlaybackState]);

  const recoverPlayback = useCallback(async () => {
    try {
      if (!selectedDevice?.id) {
        alert('Select a Spotify device first');
        return;
      }
      // Try to regain control and auto-play on selected device
      await hostFetch(`${API_BASE || ''}/api/spotify/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: selectedDevice.id, play: false })
      });
    } catch {}
    try {
      await fetchPlaybackState();
      if (socket && roomId) {
        // NudgeResume if host believes a song is active
        socket.emit('resume-song', { roomId });
      }
    } catch {}
  }, [selectedDevice?.id, fetchPlaybackState, socket, roomId]);

  // Manual resume game if stuck in paused state (recovery for missed verification modal)
  const handleManualResumeGame = useCallback(() => {
    if (!socket || !roomId) return;
    
    const confirmed = window.confirm(
      'Resume the game?\n\n' +
      'This will resume playback if the game is paused for verification.\n' +
      'Use this if you missed a bingo verification modal.'
    );
    
    if (confirmed) {
      socket.emit('manual-resume-game', { roomId });
      setPendingVerification(null); // Clear any stuck verification state
      setGamePaused(false);
      addLog('Manually resuming game', 'info');
    }
  }, [socket, roomId]);


  // Debounced volume change with strict synchronization
  const handleVolumeChange = useCallback(async (newVolume: number) => {
    // Clear any existing timeout
    if (volumeTimeout) {
      clearTimeout(volumeTimeout);
    }

    // Set local state immediately for responsive UI
    setPlaybackState(prev => ({ ...prev, volume: newVolume }));
    setIsMuted(false);
    
    // Don't persist volume to localStorage - always default to 100%

    // Debounce the actual volume change to prevent rapid API calls
    const timeout = setTimeout(async () => {
      try {
        console.log(`?? Setting volume to ${newVolume}% on Spotify`);
        const response = await hostFetch(`${API_BASE || ''}/api/spotify/volume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            volume: newVolume,
            deviceId: selectedDevice?.id,
            roomId: roomId
          })
        });
        
        if (response.ok) {
          // Don't fetch current volume - trust our local state
          console.log(`? Volume set to ${newVolume}% successfully`);
        } else {
          console.error('Failed to set volume, reverting to Spotify state');
          fetchCurrentVolume(); // Only revert on error
        }
      } catch (error) {
        console.error('Error setting volume:', error);
        fetchCurrentVolume(); // Revert to actual Spotify volume
      }
    }, 100); // 100ms debounce

    setVolumeTimeout(timeout);
  }, [selectedDevice?.id, volumeTimeout, fetchCurrentVolume, roomId]);

  const handleMuteToggle = useCallback(async () => {
    if (isMuted) {
      // Unmute - restore previous volume
      setPlaybackState(prev => ({ ...prev, volume: previousVolume }));
      setIsMuted(false);
      
      try {
        console.log(`?? Unmuting, setting volume to ${previousVolume}%`);
        const response = await hostFetch(`${API_BASE || ''}/api/spotify/volume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            volume: previousVolume,
            deviceId: selectedDevice?.id,
            roomId: roomId
          })
        });
        
        if (response.ok) {
          // Don't fetch current volume - trust our local state
          console.log(`? Unmuted to ${previousVolume}% successfully`);
        } else {
          console.error('Failed to unmute, reverting to Spotify state');
          fetchCurrentVolume();
        }
      } catch (error) {
        console.error('Error unmuting:', error);
        fetchCurrentVolume();
      }
    } else {
      // Mute - save current volume and set to 0
      setPreviousVolume(playbackState.volume);
      setPlaybackState(prev => ({ ...prev, volume: 0 }));
      setIsMuted(true);
      
      try {
        console.log(`?? Muting, setting volume to 0%`);
        const response = await hostFetch(`${API_BASE || ''}/api/spotify/volume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            volume: 0,
            deviceId: selectedDevice?.id,
            roomId: roomId
          })
        });
        
        if (response.ok) {
          // Don't fetch current volume - trust our local state
          console.log(`? Muted successfully`);
        } else {
          console.error('Failed to mute, reverting to Spotify state');
          fetchCurrentVolume();
        }
      } catch (error) {
        console.error('Error muting:', error);
        fetchCurrentVolume();
      }
    }
  }, [isMuted, previousVolume, playbackState.volume, selectedDevice?.id, fetchCurrentVolume, roomId]);

  const handleSeek = useCallback(async (newTime: number) => {
    setPlaybackState(prev => ({ ...prev, currentTime: newTime }));
    
    try {
        const response = await hostFetch(`${API_BASE || ''}/api/spotify/seek`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          position: newTime,
          deviceId: selectedDevice?.id 
        })
      });
      
      if (!response.ok) {
        console.error('Failed to seek');
      }
    } catch (error) {
      console.error('Error seeking:', error);
    }
  }, [selectedDevice?.id]);

  const handleSkipToNext = useCallback(() => {
    if (socket) {
      socket.emit('skip-song', { roomId });
    }
  }, [socket, roomId]);

  const handleSkipToPrevious = useCallback(() => {
    if (socket) {
      // Send current playback position to determine if we should restart current song or go to previous
      const currentPosition = playbackState.currentTime;
      socket.emit('previous-song', { 
        roomId, 
        currentPosition: currentPosition 
      });
      console.log(`Previous button clicked at position: ${currentPosition}ms`);
    }
  }, [socket, roomId, playbackState.currentTime]);

  // Bingo verification functions
  const approveBingo = useCallback(async () => {
    if (!socket || !pendingVerification) return;
    if (verificationTimeoutRef.current) {
      clearTimeout(verificationTimeoutRef.current);
      verificationTimeoutRef.current = null;
    }
    setIsProcessingVerification(true);
    socket.emit('verify-bingo', {
      roomId,
      playerId: pendingVerification.playerId,
      playerName: pendingVerification.playerName,
      approved: true
    });
    verificationTimeoutRef.current = setTimeout(() => {
      verificationTimeoutRef.current = null;
      addLog('Approve timed out — clearing verification modal', 'warn');
      setPendingVerification(null);
      setGamePaused(false);
      setIsProcessingVerification(false);
    }, 15000);
  }, [socket, roomId, pendingVerification, addLog]);

  const rejectBingo = useCallback(async (reason: string) => {
    if (!socket || !pendingVerification) return;
    if (verificationTimeoutRef.current) {
      clearTimeout(verificationTimeoutRef.current);
      verificationTimeoutRef.current = null;
    }
    setIsProcessingVerification(true);
    socket.emit('verify-bingo', {
      roomId,
      playerId: pendingVerification.playerId,
      playerName: pendingVerification.playerName,
      approved: false,
      reason: reason || 'Invalid bingo pattern'
    });
    verificationTimeoutRef.current = setTimeout(() => {
      verificationTimeoutRef.current = null;
      addLog('Reject timed out — clearing verification modal', 'warn');
      setPendingVerification(null);
      setGamePaused(false);
      setIsProcessingVerification(false);
    }, 15000);
  }, [socket, roomId, pendingVerification, addLog]);

  // Create output playlist
  const createOutputPlaylist = useCallback(async () => {
    if (!songList || songList.length === 0) {
      alert('No songs available to create playlist. Please finalize a mix first.');
      return;
    }

    const playlistName = prompt('Enter a name for your output playlist:', `Bingo ${roomId} - ${new Date().toLocaleDateString()}`);
    if (!playlistName) return;

    try {
      const trackIds = songList.map(song => song.id);
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/create-output-playlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: playlistName,
          trackIds: trackIds,
          description: `Output playlist from TEMPO Music Bingo - Room ${roomId} - ${selectedPlaylists.map(p => p.name).join(', ')}`
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        addLog(`? Created output playlist: ${data.playlistName} (${data.trackCount} songs)`, 'info');
        alert(`Successfully created playlist: ${data.playlistName}\n\nIt will appear in your Spotify library under "Game Of Tones Output" playlists.`);
      } else {
        throw new Error(data.error || 'Failed to create playlist');
      }
    } catch (error) {
      console.error('Error creating output playlist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog(`? Failed to create output playlist: ${errorMessage}`, 'error');
      alert(`Failed to create playlist: ${errorMessage}`);
    }
  }, [songList, roomId, selectedPlaylists, addLog]);

  // Format time helper
  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Progress tracking for time slider
  useEffect(() => {
    if (!isPlaying || !currentSong) return;
    
    const interval = setInterval(() => {
      setPlaybackState(prev => ({
        ...prev,
        currentTime: Math.min(prev.currentTime + 1000, prev.duration)
      }));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isPlaying, currentSong]);

  // DISABLED: Periodic volume synchronization to preserve user's volume setting
  // useEffect(() => {
  //   if (!isPlaying || !currentSong) return;
  //   const volumeSyncInterval = setInterval(() => {
  //     // Only sync volume every 15s to reduce noise
  //     fetchCurrentVolume();
  //   }, 15000);
  //   return () => clearInterval(volumeSyncInterval);
  // }, [isPlaying, currentSong, fetchCurrentVolume]);

  // Periodic playback state synchronization
  useEffect(() => {
    if (!currentSong) return;
    const playbackSyncInterval = setInterval(async () => {
      try {
        if (Date.now() < spotifyPollBackoffUntilRef.current) return;
        const resp = await hostFetch(`${API_BASE || ''}/api/spotify/current-playback`);
        if (resp.status === 429) {
          let j: { retryAfterSec?: number } = {};
          try {
            j = (await resp.json()) as { retryAfterSec?: number };
          } catch {
            /* ignore */
          }
          const ra = Number(j.retryAfterSec);
          const sec = Number.isFinite(ra) && ra > 0 ? Math.min(86400, ra) : 3600;
          spotifyPollBackoffUntilRef.current = Date.now() + sec * 1000;
          return;
        }
        if (!resp.ok) {
          if (resp.status >= 500) return; // ignore 5xx
          return;
        }
        const data = await resp.json();
          if (data.success && data.playbackState) {
          const spotifyIsPlaying = !!data.playbackState.is_playing;
            const spotifyPosition = data.playbackState.progress_ms || 0;
          // Shuffle/repeat state removed - not used in UI
          // setShuffleEnabled(!!data.playbackState.shuffle_state);
          // const rep = (data.playbackState.repeat_state || 'off') as 'off' | 'track' | 'context';
          // setRepeatState(rep);
          // Guards: ignore polling false near reconnect or a recent song event
          const now = Date.now();
          if (!spotifyIsPlaying) {
            if (now < ignorePollingUntilRef.current) return;
            if (now - lastSongEventAtRef.current < 15000) return;
          }
            if (spotifyIsPlaying !== isPlaying) {
              console.log(`?? Spotify playback state changed: ${spotifyIsPlaying}, updating interface`);
              setIsPlaying(spotifyIsPlaying);
            setPlaybackState(prev => ({ ...prev, isPlaying: spotifyIsPlaying, currentTime: spotifyPosition }));
              if (spotifyIsPlaying && isPausedByInterface) {
                console.log('?? SpotifyResumed externally, clearing pause tracking');
                setIsPausedByInterface(false);
                setPausePosition(0);
              }
            }
          }
      } catch {
        // ignore
      }
    }, 60000); // 60s: reduce Spotify Web API load via /current-playback
    return () => clearInterval(playbackSyncInterval);
  }, [currentSong, isPlaying, isPausedByInterface]);

  // Generate song list when selected playlists change
  useEffect(() => {
    generateSongList();
  }, [selectedPlaylists, generateSongList]);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!currentSong) return;
      
             switch (event.code) {
         case 'Space':
           event.preventDefault();
           playSong(currentSong);
           break;
         case 'ArrowLeft':
           event.preventDefault();
           handleSkipToPrevious();
           break;
         case 'ArrowRight':
           event.preventDefault();
           handleSkipToNext();
           break;
         case 'KeyM':
           event.preventDefault();
           handleMuteToggle();
           break;
       }
    };

         document.addEventListener('keydown', handleKeyPress);
     return () => document.removeEventListener('keydown', handleKeyPress);
   }, [currentSong, handleMuteToggle]);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = React.useRef<string | null>(null);
  const lastReconnectAtRef = React.useRef<number>(0);
  const lastResumePingAtRef = React.useRef<number>(0);
  const ignorePollingUntilRef = React.useRef<number>(0);
  const lastSongEventAtRef = React.useRef<number>(0);

  useEffect(() => {
    // Ensure a single audio element exists
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioRef.current.crossOrigin = 'anonymous';
      audioRef.current.volume = 1.0;
    }
  }, []);

  // When a new song starts via socket, prefetch preview if available
  useEffect(() => {
    if (!currentSong) return;
    const handlePrefetch = async () => {
      try {
        // previewUrl is delivered on song-playing payload via server
        const previewUrl = (currentSong as any).previewUrl as string | undefined;
        if (previewUrl) {
          audioUrlRef.current = previewUrl;
          if (audioRef.current) {
            audioRef.current.src = previewUrl;
            await audioRef.current.load?.();
          }
        } else {
          audioUrlRef.current = null;
        }
      } catch {}
    };
    handlePrefetch();
  }, [currentSong]);

  // Early-fail guard on the host (client-side): if playback hasn't advanced soon after start, play preview
  useEffect(() => {
    if (!isPlaying || !currentSong) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      try {
        const resp = await hostFetch(`${API_BASE || ''}/api/spotify/current-playback`);
        if (!resp.ok) return;
        const data = await resp.json();
        const progress = Number(data?.playbackState?.progress_ms || 0);
        const is_sp_playing = !!data?.playbackState?.is_playing;
        if ((!is_sp_playing || progress < 1000) && audioRef.current && audioUrlRef.current) {
          console.warn('?? Spotify stall detected on host; playing preview fallback');
          try { await audioRef.current.play(); } catch {}
        }
      } catch {}
    }, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isPlaying, currentSong]);

  const confirmAndNewRound = () => {
    // Use the same handler as the modal button for consistency
    // This ensures full reset and proper round transition
    handleStartNextRound();
  };

  // Round management functions
  const handleUpdateRounds = useCallback((newRounds: EventRound[]) => {
    setEventRounds(newRounds);
    // Store in localStorage for persistence
    try {
      localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(newRounds));
    } catch (error) {
      console.warn('Failed to save rounds to localStorage:', error);
    }
  }, [roomId]);


  const handleStartRound = useCallback((roundIndex: number) => {
    const round = eventRounds[roundIndex];
    if (!round || round.playlistIds.length === 0) {
      alert('Please select at least one playlist for this round first.');
      return;
    }

    // Mark current round as completed if it exists
    if (currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length) {
      const updatedRounds = [...eventRounds];
      updatedRounds[currentRoundIndex] = {
        ...updatedRounds[currentRoundIndex],
        status: 'completed',
        completedAt: Date.now()
      };
      setEventRounds(updatedRounds);
    }

    // Set new round as active
    const updatedRounds = [...eventRounds];
    updatedRounds[roundIndex] = {
      ...updatedRounds[roundIndex],
      status: 'active',
      startedAt: Date.now()
    };
    setEventRounds(updatedRounds);
    setCurrentRoundIndex(roundIndex);

    // Update selected playlists to match the round
    const roundPlaylists = playlists.filter(p => round.playlistIds.includes(p.id));
    if (roundPlaylists.length > 0) {
      setSelectedPlaylists(roundPlaylists);
      const playlistNames = round.playlistNames.join(', ');
      addLog(`Started ${round.name}: ${playlistNames}`, 'info');
    }

    // Store updated rounds
    try {
      localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(updatedRounds));
    } catch (error) {
      console.warn('Failed to save rounds to localStorage:', error);
    }

    // Next step is Finalize mix / Start game on the Game tab
    setActiveTab('play');
  }, [eventRounds, currentRoundIndex, playlists, roomId]);

  // Advanced round management functions
  const jumpToRound = useCallback((roundIndex: number) => {
    if (roundIndex >= 0 && roundIndex < eventRounds.length) {
      const round = eventRounds[roundIndex];
      if (round.status !== 'completed' && (round.playlistIds || []).length > 0) {
        handleStartRound(roundIndex);
        setShowRoundManager(false);
        addLog(`Jumped to ${round.name}`, 'info');
      }
    }
  }, [eventRounds, handleStartRound]);

  const completeCurrentRound = useCallback(() => {
    if (currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length) {
      const updatedRounds = [...eventRounds];
      updatedRounds[currentRoundIndex] = {
        ...updatedRounds[currentRoundIndex],
        status: 'completed',
        completedAt: Date.now()
      };
      handleUpdateRounds(updatedRounds);
      addLog(`Completed ${updatedRounds[currentRoundIndex].name}`, 'info');
    }
  }, [currentRoundIndex, eventRounds, handleUpdateRounds]);

  const resetCurrentRound = useCallback(() => {
    if (gameState === 'playing') {
      // Reset the current game state
      setGameState('waiting');
      setCurrentSong(null);
      setPlayedSoFar([]);
      setWinners([]);
      setRoundComplete(null);
      setRoundWinners([]);
      
      // Emit reset to all clients
      if (socket) {
        socket.emit('game-reset');
      }
      
      addLog(`Reset current round`, 'info');
    }
  }, [gameState, socket]);

  const getNextPlannedRound = useCallback(() => {
    return eventRounds.findIndex(round => 
      round.status === 'planned' && (round.playlistIds || []).length > 0
    );
  }, [eventRounds]);

  const getRoundStatusSummary = useCallback(() => {
    const completed = eventRounds.filter(r => r.status === 'completed').length;
    const active = eventRounds.filter(r => r.status === 'active').length;
    const planned = eventRounds.filter(r => r.status === 'planned' && (r.playlistIds || []).length > 0).length;
    const unplanned = eventRounds.filter(r => r.status === 'unplanned' || (r.playlistIds || []).length === 0).length;
    
    return { completed, active, planned, unplanned, total: eventRounds.length };
  }, [eventRounds]);

  // Load rounds from localStorage on component mount
  useEffect(() => {
    if (!roomId) return;
    
    try {
      const savedRounds = localStorage.getItem(`event-rounds-${roomId}`);
      if (savedRounds) {
        const rounds = JSON.parse(savedRounds);
        if (Array.isArray(rounds) && rounds.length > 0) {
          // Migrate old single-playlist format to new multi-playlist format
          const migratedRounds = rounds.map((round: any) => {
            // Check if this is old format (has playlistId instead of playlistIds)
            if (round.playlistId && !round.playlistIds) {
              return {
                ...round,
                playlistIds: round.playlistId ? [round.playlistId] : [],
                playlistNames: round.playlistName ? [round.playlistName] : [],
                // Remove old properties
                playlistId: undefined,
                playlistName: undefined
              };
            }
            // Ensure new format has required arrays
            return {
              ...round,
              playlistIds: round.playlistIds || [],
              playlistNames: round.playlistNames || []
            };
          });
          
          setEventRounds(migratedRounds);
          
          // Save migrated data back to localStorage
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(migratedRounds));
          
          // Find the active round
          const activeIndex = migratedRounds.findIndex((r: EventRound) => r.status === 'active');
          if (activeIndex >= 0) {
            setCurrentRoundIndex(activeIndex);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load rounds from localStorage:', error);
    }
  }, [roomId]);

  /** True when the host has a built pool to show (matches visibility of Finalized Playlist block). */
  const hasFinalizedSongPool =
    songList.length > 0 ||
    (finalizedOrder?.length ?? 0) > 0 ||
    mixFinalized;

  const playbackDeviceContent = isSpotifyConnected ? (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <h3
          style={{
            fontSize: '1.05rem',
            color: '#00ff88',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Music className="w-5 h-5" aria-hidden />
          Playback device
        </h3>
        <button type="button" className="disconnect-btn btn" onClick={() => void disconnectSpotify()}>
          Disconnect
        </button>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.65)', marginBottom: 12, lineHeight: 1.4 }}>
        Choose where Spotify should play. Open Spotify on your computer, phone, or speaker so it appears in the list. Use{' '}
        <strong style={{ color: '#cfcfcf' }}>Refresh devices</strong> if the list is empty.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <select
          aria-label="Spotify playback device"
          value={selectedDevice?.id ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            const d = devices.find((x) => x.id === id);
            setSelectedDevice(d ?? null);
          }}
          style={{
            flex: '1 1 220px',
            minWidth: 200,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(0,0,0,0.35)',
            color: '#fff',
            fontSize: '0.95rem',
          }}
        >
          <option value="">Select a device</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.is_active ? ' (active)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void loadDevices()}
          disabled={isLoadingDevices}
        >
          {isLoadingDevices ? 'Refreshing…' : 'Refresh devices'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => saveSelectedDevice()}
          disabled={!selectedDevice}
          title="Remember this device for next time"
        >
          Save as default
        </button>
      </div>
      {devices.length === 0 && !isLoadingDevices && (
        <p style={{ marginTop: 10, fontSize: '0.8rem', color: '#ffb347' }}>
          No devices found. Open Spotify on phone or desktop (or the Spotify Web Player in a browser), start
          playback once so the app is active, then tap Refresh devices. Spotify Premium is required for
          playback control on some setups.
        </p>
      )}
    </>
  ) : null;

  /** Spotify connect + LED + playback / Disconnect � shown in connection modal. */
  const hostConnectionPanel = (
    <motion.div
      className="host-spotify-playback-unified"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2 }}
    >
      <div className="host-spotify-playback-unified__grid">
        <div className="spotify-section spotify-section--unified">
          {!isSpotifyConnected ? (
            <>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Music className="w-6 h-6" style={{ color: '#1ed760' }} aria-hidden />
                Spotify Connection
              </h2>
              <p className="host-spotify-guide">
                Sign in with the <strong>Spotify account</strong> that should play music and own playlists for this show (e.g. your
                event or work account). You only need a normal Spotify login — not a developer account. After this, pick a{' '}
                <strong>playback device</strong> below.
              </p>
              <div className="spotify-connection-section">
                {spotifyError && (
                  <div className="spotify-error">
                    <p>{spotifyError}</p>
                  </div>
                )}
                <button
                  className="spotify-connect-btn btn"
                  type="button"
                  onClick={() => {
                    setSpotifyError(null);
                    connectSpotify();
                  }}
                  disabled={isSpotifyConnecting}
                >
                  <Music className="btn-icon spotify-btn-icon" aria-hidden />
                  {isSpotifyConnecting
                    ? 'Connecting...'
                    : spotifyError
                      ? 'Try again'
                      : 'Connect Spotify'}
                </button>
              </div>
            </>
          ) : (
            <div
              className="spotify-connection-led"
              role="status"
              title="Spotify connected"
              aria-label="Spotify connected"
            >
              <span className="spotify-connection-led__dot" aria-hidden />
              <span className="spotify-connection-led__label">Connection</span>
            </div>
          )}
        </div>
        {isSpotifyConnected && (
          <div className="playback-device-section playback-device-section--unified">{playbackDeviceContent}</div>
        )}
      </div>
      <p
        className="spotify-attribution"
        style={{
          fontSize: '0.72rem',
          color: 'rgba(200, 210, 220, 0.78)',
          marginTop: 14,
          lineHeight: 1.45,
        }}
      >
        Music metadata and playback control use the{' '}
        <a
          href="https://developer.spotify.com/documentation/web-api"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          Spotify Web API
        </a>
        . Spotify® is a trademark of Spotify AB. See the{' '}
        <a
          href="https://developer.spotify.com/terms"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          Spotify Developer Terms
        </a>
        .
      </p>
    </motion.div>
  );

  return (
    <div className="host-view">
      <motion.div 
        className="host-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ minHeight: 0 }}
      >
        {/* Header */}
        <div className="host-header">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
            <Gamepad2 className="w-8 h-8" style={{ color: '#00ff88' }} aria-hidden />
            Game Host
          </h1>
          <div className="room-info" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary host-connection-toolbar-btn"
              onClick={() => setShowConnectionModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Link2 className="w-4 h-4" aria-hidden />
              Connection
            </button>
            {hostAccount ? (
              <span
                className="host-account-chip"
                title={
                  [hostAccount.displayName, hostAccount.email].filter(Boolean).join(' · ') ||
                  `Host account #${hostAccount.id}`
                }
              >
                Tempo account · #{hostAccount.id}
                {hostAccount.displayName ? ` · ${hostAccount.displayName}` : ''}
              </span>
            ) : hostAccount === null ? (
              <span className="host-account-chip host-account-chip--muted" title="Sign in from home (Google) to link a host account.">
                No Tempo account linked
              </span>
            ) : null}
            <span className="room-code">Room: {roomId}</span>
          </div>
        </div>


        {/* Main Content */}
        <div className="host-content" style={{ paddingBottom: '20px' }}>
          {/* Tab Navigation */}
          <div className="tab-navigation host-tab-navigation">
            {(
              [
                { id: 'setup', Icon: LayoutDashboard, label: 'Manager', desc: 'Setup & Management' },
                { id: 'play', Icon: Gamepad2, label: 'Game', desc: 'Live Game Controls' },
              ] as const
            ).map((tab) => {
              const TabIcon = tab.Icon;
              return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as 'setup' | 'play')}
                className={`host-tab-button ${activeTab === tab.id ? 'active' : ''}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <TabIcon className="w-5 h-5" aria-hidden />
                  {tab.label}
                </div>
                <div className="host-tab-button__desc">{tab.desc}</div>
              </button>
            );
            })}
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === 'setup' && (
              <div className="setup-tab host-manager">
                {/* License Status - TEMPORARILY HIDDEN */}
                {showRoundManager && (
                  <div style={{ display: 'none' }}>License validation disabled for tonight</div>
                )}

                <div className="host-manager-grid">
                  <div className="host-manager-grid__primary">
                    <section className="host-manager-section">
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    marginBottom: 0,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(0, 255, 136, 0.25)',
                    background: 'rgba(0, 255, 136, 0.06)',
                    cursor: 'pointer',
                    maxWidth: '100%',
                  }}
                >
                  <input
                    type="checkbox"
                    className="host-control-checkbox"
                    checked={hybridInPersonPlusOnline}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setHybridInPersonPlusOnline(v);
                      try {
                        socket?.emit('set-hybrid-mode', { roomId, hybridInPersonPlusOnline: v });
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={{ marginTop: 4 }}
                  />
                  <span style={{ fontSize: '0.88rem', lineHeight: 1.45, color: 'rgba(255,255,255,0.9)' }}>
                    <strong style={{ color: '#00ff88' }}>Hybrid in-person + online</strong>
                    <br />
                    Remote players who join with &quot;online&quot; can play, but a valid bingo from them does{' '}
                    <strong>not</strong> pause the game or award the round — only an <strong>in-person</strong> player&apos;s
                    bingo does. They still see when they complete the pattern.
                  </span>
                </label>
                    </section>

          {/* Pattern Selection */}
          {isSpotifyConnected && (
            <motion.div 
              className="pattern-section host-manager-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Grid3x3 className="w-6 h-6" style={{ color: '#00ff88' }} aria-hidden />
                Bingo Pattern
              </h2>
              <div className="pattern-selection">
                {/* Main Pattern Options */}
                <div className="main-pattern-options" style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px' }}>
                  <button
                    className={`pattern-option ${pattern === 'line' ? 'active' : ''}`}
                    onClick={() => updatePattern('line')}
                    style={{
                      padding: '12px 20px',
                      border: pattern === 'line' ? '2px solid #00ff88' : '1px solid rgba(255,255,255,0.3)',
                      borderRadius: '8px',
                      background: pattern === 'line' ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)',
                      color: pattern === 'line' ? '#00ff88' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      minWidth: '120px'
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Line</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8, textAlign: 'center' }}>Any row, column, or diagonal</div>
                  </button>
                  
                  <button
                    className={`pattern-option ${pattern === 'full_card' ? 'active' : ''}`}
                    onClick={() => updatePattern('full_card')}
                    style={{
                      padding: '12px 20px',
                      border: pattern === 'full_card' ? '2px solid #00ff88' : '1px solid rgba(255,255,255,0.3)',
                      borderRadius: '8px',
                      background: pattern === 'full_card' ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)',
                      color: pattern === 'full_card' ? '#00ff88' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      minWidth: '120px'
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Full Card</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8, textAlign: 'center' }}>All 25 squares</div>
                  </button>
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    marginBottom: '16px',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    color: '#e0e0e0'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={freeSpaceEnabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setFreeSpaceEnabled(v);
                      try {
                        localStorage.setItem('bingo-free-space', v ? '1' : '0');
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                  <span>
                    Free space (center square counts without that song playing; set before Finalize Mix)
                  </span>
                </label>

                {/* Custom Pattern Section */}
                <div className="custom-pattern-section" style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                    <select
                      value={selectedCustomPattern?.id || ''}
                      onChange={(e) => {
                        const patternId = e.target.value;
                        if (patternId) {
                          const customPattern = savedCustomPatterns.find(p => p.id === patternId);
                          if (customPattern) {
                            handleCustomPatternSelect(customPattern);
                          }
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.3)',
                        background: 'rgba(0,0,0,0.3)',
                        color: '#ffffff',
                        fontSize: '0.9rem',
                        minWidth: '200px'
                      }}
                    >
                      <option value="">Select Custom Pattern...</option>
                      {savedCustomPatterns.map((customPattern) => (
                        <option key={customPattern.id} value={customPattern.id}>
                          {customPattern.name}
                        </option>
                      ))}
                    </select>
                    
                    <button
                      onClick={handleNewCustomPattern}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '6px',
                        border: '1px solid #00ff88',
                        background: 'rgba(0,255,136,0.1)',
                        color: '#00ff88',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Plus size={16} />
                      New Custom Pattern
                    </button>
                  </div>
                </div>
              </div>
                <div style={{ marginTop: '8px', fontSize: '0.9rem', color: '#b3b3b3' }}>
                  Current pattern: <strong style={{ color: '#00ff88' }}>
                    {pattern === 'custom' && selectedCustomPattern 
                      ? selectedCustomPattern.name 
                      : getPatternDisplayName(pattern)}
                  </strong>
                  {pattern === 'custom' && selectedCustomPattern && (
                    <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#b3b3b3' }}>
                      Pattern: {selectedCustomPattern.positions.length} squares selected
                    </div>
                  )}
              </div>
            </motion.div>
          )}
                  </div>
                  <div className="host-manager-grid__secondary">
          <motion.div
            className="host-manager-section host-manager-section--display font-size-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <h2 className="host-manager-section__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Monitor className="w-6 h-6" style={{ color: '#00ff88' }} aria-hidden />
              Public display
            </h2>
            <p className="host-manager-section__lead">
              Text size and what appears on the projector or TV for players.
            </p>
            <p className="host-manager-display__sub">Title &amp; artist size</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <button
                onClick={() => updatePublicDisplayFontSize(publicDisplayFontSize - 0.1)}
                disabled={publicDisplayFontSize <= 0.5}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: publicDisplayFontSize <= 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
                  color: publicDisplayFontSize <= 0.5 ? '#666' : '#ffffff',
                  cursor: publicDisplayFontSize <= 0.5 ? 'not-allowed' : 'pointer',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  minWidth: '50px'
                }}
              >
                -
              </button>
              
              <div style={{
                minWidth: '120px',
                textAlign: 'center',
                padding: '10px 20px',
                background: 'rgba(0,255,136,0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(0,255,136,0.3)'
              }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#00ff88' }}>
                  {(publicDisplayFontSize * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: '0.8rem', color: '#b3b3b3', marginTop: '4px' }}>
                  {publicDisplayFontSize.toFixed(1)}x multiplier
                </div>
              </div>
              
              <button
                onClick={() => updatePublicDisplayFontSize(publicDisplayFontSize + 0.1)}
                disabled={publicDisplayFontSize >= 3.0}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: publicDisplayFontSize >= 3.0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
                  color: publicDisplayFontSize >= 3.0 ? '#666' : '#ffffff',
                  cursor: publicDisplayFontSize >= 3.0 ? 'not-allowed' : 'pointer',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  minWidth: '50px'
                }}
              >
                +
              </button>
            </div>
            <div style={{ marginTop: '10px', fontSize: '0.82rem', color: '#b3b3b3', textAlign: 'center' }}>
              Song and artist names on the public display
            </div>
            <div className="host-manager-display__divider" />
            <p className="host-manager-display__sub">Screen modes</p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button 
                className="btn-secondary" 
                onClick={() => socket?.emit('display-show-rules', { roomId })}
                style={{ 
                  fontSize: '0.9rem', 
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <BookOpen className="w-4 h-4" aria-hidden />
                Rules
              </button>
              <button 
                className="btn-secondary" 
                onClick={() => socket?.emit('display-show-splash', { roomId })}
                style={{ 
                  fontSize: '0.9rem', 
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <ImageIcon className="w-4 h-4" aria-hidden />
                Splash
              </button>
              <button 
                className="btn-secondary" 
                onClick={() => socket?.emit('display-show-call-list', { roomId })}
                style={{ 
                  fontSize: '0.9rem', 
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <ListMusic className="w-4 h-4" aria-hidden />
                Call List
              </button>
            </div>
            <div className="host-manager-display__divider" style={{ marginTop: 14 }} />
            <p className="host-manager-display__sub">Call list layout (projector)</p>
            <p style={{ fontSize: '0.78rem', color: '#9a9a9a', marginBottom: 10, lineHeight: 1.4, maxWidth: 520 }}>
              <strong style={{ color: '#c8c8c8' }}>5×15</strong> uses BINGO columns (B–O).{' '}
              <strong style={{ color: '#c8c8c8' }}>1×75</strong> uses the scrolling band carousel.{' '}
              <strong style={{ color: '#c8c8c8' }}>Auto</strong> follows your finalized mix and the display URL (<code style={{ fontSize: '0.72rem' }}>?mode=5x15</code>).
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              {(
                [
                  { mode: '5x15' as const, label: '5×15 columns', Icon: Grid3x3 },
                  { mode: 'grouped' as const, label: '1×75 carousel', Icon: List },
                  { mode: 'auto' as const, label: 'Auto', Icon: Sliders },
                ]
              ).map(({ mode, label, Icon }) => {
                const active = publicDisplayCallListMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    className="btn-secondary"
                    onClick={() => updatePublicDisplayCallListMode(mode)}
                    style={{
                      fontSize: '0.88rem',
                      padding: '10px 14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      border: active ? '1px solid rgba(0,255,136,0.65)' : undefined,
                      background: active ? 'rgba(0,255,136,0.14)' : undefined,
                      color: active ? '#00ff88' : undefined,
                    }}
                  >
                    <Icon className="w-4 h-4" aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>
          </motion.div>
                  </div>
                </div>

          {/* Music & rounds: planner + playlists */}
          {isSpotifyConnected && (
            <div className="host-manager-music host-manager-section">
              <h2 className="host-manager-music__title">Music &amp; rounds</h2>
            <RoundPlanner
              rounds={eventRounds}
              onUpdateRounds={handleUpdateRounds}
              playlists={playlists}
              currentRound={currentRoundIndex}
              onStartRound={handleStartRound}
              gameState={gameState}
            />

          <motion.div 
                    className="playlists-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    <h3 style={{ marginBottom: 6, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Library className="w-5 h-5" style={{ color: '#00ff88' }} aria-hidden />
                      Playlist library
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: '#a8a8a8', marginBottom: 12, lineHeight: 1.45, maxWidth: 720 }}>
                      <strong style={{ color: '#fff' }}>In mix</strong>: playlists checked here are included when you{' '}
                      <strong style={{ color: '#fff' }}>finalize the bingo pool</strong> (song source for the game). You can still{' '}
                      <strong style={{ color: '#fff' }}>drag any row</strong> into round buckets for round-specific setup.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: '0.72rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Library scope</span>
                        <div role="group" aria-label="Playlist library scope" style={{ display: 'inline-flex', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(0,0,0,0.25)' }}>
                          <button type="button" onClick={() => { setShowAllPlaylists(false); setPlaylistQuery(''); }} style={{ border: 'none', padding: '10px 16px', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer', background: !showAllPlaylists ? 'rgba(0,255,136,0.22)' : 'transparent', color: !showAllPlaylists ? '#00ff88' : '#ccc', borderRight: '1px solid rgba(255,255,255,0.12)' }}>GoT picks</button>
                          <button type="button" onClick={() => { setShowAllPlaylists(true); setPlaylistQuery(''); }} style={{ border: 'none', padding: '10px 16px', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer', background: showAllPlaylists ? 'rgba(0,255,136,0.22)' : 'transparent', color: showAllPlaylists ? '#00ff88' : '#ccc' }}>All my playlists</button>
                        </div>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#c8c8c8', cursor: 'pointer', userSelect: 'none' }}>
                          <input type="checkbox" checked={stripGoTPrefix} onChange={(e) => setStripGoTPrefix(e.target.checked)} />
                          Short names (hide &quot;GoT-&quot; prefix in this list)
                        </label>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, maxWidth: 560, width: '100%' }}>
                        <input type="search" placeholder="Search playlists by name…" value={playlistQuery} onChange={(e) => setPlaylistQuery(e.target.value)} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.35)', color: '#fff', flex: '1 1 220px', minWidth: 180 }} />
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                          disabled={!isSpotifyConnected || playlistExplicitStatsLoading}
                          title="Request explicit-track counts again from Spotify"
                          onClick={() => setExplicitStatsRefreshNonce((n) => n + 1)}
                        >
                          Refresh explicit labels
                        </button>
                      </div>
                      {playlistExplicitStatsLoading ? (
                        <p style={{ fontSize: '0.78rem', color: '#888', margin: '4px 0 0' }}>
                          Scanning playlists for Spotify explicit flags…
                        </p>
                      ) : null}
                      {playlistExplicitStatsError ? (
                        <p style={{ fontSize: '0.78rem', color: '#ff9e6e', margin: '4px 0 0', maxWidth: 720 }}>
                          {playlistExplicitStatsError}
                        </p>
                      ) : null}
                      {!playlistExplicitStatsLoading && !playlistExplicitStatsError && Object.keys(playlistExplicitStats).length > 0 ? (
                        <p style={{ fontSize: '0.72rem', color: 'rgba(160,200,180,0.95)', margin: '4px 0 0', maxWidth: 720 }}>
                          Explicit badge appears when Spotify reports at least one explicit track in that playlist.
                        </p>
                      ) : null}
                    </div>

                        <div style={{ 
                      maxHeight: 400, 
                      overflowY: 'auto', 
                      border: '1px solid rgba(255,255,255,0.1)', 
                      borderRadius: 8, 
                      padding: 8 
                    }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 8px 8px',
                          fontSize: '0.68rem',
                          color: '#888',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          borderBottom: '1px solid rgba(255,255,255,0.08)',
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ width: 18, textAlign: 'center' }} title="Include in game mix">Mix</span>
                        <button
                          type="button"
                          className="host-playlist-sort-btn"
                          onClick={() => togglePlaylistSort('name')}
                          aria-sort={
                            playlistSort.key === 'name'
                              ? playlistSort.dir === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                          title="Sort by playlist name"
                          style={{
                            flex: 1,
                            textAlign: 'left',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'inherit',
                            font: 'inherit',
                            letterSpacing: 'inherit',
                            textTransform: 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          Playlist
                          {playlistSort.key === 'name' && (
                            <span style={{ color: '#00ff88', fontSize: '0.75rem' }} aria-hidden>
                              {playlistSort.dir === 'asc' ? '?' : '?'}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className="host-playlist-sort-btn"
                          onClick={() => togglePlaylistSort('tracks')}
                          aria-sort={
                            playlistSort.key === 'tracks'
                              ? playlistSort.dir === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                          title="Sort by track count"
                          style={{
                            minWidth: 72,
                            textAlign: 'right',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'inherit',
                            font: 'inherit',
                            letterSpacing: 'inherit',
                            textTransform: 'inherit',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 4,
                          }}
                        >
                          Tracks
                          {playlistSort.key === 'tracks' && (
                            <span style={{ color: '#00ff88', fontSize: '0.75rem' }} aria-hidden>
                              {playlistSort.dir === 'asc' ? '?' : '?'}
                            </span>
                          )}
                        </button>
                        <span style={{ minWidth: 72, textAlign: 'right' }}>
                          {playlistSort.key !== 'none' && (
                            <button
                              type="button"
                              onClick={() => setPlaylistSort({ key: 'none', dir: 'asc' })}
                              className="host-playlist-sort-reset"
                              title="Restore Spotify library order"
                              style={{
                                fontSize: '0.62rem',
                                textTransform: 'none',
                                letterSpacing: '0.02em',
                                background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: 6,
                                padding: '3px 8px',
                                cursor: 'pointer',
                                color: '#c8c8c8',
                              }}
                            >
                              Default order
                            </button>
                          )}
                        </span>
                      </div>
                      {sortedFilteredPlaylists.length === 0 ? (
                          <div style={{ padding: 20, textAlign: 'center', opacity: 0.7 }}>
                            {playlistQuery ? 'No playlists match your search.' : 'No available playlists.'}
                        </div>
                        ) : (
                          sortedFilteredPlaylists.map((p) => {
                            // Debug: log playlists being rendered (first 10 only)
                            if (sortedFilteredPlaylists.indexOf(p) < 10) {
                              console.log(`?? Rendering playlist ${sortedFilteredPlaylists.indexOf(p) + 1}: "${p.name}" (display: "${stripGoTPrefix ? p.name.replace(/^GoT\s*[-�:]*\s*/i, '') : p.name}")`);
                            }
                          const isSelected = selectedPlaylists.some(sp => sp.id === p.id);
                          const pidForRow = normalizeSpotifyPlaylistId(p.id);
                          const rowStatForCount =
                            pidForRow && playlistExplicitStats[pidForRow]
                              ? playlistExplicitStats[pidForRow]
                              : undefined;
                          const trackCount = Math.max(
                            p.tracks,
                            rowStatForCount && typeof rowStatForCount.total === 'number'
                              ? rowStatForCount.total
                              : 0
                          );
                          // Insufficient: < 15 songs (not enough for any mode)
                          const isInsufficient = trackCount < 15;
                          // Acceptable: 15+ songs (good for 5x15 mode) and 75+ songs (good for both modes)
                          const isAcceptable = trackCount >= 15;
                          
                          return (
                            <div 
                              key={p.id} 
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', p.id);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              style={{ 
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 10, 
                                padding: '6px 8px', 
                                borderBottom: '1px solid rgba(255,255,255,0.08)',
                                backgroundColor: isAcceptable ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                                border: isAcceptable ? '1px solid rgba(0, 255, 136, 0.3)' : 'none',
                                borderRadius: isAcceptable ? '4px' : '0',
                                margin: isAcceptable ? '2px 0' : '0',
                                cursor: 'grab'
                              }}
                              onMouseDown={(e) => e.currentTarget.style.cursor = 'grabbing'}
                              onMouseUp={(e) => e.currentTarget.style.cursor = 'grab'}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                aria-label={"Include in game mix: " + (p.name || "playlist")}
                                title="Include in game mix — used when you finalize the bingo song pool"
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPlaylists([...selectedPlaylists, p]);
                                  } else {
                                    setSelectedPlaylists(selectedPlaylists.filter(sp => sp.id !== p.id));
                                  }
                                }}
                                style={{ marginTop: 3 }}
                              />
                              <span style={{ 
                                flex: 1, 
                                minWidth: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 5,
                                alignItems: 'flex-start',
                              }}>
                                <span style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                  fontSize: '0.9rem',
                                  color: isAcceptable ? '#00ff88' : '#fff',
                                }}>
                                  {stripGoTPrefix ? p.name.replace(/^GoT\s*[-�:]*\s*/i, '') : p.name}
                                  {!showAllPlaylists && stripGoTPrefix && (/^got\s*[-�:]*\s*/i.test(p.name) || p.name.toLowerCase().includes('game of tones') || p.name.toLowerCase().includes('gameoftones')) && (
                                    <span style={{
                                      fontSize: '0.7rem',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      background: 'rgba(0, 255, 136, 0.2)',
                                      color: '#00ff88',
                                      border: '1px solid rgba(0, 255, 136, 0.3)'
                                    }}>
                                      GoT
                                    </span>
                                  )}
                                </span>
                                {(() => {
                                  const plain = p.description ? stripPlaylistDescriptionHtml(p.description) : '';
                                  if (!plain) return null;
                                  return (
                                    <span className="host-playlist-desc" title={plain}>
                                      {plain}
                                    </span>
                                  );
                                })()}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.8rem',
                                  opacity: 0.7,
                                  color: isAcceptable ? '#00ff88' : '#b3b3b3',
                                  flexShrink: 0,
                                  paddingTop: 2,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'flex-end',
                                  gap: 4,
                                  textAlign: 'right',
                                }}
                              >
                                <span>{trackCount} songs</span>
                                {(() => {
                                  const pid = pidForRow;
                                  const rowStat = pid ? playlistExplicitStats[pid] : undefined;
                                  return rowStat != null && rowStat.explicitCount > 0 ? (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      color: 'rgba(255,255,255,0.92)',
                                      border: '1px solid rgba(255,255,255,0.14)',
                                      borderRadius: 6,
                                      padding: '3px 8px 3px 6px',
                                      whiteSpace: 'nowrap',
                                      background: 'rgba(0,0,0,0.45)',
                                    }}
                                    title="Tracks flagged as explicit in Spotify"
                                  >
                                    <SpotifyExplicitBadge size="sm" title="Spotify explicit track" />
                                    {rowStat.explicitCount} explicit
                                  </span>
                                ) : null;
                                })()}
                              </span>
                              {isInsufficient && (
                                <span style={{ fontSize: '0.72rem', color: '#ffb347', whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,179,71,0.35)', background: 'rgba(255,179,71,0.08)', flexShrink: 0, paddingTop: 6 }} title="Need at least 15 tracks for a standard round; add songs in Spotify">Need 15+</span>
                              )}
                            </div>
                          );
                        })
                        )}
                        </div>
                  </motion.div>

                    <div className="host-manager-playlist-export">
                      <p>
                        Export a Spotify playlist from the songs used in this session (after you have a finalized mix or have played).
                      </p>
                      <button
                        type="button"
                        onClick={createOutputPlaylist}
                        disabled={!songList || songList.length === 0 || isSpotifyConnecting}
                        className="btn-secondary"
                        style={{
                          backgroundColor: '#6b46c1',
                          borderColor: '#8b5cf6',
                          color: 'white',
                          fontSize: '0.9rem',
                          padding: '10px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <ListPlus className="w-4 h-4" aria-hidden />
                        Create output playlist
                      </button>
                    </div>
            </div>
          )}

                {/* Round & event actions (during or between rounds) */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="host-manager-round"
                >
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CalendarRange className="w-6 h-6" style={{ color: '#00ff88' }} aria-hidden />
                    Round &amp; event
                  </h2>
                  <p className="host-manager-round__actions-head">Quick actions</p>
                  <div className="host-manager-round__row">
                      {gameState === 'playing' && (
                        <>
                          <button 
                            type="button"
                            onClick={completeCurrentRound}
                            className="host-manager-round__btn host-manager-round__btn--green"
                          >
                            <CheckCircle2 className="w-4 h-4" aria-hidden />
                            Complete current round
                          </button>
                          <button 
                            type="button"
                            onClick={resetCurrentRound}
                            className="host-manager-round__btn host-manager-round__btn--yellow"
                          >
                            <RotateCcw className="w-4 h-4" aria-hidden />
                            Reset current round
                          </button>
                        </>
                      )}
                      {(() => {
                        const nextRound = getNextPlannedRound();
                        return nextRound >= 0 ? (
                          <button 
                            type="button"
                            onClick={() => jumpToRound(nextRound)}
                            className="host-manager-round__btn host-manager-round__btn--blue"
                          >
                            <SkipForward className="w-4 h-4" aria-hidden />
                            Start next planned round
                          </button>
                        ) : null;
                      })()}
                      <div className="host-manager-round__reset-wrap">
                        <button
                          type="button"
                          onClick={resetEvent}
                          className="btn-danger-outline"
                          title="Reset entire event back to the beginning"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
                          Reset event
                        </button>
                        <span className="host-manager-round__reset-hint">
                          Clears scores and round state for this room. Cannot be undone.
                        </span>
                      </div>
                  </div>
                </motion.div>
              </div>
            )}

            {activeTab === 'play' && (
              <div className="play-tab">
          {/* Game Controls */}
          <motion.div 
            className="controls-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
          >
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Sliders className="w-6 h-6" style={{ color: '#00ff88' }} aria-hidden />
              Game Controls
            </h2>

                  {/* Game Settings */}
                  <div className="host-game-settings-panel">
                    {/* Track Length Control */}
                    <div style={{ marginBottom: 16 }}>
                      <h4 style={{ fontSize: '0.9rem', color: '#00ff88', marginBottom: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Radio className="w-4 h-4" style={{ color: '#00ff88' }} aria-hidden />
                        Track Playback Settings
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ opacity: 0.85, minWidth: '80px' }}>Track Length:</span>
                <input
                  type="range"
                  className="host-range host-range--snippet"
                  min="5"
                  max="60"
                  value={snippetLength}
                            onChange={(e) => {
                              const newLength = Number(e.target.value);
                              setSnippetLength(newLength);
                              localStorage.setItem('game-snippet-length', newLength.toString());
                            }}
                          />
                          <span style={{ width: 40, textAlign: 'right', color: '#00ff88', fontWeight: 'bold' }}>
                            {snippetLength}s
                          </span>
              </label>
                      </div>
                      
                      {/* Start Position Control */}
                      <div className="host-radio-row">
                        <span style={{ opacity: 0.85, minWidth: '80px' }}>Start Position:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                            type="radio"
                            className="host-control-radio"
                            name="startPosition"
                            checked={randomStarts === 'none'}
                            onChange={() => {
                              setRandomStarts('none');
                              localStorage.setItem('game-random-starts', 'none');
                            }}
                          />
                          <span>From beginning</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="radio"
                            className="host-control-radio"
                            name="startPosition"
                            checked={randomStarts === 'early'}
                            onChange={() => {
                              setRandomStarts('early');
                              localStorage.setItem('game-random-starts', 'early');
                            }}
                          />
                          <span>Early random (first 90s)</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="radio"
                            className="host-control-radio"
                            name="startPosition"
                            checked={randomStarts === 'random'}
                            onChange={() => {
                              setRandomStarts('random');
                              localStorage.setItem('game-random-starts', 'random');
                            }}
                          />
                          <span>Random position</span>
              </label>
            </div>
                      
                      {/* Description */}
                      <div style={{ 
                        fontSize: '0.8rem', 
                        color: '#b3b3b3', 
                        marginTop: 8, 
                        padding: '8px 12px', 
                        background: 'rgba(255,255,255,0.03)', 
                        borderRadius: 4,
                        borderLeft: '3px solid #00ff88'
                      }}>
                        {randomStarts === 'none' 
                          ? `Each track will play for ${snippetLength} seconds starting from the beginning`
                          : randomStarts === 'early'
                          ? `Each track will play for ${snippetLength} seconds starting from a random position within the first 90 seconds`
                          : `Each track will play for ${snippetLength} seconds starting from a random position (avoiding the last 30+ seconds)`
                        }
                      </div>
                    </div>
                    
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }} title="Polls Spotify playback more often and tightens recovery after context glitches. Uses more API traffic; use if you fight hijacked playback.">
                  <input
                    type="checkbox"
                    className="host-control-checkbox"
                    checked={superStrict}
                    onChange={(e) => {
                      const val = !!e.target.checked;
                      setSuperStrict(val);
                      if (socket && roomId) socket.emit('set-super-strict', { roomId, enabled: val });
                    }}
                  />
                  <span>Super-Strict Lock</span>
                </label>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#8a8a8a', lineHeight: 1.35, maxWidth: 640 }}>
                <strong style={{ color: '#b5b5b5' }}>Super-Strict:</strong>{' '}
                Makes the playback watchdog check Spotify more frequently (especially after a &quot;storm&quot; recovery), so wrong device/context gets corrected faster — slightly more API load.
              </div>
            </div>
            </div>

                  {/* Main Game Controls */}
             <div className="control-buttons">
               {gameState === 'waiting' && !currentSong ? (
                 <>
                   {!mixFinalized && (
                     <button 
                       className="control-button finalize-mix"
                       onClick={finalizeMix}
                       disabled={selectedPlaylists.length === 0 || isSpotifyConnecting}
                     >
                       <ListChecks className="w-4 h-4" aria-hidden />
                       Finalize Mix
                     </button>
                   )}
                   {mixFinalized && (
                     <div className="mix-finalized-status">
                       <p className="status-text" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                         <CheckCircle2 className="w-4 h-4" style={{ color: '#00ff88' }} aria-hidden />
                         Mix finalized — cards generated for players
                       </p>
                     </div>
                   )}
                  <button
                    onClick={startGame}
                    disabled={selectedPlaylists.length === 0 || isSpotifyConnecting}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '14px 22px',
                      fontSize: '1.05rem',
                      fontWeight: 900,
                      letterSpacing: '0.02em',
                      borderRadius: 12,
                      border: (selectedPlaylists.length === 0 || isSpotifyConnecting) ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,255,136,0.6)',
                      color: (selectedPlaylists.length === 0 || isSpotifyConnecting) ? '#c8c8c8' : '#0b0e12',
                      background: (selectedPlaylists.length === 0 || isSpotifyConnecting)
                        ? 'rgba(255,255,255,0.08)'
                        : 'linear-gradient(180deg, #00ff88 0%, #00cc6d 100%)',
                      boxShadow: (selectedPlaylists.length === 0 || isSpotifyConnecting)
                        ? 'none'
                        : '0 10px 30px rgba(0,255,136,0.25), inset 0 1px 0 rgba(255,255,255,0.4)',
                      cursor: (selectedPlaylists.length === 0 || isSpotifyConnecting) ? 'not-allowed' : 'pointer',
                      opacity: (isSpotifyConnecting) ? 0.8 : 1
                    }}
                  >
                    <Play className="btn-icon" />
                    {isSpotifyConnecting ? 'Connecting Spotify...' : 'Start Game'}
                  </button>
                  <p style={{ marginTop: 10, fontSize: '0.78rem', color: '#9a9a9a', maxWidth: 520, lineHeight: 1.4 }}>
                    Start Game will <strong style={{ color: '#cfcfcf' }}>finalize the mix automatically</strong> if you have not tapped Finalize Mix yet
                    (same server step; Finalize is optional for early card preview).
                  </p>
                 </>
               ) : (
                 <div className="game-status">
                  <p className="status-text" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Sparkles className="w-4 h-4" style={{ color: '#00ff88' }} aria-hidden />
                    Game is running — use the Now Playing controls below
                  </p>
                  {gamePaused && (
                    <div
                      className="host-paused-banner"
                      style={{
                        background: 'linear-gradient(180deg, rgba(255, 180, 60, 0.35) 0%, rgba(255, 120, 0, 0.22) 100%)',
                        border: '3px solid #ffb020',
                        borderRadius: 14,
                        padding: '18px 16px 20px',
                        marginBottom: 16,
                        textAlign: 'center',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 12px 40px rgba(255, 160, 0, 0.25)',
                      }}
                    >
                      <p style={{ color: '#1a1204', fontWeight: 900, marginBottom: 6, fontSize: '1.35rem', letterSpacing: '0.03em' }}>
                        GAME PAUSED — RESUME HERE
                      </p>
                      <p style={{ color: '#2b2215', fontSize: '0.95rem', marginBottom: 14, fontWeight: 600 }}>
                        {pendingVerification
                          ? `Bingo verification: ${pendingVerification.playerName}`
                          : 'Playback paused (verification or Spotify). Use Resume when ready.'}
                      </p>
                      <button
                        type="button"
                        className="host-resume-game-btn"
                        onClick={handleManualResumeGame}
                      >
                        Resume Game
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <button className="btn-secondary" onClick={endGame}>End Game</button>
                    <button className="btn-secondary" onClick={confirmAndNewRound} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Flag className="w-4 h-4" aria-hidden />
                      New Round
                    </button>
                          <button
                            type="button"
                            className="btn-accent"
                            onClick={() => setShowRoundManager(!showRoundManager)}
                            aria-pressed={showRoundManager}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                          >
                            {showRoundManager ? (
                              <>
                                <ListChecks className="w-4 h-4" aria-hidden />
                                Round Manager (on)
                              </>
                            ) : (
                              <>
                                <CalendarRange className="w-4 h-4" aria-hidden />
                                Round Manager
                              </>
                            )}
                          </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ opacity: 0.9 }}>Public display:</span>
                    <button 
                      type="button"
                      className="btn-secondary btn-host-warn" 
                      onClick={resetDisplayLetters}
                      title="Reset revealed letters on public display (fixes stuck letters)"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <RotateCcw className="w-4 h-4" aria-hidden />
                      Reset Letters
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {playerCards.size > 0 && !playerCardsFullscreen && (
                      <button
                        type="button"
                        className="btn-secondary btn-host-emphasis"
                        onClick={openPlayerCardsModal}
                        title="Open player cards in a window (expand to full screen inside, or Escape to close)"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                      >
                        <Users className="w-4 h-4" aria-hidden />
                        View player cards
                      </button>
                    )}
                    <span style={{ fontSize: '0.75rem', color: '#888', maxWidth: 340 }}>
                      Player cards refresh automatically when the game starts, players join, songs play, or bingo verification opens.
                    </span>
                  </div>
                 </div>
               )}
             </div>
           </motion.div>

                {gameState === 'waiting' && !currentSong && !hasFinalizedSongPool && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: '14px 16px',
                      borderRadius: 10,
                      background: 'rgba(0, 255, 136, 0.06)',
                      border: '1px solid rgba(0, 255, 136, 0.22)',
                      borderLeft: '4px solid #00ff88',
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#e8fff4', fontWeight: 600 }}>
                      No song mix yet
                    </p>
                    <p style={{
                      margin: '8px 0 0',
                      fontSize: '0.82rem',
                      color: 'rgba(255,255,255,0.72)',
                      lineHeight: 1.45,
                      maxWidth: 520,
                    }}>
                      {selectedPlaylists.length === 0
                        ? 'Use Connection in the header for Spotify, then the Manager tab to select playlists for this round. Return here to finalize or start the game.'
                        : 'Tap Finalize Mix or Start Game to build the bingo song pool from your selected playlists.'}
                    </p>
                  </div>
                )}

                {/* Finalized Playlist Display */}
                {hasFinalizedSongPool && (
                  <motion.div
                    className="finalized-playlist-section"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '20px',
                      marginTop: '20px'
                    }}
                  >
                    <h3 style={{
                      color: '#00ffa3',
                      fontSize: '1.2rem',
                      fontWeight: '600',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <ListChecks className="w-5 h-5" aria-hidden />
                      Finalized Playlist ({songList.length || finalizedOrder?.length || 0} songs)
                    </h3>
                    <p style={{
                      color: 'rgba(255,255,255,0.7)',
                      fontSize: '0.9rem',
                      marginBottom: '16px',
                      lineHeight: '1.4'
                    }}>
                      These are the songs that will be used in your bingo game. You can edit titles to make them more recognizable for players.
                      {' '}
                      <span
                        style={{
                          color: 'rgba(255,255,255,0.88)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        Tracks with the Spotify explicit label
                        <SpotifyExplicitBadge size="lg" title="Spotify explicit content label" />
                        are flagged explicit in Spotify.
                      </span>
                    </p>
                    
                    <div style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      background: 'rgba(0,0,0,0.2)'
                    }}>
                      {(finalizedOrder || songList).map((song: any, index: number) => {
                        const displayTitle = getDisplaySongTitle(song.id, song.name);
                        const validation = validateSongTitleSync(displayTitle, song.name);
                        const validationColor = getValidationColor(validation);
                        const validationMessage = getValidationMessage(validation);
                        
                        return (
                          <div 
                            key={song.id} 
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '12px',
                              borderBottom: index < (finalizedOrder || songList).length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                              fontSize: '0.9rem',
                              // Highlight problematic titles
                              background: validation.confidence < 0.7 ? 'rgba(255,68,68,0.1)' : 'transparent',
                              borderLeft: validation.confidence < 0.7 ? `3px solid ${validationColor}` : '3px solid transparent',
                              borderRadius: '4px',
                              margin: '2px 0',
                              cursor: 'help'
                            }}
                            title={`Song Title Comparison:
                            
Original: "${song.name}"
Cleaned: "${displayTitle}"
${customSongTitles[song.id] ? 'Custom: "' + customSongTitles[song.id] + '"' : ''}

${validationMessage}
${validation.warnings.length > 0 ? '\nWarnings: ' + validation.warnings.join('; ') : ''}
${validation.suggestions.length > 0 ? '\nSuggestions: ' + validation.suggestions.slice(0, 3).join('; ') : ''}

Hover over the validation icon for detailed validation info.`}
                          >
                            <span style={{ 
                              color: '#00ff88', 
                              fontWeight: 'bold', 
                              minWidth: '30px',
                              fontSize: '0.8rem'
                            }}>
                              #{index + 1}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ 
                                fontWeight: 'bold', 
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}>
                                {displayTitle}
                                {song.explicit === true && (
                                  <SpotifyExplicitBadge size="md" title="Marked explicit on Spotify" />
                                )}
                                {customSongTitles[song.id] && (
                                  <span style={{ 
                                    fontSize: '0.8rem', 
                                    color: '#00ffa3', 
                                    fontStyle: 'italic'
                                  }}>
                                    (edited)
                                  </span>
                                )}
                                {!customSongTitles[song.id] && displayTitle !== song.name && (
                                  <span style={{ 
                                    fontSize: '0.7rem', 
                                    color: '#ffaa00', 
                                    fontStyle: 'italic',
                                    marginLeft: '4px'
                                  }}>
                                    (cleaned)
                                  </span>
                                )}
                                {/* Validation indicator */}
                                <span 
                                  style={{ 
                                    fontSize: '0.7rem',
                                    color: validationColor,
                                    fontWeight: 'normal',
                                    cursor: 'help'
                                  }}
                                  title={`${validationMessage}. ${validation.warnings.join('; ')}
                                  
Original: "${song.name}"
Cleaned: "${displayTitle}"
${validation.suggestions.length > 0 ? '\nSuggestions: ' + validation.suggestions.slice(0, 2).join('; ') : ''}`}
                                >
                                  {validation.confidence < 0.7 ? (
                                    <AlertTriangle size={14} aria-hidden />
                                  ) : validation.confidence < 0.8 ? (
                                    <AlertCircle size={14} aria-hidden />
                                  ) : (
                                    <CheckCircle2 size={14} aria-hidden />
                                  )}
                                </span>
                              </div>
                              <div style={{ color: '#b3b3b3', fontSize: '0.8rem' }}>
                                by {song.artist}
                                {validation.warnings.length > 0 && (
                                  <span style={{ 
                                    color: validationColor, 
                                    fontSize: '0.7rem',
                                    marginLeft: '8px',
                                    fontStyle: 'italic'
                                  }}>
                                    {validation.warnings[0]}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleEditSongTitle({id: song.id, title: song.name, artist: song.artist})}
                                style={{
                                  background: 'rgba(0,255,163,0.1)',
                                  border: '1px solid rgba(0,255,163,0.3)',
                                  borderRadius: '6px',
                                  color: '#00ffa3',
                                  padding: '6px 10px',
                                  fontSize: '0.8rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Edit song title for Game of Tones"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden />
                                Edit
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
                </div>
          )}

            {showRoundManager && (
              <div className="manage-tab">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="host-round-manager-panel"
                >
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CalendarRange className="w-6 h-6" style={{ color: '#00ff88' }} aria-hidden />
                    Round &amp; event management
                  </h2>

                  <div className="host-round-manager-overview">
                    <h4>Event overview</h4>
                    <div className="host-round-manager-stats">
                      {(() => {
                        const summary = getRoundStatusSummary();
                        return (
                          <>
                            <div className="host-round-manager-stat">
                              <div className="host-round-manager-stat__val host-round-manager-stat__val--green">{summary.completed}</div>
                              <div className="host-round-manager-stat__label">Completed</div>
                            </div>
                            <div className="host-round-manager-stat">
                              <div className="host-round-manager-stat__val host-round-manager-stat__val--blue">{summary.active}</div>
                              <div className="host-round-manager-stat__label">Active</div>
                            </div>
                            <div className="host-round-manager-stat">
                              <div className="host-round-manager-stat__val host-round-manager-stat__val--yellow">{summary.planned}</div>
                              <div className="host-round-manager-stat__label">Planned</div>
                            </div>
                            <div className="host-round-manager-stat">
                              <div className="host-round-manager-stat__val host-round-manager-stat__val--gray">{summary.unplanned}</div>
                              <div className="host-round-manager-stat__label">Unplanned</div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div>
                    <h4 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 600, color: '#fff' }}>All rounds</h4>
                    <div className="host-round-manager-rounds">
                      {eventRounds.map((round, index) => {
                        const isCurrentRound = index === currentRoundIndex;
                        const canStart = round.status !== 'completed' && (round.playlistIds || []).length > 0;
                        const roundClass =
                          isCurrentRound
                            ? 'host-round-manager-round host-round-manager-round--current'
                            : round.status === 'completed'
                              ? 'host-round-manager-round host-round-manager-round--done'
                              : canStart
                                ? 'host-round-manager-round host-round-manager-round--ready'
                                : 'host-round-manager-round host-round-manager-round--blocked';

                        return (
                          <div key={round.id} className={roundClass}>
                            <div className="host-round-manager-round__top">
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span className="host-round-manager-round__name">{round.name}</span>
                                  {isCurrentRound && (
                                    <span className="host-round-manager-badge host-round-manager-badge--current">CURRENT</span>
                                  )}
                                  {round.status === 'completed' && (
                                    <span className="host-round-manager-badge host-round-manager-badge--done">DONE</span>
                                  )}
                                </div>
                                <div className="host-round-manager-round__meta">
                                  {(round.playlistIds || []).length} playlist{(round.playlistIds || []).length !== 1 ? 's' : ''} · {round.songCount} songs
                                  {round.status === 'completed' && round.completedAt && (
                                    <span style={{ marginLeft: 8 }}>
                                      · Completed {new Date(round.completedAt).toLocaleTimeString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="host-round-manager-round__actions">
                                {canStart && !isCurrentRound && (
                                  <button
                                    type="button"
                                    onClick={() => jumpToRound(index)}
                                    className="host-round-manager-start-btn"
                                  >
                                    Start
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              </div>
            )}

                {/* Player cards: compact strip � open modal or full screen to inspect grids */}
                {playerCards.size > 0 && !playerCardsFullscreen && (
             <motion.div 
               key={`player-cards-${playerCardsVersion}`}
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               transition={{ delay: 0.4 }}
                    className="player-cards-section"
                    style={{ 
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '12px 16px',
                      marginTop: '16px'
                    }}
             >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#00ffa3', fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Users className="w-5 h-5" aria-hidden />
                          Player cards
                        </div>
                        <div style={{ color: '#8a9ba8', fontSize: '0.8rem', marginTop: 4 }}>
                          {playerCards.size} player{playerCards.size !== 1 ? 's' : ''} · Pattern:{' '}
                          <strong style={{ color: '#c5d4e0' }}>{getPatternDisplayName(pattern)}</strong>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={openPlayerCardsModal}
                        style={{ fontWeight: 800, borderColor: '#00ffa3', color: '#00ffa3' }}
                        title="Open player cards in a window (Escape to close)"
                      >
                        View cards
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={openPlayerCardsFullscreen}
                        style={{ fontWeight: 700 }}
                        title="Use the full screen for player cards"
                      >
                        <Maximize2 className="w-4 h-4" aria-hidden />
                        Full screen
                      </button>
                      </div>
               </div>
             </motion.div>
           )}
          </div>


          {/* Legacy sections removed - now in tabbed interface */}
                  
          {/* Now Playing � normal document flow (no sticky) so it never covers Manager / round buckets */}
          {currentSong && (
            <motion.div 
              className="now-playing-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              style={{
                position: 'relative',
                zIndex: 1,
                marginTop: 20,
                borderRadius: 14,
                boxShadow: '0 8px 28px rgba(0, 0, 0, 0.35)',
                background: 'rgba(26, 26, 46, 0.98)',
                backdropFilter: 'blur(10px)',
              }}
            >
               <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                 <Music className="w-6 h-6" style={{ color: '#00ff88' }} aria-hidden />
                 Now Playing
               </h2>
               <div className="now-playing-content">
                 {/* Song Info */}
              <div style={{ 
                background: 'rgba(255,255,255,0.05)', 
                padding: 16, 
                borderRadius: 8, 
                marginBottom: 16,
                textAlign: 'center'
              }}>
                <div
                  style={{
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    color: '#00ff88',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{currentSong.name}</span>
                  {currentSong.explicit === true && (
                    <SpotifyExplicitBadge size="lg" title="Marked explicit on Spotify" />
                  )}
                </div>
                <div style={{ fontSize: '1rem', color: '#b3b3b3' }}>
                  by {currentSong.artist}
                   </div>
                 </div>

              {/* Playback Controls */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
                <button className="btn-secondary" onClick={pauseSong}>
                  {!isPlaying ? 'Resume' : 'Pause'}
                   </button>
                <button className="btn-secondary" onClick={skipSong}>Skip</button>
                 </div>

                 {/* Volume Control */}
              <div style={{ 
                background: 'rgba(255,255,255,0.05)', 
                padding: 16, 
                borderRadius: 8, 
                display: 'flex', 
                alignItems: 'center', 
                gap: 12,
                justifyContent: 'center'
              }}>
                   <button
                  type="button"
                  className="btn-secondary btn-host-icon"
                     onClick={handleMuteToggle}
                   >
                     {isMuted ? <VolumeX className="w-5 h-5" aria-hidden /> : <Volume2 className="w-5 h-5" aria-hidden />}
                   </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: '300px' }}>
                  <span style={{ fontSize: '0.9rem', color: '#b3b3b3', minWidth: '30px' }}>
                    {isMuted ? 0 : playbackState.volume}%
                  </span>
                   <input
                     type="range"
                     min="0"
                     max="100"
                     value={isMuted ? 0 : playbackState.volume}
                    onChange={(e) => {
                      const newVolume = parseInt(e.target.value);
                      if (isMuted && newVolume > 0) {
                        setIsMuted(false);
                      }
                      setPlaybackState(prev => ({ ...prev, volume: newVolume }));
                      handleVolumeChange(newVolume);
                    }}
                    style={{
                      flex: 1,
                      background: `linear-gradient(to right, #00ff88 0%, #00ff88 ${isMuted ? 0 : playbackState.volume}%, #333 ${isMuted ? 0 : playbackState.volume}%, #333 100%)`,
                    }}
                     className="volume-slider host-range host-range--volume"
                   />
                  <span style={{ fontSize: '0.8rem', color: '#666', minWidth: '40px' }}>100%</span>
                 </div>
                  </div>
               </div>
             </motion.div>
           )}
          </div> {/* Close host-content */}

      </motion.div>

      {showConnectionModal && (
        <div
          className="host-connection-modal-backdrop"
          onClick={() => setShowConnectionModal(false)}
          role="presentation"
        >
          <div
            className="host-connection-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-connection-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="host-connection-modal__header">
              <h2 id="host-connection-modal-title">Spotify & device</h2>
              <button
                type="button"
                className="host-connection-modal__close"
                aria-label="Close"
                onClick={() => setShowConnectionModal(false)}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="host-connection-modal__body">{hostConnectionPanel}</div>
          </div>
        </div>
      )}

      {/* Player cards: centered modal (default) or expanded full-screen panel (z-index below bingo verification) */}
      {playerCards.size > 0 && playerCardsFullscreen && (
        playerCardsMaximized ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Player cards full screen"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 8500,
            background: 'linear-gradient(180deg, #0d1117 0%, #0a0e14 100%)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 18px',
              borderBottom: '1px solid rgba(0,255,163,0.25)',
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(8px)'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#00ffa3', fontWeight: 800, fontSize: 'clamp(1.1rem, 2vw, 1.45rem)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Users className="w-6 h-6" aria-hidden />
                Player Cards &amp; Progress
              </div>
              <div style={{ color: '#8a9ba8', fontSize: '0.8rem', marginTop: 4 }}>
                Pattern: <strong style={{ color: '#c5d4e0' }}>{getPatternDisplayName(pattern)}</strong>
                {' · '}
                <span>Press Escape to close</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexShrink: 0, gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPlayerCardsMaximized(false)}
              style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              title="Return to windowed view"
            >
              <AppWindow className="w-4 h-4" aria-hidden />
              Window
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={closePlayerCardsOverlay}
              style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <X className="w-4 h-4" aria-hidden />
              Close
            </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '20px 18px 28px' }}>
            {renderHostPlayerCardsGrid(false)}
          </div>
        </div>
        ) : (
        <div
          role="presentation"
          onClick={closePlayerCardsOverlay}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 8500,
            background: 'rgba(0,0,0,0.76)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-player-cards-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1200px, 100%)',
              maxHeight: 'min(88vh, 920px)',
              display: 'flex',
              flexDirection: 'column',
              background: 'linear-gradient(180deg, #0d1117 0%, #0a0e14 100%)',
              border: '1px solid rgba(0,255,163,0.35)',
              borderRadius: 14,
              overflow: 'hidden',
              boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
            }}
          >
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 18px',
              borderBottom: '1px solid rgba(0,255,163,0.25)',
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(8px)'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div id="host-player-cards-modal-title" style={{ color: '#00ffa3', fontWeight: 800, fontSize: 'clamp(1.05rem, 2vw, 1.35rem)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Users className="w-6 h-6" aria-hidden />
                Player Cards &amp; Progress
              </div>
              <div style={{ color: '#8a9ba8', fontSize: '0.8rem', marginTop: 4 }}>
                Pattern: <strong style={{ color: '#c5d4e0' }}>{getPatternDisplayName(pattern)}</strong>
                {' · '}
                <span>Click outside or press Escape to close</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexShrink: 0, gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPlayerCardsMaximized(true)}
              style={{ fontWeight: 800, borderColor: '#00ffa3', color: '#00ffa3', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              title="Expand to use the full screen"
            >
              <Maximize2 className="w-4 h-4" aria-hidden />
              Full screen
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={closePlayerCardsOverlay}
              style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <X className="w-4 h-4" aria-hidden />
              Close
            </button>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 18px 20px' }}>
            {renderHostPlayerCardsGrid(false)}
          </div>
          </div>
        </div>
        )
      )}

        

      {/* Bingo Verification Modal */}
      {pendingVerification && (
        <div 
                              style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
              border: '2px solid #00ff88',
              borderRadius: '15px',
              padding: '24px',
              maxWidth: '600px',
              width: '90vw',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0, 255, 136, 0.3)'
            }}
          >
            <h2 style={{ color: '#00ff88', marginBottom: '16px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <AlertTriangle className="w-7 h-7" aria-hidden />
              BINGO VERIFICATION NEEDED
            </h2>
            
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
              <p style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px' }}>
                <strong>{pendingVerification.playerName}</strong> called BINGO!
              </p>
              <p style={{ color: '#ccc', fontSize: '0.9rem' }}>
                Pattern: <strong>{pendingVerification.winningPatternType || pendingVerification.requiredPattern}</strong>
              </p>
            </div>

            {/* Full Card Visualization */}
            {pendingVerification.playerCard && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#00ff88', marginBottom: '12px', fontSize: '1rem' }}>Player's Card:</h3>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(5, 1fr)', 
                  gap: '4px',
                  maxWidth: '400px',
                  margin: '0 auto',
                  background: 'rgba(0,0,0,0.3)',
                  padding: '8px',
                  borderRadius: '8px'
                }}>
                  {(['B', 'I', 'N', 'G', 'O'] as const).map((letter, colIdx) => {
                    const raw = hostBingoColumnHeaders[colIdx] || '';
                    const playlistLabel = stripGotPlaylistPrefix(raw);
                    return (
                      <div
                        key={`hdr-${letter}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          textAlign: 'center',
                          gap: 3,
                          minWidth: 0,
                          userSelect: 'none',
                          paddingBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            letterSpacing: '0.06em',
                            color: 'rgba(0, 255, 163, 0.95)',
                          }}
                        >
                          {letter}
                        </span>
                        {playlistLabel ? (
                          <span
                            title={playlistLabel}
                            style={{
                              fontSize: '0.55rem',
                              fontWeight: 600,
                              lineHeight: 1.15,
                              color: 'rgba(220, 230, 240, 0.9)',
                              wordBreak: 'break-word',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical' as const,
                              overflow: 'hidden',
                              width: '100%',
                            }}
                          >
                            {playlistLabel}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                  {pendingVerification.playerCard.squares?.map((square: any) => {
                    const isInWinningPattern = pendingVerification.winningPatternPositions?.includes(square.position);
                    const wasPlayed =
                      isBingoFreeSpaceSquare(square) ||
                      (pendingVerification.playedSongs?.some((song: any) => song.id === square.songId) ?? false);
                    const isMarked = square.marked === true; // Explicit check for true
                    const isInvalid = isMarked && !wasPlayed;
                    
                    let bgColor = 'rgba(255,255,255,0.1)';
                    let borderColor = 'rgba(255,255,255,0.3)';
                    let borderWidth = '1px';
                    let icon: 'bad' | 'good' | 'pending' | 'warn' | null = null;
                    
                    // Determine styling based on state
                    if (isInWinningPattern) {
                      borderWidth = '3px';
                      if (isInvalid) {
                        bgColor = 'rgba(255, 0, 0, 0.3)';
                        borderColor = '#ff4444';
                        icon = 'bad';
                      } else if (wasPlayed && isMarked) {
                        bgColor = 'rgba(0, 255, 136, 0.3)';
                        borderColor = '#00ff88';
                        icon = 'good';
                      } else {
                        bgColor = 'rgba(255, 255, 0, 0.2)';
                        borderColor = '#ffaa00';
                        icon = 'pending';
                      }
                    } else {
                      // Squares NOT in winning pattern
                      if (isInvalid) {
                        bgColor = 'rgba(255, 0, 0, 0.2)';
                        borderColor = '#ff4444';
                        borderWidth = '2px';
                        icon = 'bad';
                      } else if (isMarked && wasPlayed) {
                        bgColor = 'rgba(0, 255, 136, 0.15)';
                        borderColor = '#00ff88';
                        borderWidth = '2px';
                        icon = 'good';
                      } else if (isMarked && !wasPlayed) {
                        bgColor = 'rgba(255, 255, 0, 0.15)';
                        borderColor = '#ffaa00';
                        borderWidth = '2px';
                        icon = 'warn';
                      }
                    }
                    
                    return (
                      <div
                        key={square.position}
                        style={{
                          aspectRatio: '1',
                          background: bgColor,
                          border: `${borderWidth} solid ${borderColor}`,
                          borderRadius: '4px',
                          padding: '4px',
                          fontSize: '0.65rem',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          color: '#fff',
                          fontWeight: isInWinningPattern ? 'bold' : (isMarked ? 'bold' : 'normal')
                        }}
                        title={`${square.songName} - ${square.artistName}\nMarked: ${isMarked ? 'YES' : 'NO'}\nPlayed: ${wasPlayed ? 'YES' : 'NO'}\n${isInWinningPattern ? 'IN WINNING PATTERN' : 'NOT in pattern'}\n${isInvalid ? 'Invalid mark' : isMarked && wasPlayed ? 'Valid mark' : isMarked ? 'Marked (not played yet)' : 'Not marked'}`}
                      >
                        {icon === 'bad' && <X size={12} aria-hidden style={{ marginBottom: 2 }} />}
                        {icon === 'good' && <Check size={12} aria-hidden style={{ marginBottom: 2, color: '#00ff88' }} />}
                        {icon === 'pending' && <span style={{ fontSize: '0.75rem', marginBottom: 2 }} aria-hidden>○</span>}
                        {icon === 'warn' && <span style={{ fontSize: '0.75rem', marginBottom: 2 }} aria-hidden>!</span>}
                        <span style={{ fontSize: '0.6rem', lineHeight: 1.1 }}>
                          {square.songName.substring(0, 8)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Winning Pattern Squares List */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ color: '#00ff88', marginBottom: '12px', fontSize: '1rem' }}>
                Winning Pattern Squares ({pendingVerification.winningPatternPositions?.length || 0} squares):
              </h3>
              <div style={{ 
                maxHeight: '300px', 
                overflow: 'auto', 
                background: 'rgba(0,0,0,0.3)', 
                padding: '12px', 
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                {pendingVerification.winningPatternPositions?.map((position: string, index: number) => {
                  const square = pendingVerification.playerCard?.squares?.find((s: any) => s.position === position);
                  if (!square) return null;
                  
                  const wasPlayed =
                    isBingoFreeSpaceSquare(square) ||
                    (pendingVerification.playedSongs?.some((song: any) => song.id === square.songId) ?? false);
                  const isMarked = square.marked;
                  const isInvalid = isMarked && !wasPlayed;
                  
                  return (
                    <div 
                      key={index}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '10px',
                        marginBottom: '6px',
                        background: isInvalid ? 'rgba(255, 0, 0, 0.2)' : wasPlayed && isMarked ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '6px',
                        border: `2px solid ${isInvalid ? '#ff4444' : wasPlayed && isMarked ? '#00ff88' : 'rgba(255,255,255,0.2)'}`,
                        borderLeftWidth: isInvalid ? '6px' : wasPlayed && isMarked ? '6px' : '2px'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#fff', fontSize: '0.95rem', fontWeight: 'bold', marginBottom: '2px' }}>
                          {square.songName}
                        </div>
                        <div style={{ color: '#ccc', fontSize: '0.85rem' }}>
                          {square.artistName}
                        </div>
                        <div style={{ color: '#888', fontSize: '0.75rem', marginTop: '4px' }}>
                          Position: {position}
                        </div>
                      </div>
                      <div style={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '4px'
                      }}>
                        {isInvalid ? (
                          <>
                            <span style={{ 
                              color: '#ff4444',
                              fontSize: '0.85rem',
                              fontWeight: 'bold',
                              backgroundColor: 'rgba(255, 0, 0, 0.2)',
                              padding: '4px 8px',
                              borderRadius: '4px'
                            }}>
                              ? INVALID MARK
                            </span>
                            <span style={{ 
                              color: '#ff8888',
                              fontSize: '0.75rem'
                            }}>
                              Not in played list
                            </span>
                          </>
                        ) : wasPlayed && isMarked ? (
                          <>
                            <span style={{ 
                              color: '#00ff88',
                              fontSize: '0.85rem',
                              fontWeight: 'bold',
                              backgroundColor: 'rgba(0, 255, 136, 0.2)',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}>
                              <Check size={14} aria-hidden />
                              VALID
                            </span>
                            <span style={{ 
                              color: '#88ffaa',
                              fontSize: '0.75rem'
                            }}>
                              Played & marked
                            </span>
                          </>
                        ) : (
                          <>
                            <span style={{ 
                              color: '#ffaa00',
                              fontSize: '0.85rem',
                              fontWeight: 'bold',
                              backgroundColor: 'rgba(255, 170, 0, 0.2)',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}>
                              <AlertCircle size={14} aria-hidden />
                              NOT MARKED
                            </span>
                            <span style={{ 
                              color: '#ffcc88',
                              fontSize: '0.75rem'
                            }}>
                              {wasPlayed ? 'Played but not marked' : 'Not played'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Verification Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button
                onClick={approveBingo}
                disabled={isProcessingVerification}
                    style={{
                      background: 'linear-gradient(135deg, #00ff88, #00cc6d)',
                  color: '#000',
                      border: 'none',
                      padding: '12px 24px',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: isProcessingVerification ? 'not-allowed' : 'pointer',
                  opacity: isProcessingVerification ? 0.6 : 1
                }}
              >
                {isProcessingVerification ? '? Processing...' : '? APPROVE BINGO'}
                  </button>
                  
                  <button
                onClick={() => {
                  const reason = prompt('Reason for rejection (optional):') || 'Invalid pattern';
                  rejectBingo(reason);
                }}
                disabled={isProcessingVerification}
                    style={{
                      background: 'linear-gradient(135deg, #ff4444, #cc3333)',
                  color: '#fff',
                      border: 'none',
                      padding: '12px 24px',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: isProcessingVerification ? 'not-allowed' : 'pointer',
                  opacity: isProcessingVerification ? 0.6 : 1
                }}
              >
                {isProcessingVerification ? '? Processing...' : '? REJECT BINGO'}
                  </button>
                </div>

            {/* Debug Info - Only show in debug mode */}
            {pendingVerification.debugInfo && (() => {
              const searchParams = new URLSearchParams(window.location.search);
              const debugMode = searchParams.get('debug') === '1' || searchParams.get('dbg') === '1';
              return debugMode ? (
                <div style={{ 
                  marginTop: '16px', 
                  padding: '8px', 
                  background: 'rgba(0,0,0,0.2)', 
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  color: '#ccc'
                }}>
                  <strong>Debug:</strong> {pendingVerification.debugInfo.totalMarkedSquares} marked, {pendingVerification.debugInfo.totalPlayedSongs} played songs
                </div>
              ) : null;
            })()}
                  </div>
              </div>
      )}

      {/* Round Complete Modal - Shows after bingo is approved */}
      {roundComplete && (
        <div 
          style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001 // Above bingo verification modal
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            style={{
              background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
              border: '3px solid #00ff88',
              borderRadius: '20px',
              padding: '32px',
              maxWidth: '600px',
              width: '90vw',
              boxShadow: '0 20px 60px rgba(0, 255, 136, 0.4)',
              textAlign: 'center'
            }}
          >
            <h2 style={{ color: '#00ff88', marginBottom: '20px', fontSize: '2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <PartyPopper className="w-9 h-9" aria-hidden />
              Round Complete!
            </h2>
            
            <div style={{ marginBottom: '24px' }}>
              <p style={{ fontSize: '1.4rem', color: '#fff', marginBottom: '8px', fontWeight: 'bold' }}>
                {roundComplete.playerName} Wins Round {roundComplete.roundNumber}!
              </p>
              {roundWinners.length > 0 && (
                <div style={{ 
                  background: 'rgba(0,255,136,0.1)', 
                  padding: '12px', 
                  borderRadius: '8px',
                  marginTop: '12px'
                }}>
                  <p style={{ color: '#00ff88', fontSize: '0.9rem', marginBottom: '8px' }}>Round Winners:</p>
                  {roundWinners.map((winner: any, idx: number) => (
                    <div key={idx} style={{ color: '#fff', fontSize: '0.85rem', marginBottom: '4px' }}>
                      Round {winner.roundNumber}: {winner.playerName}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px',
              marginTop: '24px'
            }}>
              <button
                onClick={handleStartNextRound}
                style={{
                  background: 'linear-gradient(135deg, #00ff88, #00cc6d)',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '16px 24px',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  color: '#001a0d',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 15px rgba(0, 255, 136, 0.3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 255, 136, 0.5)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 255, 136, 0.3)';
                }}
              >
                <SkipForward className="w-5 h-5" aria-hidden />
                Start Next Round
              </button>

              <button
                onClick={handleEndGameSession}
                style={{
                  background: 'rgba(255, 68, 68, 0.2)',
                  border: '2px solid #ff4444',
                  borderRadius: '10px',
                  padding: '12px 24px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  color: '#ff4444',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 68, 68, 0.3)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 68, 68, 0.2)';
                }}
              >
                <X className="w-5 h-5" aria-hidden />
                End Game Session
              </button>
            </div>

            <p style={{ 
              color: '#888', 
              fontSize: '0.85rem', 
              marginTop: '20px',
              fontStyle: 'italic'
            }}>
              The game is paused. Choose an option above to continue.
            </p>
          </motion.div>
        </div>
      )}

      {/* Add spinning animation for loading indicator */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Custom Pattern Modal */}
      <CustomPatternModal
        isOpen={showCustomPatternModal}
        onClose={() => setShowCustomPatternModal(false)}
        onSave={handleSaveCustomPattern}
      />

      {/* Song Title Edit Modal */}
      {editingSong && (
        <SongTitleEditModal
          isOpen={showSongTitleModal}
          onClose={() => {
            setShowSongTitleModal(false);
            setEditingSong(null);
          }}
          onSave={handleSaveSongTitle}
          songId={editingSong.id}
          originalTitle={editingSong.title}
          customTitle={customSongTitles[editingSong.id]}
          artistName={editingSong.artist}
        />
      )}

    </div>
  );
};

export default HostView;



