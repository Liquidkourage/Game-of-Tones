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
  Printer,
  Save,
  Eraser,
  HelpCircle,
} from 'lucide-react';
import io from 'socket.io-client';
import { API_BASE, SOCKET_URL, ENABLE_YOUTUBE_MUSIC } from '../config';
import { hostFetch, getHostJwt, setHostJwt, clearHostJwt, apiOrigin, browserGoogleLoginUrl } from '../utils/hostFetch';
import {
  BingoPattern,
  BINGO_PATTERNS,
  getPatternDisplayName,
  getSavedCustomPatterns,
  PATTERN_OPTIONS,
  PRESET_SHAPE_PATTERNS,
  saveCustomPattern,
  SavedCustomPattern,
  CompositeClausePreset,
  PatternCompositeSpec,
  COMPOSITE_CLAUSE_PRESETS,
  DEFAULT_COMPOSITE_SPEC,
  normalizePatternComposite,
  normalizeLinesRequired,
  LINE_PATTERN_MAX_LINES,
  compositeLegitProgressPct,
  clauseSupportsMatchVariants,
  describeCompositePatternAudienceSentence,
  type SavedCompositePattern,
  getSavedCompositePatterns,
  saveCompositePattern,
  deleteSavedCompositePattern,
} from '../patternDefinitions';
import CustomPatternModal, { type CustomPatternSavePayload } from './CustomPatternModal';
import CombinedPatternModal from './CombinedPatternModal';
import SongTitleEditModal from './SongTitleEditModal';
import HostAcknowledgeModal, { type HostAckVariant } from './HostAcknowledgeModal';
import { HostYoutubeMusicSection } from './HostYoutubeMusicSection';
import { HostYoutubeMusicPlaylistLibrary, type YoutubeMixPlaylistRow } from './HostYoutubeMusicPlaylistLibrary';
import { HostYoutubeIframePlayer, primeYoutubeHostPlaybackAudioUnlock } from './HostYoutubeIframePlayer';
import RoundPlanner from './RoundPlanner';
import { SpotifyExplicitBadge } from './SpotifyExplicitBadge';
import { cleanSongTitle } from '../utils/songTitleCleaner';
import { youtubeTrackDisplayFields, youtubeBingoSquareDisplay } from '../utils/youtubeTrackDisplay';
import { buildPrintableBingoPdfBlob } from '../utils/printableBingoPdf';
import { buildRoundCallSheetPdfBlob } from '../utils/printRoundCallSheetPdf';
import {
  normalizePublicDisplayTitleRevealMode,
  type PublicDisplayTitleRevealMode,
} from '../utils/publicDisplayTitleReveal';
import {
  canonicalPlaylistIdForMatch,
  compute5x15InsufficientWarnings,
  computeEffectiveBingoPoolPreview,
} from '../utils/effectiveBingoPoolPreview';
import { getYoutubeHostPlaybackChannelName } from '../utils/youtubeHostPlaybackChannel';
import { sortRoundPlaylistsByBingoColumns } from '../utils/roundPlaylistOrder';
import { validateSongTitle, validateSongTitleSync, getValidationMessage, getValidationColor } from '../utils/songTitleValidator';
import './HostView.css';
import './HostFormControls.css';

const MAX_CUSTOM_PATTERN_NAME_EMIT = 80;

function positionsKeyForMatch(arr: readonly string[]): string {
  return [...arr].sort().join(',');
}

/** Saved-pattern display name for server sync (projector / clients). */
function customPatternDisplayNameForEmit(
  mask: readonly string[],
  selected: SavedCustomPattern | null | undefined,
  savedList: SavedCustomPattern[],
): string | undefined {
  if (!mask.length) return undefined;
  const key = positionsKeyForMatch(mask);
  const fromSelected =
    selected && positionsKeyForMatch(selected.positions) === key ? selected.name?.trim() : '';
  if (fromSelected) return fromSelected.slice(0, MAX_CUSTOM_PATTERN_NAME_EMIT);
  const hit = savedList.find((sp) => positionsKeyForMatch(sp.positions) === key);
  const n = hit?.name?.trim();
  return n ? n.slice(0, MAX_CUSTOM_PATTERN_NAME_EMIT) : undefined;
}

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  public?: boolean;
  collaborative?: boolean;
  owner?: string;
  /** Set after a full playlist-tracks fetch for this id in this session (Finalize / setlist build). */
  hasExplicitTracks?: boolean;
  /** Track list loaded via server catalog token (LK-owned allowlisted playlists). */
  catalog?: boolean;
  /** User library via YouTube Music / YouTube Data API (playlist items are videos). */
  youtubeMusic?: boolean;
}

/** Playlists per page in the playlist-round modal (fits viewport without scrolling). */
const PLAYLIST_LIBRARY_PAGE_SIZE = 15;

/** In-process Web API 429 cool-down (from GET /api/spotify/status and error bodies). */
type WebApiQuarantineState =
  | { active: false }
  | {
      active: true;
      remainingSec: number;
      source?: string;
      sourceDescription?: string;
      spotifyRetryAfterSec: number | null;
      effectiveCooldownSec?: number;
      inProcessMaxCooldownSec?: number;
      spotifyRetryCapped?: boolean;
    };

function normalizeWebApiQuarantine(raw: unknown): WebApiQuarantineState {
  if (!raw || typeof raw !== 'object') return { active: false };
  const o = raw as Record<string, unknown>;
  if (o.active !== true) return { active: false };
  return {
    active: true,
    remainingSec: Math.max(0, typeof o.remainingSec === 'number' ? o.remainingSec : 0),
    source: typeof o.source === 'string' ? o.source : undefined,
    sourceDescription: typeof o.sourceDescription === 'string' ? o.sourceDescription : undefined,
    spotifyRetryAfterSec:
      typeof o.spotifyRetryAfterSec === 'number' && o.spotifyRetryAfterSec > 0 ? o.spotifyRetryAfterSec : null,
    effectiveCooldownSec: typeof o.effectiveCooldownSec === 'number' ? o.effectiveCooldownSec : undefined,
    inProcessMaxCooldownSec: typeof o.inProcessMaxCooldownSec === 'number' ? o.inProcessMaxCooldownSec : 900,
    spotifyRetryCapped: o.spotifyRetryCapped === true,
  };
}

interface Song {
  id: string;
  name: string;
  artist: string;
  duration?: number; // Make duration optional
  /** Spotify: track has explicit content */
  explicit?: boolean;
  /** Playback uses host YouTube iframe (video id in `id`). */
  youtubeMusic?: boolean;
  sourcePlaylistId?: string;
  sourcePlaylistName?: string;
  /** Full YouTube `snippet.title` when loaded from Data API; finalize reconciliation uses this. */
  youtubeRawTitle?: string;
  /** Canonical title/artist from optional iTunes pass + disk cache at finalize. */
  catalogDisplayVerified?: boolean;
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
  /** Winning pattern for this round (live game + printable PDF free-space toggle when set). */
  bingoPattern?: BingoPattern;
  /** Required when `bingoPattern === 'custom'` (saved-pattern squares). */
  customPatternMask?: string[];
  /** Required when `bingoPattern === 'composite'` (AND/OR clauses). */
  patternComposite?: PatternCompositeSpec;
  /** When `bingoPattern === 'line'`: how many distinct rows/columns/diagonals must be complete (1–12). */
  linesRequired?: number;
  /** Custom pattern: allow rotated placements when matching (stored per round). */
  customMatchAllowRotation?: boolean;
  /** Custom pattern: allow mirrored placements when matching (stored per round). */
  customMatchAllowMirror?: boolean;
  /** When set, overrides host-wide free-space for this round; omit to inherit the Bingo Pattern checkbox. */
  freeSpaceEnabled?: boolean;
  /** Frozen finalized subset for this round (tracks + gameplay knobs at save time). Enables offline PDF from snapshot. */
  savedMixSnapshot?: SavedRoundMixSnapshot;
}

/** Geometry implied by mix playlist layout when the snapshot was saved (informational + reload UX). */
type SavedMixGeometry = '5x15' | '1x75' | 'merged';

interface SavedRoundMixSnapshot {
  savedAt: number;
  songs: Song[];
  mixGeometry: SavedMixGeometry;
  snippetLength: number;
  randomStarts: 'none' | 'early' | 'random';
}

function cloneSongForSnapshot(s: Song): Song {
  return {
    id: s.id,
    name: s.name,
    artist: s.artist,
    duration: s.duration,
    explicit: s.explicit,
    youtubeMusic: s.youtubeMusic,
    sourcePlaylistId: s.sourcePlaylistId,
    sourcePlaylistName: s.sourcePlaylistName,
    youtubeRawTitle: s.youtubeRawTitle,
    catalogDisplayVerified: s.catalogDisplayVerified,
  };
}

function selectionPlaylistKey(playlists: Array<{ id: string }>): string {
  return [...playlists]
    .map((p) => String(p.id))
    .sort((a, b) => a.localeCompare(String(b)))
    .join('|');
}

/** Tracks assigned to this round's playlists, order preserved from the finalized playback pool. */
function songsForRoundFromFinalizedPool(round: EventRound, pool: Song[]): Song[] {
  const wantRaw = (round.playlistIds || []).map((id) => String(id).trim()).filter(Boolean);
  const want = new Set(wantRaw.map(canonicalPlaylistIdForMatch));
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of pool) {
    const pidRaw = s.sourcePlaylistId != null ? String(s.sourcePlaylistId).trim() : '';
    const pid = pidRaw ? canonicalPlaylistIdForMatch(pidRaw) : '';
    if (!want.has(pid)) continue;
    if (!s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  // Single-playlist (1×75): pool may lack sourcePlaylistId on every track (legacy server emit); pool is already from this finalize.
  if (out.length === 0 && wantRaw.length === 1 && pool.length > 0) {
    const seenFb = new Set<string>();
    const fb: Song[] = [];
    for (const s of pool) {
      if (!s.id || seenFb.has(s.id)) continue;
      seenFb.add(s.id);
      fb.push(s);
    }
    return fb;
  }
  return out;
}

function deriveMixGeometryForSnapshot(playlists: Array<{ id: string }>, poolLen: number): SavedMixGeometry {
  if (playlists.length === 5) return '5x15';
  if (playlists.length === 1 && poolLen >= 75) return '1x75';
  return 'merged';
}

/** Same minimum track count as Save round / printable PDF eligibility for this round's free-center setting. */
function eventRoundSnapshotMeetsSaveThreshold(round: EventRound, hostDefaultFreeSpace: boolean): boolean {
  const fs = round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : hostDefaultFreeSpace;
  const need = fs ? 24 : 25;
  const n = round.savedMixSnapshot?.songs?.length ?? 0;
  return n >= need;
}

/** Migrate stored JSON → EventRound[] (localStorage + Tempo cloud prep). */
function migrateRawEventRounds(raw: unknown): EventRound[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((round: any) => {
    if (round.playlistId && !round.playlistIds) {
      return {
        ...round,
        playlistIds: round.playlistId ? [round.playlistId] : [],
        playlistNames: round.playlistName ? [round.playlistName] : [],
        playlistId: undefined,
        playlistName: undefined,
        bingoPattern: round.bingoPattern ?? 'line',
      };
    }
    return {
      ...round,
      playlistIds: round.playlistIds || [],
      playlistNames: round.playlistNames || [],
      bingoPattern: round.bingoPattern ?? 'line',
    };
  }) as EventRound[];
}

function promoteRoundStatusesAfterPrepLoad(rounds: EventRound[], hostFsDefault: boolean): EventRound[] {
  return rounds.map((r: EventRound) => {
    if (
      r.status !== 'active' &&
      r.status !== 'completed' &&
      (r.playlistIds || []).length > 0 &&
      eventRoundSnapshotMeetsSaveThreshold(r, hostFsDefault)
    ) {
      return r.status === 'unplanned' ? { ...r, status: 'planned' as const } : r;
    }
    return r;
  });
}

function readHostDefaultFreeSpaceFlag(): boolean {
  try {
    return localStorage.getItem('bingo-free-space') === '1';
  } catch {
    return false;
  }
}

function prepCloudAckStorageKey(roomId: string): string {
  return `event-rounds-cloud-ack-${roomId}`;
}

function readPrepCloudAckMs(roomId: string): number {
  try {
    const v = localStorage.getItem(prepCloudAckStorageKey(roomId));
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writePrepCloudAckMs(roomId: string, ms: number): void {
  try {
    localStorage.setItem(prepCloudAckStorageKey(roomId), String(ms));
  } catch {
    /* ignore */
  }
}

function clearPrepCloudAck(roomId: string): void {
  try {
    localStorage.removeItem(prepCloudAckStorageKey(roomId));
  } catch {
    /* ignore */
  }
}

/** Same playlist ids in the same order as the round bucket and current mix (column order matters for 5×15). */
function prepRoundPlaylistOrderMatchesMix(
  roundIds: string[] | undefined,
  mix: Array<{ id: string }>,
): boolean {
  const r = (roundIds || []).map((id) => String(id).trim()).filter(Boolean);
  const m = mix.map((p) => String(p.id).trim()).filter(Boolean);
  if (r.length !== m.length) return false;
  for (let i = 0; i < r.length; i++) {
    if (r[i] !== m[i]) return false;
  }
  return true;
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

/** After a full playlist-tracks fetch: playlist row shows E if any track is Spotify-explicit (no extra API). */
function applyPlaylistExplicitKnowledge(
  playlistId: string,
  tracks: Array<{ explicit?: boolean }>,
  setPlaylists: React.Dispatch<React.SetStateAction<Playlist[]>>,
  setSelectedPlaylists: React.Dispatch<React.SetStateAction<Playlist[]>>
) {
  const hasExplicit = tracks.some((t) => t.explicit === true);
  const merge = (prev: Playlist[]) =>
    prev.map((pl) =>
      String(pl.id) === String(playlistId) ? { ...pl, hasExplicitTracks: hasExplicit } : pl
    );
  setPlaylists(merge);
  setSelectedPlaylists(merge);
}

/** Persisted before Spotify/Google redirects so return URL without ?name= still shows the right host label. */
const HOST_DISPLAY_NAME_KEY = 'tempo_host_display_name';

/** When set this tab session, host UI may call Spotify Web API routes; cleared on Disconnect Spotify. */
const HOST_SPOTIFY_WEB_ENABLED_KEY = 'tempo_host_spotify_web_enabled';

function readHostSpotifyWebEnabled(): boolean {
  try {
    return sessionStorage.getItem(HOST_SPOTIFY_WEB_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHostSpotifyWebEnabled(enabled: boolean): void {
  try {
    if (enabled) sessionStorage.setItem(HOST_SPOTIFY_WEB_ENABLED_KEY, '1');
    else sessionStorage.removeItem(HOST_SPOTIFY_WEB_ENABLED_KEY);
  } catch {
    /* ignore */
  }
}

async function postSpotifyWebSessionStart(): Promise<boolean> {
  try {
    const r = await hostFetch(`${API_BASE || ''}/api/spotify/web-session/start`, { method: 'POST' });
    return r.ok;
  } catch {
    return false;
  }
}

/** Spotify playlist ids are strings; rounds/API may store numbers — normalize for Set lookups. */
function normalizeSpotifyPlaylistId(id: unknown): string {
  if (id == null || id === '') return '';
  return String(id).trim();
}

/** GoT mix library filter (same rules as visible playlist effect). YouTube Music playlists always pass through. */
function filterBasePlaylistsForMix(playlists: Playlist[], showAllPlaylists: boolean): Playlist[] {
  const ytm = playlists.filter((p: Playlist) => !!p.youtubeMusic);
  const rest = playlists.filter((p: Playlist) => !p.youtubeMusic);
  let spotifyPart: Playlist[];
  if (!showAllPlaylists) {
    spotifyPart = rest.filter((p: Playlist) => {
      const nameLower = p.name.toLowerCase();
      if (nameLower.includes('game of tones output') || nameLower.includes('gameoftones output')) {
        return false;
      }
      const startsWithGot = /^got\s*[-�:]*\s*/i.test(p.name);
      const containsGameOfTones = nameLower.includes('game of tones') || nameLower.includes('gameoftones');
      return startsWithGot || containsGameOfTones;
    });
  } else {
    spotifyPart = rest;
  }
  return [...spotifyPart, ...ytm];
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
  /** YouTube Music playlists (API); merged into Playlist library table and Round planner. */
  const [youtubeMusicPlaylists, setYoutubeMusicPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Playlist[]>([]);
  /** Official packs (server allowlist + catalog Spotify refresh token). */
  const [catalogPackOptions, setCatalogPackOptions] = useState<Playlist[]>([]);
  const [catalogPacksConfigured, setCatalogPacksConfigured] = useState(false);
  /** After first catalog /packs response attempt (success or failure). */
  const [catalogPacksProbeDone, setCatalogPacksProbeDone] = useState(false);
  /** True only when /packs returned 200 with success (then configured reflects server env). */
  const [catalogPacksFetchOk, setCatalogPacksFetchOk] = useState(false);
  /** Last /packs returned 401 (needs Google host session). */
  const [catalogPacksFetchUnauthorized, setCatalogPacksFetchUnauthorized] = useState(false);
  /** Server skipped prefix crawl (e.g. Spotify 429) — empty packs is not always “wrong prefix”. */
  const [catalogPrefixDiscoverySkipped, setCatalogPrefixDiscoverySkipped] = useState(false);
  const [selectedCatalogPlaylists, setSelectedCatalogPlaylists] = useState<Playlist[]>([]);
  /** Debounce catalog /packs so it doesn’t fire in the same burst as host GET /v1/me/playlists (reduces Spotify 429). */
  const catalogPacksLoadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Personal selection first, then catalog-only ids (append). Dedupes by id. */
  const mixPlaylistSelection = useMemo(() => {
    const out: Playlist[] = [...selectedPlaylists];
    const ids = new Set(selectedPlaylists.map((p) => p.id));
    for (const c of selectedCatalogPlaylists) {
      if (!ids.has(c.id)) {
        out.push({ ...c, catalog: true });
        ids.add(c.id);
      }
    }
    return out;
  }, [selectedPlaylists, selectedCatalogPlaylists]);

  const mixPlaylistSelectionRef = useRef(mixPlaylistSelection);
  useEffect(() => {
    mixPlaylistSelectionRef.current = mixPlaylistSelection;
  }, [mixPlaylistSelection]);

  /** Mix includes at least one playlist that uses the host Spotify token (not catalog-only or YouTube Music). */
  const mixNeedsHostSpotify = useMemo(
    () =>
      mixPlaylistSelection.some(
        (p) => p.youtubeMusic !== true && p.catalog !== true
      ),
    [mixPlaylistSelection]
  );

  const [snippetLength, setSnippetLength] = useState(() => {
    const saved = localStorage.getItem('game-snippet-length');
    return saved ? parseInt(saved) : 30;
  });
  const [winners, setWinners] = useState<Player[]>([]);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
  const [isSpotifyConnecting, setIsSpotifyConnecting] = useState(false);
  /** True while pushing a saved-round snapshot through finalize-mix (display + online cards). Blocks Start Game briefly. */
  const [savedRoundRoomSyncBusy, setSavedRoundRoomSyncBusy] = useState(false);
  /** Finalize / Start Game require Spotify only when the mix includes non-catalog Spotify playlists. */
  const mixGameActionsBlocked = useMemo(
    () =>
      mixPlaylistSelection.length === 0 ||
      (mixNeedsHostSpotify && (!isSpotifyConnected || isSpotifyConnecting)) ||
      savedRoundRoomSyncBusy,
    [
      mixPlaylistSelection.length,
      mixNeedsHostSpotify,
      isSpotifyConnected,
      isSpotifyConnecting,
      savedRoundRoomSyncBusy,
    ]
  );
  /** Mirrors isSpotifyConnected for callbacks declared above sync effects (catalog schedule, socket reconnect). */
  const isSpotifyConnectedRef = useRef(false);
  const [pendingVerification, setPendingVerification] = useState<any>(null);
  /** Additional bingo claims waiting after the current verification modal (FIFO). */
  const [bingoVerificationBehindCount, setBingoVerificationBehindCount] = useState(0);
  const [gamePaused, setGamePaused] = useState(false);
  const [mixFinalized, setMixFinalized] = useState(false);
  /** Printable PDF export (physical daubers) — count capped server-side at 200. */
  const [printableCardCount, setPrintableCardCount] = useState(30);
  const [saveRoundBusy, setSaveRoundBusy] = useState(false);
  const [printablePdfLoading, setPrintablePdfLoading] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  /** Server served playlist list from DB (429/quarantine, or normal cache-first load without hitting Spotify). */
  const [spotifyListCacheInfo, setSpotifyListCacheInfo] = useState<string | null>(null);
  /** True while GET /api/spotify/playlists?refresh=1 is in flight (explicit host sync). */
  const [spotifyPlaylistsRefreshing, setSpotifyPlaylistsRefreshing] = useState(false);
  /** Spotify Web API 429 in-process quarantine (source, Retry-After, remaining). */
  const [webApiQuarantine, setWebApiQuarantine] = useState<WebApiQuarantineState>({ active: false });
  /** High-salience notice; blocks UI until the host dismisses (API / rate / failsafe). */
  const [hostAckNotification, setHostAckNotification] = useState<{
    id: string;
    title: string;
    message: string;
    variant: HostAckVariant;
  } | null>(null);
  const [playlistByLinkInput, setPlaylistByLinkInput] = useState('');
  const [playlistByLinkLoading, setPlaylistByLinkLoading] = useState(false);
  const [playlistByLinkError, setPlaylistByLinkError] = useState<string | null>(null);
  /** From GET /api/spotify/playlists: Spotify PagingObject total (null = unknown / not loaded). */
  const [spotifyMyPlaylistsTotal, setSpotifyMyPlaylistsTotal] = useState<number | null>(null);
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
  const [linesRequired, setLinesRequired] = useState(1);
  const [customMatchAllowRotation, setCustomMatchAllowRotation] = useState(false);
  const [customMatchAllowMirror, setCustomMatchAllowMirror] = useState(false);
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
  /** Seconds between random letter reveals on the public display (server clamps 5–120). */
  const [letterRevealIntervalSec, setLetterRevealIntervalSec] = useState<number>(15);
  /** Projector: masked titles fill in by timed letters vs full at clip start/end. */
  const [publicDisplayTitleRevealMode, setPublicDisplayTitleRevealMode] =
    useState<PublicDisplayTitleRevealMode>('letter');

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
  const updatePublicDisplayLetterRevealInterval = (intervalSec: number) => {
    const clamped = Math.min(120, Math.max(5, Math.round(intervalSec)));
    setLetterRevealIntervalSec(clamped);
    if (socket && roomId) {
      socket.emit('set-public-display-letter-reveal-interval', { roomId, intervalSec: clamped });
    }
  };
  const updatePublicDisplayTitleRevealMode = (mode: PublicDisplayTitleRevealMode) => {
    setPublicDisplayTitleRevealMode(mode);
    if (socket && roomId) {
      socket.emit('set-public-display-title-reveal-mode', { roomId, mode });
    }
  };
  const [selectedCustomPattern, setSelectedCustomPattern] = useState<SavedCustomPattern | null>(null);
  const [savedCustomPatterns, setSavedCustomPatterns] = useState<SavedCustomPattern[]>([]);
  const [showCustomPatternModal, setShowCustomPatternModal] = useState<boolean>(false);
  const [combinedPatternModalOpen, setCombinedPatternModalOpen] = useState(false);
  
  // Song title editing
  const [showSongTitleModal, setShowSongTitleModal] = useState(false);
  /** Five playlists: cross-playlist dedup leaves a column short of 15 unique tracks (precheck blocks finalize; server uses fallback). */
  const [fiveByFifteenInsufficientModal, setFiveByFifteenInsufficientModal] = useState<{
    variant: 'blocked' | 'fallback';
    warnings: string[];
  } | null>(null);
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
  const [patternComposite, setPatternComposite] = useState<PatternCompositeSpec>(
    () => normalizePatternComposite(DEFAULT_COMPOSITE_SPEC) ?? DEFAULT_COMPOSITE_SPEC,
  );
  const [compositePaintDraft, setCompositePaintDraft] = useState<string[]>([]);
  const [savedCompositePatterns, setSavedCompositePatterns] = useState<SavedCompositePattern[]>([]);
  const [compositeRecipeSaveName, setCompositeRecipeSaveName] = useState('');
  const [compositeRecipePickId, setCompositeRecipePickId] = useState('');
  const [editingMaskClauseIndex, setEditingMaskClauseIndex] = useState<number | null>(null);
  const [showSongList, setShowSongList] = useState(false);

  useEffect(() => {
    if (pattern !== 'composite') {
      setEditingMaskClauseIndex(null);
      setCompositePaintDraft([]);
    }
  }, [pattern]);

  useEffect(() => {
    if (combinedPatternModalOpen) {
      setSavedCustomPatterns(getSavedCustomPatterns());
    }
  }, [combinedPatternModalOpen]);

  const [playedInOrder, setPlayedInOrder] = useState<Array<{ id: string; name: string; artist: string }>>([]);
  const [showRooms, setShowRooms] = useState<boolean>(false);
  const [rooms, setRooms] = useState<Array<any>>([]);
  const [playerCards, setPlayerCards] = useState<Map<string, any>>(new Map());
  const [playerCardsVersion, setPlayerCardsVersion] = useState<number>(0); // Force re-render trigger
  const [playerCardsFullscreen, setPlayerCardsFullscreen] = useState<boolean>(false);
  /** When overlay is open: false = centered modal, true = viewport-filling panel */
  const [playerCardsMaximized, setPlayerCardsMaximized] = useState<boolean>(false);
  /** 5�15 mode: playlist title per column (from `fiveby15-pool`, else five selected playlists). */
  const [bingoColumnPlaylistNames, setBingoColumnPlaylistNames] = useState<string[]>([]);
  const [showPlaylistRoundModal, setShowPlaylistRoundModal] = useState(false);
  const [roundBuilderFocusIndex, setRoundBuilderFocusIndex] = useState(0);
  const compositeEditRoundIndexRef = useRef(0);
  const [playlistRoundModalPane, setPlaylistRoundModalPane] = useState<'library' | 'rounds'>('library');
  const openRoundBuilder = useCallback((focusIndex?: number) => {
    const idx =
      focusIndex !== undefined
        ? focusIndex
        : Math.max(0, currentRoundIndexRef.current >= 0 ? currentRoundIndexRef.current : 0);
    setRoundBuilderFocusIndex(idx);
    setShowPlaylistRoundModal(true);
  }, []);
  const showPlaylistRoundModalScrollRef = useRef(showPlaylistRoundModal);
  showPlaylistRoundModalScrollRef.current = showPlaylistRoundModal;
  const [activeTab, setActiveTab] = useState<'setup' | 'play'>('setup');
  /** In-person + online: only in-person verified bingos end the round / prize */
  const [hybridInPersonPlusOnline, setHybridInPersonPlusOnline] = useState(false);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const showConnectionModalScrollRef = useRef(showConnectionModal);
  showConnectionModalScrollRef.current = showConnectionModal;
  /** Server has YTM OAuth env; shows Connection UI even when REACT_APP_ENABLE_YOUTUBE_MUSIC was not set at client build time. */
  const [ytMusicServerConfigured, setYtMusicServerConfigured] = useState(false);
  /** Bump so HostYoutubeMusicPlaylistLibrary refetches after Google OAuth return (?youtube_music=connected). */
  const [ytMusicLibraryRefreshNonce, setYtMusicLibraryRefreshNonce] = useState(0);
  const showYoutubeMusicInConnectionModal = ENABLE_YOUTUBE_MUSIC || ytMusicServerConfigured;
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

  // Round management state (see file-level `EventRound`)

  const [eventRounds, setEventRounds] = useState<EventRound[]>([
    {
      id: 'round-1',
      name: 'Round 1',
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned',
      bingoPattern: 'line',
    }
  ]);
  const eventRoundsRef = useRef(eventRounds);
  useEffect(() => {
    eventRoundsRef.current = eventRounds;
  }, [eventRounds]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await hostFetch(`${API_BASE || ''}/api/youtube/music/status?_=${Date.now()}`, {
          cache: 'no-store',
        });
        const data = (await r.json().catch(() => ({}))) as { configured?: boolean };
        if (!cancelled && data.configured === true) setYtMusicServerConfigured(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostAuthBootstrapDone]);

  const [currentRoundIndex, setCurrentRoundIndex] = useState<number>(-1);
  const currentRoundIndexRef = useRef(currentRoundIndex);
  useEffect(() => {
    currentRoundIndexRef.current = currentRoundIndex;
  }, [currentRoundIndex]);

  /** Wait for Tempo cloud prep pull (or skip if not signed in) before autosaving PUTs. */
  const [prepCloudHydrated, setPrepCloudHydrated] = useState(false);
  const prepPutTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPrepCloudHydrated(false);
  }, [roomId]);

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

  /** Server-driven YouTube snippet playback in this browser (audio for YTM rows). */
  const [youtubeHostPlayback, setYoutubeHostPlayback] = useState<{
    videoId: string;
    startMs: number;
    snippetSeconds: number;
  } | null>(null);

  const youtubePlaybackBcRef = useRef<BroadcastChannel | null>(null);
  const youtubeHostPlaybackBroadcastRef = useRef(youtubeHostPlayback);
  youtubeHostPlaybackBroadcastRef.current = youtubeHostPlayback;
  const youtubePlaybackVolumeRef = useRef(playbackState.volume);
  youtubePlaybackVolumeRef.current = playbackState.volume;
  const [youtubePlaybackPopupOpen, setYoutubePlaybackPopupOpen] = useState(false);
  const youtubePlaybackPopupRef = useRef<Window | null>(null);
  /** Last POPUP_ACTIVE ping from `/youtube-host-playback` — lets host hide corner player for manual tabs too. */
  const lastYtPopupPingRef = useRef(0);
  /** Corner iframe hidden while external playback window is active (popup or same-browser tab). */
  const [hideYoutubeCornerPlayer, setHideYoutubeCornerPlayer] = useState(false);

  const [isSeeking, setIsSeeking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(100);
  const [songList, setSongList] = useState<Song[]>([]);
  const [finalizedOrder, setFinalizedOrder] = useState<Song[] | null>(null);
  const finalizedOrderRef = useRef<Song[] | null>(null);
  useEffect(() => {
    finalizedOrderRef.current = finalizedOrder;
  }, [finalizedOrder]);

  /** Sort-stable fingerprint of current Game-tab mix (same grouping rule as finalize — playlist ids sorted). */
  const mixPlaylistSelectionKeyRef = useRef('');
  useEffect(() => {
    mixPlaylistSelectionKeyRef.current = selectionPlaylistKey(mixPlaylistSelection);
  }, [mixPlaylistSelection]);

  /**
   * Playlist key for which `finalizedOrder` was produced. Without this, Save round #2 can reuse round #1's pool
   * when `ensureFinalizedOrderFromServer` sees a non-empty ref and skips waiting for the new finalize.
   */
  const finalizedOrderPlaylistKeyRef = useRef<string | null>(null);
  /** Tag the next `finalized-order` event while a finalize or replay is in flight. */
  const pendingFinalizePlaylistKeyRef = useRef<string | null>(null);

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
  const [playlistLibraryPage, setPlaylistLibraryPage] = useState(0);
  /** Playlist-round modal table: all sources, personal Spotify only, or YouTube only. */
  const [playlistLibrarySource, setPlaylistLibrarySource] = useState<'all' | 'spotify' | 'youtube'>(
    'spotify'
  );
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

  const showHostAckNotification = useCallback(
    (p: { title: string; message: string; variant?: HostAckVariant; id?: string }) => {
      setHostAckNotification({
        id: p.id ?? `host-ack-${Date.now()}`,
        title: p.title,
        message: p.message,
        variant: p.variant ?? 'warning',
      });
    },
    []
  );

  const refreshSpotifyQuarantineFromStatus = useCallback(async () => {
    if (!readHostSpotifyWebEnabled()) return;
    try {
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/status?_=${Date.now()}`);
      const data = (await response.json()) as { webApiQuarantine?: unknown };
      if (data.webApiQuarantine != null) {
        setWebApiQuarantine(normalizeWebApiQuarantine(data.webApiQuarantine));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isSpotifyConnected) return;
    if (webApiQuarantine.active !== true) return;
    const id = window.setInterval(() => {
      void refreshSpotifyQuarantineFromStatus();
    }, 4000);
    return () => clearInterval(id);
  }, [isSpotifyConnected, webApiQuarantine.active, refreshSpotifyQuarantineFromStatus]);

  const openYoutubeHostPlaybackWindow = useCallback(() => {
    if (!roomId) return;
    const path = `/youtube-host-playback/${encodeURIComponent(roomId)}`;
    const url = `${window.location.origin}${path}`;
    const name = `ytPlayback_${roomId}_${Date.now()}`;
    const sw = typeof window.screen?.availWidth === 'number' ? window.screen.availWidth : 1280;
    const sh = typeof window.screen?.availHeight === 'number' ? window.screen.availHeight : 800;
    const ww = Math.min(940, Math.max(480, sw - 48));
    const wh = Math.min(780, Math.max(420, sh - 72));
    const left = Math.max(0, Math.round((sw - ww) / 2));
    const top = Math.max(0, Math.round((sh - wh) / 5));
    const features = `width=${ww},height=${wh},left=${left},top=${top},scrollbars=yes,resizable=yes`;

    const registerWindow = (win: Window | null): boolean => {
      if (!win) return false;
      try {
        if (win.closed) return false;
      } catch {
        return false;
      }
      youtubePlaybackPopupRef.current = win;
      setYoutubePlaybackPopupOpen(true);
      primeYoutubeHostPlaybackAudioUnlock();
      try {
        win.focus();
      } catch {
        /* ignore */
      }
      return true;
    };

    let win = window.open(url, name, features);
    let opened = registerWindow(win);
    if (!opened) {
      win = window.open(url, '_blank');
      opened = registerWindow(win);
    }

    if (!opened) {
      showToast(
        'Could not open playback (often blocked popups). Allow popups for this site and try again.',
        'warn'
      );
      addLog(`YouTube playback — open manually in a new tab: ${url}`, 'info');
      return;
    }

    window.setTimeout(() => {
      const cur = youtubePlaybackPopupRef.current;
      if (!cur || cur.closed) return;
      try {
        cur.focus();
      } catch {
        /* ignore */
      }
    }, 400);
  }, [roomId, showToast]);

  useEffect(() => {
    if (!roomId) return;
    const ch = new BroadcastChannel(getYoutubeHostPlaybackChannelName(roomId));
    youtubePlaybackBcRef.current = ch;
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'REQUEST_SYNC') {
        ch.postMessage({
          type: 'playback',
          payload: youtubeHostPlaybackBroadcastRef.current,
        });
        ch.postMessage({ type: 'volume', volume: youtubePlaybackVolumeRef.current });
        return;
      }
      if (d.type === 'POPUP_ACTIVE') {
        lastYtPopupPingRef.current = Date.now();
        setHideYoutubeCornerPlayer(true);
        ch.postMessage({
          type: 'playback',
          payload: youtubeHostPlaybackBroadcastRef.current,
        });
        ch.postMessage({ type: 'volume', volume: youtubePlaybackVolumeRef.current });
        return;
      }
      if (d.type === 'POPUP_CLOSING') {
        setHideYoutubeCornerPlayer(false);
      }
    };
    ch.addEventListener('message', onMessage);
    return () => {
      ch.removeEventListener('message', onMessage);
      ch.close();
      if (youtubePlaybackBcRef.current === ch) {
        youtubePlaybackBcRef.current = null;
      }
    };
  }, [roomId]);

  useEffect(() => {
    youtubePlaybackBcRef.current?.postMessage({
      type: 'playback',
      payload: youtubeHostPlayback,
    });
  }, [youtubeHostPlayback]);

  useEffect(() => {
    youtubePlaybackBcRef.current?.postMessage({
      type: 'volume',
      volume: playbackState.volume,
    });
  }, [playbackState.volume]);

  useEffect(() => {
    if (!youtubePlaybackPopupOpen) return;
    const id = window.setInterval(() => {
      const w = youtubePlaybackPopupRef.current;
      if (!w || w.closed) {
        youtubePlaybackPopupRef.current = null;
        setYoutubePlaybackPopupOpen(false);
      }
    }, 700);
    return () => clearInterval(id);
  }, [youtubePlaybackPopupOpen]);

  /** If the playback page dies without POPUP_CLOSING, restore the corner player after pings stop. */
  useEffect(() => {
    if (!hideYoutubeCornerPlayer) return;
    const id = window.setInterval(() => {
      const w = youtubePlaybackPopupRef.current;
      const openedPopupOk = w != null && !w.closed;
      const pingOk = Date.now() - lastYtPopupPingRef.current < 16000;
      if (openedPopupOk || pingOk) return;
      setHideYoutubeCornerPlayer(false);
      setYoutubePlaybackPopupOpen(false);
      youtubePlaybackPopupRef.current = null;
    }, 3000);
    return () => clearInterval(id);
  }, [hideYoutubeCornerPlayer]);

  useEffect(() => {
    if (!hostAckNotification) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [hostAckNotification]);

  /** Official packs — uses Google host session; safe to call whenever playlists refresh too (rail against stale bundles / bootstrap timing). */
  const loadCatalogPacks = useCallback(async () => {
    if (!readHostSpotifyWebEnabled()) {
      setCatalogPacksProbeDone(true);
      setCatalogPacksFetchOk(false);
      setCatalogPacksConfigured(false);
      setCatalogPackOptions([]);
      setCatalogPacksFetchUnauthorized(false);
      setCatalogPrefixDiscoverySkipped(false);
      return;
    }
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/spotify/catalog/packs`);
      if (!res.ok) {
        setCatalogPacksFetchOk(false);
        setCatalogPacksConfigured(false);
        setCatalogPackOptions([]);
        setCatalogPacksFetchUnauthorized(res.status === 401);
        setCatalogPrefixDiscoverySkipped(false);
        return;
      }
      setCatalogPacksFetchUnauthorized(false);
      const data = (await res.json()) as {
        success?: boolean;
        configured?: boolean;
        packs?: Array<{ id: string; name: string; tracks: number; catalog?: boolean }>;
        catalogPrefixDiscoverySkipped?: boolean;
      };
      if (!data.success) {
        setCatalogPacksFetchOk(false);
        setCatalogPacksConfigured(false);
        setCatalogPackOptions([]);
        setCatalogPrefixDiscoverySkipped(false);
        return;
      }
      setCatalogPacksFetchOk(true);
      setCatalogPacksConfigured(data.configured === true);
      setCatalogPrefixDiscoverySkipped(data.catalogPrefixDiscoverySkipped === true);
      const packs = data.packs || [];
      setCatalogPackOptions(
        packs.map((row) => ({
          id: row.id,
          name: row.name || 'Catalog pack',
          tracks: Math.max(0, Number(row.tracks) || 0),
          catalog: true,
        }))
      );
    } catch {
      setCatalogPacksFetchOk(false);
      setCatalogPacksConfigured(false);
      setCatalogPackOptions([]);
      setCatalogPacksFetchUnauthorized(false);
      setCatalogPrefixDiscoverySkipped(false);
    } finally {
      setCatalogPacksProbeDone(true);
    }
  }, []);

  /** Wait after host library Spotify traffic before hitting catalog (same app quota; catalog runs another full /me/playlists). */
  const scheduleCatalogPacksLoad = useCallback(
    (delayMs: number) => {
      if (catalogPacksLoadDebounceRef.current != null) {
        clearTimeout(catalogPacksLoadDebounceRef.current);
        catalogPacksLoadDebounceRef.current = null;
      }
      catalogPacksLoadDebounceRef.current = setTimeout(() => {
        catalogPacksLoadDebounceRef.current = null;
        if (!isSpotifyConnectedRef.current) return;
        void loadCatalogPacks();
      }, delayMs);
    },
    [loadCatalogPacks]
  );

  useEffect(() => {
    return () => {
      if (catalogPacksLoadDebounceRef.current != null) {
        clearTimeout(catalogPacksLoadDebounceRef.current);
        catalogPacksLoadDebounceRef.current = null;
      }
    };
  }, []);

  const loadPlaylists = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    const forceRefresh = opts?.forceRefresh === true;
    if (!readHostSpotifyWebEnabled()) return;
    if (forceRefresh) setSpotifyPlaylistsRefreshing(true);
    try {
      const assignedForQuery = eventRoundsRef.current
        .flatMap((r) => r.playlistIds || [])
        .map((id) => String(id))
        .filter(Boolean);
      const qs = new URLSearchParams();
      if (assignedForQuery.length > 0) {
        qs.set('assigned', assignedForQuery.join(','));
      }
      if (forceRefresh) {
        qs.set('refresh', '1');
      }
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/playlists?${qs.toString()}`);
      if (response.status === 401) {
        setSpotifyError('Spotify is not connected. Open Connection in the header to connect.');
        setSpotifyListCacheInfo(null);
        setPlaylists([]);
        setSpotifyMyPlaylistsTotal(null);
        return;
      }
      if (response.status === 429) {
        let retryMin = '';
        try {
          const d = (await response.json()) as {
            retryAfterSec?: number;
            message?: string;
            webApiQuarantine?: unknown;
          };
          if (d.webApiQuarantine != null) {
            setWebApiQuarantine(normalizeWebApiQuarantine(d.webApiQuarantine));
          }
          if (d && typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0) {
            retryMin = ` (retry in about ${Math.max(1, Math.ceil(d.retryAfterSec / 60))} min)`;
          }
        } catch {
          /* ignore */
        }
        setSpotifyMyPlaylistsTotal(null);
        setSpotifyListCacheInfo(null);
        setSpotifyError(null);
        showHostAckNotification({
          id: 'playlists-http-429',
          title: 'Spotify rate limit',
          variant: 'warning',
          message: `Spotify is rate-limiting this app right now${retryMin}. Wait, then tap Refresh Spotify library under Playlist library, or check your app in the Spotify Developer Dashboard (quota / usage).`,
        });
        return;
      }
      const data = (await response.json()) as {
        success?: boolean;
        playlists?: Playlist[];
        error?: string;
        spotifyListTotal?: number;
        retryAfterSec?: number;
        fromSpotifyListCache?: boolean;
        cacheMessage?: string;
        cacheUpdatedAt?: string;
        webApiQuarantine?: unknown;
      };

      if (data.webApiQuarantine != null) {
        setWebApiQuarantine(normalizeWebApiQuarantine(data.webApiQuarantine));
      }
      
      if (data.success) {
        if (data.fromSpotifyListCache) {
          const m = (data.cacheMessage || 'Showing a saved copy of your Spotify library list.').trim();
          const t = data.cacheUpdatedAt ? new Date(String(data.cacheUpdatedAt)).toLocaleString() : '';
          setSpotifyListCacheInfo(t ? `${m} (saved ${t})` : m);
        } else {
          setSpotifyListCacheInfo(null);
        }
        if (typeof data.spotifyListTotal === 'number') {
          setSpotifyMyPlaylistsTotal(data.spotifyListTotal);
        } else {
          setSpotifyMyPlaylistsTotal(null);
        }
        // Filter out temporary TEMPO playlists (store all others in state)
        const allPlaylists = (data.playlists || []).filter((playlist: Playlist) => 
          !playlist.name.startsWith('TEMPO')
        );
        
        setPlaylists(allPlaylists);
        // Fresh library fetch: load Official packs shortly after (another GET /me/playlists on catalog token).
        // Stale/cache response: Spotify is already rate-limiting — defer catalog to avoid an immediate second burst (same app quota); Official packs still loads after cooldown.
        scheduleCatalogPacksLoad(data.fromSpotifyListCache === true ? 60_000 : 7500);
        // Reset filter to GoT-only by default when playlists are reloaded
        setShowAllPlaylists(false);
        // Don't set visiblePlaylists here - let the useEffect handle it to ensure consistency
      } else {
        setSpotifyMyPlaylistsTotal(null);
        console.error('Failed to load playlists:', data.error);
        if (data && data.error === 'spotify_rate_limited') {
          const ra = typeof data.retryAfterSec === 'number' ? data.retryAfterSec : null;
          const retryMin = ra != null && ra > 0 ? ` (retry in about ${Math.max(1, Math.ceil(ra / 60))} min)` : '';
          setSpotifyError(null);
          showHostAckNotification({
            id: 'playlists-spotify_rate_limited',
            title: 'Spotify rate limit',
            variant: 'warning',
            message: `Spotify is rate-limiting this app or the server is cooling down${retryMin}. Wait and tap Refresh, or check the Developer Dashboard.`,
          });
        }
      }
    } catch (error) {
      setSpotifyMyPlaylistsTotal(null);
      console.error('Error loading playlists:', error);
    } finally {
      if (forceRefresh) setSpotifyPlaylistsRefreshing(false);
    }
  }, [showHostAckNotification, scheduleCatalogPacksLoad]);

  const addPlaylistByLink = useCallback(async () => {
    setPlaylistByLinkError(null);
    const raw = playlistByLinkInput.trim();
    if (!raw) {
      setPlaylistByLinkError('Paste a playlist link or id.');
      return;
    }
    if (!readHostSpotifyWebEnabled()) {
      setPlaylistByLinkError('Connect Spotify from Connection first.');
      return;
    }
    setPlaylistByLinkLoading(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/spotify/playlist-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrId: raw }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        playlist?: Playlist;
        error?: string;
        message?: string;
        retryAfterSec?: number;
      };
      if (!res.ok) {
        if (res.status === 429) {
          const ra = typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0 ? d.retryAfterSec : null;
          const wait =
            ra != null
              ? ` Try again in about ${Math.max(1, Math.ceil(ra / 60))} min (Spotify’s Retry-After: ${ra}s).`
              : ' Try again after cooldown.';
          setPlaylistByLinkError(null);
          showHostAckNotification({
            id: 'playlist-by-link-429',
            title: 'Spotify rate limit',
            variant: 'warning',
            message: `Spotify is rate-limiting playlist requests for this app right now, including a single link lookup — not a bad URL.${wait} Nothing in TEMPO can override Spotify’s wait window.`,
          });
        } else {
          setPlaylistByLinkError(
            d.message || d.error || `Could not add (${res.status})`
          );
        }
        return;
      }
      if (d.playlist && d.playlist.id) {
        const p = d.playlist;
        setPlaylists((prev) => {
          const m = new Map(prev.map((x) => [x.id, x]));
          m.set(p.id, p);
          return Array.from(m.values());
        });
        setPlaylistByLinkInput('');
        setShowAllPlaylists(true);
      }
    } catch (e) {
      setPlaylistByLinkError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setPlaylistByLinkLoading(false);
    }
  }, [playlistByLinkInput, showHostAckNotification]);


  /** Assigned-to-round ids as strings so Spotify id === round id always matches. */
  const assignedPlaylistIds = useMemo(
    () => new Set(eventRounds.flatMap((round) => round.playlistIds || []).map((id) => String(id))),
    [eventRounds]
  );

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

  const libraryTablePlaylists = useMemo(() => {
    if (playlistLibrarySource === 'spotify') {
      return sortedFilteredPlaylists.filter((p) => !p.youtubeMusic && !p.catalog);
    }
    if (playlistLibrarySource === 'youtube') {
      return sortedFilteredPlaylists.filter((p) => p.youtubeMusic);
    }
    return sortedFilteredPlaylists;
  }, [sortedFilteredPlaylists, playlistLibrarySource]);

  const playlistLibraryPageCount = useMemo(
    () => Math.max(1, Math.ceil(libraryTablePlaylists.length / PLAYLIST_LIBRARY_PAGE_SIZE)),
    [libraryTablePlaylists.length]
  );

  const playlistLibraryPageClamped = useMemo(
    () => Math.min(playlistLibraryPage, playlistLibraryPageCount - 1),
    [playlistLibraryPage, playlistLibraryPageCount]
  );

  const paginatedPlaylists = useMemo(() => {
    const start = playlistLibraryPageClamped * PLAYLIST_LIBRARY_PAGE_SIZE;
    return libraryTablePlaylists.slice(start, start + PLAYLIST_LIBRARY_PAGE_SIZE);
  }, [libraryTablePlaylists, playlistLibraryPageClamped]);

  const playlistLibraryPageRangeLabel = useMemo(() => {
    if (libraryTablePlaylists.length === 0) return '';
    const start = playlistLibraryPageClamped * PLAYLIST_LIBRARY_PAGE_SIZE + 1;
    const end = Math.min(
      libraryTablePlaylists.length,
      (playlistLibraryPageClamped + 1) * PLAYLIST_LIBRARY_PAGE_SIZE
    );
    return `${start}–${end} of ${libraryTablePlaylists.length}`;
  }, [libraryTablePlaylists.length, playlistLibraryPageClamped]);

  const playlistLibrarySourceCounts = useMemo(() => {
    const spotify = sortedFilteredPlaylists.filter((p) => !p.youtubeMusic && !p.catalog).length;
    const youtube = sortedFilteredPlaylists.filter((p) => p.youtubeMusic).length;
    return { all: sortedFilteredPlaylists.length, spotify, youtube };
  }, [sortedFilteredPlaylists]);

  useEffect(() => {
    setPlaylistLibraryPage(0);
  }, [playlistQuery, showAllPlaylists, playlistSort.key, playlistSort.dir, playlistLibrarySource]);

  useEffect(() => {
    setPlaylistLibraryPage((p) => Math.min(p, Math.max(0, playlistLibraryPageCount - 1)));
  }, [playlistLibraryPageCount]);

  /** Spotify + YouTube Music rows so round buckets resolve dragged ids from either source. */
  const playlistsForRoundPlanner = useMemo(() => {
    const m = new Map<string, Playlist>();
    for (const p of playlists) {
      const id = normalizeSpotifyPlaylistId(p.id);
      if (id) m.set(id, p);
    }
    for (const p of youtubeMusicPlaylists) {
      const id = normalizeSpotifyPlaylistId(p.id);
      if (id) m.set(id, p);
    }
    return Array.from(m.values());
  }, [playlists, youtubeMusicPlaylists]);

  /** Shown when the library table has no rows (search, filter, or all assigned to rounds). */
  const playlistLibraryEmptyMessage = useMemo(() => {
    const q = playlistQuery.trim();
    if (q) return 'No playlists match your search.';
    const merged = [...playlists, ...youtubeMusicPlaylists];
    const base = filterBasePlaylistsForMix(merged, showAllPlaylists);
    const visibleApprox = base.filter((p) => {
      const pid = normalizeSpotifyPlaylistId(p.id);
      return pid !== '' && !assignedPlaylistIds.has(pid);
    });
    if (merged.length === 0) {
      if (isSpotifyConnected && spotifyMyPlaylistsTotal === 0) {
        return 'Spotify reports 0 playlists for the connected account. Create playlists in Spotify or connect YouTube Music under Connection, then refresh.';
      }
      return 'No playlists loaded yet. Connect Spotify and/or YouTube Music under Connection, then refresh your library.';
    }
    if (visibleApprox.length === 0) {
      const spotifyBase = filterBasePlaylistsForMix(playlists, showAllPlaylists);
      if (
        playlists.length > 0 &&
        spotifyBase.length === 0 &&
        !showAllPlaylists &&
        youtubeMusicPlaylists.length === 0
      ) {
        return `Spotify returned ${playlists.length} playlist(s), but none match GoT picks (name starts with "GoT" or contains "Game of Tones"). Use "All my playlists" to see your full library.`;
      }
      return 'Every playlist in this view is already assigned to a round (or filtered out). Remove one from a round bucket, widen filters, or add playlists.';
    }
    return 'No available playlists.';
  }, [
    playlistQuery,
    playlists,
    youtubeMusicPlaylists,
    showAllPlaylists,
    assignedPlaylistIds,
    spotifyMyPlaylistsTotal,
    isSpotifyConnected,
  ]);

  const handleYoutubeMusicMixPlaylistsChange = useCallback((rows: YoutubeMixPlaylistRow[]) => {
    setYoutubeMusicPlaylists(rows);
  }, []);

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

  /** After Spotify status is known: mark catalog as skipped without hitting Spotify when host has not connected Spotify. */
  useEffect(() => {
    if (!hostAuthBootstrapDone || !spotifyInitialCheckDone) return;
    if (isSpotifyConnected) return;
    setCatalogPacksProbeDone(true);
    setCatalogPacksFetchOk(false);
    setCatalogPacksConfigured(false);
    setCatalogPackOptions([]);
    setCatalogPacksFetchUnauthorized(false);
    setCatalogPrefixDiscoverySkipped(false);
  }, [hostAuthBootstrapDone, spotifyInitialCheckDone, isSpotifyConnected]);

  // Update visible playlists when rounds change to exclude newly assigned playlists, or when filter mode changes
  useEffect(() => {
    const merged = [...playlists, ...youtubeMusicPlaylists];
    if (merged.length > 0) {
      const basePlaylists = filterBasePlaylistsForMix(merged, showAllPlaylists);
      const availablePlaylists = basePlaylists.filter((p: Playlist) => {
        const pid = normalizeSpotifyPlaylistId(p.id);
        return pid !== '' && !assignedPlaylistIds.has(pid);
      });
      setVisiblePlaylists(availablePlaylists);
    } else {
      setVisiblePlaylists([]);
    }
  }, [assignedPlaylistIds, playlists, youtubeMusicPlaylists, showAllPlaylists]);

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
    if (showYoutubeMusicInConnectionModal) return;
    if (!initialConnectionPromptRef.current) {
      initialConnectionPromptRef.current = true;
      setShowConnectionModal(true);
    }
  }, [spotifyInitialCheckDone, isSpotifyConnected, showYoutubeMusicInConnectionModal]);

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
    const needLock = showConnectionModal || showPlaylistRoundModal;
    if (!needLock) return;
    const restoreTo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (
        !showConnectionModalScrollRef.current &&
        !showPlaylistRoundModalScrollRef.current
      ) {
        document.body.style.overflow = restoreTo;
      }
    };
  }, [showConnectionModal, showPlaylistRoundModal]);

  useEffect(() => {
    if (!showPlaylistRoundModal) return;
    setPlaylistRoundModalPane('library');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (combinedPatternModalOpen) {
        setCombinedPatternModalOpen(false);
        return;
      }
      if (showCustomPatternModal) {
        setShowCustomPatternModal(false);
        return;
      }
      setShowPlaylistRoundModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPlaylistRoundModal, combinedPatternModalOpen, showCustomPatternModal]);

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
    if (!readHostSpotifyWebEnabled()) return;
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

  /** After YouTube Music OAuth redirect (?youtube_music=connected), strip param and refetch merged library playlists. */
  useEffect(() => {
    if (searchParams.get('youtube_music') !== 'connected') return;
    const next = new URLSearchParams(searchParams);
    next.delete('youtube_music');
    setSearchParams(next, { replace: true });
    setYtMusicLibraryRefreshNonce((n) => n + 1);
  }, [searchParams, setSearchParams]);

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
      const data = (await response.json()) as { connected?: boolean; webApiQuarantine?: unknown };
      if (data.webApiQuarantine != null) {
        setWebApiQuarantine(normalizeWebApiQuarantine(data.webApiQuarantine));
      }
      const ok = data.connected === true;
      writeHostSpotifyWebEnabled(ok);
      return ok;
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
          await loadPlaylists({ forceRefresh: true });
          await new Promise((r) => setTimeout(r, 800));
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
    if (!readHostSpotifyWebEnabled()) return;
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

  /** Back off host polling of /api/spotify/current-playback when server returns 429. */
  const spotifyPollBackoffUntilRef = useRef(0);
  /** Throttle getUserPlaylists on socket reconnect to avoid piling on Spotify (429) next to OAuth / status checks. */
  const lastLoadPlaylistsOnSocketReconnectAtRef = useRef(0);
  /** Last non-empty list sent in finalize-mix (React state can lag right after setSongList / socket events). */
  const lastFinalizeMixSongListRef = useRef<Song[] | null>(null);
  /** Mirror songList for incremental setlist fetches (avoids refetching every playlist on each new selection). */
  const songListRef = useRef<Song[]>([]);
  /** Playlist ids we have already fully loaded track lists for. */
  const fullyLoadedPlaylistIdsRef = useRef<Set<string>>(new Set());
  /** Bumped to cancel in-flight generateSongList from selection/debounce — does not invalidate Finalize Mix (see finalizeSetlistGenerationRef). */
  const setlistBuildGenerationRef = useRef(0);
  /** Finalize Mix builds use this alone so the 750ms debounced `generateSongList` cannot bump generation mid-fetch and yield an empty list + false rate-limit alert. */
  const finalizeSetlistGenerationRef = useRef(0);
  useEffect(() => {
    songListRef.current = songList;
  }, [songList]);
  const invalidateSetlistBuildCache = useCallback(() => {
    setlistBuildGenerationRef.current += 1;
    finalizeSetlistGenerationRef.current += 1;
    fullyLoadedPlaylistIdsRef.current.clear();
  }, []);

  const disconnectSpotify = useCallback(async () => {
    try {
      writeHostSpotifyWebEnabled(false);
      if (catalogPacksLoadDebounceRef.current != null) {
        clearTimeout(catalogPacksLoadDebounceRef.current);
        catalogPacksLoadDebounceRef.current = null;
      }
      await hostFetch(`${API_BASE || ''}/api/spotify/clear`, { method: 'POST' });
      setIsSpotifyConnected(false);
      setPlaylists([]);
      setSpotifyError(null);
      setWebApiQuarantine({ active: false });
      setSongList([]);
      invalidateSetlistBuildCache();
      setSelectedCatalogPlaylists([]);
    } catch (error) {
      console.error('Error disconnecting Spotify:', error);
    }
  }, [invalidateSetlistBuildCache]);

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
    if (!readHostSpotifyWebEnabled()) {
      alert('Connect Spotify from Connection first.');
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
    setSavedCompositePatterns(getSavedCompositePatterns());
    
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
      setBingoVerificationBehindCount(Math.max(0, Number(data?.verificationQueueAheadCount) || 0));
      setGamePaused(true);
      addLog(`?? ${data.playerName} called BINGO - verification needed!`, 'warn');
      playHostAlertSound();
      schedulePlayerCardsRefresh(120);
    });

    newSocket.on('bingo-verification-queued', (data: any) => {
      const n = Math.max(0, Number(data?.waitingAhead) || 0);
      setBingoVerificationBehindCount(n);
      addLog(`${data?.playerName || 'Player'} bingo queued — ${n} waiting behind current verification`, 'warn');
    });

    newSocket.on('bingo-verified', (data: any) => {
      if (verificationTimeoutRef.current) {
        clearTimeout(verificationTimeoutRef.current);
        verificationTimeoutRef.current = null;
      }
      console.log('Bingo verified:', data);
      setPendingVerification(null);
      setBingoVerificationBehindCount(0);
      setIsProcessingVerification(false);

      if (data.error === 'no_pending') {
        addLog(data.reason || 'No bingo claim was pending.', 'warn');
        setGamePaused(false);
        return;
      }
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
        const arr = Array.isArray(data?.order)
          ? data.order.map((o: any) => ({
              id: o.id,
              name: o.name,
              artist: o.artist,
              explicit: o.explicit === true,
              youtubeMusic: o.youtubeMusic === true,
              sourcePlaylistId: o.sourcePlaylistId != null ? String(o.sourcePlaylistId) : undefined,
              sourcePlaylistName: typeof o.sourcePlaylistName === 'string' ? o.sourcePlaylistName : undefined,
            }))
          : [];
        if (arr.length > 0) {
          finalizedOrderRef.current = arr;
          setFinalizedOrder(arr);
          finalizedOrderPlaylistKeyRef.current =
            pendingFinalizePlaylistKeyRef.current ?? mixPlaylistSelectionKeyRef.current;
          pendingFinalizePlaylistKeyRef.current = null;
          addLog(`Finalized order received (${arr.length} tracks)`, 'info');
        }
      } catch (e) {
        console.warn('Failed to parse finalized order:', e);
      }
    });

    newSocket.on('song-playing', (data: any) => {
      const yt =
        data.youtubeMusic === true &&
        typeof data.youtubeVideoId === 'string' &&
        data.youtubeVideoId.length > 0;
      if (yt) {
        setYoutubeHostPlayback({
          videoId: data.youtubeVideoId,
          startMs: typeof data.startMs === 'number' ? data.startMs : 0,
          snippetSeconds: typeof data.snippetLength === 'number' ? data.snippetLength : 30,
        });
      } else {
        setYoutubeHostPlayback(null);
      }

      const ytf = youtubeTrackDisplayFields({
        name: data.songName,
        artist: data.artistName,
        youtubeMusic: data.youtubeMusic === true,
      });
      const displayTitleForUi = getDisplaySongTitle(data.songId, ytf.title);
      setCurrentSong({
        id: data.songId,
        name: displayTitleForUi,
        artist: ytf.artist,
        explicit: data.explicit === true,
      });
      lastSongEventAtRef.current = Date.now();
      setIsPlaying(true);
      setPlaybackState(prev => ({
        ...prev,
        isPlaying: true,
        currentSong: {
          id: data.songId,
          name: displayTitleForUi,
          artist: ytf.artist,
          explicit: data.explicit === true,
        },
        duration: data.snippetLength * 1000, // Convert to milliseconds
        currentTime: 0
      }));
      setPlayedInOrder(prev => {
        if (prev.find(p => p.id === data.songId)) return prev; // prevent dupes
        return [...prev, { id: data.songId, name: displayTitleForUi, artist: ytf.artist }];
      });
      
      // Reset pause tracking for new song
      setPausePosition(0);
      setIsPausedByInterface(false);
      
      console.log('Song playing:', data);
      addLog(
        `Now playing: ${displayTitleForUi}${ytf.artist ? ` — ${ytf.artist}` : ''}`,
        'info',
      );
      
      if (!yt) {
        setTimeout(() => {
          syncVolumeToSpotify();
        }, 500);
      }
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
      setYoutubeHostPlayback(null);
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
      setBingoVerificationBehindCount(0);
      setCurrentSong(null);
      setYoutubeHostPlayback(null);
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
      setBingoVerificationBehindCount(0);
      setIsProcessingVerification(false);
      
      // Reset all game state
      setWinners([]);
      setGamePaused(false);
      setIsPlaying(false);
      setCurrentSong(null);
      setMixFinalized(false);
      lastFinalizePlaylistKeyRef.current = null;
      setPlaylists([]);
      setSelectedPlaylists([]);
      setSelectedCatalogPlaylists([]);
      setPattern('line');
      setSnippetLength(30);
      setRandomStarts('none');
      setRevealMode('off');
      setPlayedSoFar([]);
      setSongList([]);
      setFinalizedOrder([]);
      finalizedOrderPlaylistKeyRef.current = null;
      pendingFinalizePlaylistKeyRef.current = null;
      lastFinalizeMixSongListRef.current = null;
      invalidateSetlistBuildCache();
      
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

    newSocket.on('hybrid-mode-updated', (data: any) => {
      if (typeof data?.hybridInPersonPlusOnline === 'boolean') {
        setHybridInPersonPlusOnline(data.hybridInPersonPlusOnline);
      }
    });

    // Listen for pattern updates
    newSocket.on('pattern-updated', (data: any) => {
      if (data?.pattern) {
        const incomingPat = data.pattern === 'blackout' ? 'full_card' : data.pattern;
        setPattern(incomingPat);
        if (incomingPat === 'composite' && data.patternComposite != null) {
          const n = normalizePatternComposite(data.patternComposite);
          if (n) setPatternComposite(n);
        }
        if (incomingPat === 'line' && data.linesRequired != null) {
          setLinesRequired(normalizeLinesRequired(data.linesRequired));
        }
        if (incomingPat === 'custom') {
          setCustomMatchAllowRotation(!!data.customMatchAllowRotation);
          setCustomMatchAllowMirror(!!data.customMatchAllowMirror);
        }
        if (incomingPat !== 'custom') {
          setCustomMatchAllowRotation(false);
          setCustomMatchAllowMirror(false);
        }
        addLog(`Pattern updated to ${incomingPat}`, 'info');
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

    newSocket.on('public-display-letter-reveal-interval-updated', (data: any) => {
      if (typeof data?.intervalSec === 'number' && Number.isFinite(data.intervalSec)) {
        const sec = Math.round(data.intervalSec);
        setLetterRevealIntervalSec(Math.min(120, Math.max(5, sec)));
      }
    });

    newSocket.on('public-display-title-reveal-mode-updated', (data: any) => {
      if (data?.mode !== undefined) {
        setPublicDisplayTitleRevealMode(normalizePublicDisplayTitleRevealMode(data.mode));
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
      if (
        typeof payload?.letterRevealIntervalSec === 'number' &&
        Number.isFinite(payload.letterRevealIntervalSec)
      ) {
        const sec = Math.round(payload.letterRevealIntervalSec);
        setLetterRevealIntervalSec(Math.min(120, Math.max(5, sec)));
      }
      if (payload?.publicDisplayTitleRevealMode !== undefined) {
        setPublicDisplayTitleRevealMode(normalizePublicDisplayTitleRevealMode(payload.publicDisplayTitleRevealMode));
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
        if (!isSpotifyConnectedRef.current) return;
        const now = Date.now();
        if (now - lastLoadPlaylistsOnSocketReconnectAtRef.current > 90_000) {
          lastLoadPlaylistsOnSocketReconnectAtRef.current = now;
          await loadPlaylists();
        }
        await new Promise((r) => setTimeout(r, 800));
        await loadDevices();
        await new Promise((r) => setTimeout(r, 800));
        await fetchPlaybackState();
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
      lastFinalizePlaylistKeyRef.current = null;
      setSongList([]);
      invalidateSetlistBuildCache();
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

    newSocket.on('spotify-failsafe', (data: any) => {
      const msg =
        data?.message ||
        'Spotify was disconnected due to very high API traffic. Reconnect from the host when you are ready.';
      console.warn('Spotify failsafe (server):', data);
      setIsSpotifyConnected(false);
      setSpotifyError(msg);
      addLog(`Spotify failsafe: ${msg}`, 'error');
      const detail =
        typeof data?.count30s === 'number' && data?.max != null
          ? `\n\n(Approx. ${data.count30s} Spotify API calls in 30s; automatic disconnect threshold is ${data.max}.)`
          : '';
      showHostAckNotification({
        id: 'server-spotify-failsafe',
        title: 'Spotify disconnected (API protection)',
        variant: 'error',
        message: `${msg}${detail}`,
      });
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

    // 5×15 insufficient columns after cross-playlist dedup — must not be silent (server falls back to non-column pool).
    newSocket.on('mode-warning', (data: any) => {
      const type = data?.type;
      const msg = data?.message || 'Mode warning occurred';
      const details = Array.isArray(data?.details) ? (data.details as string[]) : [];

      if (type === 'insufficient-unique-songs-5x15') {
        console.warn('5×15 mode-warning:', msg, details);
        addLog(`5×15 unavailable (fallback pool): ${msg}`, 'warn');
        details.forEach((detail: string) => addLog(`  ${detail}`, 'warn'));
        setFiveByFifteenInsufficientModal({
          variant: 'fallback',
          warnings: details.length > 0 ? details : [msg],
        });
        return;
      }

      console.warn('Mode warning:', msg);
      addLog(`Mode warning: ${msg}`, 'warn');
      details.forEach((detail: string) => addLog(`  ${detail}`, 'warn'));
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
        const data = (await response.json()) as { connected?: boolean; webApiQuarantine?: unknown };
        writeHostSpotifyWebEnabled(data.connected === true);
        if (data.webApiQuarantine != null) {
          setWebApiQuarantine(normalizeWebApiQuarantine(data.webApiQuarantine));
        }

        if (data.connected) {
          console.log('Spotify already connected, loading playlists...');
          console.log('?? Status API returned connected=true, setting state to true');
          setIsSpotifyConnected(true);
          setIsSpotifyConnecting(false);
          await loadPlaylists();
          // Stagger Web API calls (dev-mode Spotify quota is tight; parallel /devices + /playlists + /player hurts 429s)
          await new Promise((r) => setTimeout(r, 800));
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
    showHostAckNotification,
    invalidateSetlistBuildCache,
  ]);



  const connectSpotify = useCallback(async () => {
    try {
      console.log('Initiating Spotify connection...');
      setIsSpotifyConnecting(true);
      setSpotifyError(null);
      const sessionOk = await postSpotifyWebSessionStart();
      if (!sessionOk) {
        writeHostSpotifyWebEnabled(false);
        setSpotifyError(
          'Could not start Spotify session on the server. Sign out and sign back in, then try Connect Spotify again.'
        );
        setIsSpotifyConnecting(false);
        return;
      }
      writeHostSpotifyWebEnabled(true);

      // Check if Spotify is already connected (with cache-busting)
      const cacheBuster = Date.now();
      const statusResponse = await hostFetch(`${API_BASE || ''}/api/spotify/status?_=${cacheBuster}`);
      const statusData = (await statusResponse.json()) as { connected?: boolean; webApiQuarantine?: unknown };
      if (statusData.webApiQuarantine != null) {
        setWebApiQuarantine(normalizeWebApiQuarantine(statusData.webApiQuarantine));
      }
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




  /** True while finalizeMix is loading tracks or waiting on socket — blocks overlapping finalize (shared finalize generation ref) and debounced setlist rebuilds. */
  const finalizeMixInFlightRef = useRef(false);
  /** Shared promise so Save round + printable PDF await the same finalize instead of failing the second caller. */
  const finalizeMixPromiseRef = useRef<Promise<boolean> | null>(null);
  /** Playlist-id key last confirmed by server `mix-finalized` for this tab — avoids skipping refinalize after prep changes selection while `mixFinalized` stayed true. */
  const lastFinalizePlaylistKeyRef = useRef<string | null>(null);

  /**
   * Ensures `finalizedOrderRef` is populated from `finalized-order` (grace window for race after finalize,
   * then host-only replay via `request-finalized-order`).
   */
  const ensureFinalizedOrderFromServer = useCallback(
    async (expectedPlaylistKey: string | null): Promise<boolean> => {
      if (!socket || !roomId) return false;

      if (
        expectedPlaylistKey != null &&
        (finalizedOrderRef.current?.length ?? 0) > 0 &&
        finalizedOrderPlaylistKeyRef.current !== expectedPlaylistKey
      ) {
        finalizedOrderRef.current = null;
        finalizedOrderPlaylistKeyRef.current = null;
        setFinalizedOrder(null);
      }

      if (
        (finalizedOrderRef.current?.length ?? 0) > 0 &&
        (expectedPlaylistKey == null || finalizedOrderPlaylistKeyRef.current === expectedPlaylistKey)
      ) {
        return true;
      }

      const graceUntil = Date.now() + 500;
      while (Date.now() < graceUntil) {
        if (
          (finalizedOrderRef.current?.length ?? 0) > 0 &&
          (expectedPlaylistKey == null || finalizedOrderPlaylistKeyRef.current === expectedPlaylistKey)
        ) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (
        (finalizedOrderRef.current?.length ?? 0) > 0 &&
        (expectedPlaylistKey == null || finalizedOrderPlaylistKeyRef.current === expectedPlaylistKey)
      ) {
        return true;
      }

      pendingFinalizePlaylistKeyRef.current =
        expectedPlaylistKey ?? mixPlaylistSelectionKeyRef.current ?? null;
      socket.emit('request-finalized-order', { roomId });
      addLog('Requested finalized playback order from server…', 'info');
      const deadline = Date.now() + 16000;
      while (Date.now() < deadline) {
        if (
          (finalizedOrderRef.current?.length ?? 0) > 0 &&
          (expectedPlaylistKey == null || finalizedOrderPlaylistKeyRef.current === expectedPlaylistKey)
        ) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 75));
      }
      return !!(
        (finalizedOrderRef.current?.length ?? 0) > 0 &&
        (expectedPlaylistKey == null || finalizedOrderPlaylistKeyRef.current === expectedPlaylistKey)
      );
    },
    [socket, roomId, addLog],
  );

  /** Returns true when server confirms mix-finalized (or already finalized on client). */
  const finalizeMix = async (opts?: {
    playlists?: Playlist[];
    /** Skip playlist fetch — use frozen Save-round order (must match `playlists` column assignment). */
    songListOverride?: Song[];
    /** Server free-center flag for this finalize (defaults to host Game tab toggle). */
    freeSpace?: boolean;
  }): Promise<boolean> => {
    const playlists = opts?.playlists ?? mixPlaylistSelection;
    if (!socket || playlists.length === 0) return false;
    const freeSpaceForPayload = opts?.freeSpace ?? freeSpaceEnabled;

    const targetKey = selectionPlaylistKey(playlists);
    const uiKey = selectionPlaylistKey(mixPlaylistSelection);
    if (
      mixFinalized &&
      targetKey === uiKey &&
      lastFinalizePlaylistKeyRef.current === targetKey
    ) {
      if (
        finalizedOrderRef.current &&
        finalizedOrderRef.current.length > 0 &&
        finalizedOrderPlaylistKeyRef.current === targetKey
      ) {
        return true;
      }
      addLog('Fetching finalized playback order from server…', 'info');
      return ensureFinalizedOrderFromServer(targetKey);
    }

    const inFlight = finalizeMixPromiseRef.current;
    if (inFlight) {
      addLog('Waiting for finalize already in progress…', 'info');
      return inFlight;
    }

    finalizeMixInFlightRef.current = true;

    const run = async (): Promise<boolean> => {
      try {
        let listToSend: Song[];

        if (opts?.songListOverride && opts.songListOverride.length > 0) {
          addLog('Applying saved round snapshot to the room (display + player cards)…', 'info');
          listToSend = opts.songListOverride.map(cloneSongForSnapshot);
        } else {
          addLog('Loading tracks from playlists before finalizing…', 'info');
          listToSend = await generateSongList({
            force: true,
            reason: 'finalize',
            playlists,
          });

          if (listToSend.length === 0) {
            window.alert(
              'No songs could be loaded from your playlists. Check Spotify and/or YouTube Music under Connection, refresh your library, fix any disconnects, and wait out API rate limits before retrying.'
            );
            return false;
          }
        }

        if (listToSend.length === 0) {
          window.alert('No tracks to finalize. Try Save round again or pick playlists.');
          return false;
        }

        if (playlists.length === 5) {
          const insufficient = compute5x15InsufficientWarnings(playlists, listToSend);
          if (insufficient.length > 0) {
            addLog(
              'Finalize blocked: 5×15 needs 15 unique tracks per playlist after removing duplicates across all five columns.',
              'error',
            );
            insufficient.forEach((line) => addLog(`  ${line}`, 'warn'));
            setFiveByFifteenInsufficientModal({ variant: 'blocked', warnings: insufficient });
            return false;
          }
        }

        console.log('?? Finalizing mix with songList:', {
          length: listToSend.length,
          hasPlaylistInfo: listToSend.length > 0 ? !!listToSend[0]?.sourcePlaylistId : false,
          firstSong: listToSend.length > 0
            ? {
                id: listToSend[0].id,
                name: listToSend[0].name,
                sourcePlaylistId: listToSend[0].sourcePlaylistId,
                sourcePlaylistName: listToSend[0].sourcePlaylistName,
              }
            : null,
        });

        // Include current host-side songList ordering to enforce 1x75 pool deterministically
        console.log('?? Finalizing mix - Playlist order being sent to server:');
        playlists.forEach((p, i) => {
          console.log(
            `   ${i + 1}. ${p.name}${p.catalog ? ' (catalog)' : ''}${p.youtubeMusic ? ' (YouTube)' : ''} (will be column ${i})`
          );
        });

        return await new Promise<boolean>((resolve) => {
          const timeoutMs = 120000;
          const cleanup = () => {
            window.clearTimeout(t);
            socket.off('mix-finalized', onFinalized);
            socket.off('finalize-mix-failed', onFailed);
          };

          const t = window.setTimeout(() => {
            cleanup();
            console.warn('finalize-mix timed out');
            resolve(false);
          }, timeoutMs);

          const onFailed = (payload: { message?: string; code?: string }) => {
            cleanup();
            const msg =
              payload?.message ||
              'Finalize failed. Check playlist loading (YouTube Music / Spotify), connection, or wait if the service is rate-limiting.';
            showHostAckNotification({
              id: 'finalize-mix-failed',
              title: 'Could not finalize mix',
              variant: 'warning',
              message: msg,
            });
            resolve(false);
          };

          const onFinalized = (data: any) => {
            cleanup();
            console.log('Mix finalized:', data);
            pendingFinalizePlaylistKeyRef.current = null;
            finalizedOrderPlaylistKeyRef.current = selectionPlaylistKey(playlists);
            lastFinalizePlaylistKeyRef.current = selectionPlaylistKey(playlists);
            if (Array.isArray(data?.songList) && data.songList.length > 0) {
              setSongList(data.songList as Song[]);
              lastFinalizeMixSongListRef.current = data.songList as Song[];
            }
            setMixFinalized(true);
            setTimeout(() => {
              requestPlayerCards({ announce: true });
            }, 500);
            resolve(true);
          };

          pendingFinalizePlaylistKeyRef.current = selectionPlaylistKey(playlists);
          lastFinalizeMixSongListRef.current = listToSend;
          socket.on('mix-finalized', onFinalized);
          socket.on('finalize-mix-failed', onFailed);
          socket.emit('finalize-mix', {
            roomId: roomId,
            playlists,
            songList: listToSend,
            freeSpace: freeSpaceForPayload,
          });
        });
      } catch (error) {
        console.error('Error finalizing mix:', error);
        return false;
      } finally {
        finalizeMixInFlightRef.current = false;
        finalizeMixPromiseRef.current = null;
      }
    };

    const p = run();
    finalizeMixPromiseRef.current = p;
    return p;
  };

  const requestPrintablePdfDownload = useCallback(
    (opts: {
      pdfSubtitle: string;
      fileSlug: string;
      freeSpace?: boolean;
    }) => {
      if (!socket || !roomId) return;

      void (async () => {
        let finalizedOk = mixFinalized;
        if (!finalizedOk) {
          finalizedOk = await finalizeMix();
        }
        if (!finalizedOk) return;

        const count = Math.min(200, Math.max(1, Math.floor(Number(printableCardCount)) || 30));
        setPrintablePdfLoading(true);

        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const cleanup = () => {
          socket.off('printable-cards-result', onOk);
          socket.off('printable-cards-error', onErr);
          if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
        };

        const onOk = (payload: any) => {
          void (async () => {
            cleanup();
            try {
              const cards = Array.isArray(payload?.cards) ? payload.cards : [];
              if (cards.length === 0) {
                window.alert('No cards returned from server.');
                return;
              }
              const logoUrl =
                payload?.venueBranding && typeof payload.venueBranding.logoUrl === 'string'
                  ? payload.venueBranding.logoUrl
                  : undefined;
              const blob = await buildPrintableBingoPdfBlob(cards, {
                freeSpace: !!payload?.freeSpace,
                subtitle: opts.pdfSubtitle,
                logoUrl,
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              const slug = opts.fileSlug.replace(/[^\w\-]+/g, '_').slice(0, 72);
              a.download = `tempo-bingo-${slug}-${roomId}-${Date.now()}.pdf`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            } catch (e) {
              console.error(e);
              window.alert('Could not build PDF. Try fewer cards or reload and finalize again.');
            } finally {
              setPrintablePdfLoading(false);
            }
          })();
        };

        const onErr = (payload: any) => {
          cleanup();
          window.alert(typeof payload?.message === 'string' ? payload.message : 'Could not generate printable cards.');
          setPrintablePdfLoading(false);
        };

        timeoutId = globalThis.setTimeout(() => {
          cleanup();
          setPrintablePdfLoading(false);
          window.alert('Timed out waiting for printable cards. Try again.');
        }, 90000);

        socket.on('printable-cards-result', onOk);
        socket.on('printable-cards-error', onErr);
        socket.emit('request-printable-cards', {
          roomId,
          count,
          ...(opts.freeSpace !== undefined ? { freeSpace: opts.freeSpace } : {}),
        });
      })();
    },
    [socket, roomId, mixFinalized, printableCardCount, freeSpaceEnabled, finalizeMix],
  );

  /** Same server path + RNG rules as Round builder “Print PDF” — subtitle/filename only differ for organizers. */
  const handleDownloadRoundPrintablePdf = useCallback(
    (round: EventRound) => {
      const ids = round.playlistIds || [];
      if (ids.length === 0) return;
      const safeSlug = (round.name || 'round').replace(/[^\w\-]+/g, '_').slice(0, 48);
      requestPrintablePdfDownload({
        pdfSubtitle: `Room ${roomId} · ${round.name}`,
        fileSlug: safeSlug,
      });
    },
    [requestPrintablePdfDownload, roomId],
  );

  const handleDownloadRoundCallSheetPdf = useCallback(
    (round: EventRound) => {
      const songs = round.savedMixSnapshot?.songs;
      if (!eventRoundSnapshotMeetsSaveThreshold(round, freeSpaceEnabled)) {
        window.alert(
          'Save this round first so there is a snapshot with enough tracks. The call sheet uses the frozen playback order from Save round.',
        );
        return;
      }
      if (!songs || songs.length === 0) {
        window.alert('No snapshot songs found for this round. Save the round again and retry.');
        return;
      }
      try {
        const blob = buildRoundCallSheetPdfBlob({
          roundName: round.name,
          roomLabel: `Room ${roomId}`,
          tracks: songs.map((s) => ({ name: s.name, artist: s.artist })),
        });
        const safeSlug = (round.name || 'round').replace(/[^\w\-]+/g, '_').slice(0, 48);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tempo-call-sheet-${safeSlug}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error(e);
        window.alert('Could not build call sheet PDF. Try again or use a shorter round name.');
      }
    },
    [roomId, freeSpaceEnabled],
  );

  const startGame = async () => {
    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    if (mixNeedsHostSpotify && !isSpotifyConnected) {
      alert('Spotify is not connected. Open Connection in the header and connect Spotify first.');
      return;
    }

    const idxStart = currentRoundIndex;
    const roundForStart =
      idxStart >= 0 && idxStart < eventRounds.length ? eventRounds[idxStart] : null;
    const freeSpaceForStart =
      roundForStart?.freeSpaceEnabled !== undefined
        ? roundForStart.freeSpaceEnabled
        : freeSpaceEnabled;
    const needSnapTracks = freeSpaceForStart ? 24 : 25;
    const snapPool = roundForStart?.savedMixSnapshot?.songs;
    const useSavedRoundPlayback =
      !!roundForStart && !!snapPool && snapPool.length >= needSnapTracks;

    if (!useSavedRoundPlayback && mixPlaylistSelection.length === 0) {
      alert('Please select at least one playlist or official catalog pack');
      return;
    }

    if (mixNeedsHostSpotify && !selectedDevice) {
      alert(
        'Please select a Spotify playback device first.\n\nOpen Connection (header button), pick a device in Playback device, or open Spotify on your target device and tap Refresh devices.'
      );
      return;
    }

    const resolveSongListForStart = () =>
      finalizedOrder && finalizedOrder.length > 0
        ? finalizedOrder
        : songList.length > 0
          ? songList
          : lastFinalizeMixSongListRef.current ?? [];

    if (!useSavedRoundPlayback && resolveSongListForStart().length === 0) {
      alert(
        mixNeedsHostSpotify
          ? 'No songs loaded from playlists. Ensure Spotify is connected and playlists have tracks, then try again.'
          : 'No songs loaded. Open Connection and connect YouTube Music if needed, load playlists, then try Finalize Mix or Start Game again.'
      );
      return;
    }

    try {
      if (!useSavedRoundPlayback && !mixFinalized) {
        addLog('Finalizing mix before start...', 'info');
        const ok = await finalizeMix();
        if (!ok) {
          alert(
            'Could not finalize the mix in time. Try the Finalize Mix button, wait for the confirmation, then Start Game.'
          );
          return;
        }
      }

      const songListForStart = useSavedRoundPlayback && snapPool
        ? snapPool.map(cloneSongForSnapshot)
        : resolveSongListForStart();

      if (songListForStart.length === 0) {
        alert('No song pool is available. Refresh the page or load playlists again.');
        return;
      }

      console.log('Starting game with playlists:', mixPlaylistSelection);
      setIsStartingGame(true);

      let patternForStart: BingoPattern = roundForStart?.bingoPattern ?? pattern;
      let maskForStart: string[] =
        patternForStart === 'custom'
          ? roundForStart?.customPatternMask?.length
            ? roundForStart.customPatternMask
            : customMask.length > 0
              ? customMask
              : customPattern
          : [];
      let compositeForStart: PatternCompositeSpec | undefined;
      if (patternForStart === 'composite') {
        const spec =
          normalizePatternComposite(roundForStart?.patternComposite) ??
          normalizePatternComposite(patternComposite);
        if (!spec) {
          window.alert(
            'This round uses a combined pattern but it could not be loaded. Configure Combined (AND/OR) on the Game tab or in Round Manager.',
          );
          setIsStartingGame(false);
          return;
        }
        compositeForStart = spec;
      }

      if (patternForStart === 'custom' && maskForStart.length === 0) {
        window.alert(
          'This round uses a custom pattern but no squares are saved. Choose a saved custom pattern on the Game tab or in Round Manager.',
        );
        setIsStartingGame(false);
        return;
      }

      if (patternForStart === 'custom' && maskForStart.length > 0) {
        socket.emit('set-pattern', {
          roomId,
          pattern: 'custom',
          customMask: maskForStart,
          customMatchAllowRotation: !!(roundForStart?.customMatchAllowRotation ?? customMatchAllowRotation),
          customMatchAllowMirror: !!(roundForStart?.customMatchAllowMirror ?? customMatchAllowMirror),
          customPatternName:
            customPatternDisplayNameForEmit(maskForStart, selectedCustomPattern, savedCustomPatterns) ?? '',
        });
      } else if (patternForStart === 'composite' && compositeForStart) {
        socket.emit('set-pattern', { roomId, pattern: 'composite', patternComposite: compositeForStart });
      } else if (patternForStart === 'line') {
        socket.emit('set-pattern', {
          roomId,
          pattern: 'line',
          linesRequired: normalizeLinesRequired(roundForStart?.linesRequired ?? linesRequired),
        });
      } else {
        socket.emit('set-pattern', { roomId, pattern: patternForStart });
      }

      if (useSavedRoundPlayback) {
        addLog('Starting game from saved round snapshot (playback order = snapshot)', 'info');
      }

      socket.emit('start-game', {
        roomId,
        playlists: mixPlaylistSelection,
        snippetLength,
        deviceId: mixNeedsHostSpotify && selectedDevice ? selectedDevice.id : undefined,
        songList: songListForStart,
        randomStarts,
        pattern: patternForStart,
        customMask: maskForStart,
        patternComposite: compositeForStart,
        linesRequired: normalizeLinesRequired(roundForStart?.linesRequired ?? linesRequired),
        customMatchAllowRotation: !!(roundForStart?.customMatchAllowRotation ?? customMatchAllowRotation),
        customMatchAllowMirror: !!(roundForStart?.customMatchAllowMirror ?? customMatchAllowMirror),
        ...(patternForStart === 'custom'
          ? {
              customPatternName:
                customPatternDisplayNameForEmit(maskForStart, selectedCustomPattern, savedCustomPatterns) ?? '',
            }
          : {}),
        freeSpace: freeSpaceForStart,
        savedRoundPlayback: useSavedRoundPlayback,
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
  const calculateWinProgress = (
    card: any,
    currentPattern: string,
    playedSongs: string[] = [],
    compositeSpec?: PatternCompositeSpec | null,
  ) => {
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
    } else if (currentPattern === 'full_card' || currentPattern === 'blackout') {
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
      const xp = BINGO_PATTERNS.x.positions;
      patternProgress = xp.filter((pos) => {
        const square = squares.find((s: any) => s.position === pos);
        return square && isLegitimatelyMarked(square);
      }).length;
      totalNeeded = xp.length;
      bestProgress = patternProgress;
    } else if (currentPattern === 't') {
      const pts = BINGO_PATTERNS.t.positions;
      patternProgress = pts.filter((pos) => {
        const square = squares.find((s: any) => s.position === pos);
        return square && isLegitimatelyMarked(square);
      }).length;
      totalNeeded = pts.length;
      bestProgress = patternProgress;
    } else if (currentPattern === 'l') {
      const pts = BINGO_PATTERNS.l.positions;
      patternProgress = pts.filter((pos) => {
        const square = squares.find((s: any) => s.position === pos);
        return square && isLegitimatelyMarked(square);
      }).length;
      totalNeeded = pts.length;
      bestProgress = patternProgress;
    } else if (currentPattern === 'u') {
      const pts = BINGO_PATTERNS.u.positions;
      patternProgress = pts.filter((pos) => {
        const square = squares.find((s: any) => s.position === pos);
        return square && isLegitimatelyMarked(square);
      }).length;
      totalNeeded = pts.length;
      bestProgress = patternProgress;
    } else if (currentPattern === 'plus') {
      const pts = BINGO_PATTERNS.plus.positions;
      patternProgress = pts.filter((pos) => {
        const square = squares.find((s: any) => s.position === pos);
        return square && isLegitimatelyMarked(square);
      }).length;
      totalNeeded = pts.length;
      bestProgress = patternProgress;
    } else if (currentPattern === 'composite' && compositeSpec && compositeSpec.clauses.length > 0) {
      const pct = compositeLegitProgressPct(card, compositeSpec, playedSongs);
      patternProgress = pct;
      totalNeeded = 100;
      bestProgress = pct;
    } else if (currentPattern === 'custom') {
      // For custom patterns, we'd need the custom mask from the server
      // For now, fall back to line logic
      patternProgress = legitimateMarkedCount;
      bestProgress = legitimateMarkedCount;
    }
    
    const needed =
      currentPattern === 'composite'
        ? Math.max(0, 100 - bestProgress)
        : Math.max(0, totalNeeded - bestProgress);
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
              const progress = calculateWinProgress(
                playerData.card,
                pattern,
                playerData.playedSongs || [],
                pattern === 'composite' ? patternComposite : undefined,
              );
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

                const cellVis = youtubeBingoSquareDisplay({
                  customSongName: square.customSongName,
                  songName: square.songName,
                  artistName: square.artistName,
                  youtubeMusic: square.youtubeMusic === true,
                  youtubeRawTitle: square.youtubeRawTitle,
                  catalogDisplayVerified: square.catalogDisplayVerified === true,
                  isFreeSpace: isFree,
                });
                const cellTitle = `${cellVis.title}${cellVis.artist ? ` — ${cellVis.artist}` : ''}`;

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
                    title={`${cellTitle}\nStatus: ${statusText}`}
                  >
                    {icon && <span style={{ marginRight: 2 }}>{icon}</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(() => {
                        const label = cellVis.title;
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

  const patchActiveRoundBingo = useCallback(
    (
      patch: Partial<
        Pick<
          EventRound,
          | 'bingoPattern'
          | 'customPatternMask'
          | 'patternComposite'
          | 'freeSpaceEnabled'
          | 'linesRequired'
          | 'customMatchAllowRotation'
          | 'customMatchAllowMirror'
        >
      >,
    ) => {
      const idx = currentRoundIndexRef.current;
      if (idx < 0) return;
      setEventRounds((prev) => {
        if (idx >= prev.length) return prev;
        const r = prev[idx];
        let updated: EventRound = { ...r, ...patch };
        if (patch.bingoPattern != null && patch.bingoPattern !== 'custom' && patch.bingoPattern !== 'composite') {
          updated = { ...updated, customPatternMask: undefined, patternComposite: undefined };
        }
        if (patch.bingoPattern != null && patch.bingoPattern !== 'line') {
          updated = { ...updated, linesRequired: undefined };
        }
        if (patch.bingoPattern != null && patch.bingoPattern !== 'custom') {
          updated = { ...updated, customMatchAllowRotation: undefined, customMatchAllowMirror: undefined };
        }
        if (patch.bingoPattern === 'custom') {
          updated = { ...updated, patternComposite: undefined };
        }
        if (patch.bingoPattern === 'composite') {
          updated = { ...updated, customPatternMask: undefined };
          if (!updated.patternComposite) {
            const d = normalizePatternComposite(DEFAULT_COMPOSITE_SPEC);
            if (d) updated = { ...updated, patternComposite: d };
          }
        }
        const next = [...prev];
        next[idx] = updated;
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [roomId],
  );

  const applyRoundBingoToHost = useCallback(
    (round: EventRound, options?: { restorePlaybackFromSnapshot?: boolean }) => {
      const restorePlayback = options?.restorePlaybackFromSnapshot === true;
      let p = round.bingoPattern ?? 'line';
      let mask =
        p === 'custom' && round.customPatternMask && round.customPatternMask.length > 0
          ? round.customPatternMask
          : [];

      if (p === 'custom' && mask.length === 0) {
        p = 'line';
        mask = [];
      }

      let compositeSpec: PatternCompositeSpec | null = null;
      if (p === 'composite') {
        compositeSpec =
          normalizePatternComposite(round.patternComposite) ??
          normalizePatternComposite(DEFAULT_COMPOSITE_SPEC);
        if (!compositeSpec) p = 'line';
      }

      setPattern(p);
      setCustomPattern(mask);
      setCustomMask(mask);
      setLinesRequired(normalizeLinesRequired(round.linesRequired ?? 1));

      let matchedSaved: SavedCustomPattern | undefined;

      if (p === 'composite' && compositeSpec) {
        setPatternComposite(compositeSpec);
        setSelectedCustomPattern(null);
        setCustomMatchAllowRotation(false);
        setCustomMatchAllowMirror(false);
      } else if (p === 'custom' && mask.length > 0) {
        const norm = (arr: string[]) => [...arr].sort().join(',');
        const key = norm(mask);
        matchedSaved = savedCustomPatterns.find((sp) => norm(sp.positions) === key);
        setSelectedCustomPattern(matchedSaved ?? null);
        const rot = !!(round.customMatchAllowRotation ?? matchedSaved?.matchAllowRotation);
        const mir = !!(round.customMatchAllowMirror ?? matchedSaved?.matchAllowMirror);
        setCustomMatchAllowRotation(rot);
        setCustomMatchAllowMirror(mir);
      } else {
        setSelectedCustomPattern(null);
        setCustomMatchAllowRotation(false);
        setCustomMatchAllowMirror(false);
      }

      if (round.freeSpaceEnabled !== undefined) {
        setFreeSpaceEnabled(round.freeSpaceEnabled);
        try {
          localStorage.setItem('bingo-free-space', round.freeSpaceEnabled ? '1' : '0');
        } catch {
          /* ignore */
        }
      }

      if (restorePlayback && round.savedMixSnapshot) {
        const snap = round.savedMixSnapshot;
        const sl = snap.snippetLength;
        if (typeof sl === 'number' && Number.isFinite(sl) && sl > 0 && sl <= 120) {
          setSnippetLength(sl);
          try {
            localStorage.setItem('game-snippet-length', String(sl));
          } catch {
            /* ignore */
          }
        }
        const rs = snap.randomStarts;
        if (rs === 'none' || rs === 'early' || rs === 'random') {
          setRandomStarts(rs);
          try {
            localStorage.setItem('game-random-starts', rs);
          } catch {
            /* ignore */
          }
        }
      }

      if (socket && roomId) {
        if (p === 'composite' && compositeSpec) {
          socket.emit('set-pattern', { roomId, pattern: 'composite', patternComposite: compositeSpec });
        } else if (p === 'custom' && mask.length > 0) {
          socket.emit('set-pattern', {
            roomId,
            pattern: 'custom',
            customMask: mask,
            customMatchAllowRotation: !!(round.customMatchAllowRotation ?? matchedSaved?.matchAllowRotation),
            customMatchAllowMirror: !!(round.customMatchAllowMirror ?? matchedSaved?.matchAllowMirror),
            customPatternName:
              customPatternDisplayNameForEmit(mask, matchedSaved ?? null, savedCustomPatterns) ?? '',
          });
        } else if (p === 'line') {
          socket.emit('set-pattern', {
            roomId,
            pattern: 'line',
            linesRequired: normalizeLinesRequired(round.linesRequired ?? 1),
          });
        } else {
          socket.emit('set-pattern', { roomId, pattern: p });
        }
      }
    },
    [socket, roomId, savedCustomPatterns],
  );

  useEffect(() => {
    if (currentRoundIndex < 0) return;
    const r = eventRoundsRef.current[currentRoundIndex];
    if (!r) return;
    applyRoundBingoToHost(r, { restorePlaybackFromSnapshot: true });
  }, [currentRoundIndex, applyRoundBingoToHost]);

  // Round management functions



  const resetEvent = () => {
    if (
      window.confirm(
        'Reset entire event?\n\n' +
          '• Ends the game if playing\n' +
          '• Clears mix selection & finalized pool in this tab\n' +
          '• Rounds with a valid Save round snapshot keep playlists + snapshot\n' +
          '• All other rounds: buckets emptied (draft prep discarded)\n' +
          '• Every round returns to unplanned\n\n' +
          'This cannot be undone. Continue?',
      )
    ) {
      // End current game if running
      if (gameState === 'playing') {
        endGame();
      }

      const resetRounds: EventRound[] = eventRounds.map((round) => {
        if (eventRoundSnapshotMeetsSaveThreshold(round, freeSpaceEnabled)) {
          const snapLen = round.savedMixSnapshot!.songs.length;
          return {
            ...round,
            status: 'unplanned' as const,
            startedAt: undefined,
            completedAt: undefined,
            songCount: snapLen,
          };
        }
        return {
          id: round.id,
          name: round.name,
          playlistIds: [],
          playlistNames: [],
          songCount: 0,
          status: 'unplanned' as const,
          bingoPattern: round.bingoPattern ?? 'line',
          startedAt: undefined,
          completedAt: undefined,
        };
      });

      // Update rounds and reset current round index
      setEventRounds(resetRounds);
      setCurrentRoundIndex(-1);

      // Save to localStorage
      if (roomId) {
        localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(resetRounds));
      }

      // Clear selected playlists and reset game state
      setSelectedPlaylists([]);
      setSelectedCatalogPlaylists([]);
      setMixFinalized(false);
      lastFinalizePlaylistKeyRef.current = null;
      setSongList([]);
      invalidateSetlistBuildCache();
      setGameState('waiting');

      addLog('Event reset — saved-round snapshots kept; unsaved buckets cleared', 'info');
    }
  };

  /** Browser-only: wipe `event-rounds-<roomId>` and UI prep state for a clean save/load test (snapshots + buckets). */
  const clearRoomRoundPrepStorage = () => {
    if (!roomId) return;
    if (
      !window.confirm(
        'Clear ALL saved round prep for THIS ROOM on THIS browser?\n\n' +
          '• Deletes localStorage event-rounds (round buckets + Save-round snapshots)\n' +
          '• Clears cloud-sync marker so the next load can restore from your Tempo account if you’re signed in\n' +
          '• Leaves one empty Round 1\n' +
          '• Clears mix selection & finalized pool in this tab\n' +
          '• Ends the live game if playing\n\n' +
          'Does not remove playlists from Spotify/YouTube. Cannot be undone.',
      )
    ) {
      return;
    }

    if (gameState === 'playing') {
      endGame();
    }

    try {
      localStorage.removeItem(`event-rounds-${roomId}`);
      clearPrepCloudAck(roomId);
    } catch {
      /* ignore */
    }

    const fresh: EventRound[] = [
      {
        id: `round-${Date.now()}`,
        name: 'Round 1',
        playlistIds: [],
        playlistNames: [],
        songCount: 0,
        status: 'unplanned',
        bingoPattern: 'line',
      },
    ];
    setEventRounds(fresh);
    setCurrentRoundIndex(-1);
    setSelectedPlaylists([]);
    setSelectedCatalogPlaylists([]);
    setMixFinalized(false);
    lastFinalizePlaylistKeyRef.current = null;
    setSongList([]);
    invalidateSetlistBuildCache();
    setGameState('waiting');
    setCurrentSong(null);
    setPlayedSoFar([]);
    setWinners([]);
    setRoundComplete(null);
    setRoundWinners([]);
    setShowPlaylistRoundModal(false);
    showToast('Prep cache cleared — fresh Round 1 (this browser)', 'success');
    addLog('Cleared room round prep storage (localStorage + UI)', 'info');
  };

  const updatePattern = (next: BingoPattern) => {
    if (next === 'composite') {
      const spec = normalizePatternComposite(patternComposite) ?? normalizePatternComposite(DEFAULT_COMPOSITE_SPEC);
      if (!spec) return;
      setPatternComposite(spec);
      setPattern('composite');
      setSelectedCustomPattern(null);
      setCustomPattern([]);
      setCustomMask([]);
      setCustomMatchAllowRotation(false);
      setCustomMatchAllowMirror(false);
      patchActiveRoundBingo({
        bingoPattern: 'composite',
        patternComposite: spec,
        customPatternMask: undefined,
      });
      if (socket && roomId) {
        socket.emit('set-pattern', { roomId, pattern: 'composite', patternComposite: spec });
        addLog(`Pattern set to Combined (${spec.op.toUpperCase()})`, 'info');
      }
      return;
    }

    setPattern(next);
    if (next !== 'custom') {
      setSelectedCustomPattern(null);
      setCustomPattern([]);
      setCustomMask([]);
      setCustomMatchAllowRotation(false);
      setCustomMatchAllowMirror(false);
    }
    patchActiveRoundBingo({
      bingoPattern: next,
      ...(next !== 'custom' ? { customPatternMask: undefined } : {}),
      patternComposite: undefined,
      ...(next === 'line' ? { linesRequired: normalizeLinesRequired(linesRequired) } : {}),
      ...(next === 'custom'
        ? {
            customMatchAllowRotation,
            customMatchAllowMirror,
          }
        : {}),
    });
    if (socket && roomId) {
      socket.emit('set-pattern', {
        roomId,
        pattern: next,
        customMask: next === 'custom' ? customMask : undefined,
        ...(next === 'line' ? { linesRequired: normalizeLinesRequired(linesRequired) } : {}),
        ...(next === 'custom'
          ? {
              customMatchAllowRotation,
              customMatchAllowMirror,
              customPatternName:
                customPatternDisplayNameForEmit(customMask, selectedCustomPattern, savedCustomPatterns) ?? '',
            }
          : {}),
      });
      addLog(`Pattern set to ${next}`, 'info');
    }
  };

  const handleCustomPatternSelect = (customPatternObj: SavedCustomPattern) => {
    setSelectedCustomPattern(customPatternObj);
    setPattern('custom');
    setCustomPattern(customPatternObj.positions);
    setCustomMask(customPatternObj.positions);
    const rot = customPatternObj.matchAllowRotation === true;
    const mir = customPatternObj.matchAllowMirror === true;
    setCustomMatchAllowRotation(rot);
    setCustomMatchAllowMirror(mir);
    patchActiveRoundBingo({
      bingoPattern: 'custom',
      customPatternMask: customPatternObj.positions,
      patternComposite: undefined,
      customMatchAllowRotation: rot,
      customMatchAllowMirror: mir,
    });
    if (socket && roomId) {
      socket.emit('set-pattern', {
        roomId,
        pattern: 'custom',
        customMask: customPatternObj.positions,
        customMatchAllowRotation: rot,
        customMatchAllowMirror: mir,
        customPatternName:
          customPatternDisplayNameForEmit(customPatternObj.positions, customPatternObj, savedCustomPatterns) ?? '',
      });
      addLog(`Custom pattern set to ${customPatternObj.name}`, 'info');
    }
  };

  const handleNewCustomPattern = useCallback((roundIndex: number) => {
    compositeEditRoundIndexRef.current = roundIndex;
    setShowCustomPatternModal(true);
  }, []);

  const handleSaveCustomPattern = (patternData: CustomPatternSavePayload) => {
    const savedPattern = saveCustomPattern(patternData);
    setSavedCustomPatterns(getSavedCustomPatterns());
    const idx = compositeEditRoundIndexRef.current;
    const rot = savedPattern.matchAllowRotation === true;
    const mir = savedPattern.matchAllowMirror === true;
    handleUpdateRoundBingoFields(idx, {
      bingoPattern: 'custom',
      customPatternMask: [...savedPattern.positions],
      patternComposite: undefined,
      customMatchAllowRotation: rot,
      customMatchAllowMirror: mir,
    });
    if (idx === currentRoundIndexRef.current) {
      setSelectedCustomPattern(savedPattern);
      setPattern('custom');
      setCustomPattern(savedPattern.positions);
      setCustomMask(savedPattern.positions);
      setCustomMatchAllowRotation(rot);
      setCustomMatchAllowMirror(mir);
      if (socket && roomId) {
        socket.emit('set-pattern', {
          roomId,
          pattern: 'custom',
          customMask: savedPattern.positions,
          customMatchAllowRotation: rot,
          customMatchAllowMirror: mir,
          customPatternName:
            customPatternDisplayNameForEmit(savedPattern.positions, savedPattern, getSavedCustomPatterns()) ??
            '',
        });
      }
      addLog(`Custom pattern set to ${savedPattern.name}`, 'info');
    }
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

  // Generate and shuffle song list from selected playlists. Only fetches tracks for newly selected playlists (avoids re-downloading the whole library on each click). Use { force: true } to refetch all.
  const generateSongList = useCallback(
    async (opts?: {
      force?: boolean;
      reason?: 'selection' | 'finalize';
      playlists?: Playlist[];
    }): Promise<Song[]> => {
      const rows = opts?.playlists ?? mixPlaylistSelection;
      const rowsNeedHostSpotify = rows.some(
        (p) => p.youtubeMusic !== true && p.catalog !== true
      );

      if (rows.length === 0) {
        fullyLoadedPlaylistIdsRef.current.clear();
        setSongList([]);
        return [];
      }

      if (rowsNeedHostSpotify && !isSpotifyConnected) {
        console.warn('Cannot generate song list: Spotify not connected for selected playlists');
        setSongList([]);
        fullyLoadedPlaylistIdsRef.current.clear();
        return [];
      }

      if (opts?.force) {
        fullyLoadedPlaylistIdsRef.current.clear();
      }
      const genRef =
        opts?.reason === 'finalize' ? finalizeSetlistGenerationRef : setlistBuildGenerationRef;
      genRef.current += 1;
      const myBuild = genRef.current;

      const selectedIds = new Set(rows.map((p) => p.id));
      Array.from(fullyLoadedPlaylistIdsRef.current).forEach((id) => {
        if (!selectedIds.has(id)) {
          fullyLoadedPlaylistIdsRef.current.delete(id);
        }
      });

      const kept: Song[] = opts?.force
        ? []
        : songListRef.current.filter(
            (s) => s.sourcePlaylistId && selectedIds.has(s.sourcePlaylistId)
          );

      let toFetch = rows.filter((p) => !fullyLoadedPlaylistIdsRef.current.has(p.id));

      // Ref says every selected playlist was fetched, but we have no tracks in memory (reconnect, room
      // lifecycle, etc.). Refetch instead of returning [] with no network calls — avoids Finalize Mix alert.
      if (toFetch.length === 0 && kept.length === 0 && rows.length > 0) {
        fullyLoadedPlaylistIdsRef.current.clear();
        toFetch = rows.filter((p) => !fullyLoadedPlaylistIdsRef.current.has(p.id));
      }

      const dedupeAndShuffle = (songs: Song[]) => {
        const seen = new Set<string>();
        const uniqueSongs = songs.filter((song) => {
          if (seen.has(song.id)) {
            return false;
          }
          seen.add(song.id);
          return true;
        });
        const shuffledSongs = [...uniqueSongs];
        for (let i = shuffledSongs.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledSongs[i], shuffledSongs[j]] = [shuffledSongs[j], shuffledSongs[i]];
        }
        return shuffledSongs;
      };

      if (genRef.current !== myBuild) {
        return [];
      }

      if (toFetch.length === 0) {
        if (kept.length === 0) {
          setSongList([]);
          return [];
        }
        const shuffledSongs = dedupeAndShuffle(kept);
        if (genRef.current !== myBuild) {
          return [];
        }
        setSongList(shuffledSongs);
        console.log(`Setlist: ${shuffledSongs.length} songs (reused already-loaded tracks)`);
        return shuffledSongs;
      }

      try {
        let allSongs: Song[] = [...kept];

        const needsHostSpotifyApi = toFetch.some((p) => !p.youtubeMusic);
        if (needsHostSpotifyApi && !readHostSpotifyWebEnabled()) {
          setSongList([]);
          return [];
        }

        for (let i = 0; i < toFetch.length; i++) {
          if (genRef.current !== myBuild) {
            return [];
          }
          if (i > 0) {
            await new Promise((r) => setTimeout(r, 450));
          }
          const playlist = toFetch[i];
          const qs = new URLSearchParams();
          if (playlist.name) qs.set('playlistName', playlist.name);
          const q = qs.toString();
          const catalog = playlist.catalog === true;
          const yt = playlist.youtubeMusic === true;
          const url = yt
            ? `${API_BASE || ''}/api/youtube/music/playlist/${encodeURIComponent(playlist.id)}/items${q ? `?${q}` : ''}`
            : catalog
            ? `${API_BASE || ''}/api/spotify/catalog/playlist/${playlist.id}${q ? `?${q}` : ''}`
            : `${API_BASE || ''}/api/spotify/playlist-tracks/${playlist.id}${q ? `?${q}` : ''}`;
          const response = await hostFetch(url, { cache: 'no-store' });
          const data = (await response.json()) as { success?: boolean; tracks?: Song[] };

          if (genRef.current !== myBuild) {
            return [];
          }
          if (data.success && data.tracks) {
            const rows = yt
              ? data.tracks.map((t) => ({ ...t, youtubeMusic: true as const }))
              : data.tracks;
            allSongs.push(...rows);
            fullyLoadedPlaylistIdsRef.current.add(playlist.id);
            if (!catalog && !yt) {
              applyPlaylistExplicitKnowledge(playlist.id, data.tracks, setPlaylists, setSelectedPlaylists);
            }
          }
        }

        const shuffledSongs = dedupeAndShuffle(allSongs);
        if (genRef.current !== myBuild) {
          return [];
        }
        setSongList(shuffledSongs);
        console.log(`Generated ${shuffledSongs.length} shuffled songs (fetched ${toFetch.length} playlist(s), reused ${kept.length} track(s) from buffer)`);
        return shuffledSongs;
      } catch (error) {
        console.error('Error generating song list:', error);
        return [];
      }
    },
    [mixPlaylistSelection, isSpotifyConnected, setPlaylists, setSelectedPlaylists]
  );

  /** Always latest generateSongList — debounced effect must not depend on this callback (identity churn retriggers → duplicate playlist-tracks waves). */
  const generateSongListRef = useRef(generateSongList);
  generateSongListRef.current = generateSongList;

  /** Stable when the same playlist IDs are selected but selection arrays are replaced (socket / state sync). */
  const playlistSelectionKey = useMemo(
    () =>
      [...mixPlaylistSelection]
        .map((p) => p.id)
        .sort((a, b) => String(a).localeCompare(String(b)))
        .join('|'),
    [mixPlaylistSelection]
  );

  // Advanced playback functions
  const [volumeTimeout, setVolumeTimeout] = useState<NodeJS.Timeout | null>(null);

  // Function to fetch current Spotify volume
  const fetchCurrentVolume = useCallback(async () => {
    if (!readHostSpotifyWebEnabled()) return;
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
    if (!readHostSpotifyWebEnabled()) return;
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
    if (!readHostSpotifyWebEnabled()) {
      alert('Connect Spotify from Connection first.');
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
      if (!readHostSpotifyWebEnabled()) return;
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
        if (!readHostSpotifyWebEnabled()) return;
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
        if (!readHostSpotifyWebEnabled()) return;
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
        if (!readHostSpotifyWebEnabled()) return;
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
    
    if (!readHostSpotifyWebEnabled()) return;
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

    if (!readHostSpotifyWebEnabled()) {
      alert('Connect Spotify from Connection first.');
      return;
    }

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
          description: `Output playlist from TEMPO Music Bingo - Room ${roomId} - ${mixPlaylistSelection.map(p => p.name).join(', ')}`
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
  }, [songList, roomId, mixPlaylistSelection, addLog]);

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
        if (!isSpotifyConnectedRef.current) return;
        if (!readHostSpotifyWebEnabled()) return;
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
    }, 120_000); // 120s: minimize /me/player via /api/spotify/current-playback (was 60s)
    return () => clearInterval(playbackSyncInterval);
  }, [currentSong, isPlaying, isPausedByInterface]);

  // Build master setlist when selection changes. Debounced: ticking several playlists in a row = one import wave.
  // Depends on playlistSelectionKey + Spotify connectivity gates + mixNeedsHostSpotify — NOT generateSongList — so callback identity churn does not reschedule this effect (was causing 3× identical playlist-tracks bursts).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (finalizeMixInFlightRef.current) return;
      void generateSongListRef.current({ reason: 'selection' });
    }, 750);
    return () => window.clearTimeout(t);
  }, [playlistSelectionKey, isSpotifyConnected, mixNeedsHostSpotify]);

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
      if (!readHostSpotifyWebEnabled()) return;
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
  const handleUpdateRounds = useCallback(
    (newRounds: EventRound[], meta?: { reorder?: { from: number; to: number } }) => {
      setEventRounds(newRounds);
      if (meta?.reorder) {
        const { from, to } = meta.reorder;
        setCurrentRoundIndex((cur) => {
          if (cur < 0) return cur;
          if (cur === from) return to;
          if (from < to && cur > from && cur <= to) return cur - 1;
          if (from > to && cur >= to && cur < from) return cur + 1;
          return cur;
        });
        setRoundBuilderFocusIndex((cur) => {
          if (cur < 0) return cur;
          if (cur === from) return to;
          if (from < to && cur > from && cur <= to) return cur - 1;
          if (from > to && cur >= to && cur < from) return cur + 1;
          return cur;
        });
      }
      try {
        localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(newRounds));
      } catch (error) {
        console.warn('Failed to save rounds to localStorage:', error);
      }
    },
    [roomId],
  );

  /** Same behavior as dragging a library row into a round bucket (RoundPlanner drop). */
  const addPlaylistToRoundBucket = useCallback(
    (roundIndex: number, playlistId: string) => {
      const playlist = playlistsForRoundPlanner.find((p) => String(p.id) === String(playlistId));
      if (!playlist) return;
      setEventRounds((prev) => {
        if (roundIndex < 0 || roundIndex >= prev.length) return prev;
        const round = prev[roundIndex];
        if (round.playlistIds.some((id) => String(id) === String(playlistId))) return prev;
        const newRounds = [...prev];
        const tracks = Math.max(0, Number(playlist.tracks) || 0);
        let updated: EventRound = {
          ...round,
          playlistIds: [...round.playlistIds, playlist.id],
          playlistNames: [...round.playlistNames, playlist.name],
          songCount: round.songCount + tracks,
          status: round.status === 'unplanned' ? 'planned' : round.status,
        };
        updated = sortRoundPlaylistsByBingoColumns(updated, playlistsForRoundPlanner);
        newRounds[roundIndex] = updated;
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(newRounds));
        } catch (error) {
          console.warn('Failed to save rounds to localStorage:', error);
        }
        return newRounds;
      });
    },
    [playlistsForRoundPlanner, roomId],
  );


  const handleUpdateRoundBingoFields = useCallback(
    (
      roundIndex: number,
      patch: Partial<
        Pick<
          EventRound,
          | 'bingoPattern'
          | 'customPatternMask'
          | 'patternComposite'
          | 'freeSpaceEnabled'
          | 'linesRequired'
          | 'customMatchAllowRotation'
          | 'customMatchAllowMirror'
        >
      >,
    ) => {
      setEventRounds((prev) => {
        const r = prev[roundIndex];
        if (!r) return prev;
        let updated: EventRound = { ...r, ...patch };
        if (patch.bingoPattern != null && patch.bingoPattern !== 'custom' && patch.bingoPattern !== 'composite') {
          updated = { ...updated, customPatternMask: undefined, patternComposite: undefined };
        }
        if (patch.bingoPattern != null && patch.bingoPattern !== 'line') {
          updated = { ...updated, linesRequired: undefined };
        }
        if (patch.bingoPattern != null && patch.bingoPattern !== 'custom') {
          updated = { ...updated, customMatchAllowRotation: undefined, customMatchAllowMirror: undefined };
        }
        if (patch.bingoPattern === 'custom') {
          updated = { ...updated, patternComposite: undefined };
        }
        if (patch.bingoPattern === 'composite') {
          updated = { ...updated, customPatternMask: undefined };
          if (!updated.patternComposite) {
            const d = normalizePatternComposite(DEFAULT_COMPOSITE_SPEC);
            if (d) updated = { ...updated, patternComposite: d };
          }
        }
        const next = [...prev];
        next[roundIndex] = updated;
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        if (roundIndex === currentRoundIndexRef.current) {
          applyRoundBingoToHost(updated);
        }
        return next;
      });
    },
    [roomId, applyRoundBingoToHost],
  );

  const openCompositeForRound = useCallback((roundIndex: number) => {
    compositeEditRoundIndexRef.current = roundIndex;
    const r = eventRoundsRef.current[roundIndex];
    const spec =
      normalizePatternComposite(r?.patternComposite) ??
      normalizePatternComposite(DEFAULT_COMPOSITE_SPEC);
    if (spec) setPatternComposite(spec);
    setCombinedPatternModalOpen(true);
  }, []);

  const commitPatternComposite = useCallback(
    (next: PatternCompositeSpec) => {
      const n = normalizePatternComposite(next);
      if (!n) return;
      const idx = compositeEditRoundIndexRef.current;
      handleUpdateRoundBingoFields(idx, {
        bingoPattern: 'composite',
        patternComposite: n,
        customPatternMask: undefined,
      });
      if (idx === currentRoundIndexRef.current) {
        setPatternComposite(n);
        setPattern('composite');
      }
    },
    [handleUpdateRoundBingoFields],
  );

  /** Resolved rows match `mixPlaylistSelection` merge order (library first, then catalog-only). */
  const resolveMixPlaylistRowsForRound = useCallback(
    (round: EventRound): Playlist[] | null => {
      const idSet = new Set((round.playlistIds || []).map((id) => String(id)));
      const fromLibrary = playlistsForRoundPlanner.filter((p) => idSet.has(String(p.id)));
      const libraryIdSet = new Set(fromLibrary.map((p) => String(p.id)));
      const fromCatalog = catalogPackOptions.filter(
        (p) => idSet.has(String(p.id)) && !libraryIdSet.has(String(p.id)),
      );
      if (fromLibrary.length === 0 && fromCatalog.length === 0) return null;
      const merged: Playlist[] = [...fromLibrary];
      const ids = new Set(fromLibrary.map((p) => p.id));
      for (const c of fromCatalog) {
        if (!ids.has(c.id)) {
          merged.push({ ...c, catalog: true });
          ids.add(c.id);
        }
      }
      return merged;
    },
    [playlistsForRoundPlanner, catalogPackOptions],
  );

  /** Load a round's playlists into the host mix selection (finalize / Save round use this list). Does not change round status. */
  const applyRoundPlaylistsToMixSelection = useCallback(
    (round: EventRound) => {
      const merged = resolveMixPlaylistRowsForRound(round);
      if (!merged) return false;
      const libraryRows = merged.filter((p) => p.catalog !== true);
      const catalogRows = merged.filter((p) => p.catalog === true);
      setSelectedPlaylists(libraryRows);
      setSelectedCatalogPlaylists(catalogRows);
      return true;
    },
    [resolveMixPlaylistRowsForRound],
  );

  /** Sync only mix playlists for the focused round (no pattern/playback reset). */
  const syncMixFromRound = useCallback(
    (roundIndex: number) => {
      const round = eventRoundsRef.current[roundIndex];
      if (!round || !(round.playlistIds || []).length) return;
      applyRoundPlaylistsToMixSelection(round);
    },
    [applyRoundPlaylistsToMixSelection],
  );

  /** Pick a round for advance prep: sync mix + pattern/snippet UI without marking rounds active/completed or leaving Manager. */
  const handleSelectRoundForPrep = useCallback(
    (roundIndex: number) => {
      if (gameState === 'playing') {
        window.alert('End or pause the live game before switching which round you are prepping.');
        return;
      }
      const round = eventRoundsRef.current[roundIndex];
      if (!round || !(round.playlistIds || []).length) {
        window.alert('Add playlists to this round first.');
        return;
      }
      const ok = applyRoundPlaylistsToMixSelection(round);
      if (!ok) {
        window.alert(
          'No playlists from this round matched your library. Use Connection to refresh, or re-drag playlists from the library into this bucket.',
        );
        return;
      }
      const mixRows = resolveMixPlaylistRowsForRound(round);
      const switchingRound = roundIndex !== currentRoundIndexRef.current;
      if (switchingRound) {
        applyRoundBingoToHost(round, { restorePlaybackFromSnapshot: true });
        setCurrentRoundIndex(roundIndex);
        const playlistNames = round.playlistNames.join(', ');
        showToast(`${round.name} — mix loaded for prep (${playlistNames})`, 'success');
        addLog(`Prep select ${round.name}: ${playlistNames}`, 'info');
      } else {
        setCurrentRoundIndex(roundIndex);
      }

      if (
        mixRows &&
        socket &&
        roomId &&
        eventRoundSnapshotMeetsSaveThreshold(round, freeSpaceEnabled) &&
        round.savedMixSnapshot?.songs?.length
      ) {
        void (async () => {
          setSavedRoundRoomSyncBusy(true);
          try {
            const pending = finalizeMixPromiseRef.current;
            if (pending) await pending;
            const fs =
              round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : freeSpaceEnabled;
            await finalizeMix({
              playlists: mixRows,
              songListOverride: round.savedMixSnapshot!.songs.map(cloneSongForSnapshot),
              freeSpace: fs,
            });
          } finally {
            setSavedRoundRoomSyncBusy(false);
          }
        })();
      }
    },
    [
      gameState,
      applyRoundPlaylistsToMixSelection,
      resolveMixPlaylistRowsForRound,
      applyRoundBingoToHost,
      showToast,
      addLog,
      socket,
      roomId,
      freeSpaceEnabled,
      finalizeMix,
    ],
  );

  /** After reload / restore, pull the active round's playlists into the mix when the mix is still empty. */
  useEffect(() => {
    if (!roomId) return;
    if (currentRoundIndex < 0 || currentRoundIndex >= eventRounds.length) return;
    if (mixPlaylistSelection.length > 0) return;
    const round = eventRounds[currentRoundIndex];
    if (!round || !(round.playlistIds || []).length) return;
    applyRoundPlaylistsToMixSelection(round);
  }, [
    roomId,
    currentRoundIndex,
    eventRounds,
    mixPlaylistSelection.length,
    applyRoundPlaylistsToMixSelection,
  ]);

  const handleSaveRoundAtIndex = async (roundIndex: number) => {
    if (!socket || !roomId) {
      window.alert('Connect to the room first.');
      return;
    }
    const round0 = eventRoundsRef.current[roundIndex];
    if (!round0 || !(round0.playlistIds || []).length) {
      window.alert('Assign at least one playlist to this round before saving.');
      return;
    }

    const mixRows = resolveMixPlaylistRowsForRound(round0);
    if (!mixRows) {
      window.alert(
        'No playlists from this round matched your library. Use Connection to refresh, or re-drag playlists from the library into this bucket.',
      );
      return;
    }
    applyRoundPlaylistsToMixSelection(round0);

    setSaveRoundBusy(true);
    try {
      const ok = await finalizeMix({ playlists: mixRows });
      if (!ok) {
        addLog('Save round: finalize did not complete.', 'warn');
        return;
      }

      const saveMixKey = selectionPlaylistKey(mixRows);
      const orderReady = await ensureFinalizedOrderFromServer(saveMixKey);
      const fo = finalizedOrderRef.current;
      if (!orderReady || !fo || fo.length === 0) {
        window.alert(
          'The server did not send the finalized playback order in time. Wait until you see “Finalized order received” in the activity log, or tap Finalize mix again, then Save round. Saved rounds must match projector/host playback order, not the longer prep list.',
        );
        addLog('Save round: no finalized playback order after replay request.', 'warn');
        return;
      }
      const pool = fo.map(cloneSongForSnapshot);

      const r = eventRoundsRef.current[roundIndex];
      if (!r) return;

      const filtered = songsForRoundFromFinalizedPool(r, pool).map(cloneSongForSnapshot);
      const fs = r.freeSpaceEnabled !== undefined ? r.freeSpaceEnabled : freeSpaceEnabled;
      const need = fs ? 24 : 25;
      if (filtered.length < need) {
        const stalePoolHint =
          pool.length > 0 && filtered.length === 0
            ? ' The finalized playback pool still looked like a different mix — tap Finalize mix on the Game tab once, then Save round again.'
            : '';
        window.alert(
          `This round only has ${filtered.length} unique tracks from its playlists in the finalized mix (need ${need}).${stalePoolHint} Include those playlists in the mix on the Game tab, finalize, then save again.`,
        );
        return;
      }

      const snap: SavedRoundMixSnapshot = {
        savedAt: Date.now(),
        songs: filtered,
        mixGeometry: deriveMixGeometryForSnapshot(mixRows, pool.length),
        snippetLength,
        randomStarts,
      };

      setEventRounds((prev) => {
        if (roundIndex < 0 || roundIndex >= prev.length) return prev;
        const next = [...prev];
        next[roundIndex] = {
          ...next[roundIndex],
          savedMixSnapshot: snap,
          songCount: filtered.length,
          status: next[roundIndex].status === 'active' ? 'active' : 'planned',
        };
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setCurrentRoundIndex(roundIndex);
      showToast(`Saved ${r.name} — ${filtered.length} tracks (${snap.mixGeometry})`, 'success');
      addLog(`Round snapshot saved: ${r.name}, ${filtered.length} tracks`, 'info');
    } finally {
      setSaveRoundBusy(false);
    }
  };


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

    const loaded = applyRoundPlaylistsToMixSelection(round);
    if (loaded) {
      const playlistNames = round.playlistNames.join(', ');
      addLog(`Started ${round.name}: ${playlistNames}`, 'info');
    }

    applyRoundBingoToHost(round, { restorePlaybackFromSnapshot: true });
    const mixRows = resolveMixPlaylistRowsForRound(round);
    if (
      loaded &&
      mixRows &&
      socket &&
      roomId &&
      eventRoundSnapshotMeetsSaveThreshold(round, freeSpaceEnabled) &&
      round.savedMixSnapshot?.songs?.length
    ) {
      void (async () => {
        setSavedRoundRoomSyncBusy(true);
        try {
          const pending = finalizeMixPromiseRef.current;
          if (pending) await pending;
          const fs =
            round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : freeSpaceEnabled;
          await finalizeMix({
            playlists: mixRows,
            songListOverride: round.savedMixSnapshot!.songs.map(cloneSongForSnapshot),
            freeSpace: fs,
          });
        } finally {
          setSavedRoundRoomSyncBusy(false);
        }
      })();
    }

    // Store updated rounds
    try {
      localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(updatedRounds));
    } catch (error) {
      console.warn('Failed to save rounds to localStorage:', error);
    }

    // Next step is Start game on the Game tab (finalize runs via Save round or Start Game)
    setActiveTab('play');
  }, [
    eventRounds,
    currentRoundIndex,
    applyRoundPlaylistsToMixSelection,
    applyRoundBingoToHost,
    resolveMixPlaylistRowsForRound,
    roomId,
    addLog,
    socket,
    freeSpaceEnabled,
    finalizeMix,
  ]);

  // Advanced round management functions
  const jumpToRound = useCallback((roundIndex: number) => {
    if (roundIndex >= 0 && roundIndex < eventRounds.length) {
      const round = eventRounds[roundIndex];
      if (round.status !== 'completed' && (round.playlistIds || []).length > 0) {
        handleStartRound(roundIndex);
        setShowPlaylistRoundModal(false);
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

  // Load rounds from localStorage on component mount (browser-local; cloud may overlay after auth).
  useEffect(() => {
    if (!roomId) return;

    try {
      const savedRounds = localStorage.getItem(`event-rounds-${roomId}`);
      if (!savedRounds) return;
      const parsed = JSON.parse(savedRounds);
      const migratedRounds = migrateRawEventRounds(parsed);
      if (migratedRounds.length === 0) return;

      const hostFsDefault = readHostDefaultFreeSpaceFlag();
      const withPromotedStatus = promoteRoundStatusesAfterPrepLoad(migratedRounds, hostFsDefault);

      setEventRounds(withPromotedStatus);
      localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(withPromotedStatus));

      let pickIdx = withPromotedStatus.findIndex((r: EventRound) => r.status === 'active');
      if (pickIdx < 0) {
        pickIdx = withPromotedStatus.findIndex(
          (r: EventRound) =>
            (r.playlistIds || []).length > 0 &&
            eventRoundSnapshotMeetsSaveThreshold(r, hostFsDefault),
        );
      }
      if (pickIdx >= 0) {
        setCurrentRoundIndex(pickIdx);
      }
    } catch (error) {
      console.warn('Failed to load rounds from localStorage:', error);
    }
  }, [roomId]);

  /** Signed-in hosts: pull newer prep from API (Postgres) so site-data clears can be recovered. */
  useEffect(() => {
    if (!roomId) return;

    if (!hostAccount?.id || !getHostJwt()) {
      setPrepCloudHydrated(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const r = await hostFetch(
          `${API_BASE || ''}/api/host/rooms/${encodeURIComponent(roomId)}/prep`,
          { cache: 'no-store' },
        );
        if (cancelled) return;

        if (r.status === 404 || r.status === 503 || !r.ok) {
          setPrepCloudHydrated(true);
          return;
        }

        const data = (await r.json()) as {
          rounds?: unknown;
          currentRoundIndex?: number;
          updatedAt?: string;
        };

        const serverTs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
        const ack = readPrepCloudAckMs(roomId);
        const localRaw = localStorage.getItem(`event-rounds-${roomId}`);
        let hasLocalPrep = false;
        if (localRaw) {
          try {
            const a = JSON.parse(localRaw);
            hasLocalPrep = Array.isArray(a) && a.length > 0;
          } catch {
            hasLocalPrep = false;
          }
        }

        if (!Number.isFinite(serverTs) || serverTs <= ack) {
          setPrepCloudHydrated(true);
          return;
        }

        /** Avoid overwriting unsynced local prep when the host signs in mid-session (ack never set). */
        if (ack === 0 && hasLocalPrep) {
          setPrepCloudHydrated(true);
          return;
        }

        const migrated = migrateRawEventRounds(data.rounds);
        if (migrated.length === 0) {
          setPrepCloudHydrated(true);
          return;
        }

        const hostFsDefault = readHostDefaultFreeSpaceFlag();
        const withPromoted = promoteRoundStatusesAfterPrepLoad(migrated, hostFsDefault);

        if (cancelled) return;
        setEventRounds(withPromoted);
        localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(withPromoted));

        let pickIdx =
          typeof data.currentRoundIndex === 'number' ? data.currentRoundIndex : -1;
        if (pickIdx < 0 || pickIdx >= withPromoted.length) {
          pickIdx = withPromoted.findIndex((rr: EventRound) => rr.status === 'active');
        }
        if (pickIdx < 0) {
          pickIdx = withPromoted.findIndex(
            (rr: EventRound) =>
              (rr.playlistIds || []).length > 0 &&
              eventRoundSnapshotMeetsSaveThreshold(rr, hostFsDefault),
          );
        }
        if (pickIdx >= 0) {
          setCurrentRoundIndex(pickIdx);
        }

        writePrepCloudAckMs(roomId, serverTs);
        addLog('Restored round prep from your Tempo account (cloud backup).', 'info');
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setPrepCloudHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, hostAccount?.id, addLog]);

  /** Autosave prep to Tempo account (debounced). */
  useEffect(() => {
    if (!roomId || !prepCloudHydrated || !hostAccount?.id || !getHostJwt()) return;

    if (prepPutTimerRef.current) {
      window.clearTimeout(prepPutTimerRef.current);
      prepPutTimerRef.current = null;
    }

    prepPutTimerRef.current = window.setTimeout(() => {
      prepPutTimerRef.current = null;
      void (async () => {
        try {
          const r = await hostFetch(`${API_BASE || ''}/api/host/rooms/${encodeURIComponent(roomId)}/prep`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rounds: eventRounds,
              currentRoundIndex,
            }),
          });
          if (r.ok) {
            const d = (await r.json()) as { updatedAt?: string };
            const ts = d.updatedAt ? Date.parse(d.updatedAt) : NaN;
            if (Number.isFinite(ts)) writePrepCloudAckMs(roomId, ts);
          }
        } catch {
          /* ignore */
        }
      })();
    }, 1000);

    return () => {
      if (prepPutTimerRef.current) {
        window.clearTimeout(prepPutTimerRef.current);
        prepPutTimerRef.current = null;
      }
    };
  }, [eventRounds, currentRoundIndex, roomId, hostAccount?.id, prepCloudHydrated]);

  /** Tracks shown in the host bingo pool list (finalized server order, or pre-finalize 1×75/5×15 preview). */
  const bingoPoolPreview = useMemo(
    () => computeEffectiveBingoPoolPreview(mixPlaylistSelection, songList),
    [mixPlaylistSelection, songList],
  );

  const finalizedPoolSongs: Song[] = useMemo(() => {
    if (mixFinalized) {
      return (finalizedOrder && finalizedOrder.length > 0 ? finalizedOrder : null) || songList;
    }
    if (!songList.length || mixPlaylistSelection.length === 0) {
      const ridx = currentRoundIndex;
      const r = ridx >= 0 && ridx < eventRounds.length ? eventRounds[ridx] : null;
      if (
        r &&
        mixPlaylistSelection.length > 0 &&
        prepRoundPlaylistOrderMatchesMix(r.playlistIds, mixPlaylistSelection) &&
        eventRoundSnapshotMeetsSaveThreshold(r, freeSpaceEnabled) &&
        r.savedMixSnapshot?.songs?.length
      ) {
        return r.savedMixSnapshot.songs;
      }
      return songList;
    }
    return bingoPoolPreview.pool as Song[];
  }, [
    mixFinalized,
    finalizedOrder,
    songList,
    mixPlaylistSelection,
    bingoPoolPreview,
    currentRoundIndex,
    eventRounds,
    freeSpaceEnabled,
  ])

  const bingoPoolUiShowsPreFinalizeSubset =
    !mixFinalized && songList.length > 0 && finalizedPoolSongs.length < songList.length;

  const hasFinalizedSongPool = finalizedPoolSongs.length > 0;
  /** Server said mix is finalized but this UI has no tracks (e.g. client fetches got 429; rare timing). */
  const showFinalizedButEmptyPool = mixFinalized && finalizedPoolSongs.length === 0;

  const currentPrepRoundForFinalizeUi =
    currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length
      ? eventRounds[currentRoundIndex]
      : undefined;
  const prepRoundPlaylistsMatchMix =
    currentPrepRoundForFinalizeUi == null ||
    prepRoundPlaylistOrderMatchesMix(currentPrepRoundForFinalizeUi.playlistIds, mixPlaylistSelection);
  /** Active round has a usable snapshot and the mix still matches that round's playlist bucket — hide manual Finalize. */
  const savedRoundSnapshotMakesFinalizeRedundant =
    currentPrepRoundForFinalizeUi != null &&
    eventRoundSnapshotMeetsSaveThreshold(currentPrepRoundForFinalizeUi, freeSpaceEnabled) &&
    prepRoundPlaylistsMatchMix;

  const showPrimaryFinalizeMixButton =
    !mixFinalized && !savedRoundSnapshotMakesFinalizeRedundant && mixPlaylistSelection.length > 0;
  /** Round builder saved this round — Game tab is go-live only (no mix/finalize/PDF chrome). */
  const gameTabRoundBuilderReady = savedRoundSnapshotMakesFinalizeRedundant;

  const webApiQuarantineBannerText = useMemo(() => {
    if (webApiQuarantine.active !== true) return null;
    const q = webApiQuarantine;
    const rem = q.remainingSec;
    const remPart =
      rem >= 120
        ? `~${Math.ceil(rem / 60)} min`
        : rem >= 60
          ? `${Math.floor(rem / 60)}m ${rem % 60}s`
          : `${rem}s`;
    const cap = q.inProcessMaxCooldownSec ?? 480;
    const parts: string[] = [
      `Spotify is rate limiting the Web API (HTTP 429). You are not expected to “come back in 12 hours”—TEMPO only spaces out requests on this server (at most ~${Math.ceil(cap / 60)} min between back-off windows), and full playlist data is cached briefly after the first load so finalizing a mix does not re-download the same tracks from Spotify.`,
      `You can often still run a show using the library you already loaded, “Add by link” for a playlist, and device playback while Spotify cools off.`,
      `This burst: ${q.sourceDescription || q.source || 'Spotify Web API'}. Current spacing: ~${remPart}.`,
    ];
    if (q.spotifyRetryAfterSec != null && q.spotifyRetryAfterSec > 0) {
      const s = q.spotifyRetryAfterSec;
      const hours = s / 3600;
      const human =
        hours >= 1
          ? `~${hours.toFixed(1)} h (Spotify’s Retry-After — ${s.toLocaleString()}s)`
          : s >= 60
            ? `~${Math.ceil(s / 60)} min (${s}s)`
            : `${s}s`;
      parts.push(
        `Spotify’s Retry-After can look extreme (${human}). TEMPO does not sleep for that long; the host is not “frozen” for 12+ hours. If API calls still fail, check your app in the Spotify Developer Dashboard and avoid hammering Refresh on the library.`
      );
    } else if (q.spotifyRetryCapped) {
      parts.push(
        `Spotify’s suggested wait was longer than TEMPO’s spacing cap; you may still get 429s from Spotify until their throttling eases.`
      );
    }
    return parts.join(' ');
  }, [webApiQuarantine]);

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
              {showYoutubeMusicInConnectionModal ? (
                <p
                  className="host-spotify-guide"
                  style={{ marginTop: 10, fontSize: '0.84rem', color: 'rgba(220,230,240,0.88)' }}
                >
                  <strong style={{ color: '#cfcfcf' }}>YouTube-only show?</strong> You can skip Spotify if every playlist in your mix is from{' '}
                  <strong style={{ color: '#cfcfcf' }}>YouTube Music</strong> (link Google under Music &amp; rounds). Spotify is only required when the mix includes Spotify playlists or catalog packs that need it.
                </p>
              ) : null}
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
      {showYoutubeMusicInConnectionModal ? <HostYoutubeMusicSection roomId={roomId || ''} /> : null}
    </motion.div>
  );

  const playlistRoundBuilderBody = (
              <div
                className="host-playlist-round-modal-root"
                data-mobile-pane={playlistRoundModalPane}
              >
              {!isSpotifyConnected && showYoutubeMusicInConnectionModal ? (
                <p className="host-playlist-round-modal__banner" role="status">
                  YouTube playlists work without Spotify — use <strong>Connection</strong> for the full Spotify grid.
                </p>
              ) : null}
              <div
                className="host-playlist-round-modal__pane-switch"
                role="tablist"
                aria-label="Library or round buckets"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={playlistRoundModalPane === 'library'}
                  className={
                    playlistRoundModalPane === 'library'
                      ? 'host-playlist-round-modal__pane-tab host-playlist-round-modal__pane-tab--active'
                      : 'host-playlist-round-modal__pane-tab'
                  }
                  onClick={() => setPlaylistRoundModalPane('library')}
                >
                  Library
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={playlistRoundModalPane === 'rounds'}
                  className={
                    playlistRoundModalPane === 'rounds'
                      ? 'host-playlist-round-modal__pane-tab host-playlist-round-modal__pane-tab--active'
                      : 'host-playlist-round-modal__pane-tab'
                  }
                  onClick={() => setPlaylistRoundModalPane('rounds')}
                >
                  Rounds
                </button>
              </div>
            <div className="host-music-two-pane">
              <div className="host-music-two-pane__library">
          <motion.div
                    className="playlists-section host-playlist-library-panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                  >
                    <div className="host-playlist-library-toolbar host-playlist-library-toolbar--single">
                      <div
                        className="host-playlist-library-toolbar__sources"
                        role="tablist"
                        aria-label="Playlist source"
                      >
                        {(
                          [
                            ['spotify', 'Spotify', playlistLibrarySourceCounts.spotify],
                            ['youtube', 'YouTube', playlistLibrarySourceCounts.youtube],
                            ['all', 'All', playlistLibrarySourceCounts.all],
                          ] as const
                        ).map(([id, label, count]) => (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={playlistLibrarySource === id}
                            title={`${count} playlists`}
                            className={
                              playlistLibrarySource === id
                                ? 'host-playlist-library-toolbar__tab host-playlist-library-toolbar__tab--active'
                                : 'host-playlist-library-toolbar__tab'
                            }
                            onClick={() => setPlaylistLibrarySource(id)}
                          >
                            {label}
                            <span className="host-playlist-library-toolbar__tab-count" aria-hidden>
                              {count}
                            </span>
                          </button>
                        ))}
                      </div>
                      {playlistLibrarySource !== 'youtube' ? (
                        <div
                          role="group"
                          aria-label="Spotify library scope"
                          className="host-playlist-library-toolbar__scope"
                        >
                          <button
                            type="button"
                            className={!showAllPlaylists ? 'is-active' : ''}
                            title="Curated Game of Tones playlists"
                            onClick={() => {
                              setShowAllPlaylists(false);
                              setPlaylistQuery('');
                            }}
                          >
                            GoT
                          </button>
                          <button
                            type="button"
                            className={showAllPlaylists ? 'is-active' : ''}
                            title="Your full Spotify library"
                            onClick={() => {
                              setShowAllPlaylists(true);
                              setPlaylistQuery('');
                            }}
                          >
                            All
                          </button>
                        </div>
                      ) : null}
                      <input
                        type="search"
                        className="host-playlist-library-toolbar__search"
                        placeholder="Search…"
                        value={playlistQuery}
                        onChange={(e) => setPlaylistQuery(e.target.value)}
                      />
                      <label
                        className="host-playlist-library-toolbar__short-names"
                        title="Hide GoT prefix on playlist names"
                      >
                        <input
                          type="checkbox"
                          checked={stripGoTPrefix}
                          onChange={(e) => setStripGoTPrefix(e.target.checked)}
                        />
                        <span className="host-playlist-library-toolbar__short-names-label">Short</span>
                      </label>
                      {isSpotifyConnected ? (
                        <button
                          type="button"
                          className="btn-secondary host-playlist-library-toolbar__icon-btn"
                          disabled={spotifyPlaylistsRefreshing || playlistByLinkLoading}
                          aria-label={
                            spotifyPlaylistsRefreshing
                              ? 'Syncing Spotify playlists'
                              : 'Refresh Spotify playlists'
                          }
                          title="Refresh from Spotify (uses API quota)"
                          onClick={() => void loadPlaylists({ forceRefresh: true })}
                        >
                          <RotateCcw
                            className={`w-4 h-4${spotifyPlaylistsRefreshing ? ' host-playlist-library-toolbar__spin' : ''}`}
                            aria-hidden
                          />
                        </button>
                      ) : null}
                    </div>
                    {(spotifyError || spotifyListCacheInfo) && (
                      <div className="host-playlist-library-alerts">
                        {spotifyListCacheInfo ? (
                          <p className="host-playlist-library-alerts__cache" role="status">
                            <strong>Saved library copy</strong> — {spotifyListCacheInfo}
                          </p>
                        ) : null}
                        {spotifyError ? (
                          <div className="host-playlist-library-alerts__error" role="alert">
                            <p>{spotifyError}</p>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: '0.82rem' }}
                              onClick={() => {
                                setSpotifyError(null);
                                void loadPlaylists({ forceRefresh: true });
                              }}
                            >
                              Retry
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                    <div className="host-playlist-library-table-zone">
                    <h3 className="host-playlist-library-table-zone__title">Your Spotify playlists</h3>
                        <div className="host-playlist-library-table">
                      <div className="host-playlist-library-table-head">
                      <div className="host-playlist-library-table-head__cols">
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
                              {playlistSort.dir === 'asc' ? '↑' : '↓'}
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
                              {playlistSort.dir === 'asc' ? '↑' : '↓'}
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
                      {libraryTablePlaylists.length > 0 ? (
                        <nav
                          className="host-playlist-library-table-head__pager"
                          aria-label="Playlist pages"
                          title={playlistLibraryPageRangeLabel}
                        >
                          <button
                            type="button"
                            className="host-playlist-library-table-head__pager-btn"
                            disabled={playlistLibraryPageClamped <= 0}
                            aria-label="Previous page"
                            onClick={() => setPlaylistLibraryPage((p) => Math.max(0, p - 1))}
                          >
                            ‹
                          </button>
                          <span className="host-playlist-library-table-head__pager-label">
                            {playlistLibraryPageClamped + 1}/{playlistLibraryPageCount}
                          </span>
                          <button
                            type="button"
                            className="host-playlist-library-table-head__pager-btn"
                            disabled={playlistLibraryPageClamped >= playlistLibraryPageCount - 1}
                            aria-label="Next page"
                            onClick={() =>
                              setPlaylistLibraryPage((p) =>
                                Math.min(playlistLibraryPageCount - 1, p + 1)
                              )
                            }
                          >
                            ›
                          </button>
                        </nav>
                      ) : null}
                      </div>
                      <div className="host-playlist-library-table__rows">
                      {libraryTablePlaylists.length === 0 ? (
                          <div className="host-playlist-library-table__empty">
                            {playlistLibrarySource === 'spotify'
                              ? 'No Spotify playlists in this view — try All playlists, YouTube, or widen search.'
                              : playlistLibrarySource === 'youtube'
                                ? 'No YouTube playlists loaded — connect under Connection, then refresh in More options.'
                                : playlistLibraryEmptyMessage}
                        </div>
                        ) : (
                          paginatedPlaylists.map((p) => {
                          const isSelected = selectedPlaylists.some(sp => sp.id === p.id);
                          const trackCount = Math.max(0, Number(p.tracks) || 0);
                          // Insufficient: < 15 songs (not enough for any mode)
                          const isInsufficient = trackCount < 15;
                          // Acceptable: 15+ songs (good for 5x15 mode) and 75+ songs (good for both modes)
                          const isAcceptable = trackCount >= 15;
                          
                          return (
                            <div
                              key={p.id}
                              className={
                                isAcceptable
                                  ? 'host-playlist-library-row host-playlist-library-row--ok'
                                  : 'host-playlist-library-row'
                              }
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', p.id);
                                e.dataTransfer.effectAllowed = 'copy';
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
                                  {p.youtubeMusic ? (
                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        background: 'rgba(255, 68, 68, 0.18)',
                                        color: '#ffb4b4',
                                        border: '1px solid rgba(255, 68, 68, 0.35)',
                                      }}
                                      title="YouTube Music playlist (items are videos)"
                                    >
                                      YT
                                    </span>
                                  ) : null}
                                  {!p.youtubeMusic &&
                                    !showAllPlaylists &&
                                    stripGoTPrefix &&
                                    (/^got\s*[-�:]*\s*/i.test(p.name) ||
                                      p.name.toLowerCase().includes('game of tones') ||
                                      p.name.toLowerCase().includes('gameoftones')) && (
                                      <span
                                        style={{
                                          fontSize: '0.7rem',
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          background: 'rgba(0, 255, 136, 0.2)',
                                          color: '#00ff88',
                                          border: '1px solid rgba(0, 255, 136, 0.3)',
                                        }}
                                      >
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
                                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                  {!p.youtubeMusic && p.hasExplicitTracks === true && (
                                    <SpotifyExplicitBadge size="sm" title="This playlist includes at least one Spotify explicit track" />
                                  )}
                                  <span>
                                    {trackCount} {p.youtubeMusic ? 'videos' : 'songs'}
                                  </span>
                                </span>
                              </span>
                              <span
                                role="presentation"
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{ flexShrink: 0, alignSelf: 'flex-start', paddingTop: 2 }}
                              >
                                <select
                                  className="host-playlist-add-to-round"
                                  aria-label={`Add playlist to round: ${stripGoTPrefix ? stripGotPlaylistPrefix(p.name) : p.name}`}
                                  value=""
                                  title="Add this playlist to a round bucket (same as dragging into a bucket)"
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v !== '') {
                                      addPlaylistToRoundBucket(Number(v), p.id);
                                      e.target.value = '';
                                    }
                                  }}
                                >
                                  <option value="">Add to round…</option>
                                  {eventRounds.map((r, i) => (
                                    <option key={r.id} value={String(i)}>
                                      {r.name}
                                      {(r.playlistIds?.length ?? 0) > 0
                                        ? ` (${r.playlistIds!.length})`
                                        : ''}
                                    </option>
                                  ))}
                                </select>
                              </span>
                              {isInsufficient && (
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    color: '#ffb347',
                                    whiteSpace: 'nowrap',
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    border: '1px solid rgba(255,179,71,0.35)',
                                    background: 'rgba(255,179,71,0.08)',
                                    flexShrink: 0,
                                    paddingTop: 6,
                                  }}
                                  title={
                                    p.youtubeMusic
                                      ? 'Need at least 15 videos for a standard round'
                                      : 'Need at least 15 tracks for a standard round; add songs in Spotify'
                                  }
                                >
                                  Need 15+
                                </span>
                              )}
                            </div>
                          );
                        })
                        )}
                      </div>
                        </div>
                    </div>
                    <div className="host-playlist-round-modal__tools">
                      <h3 className="host-playlist-round-modal__tools-title">More options</h3>
                      <div className="host-playlist-round-modal__tools-body">
                    <HostYoutubeMusicPlaylistLibrary
                      hostSessionReady={hostAuthBootstrapDone}
                      refreshNonce={ytMusicLibraryRefreshNonce}
                      onMixPlaylistsChange={handleYoutubeMusicMixPlaylistsChange}
                    />
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 12,
                        maxWidth: 720,
                        padding: '12px 14px',
                        borderRadius: 10,
                        border: '1px solid rgba(0,255,136,0.25)',
                        background: 'rgba(0,255,136,0.06)',
                      }}
                    >
                      <span style={{ fontSize: '0.82rem', color: '#c8d8d0', fontWeight: 600 }}>Add by link</span>
                      <input
                        type="text"
                        value={playlistByLinkInput}
                        onChange={(e) => setPlaylistByLinkInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void addPlaylistByLink();
                        }}
                        placeholder="https://open.spotify.com/playlist/… or id"
                        disabled={!isSpotifyConnected || playlistByLinkLoading}
                        style={{
                          flex: '1 1 220px',
                          minWidth: 180,
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.2)',
                          background: 'rgba(0,0,0,0.35)',
                          color: '#fff',
                        }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                        disabled={!isSpotifyConnected || playlistByLinkLoading}
                        onClick={() => void addPlaylistByLink()}
                      >
                        {playlistByLinkLoading ? 'Adding…' : 'Add playlist'}
                      </button>
                    </div>
                    {playlistByLinkError ? (
                      <p style={{ fontSize: '0.82rem', color: '#ff9e6e', margin: '0 0 10px' }}>{playlistByLinkError}</p>
                    ) : null}
                      <div className="host-playlist-round-modal__fine-print">
                        <p className="host-playlist-round-modal__fine-print-title">
                          When does the Mix column show explicit-song badges?
                        </p>
                        <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.45, maxWidth: 640 }}>
                          After Tempo loads tracks for playlists in your mix (selection debounce or Finalize), playlists that contain a Spotify explicit track show{' '}
                          <SpotifyExplicitBadge size="sm" title="At least one explicit track in this playlist" /> next to their counts — without extra Spotify calls.
                        </p>
                      </div>
                      <div className="host-playlist-round-modal__catalog">
                        <h4 className="host-playlist-round-modal__catalog-title">
                          {!catalogPacksProbeDone || !catalogPacksFetchOk
                            ? 'Official packs (catalog)'
                            : catalogPacksConfigured
                              ? catalogPackOptions.length > 0
                                ? `Official packs — ${catalogPackOptions.length} from catalog`
                                : 'Official packs (catalog)'
                              : 'Official packs — server not configured'}
                        </h4>
                        <div
                          style={{
                            marginTop: 10,
                            padding: '12px 14px',
                            borderRadius: 10,
                            border: '1px solid rgba(120, 180, 255, 0.35)',
                            background: 'rgba(60, 120, 200, 0.12)',
                          }}
                        >
                        {!catalogPacksProbeDone ? (
                          <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
                            Contacting server…
                          </p>
                        ) : !catalogPacksFetchOk ? (
                          <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
                            {catalogPacksFetchUnauthorized ? (
                              <>
                                Host session required — sign in with <strong style={{ color: '#c8dcff' }}>Google</strong> as
                                host, then retry <strong style={{ color: '#c8dcff' }}>Refresh</strong> on your library (or reload).
                              </>
                            ) : (
                              <>
                                Couldn&apos;t load Official packs (network or server error). Reload the page or use{' '}
                                <strong style={{ color: '#c8dcff' }}>Retry loading playlists</strong> above if Spotify failed.
                              </>
                            )}
                          </p>
                        ) : !catalogPacksConfigured ? (
                          <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
                            <strong style={{ color: '#c8dcff' }}>Not enabled on this server.</strong> Set{' '}
                            <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_SPOTIFY_REFRESH_TOKEN</code> plus{' '}
                            <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLIST_NAME_PREFIX</code> or{' '}
                            <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLIST_IDS</code> /{' '}
                            <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLISTS_JSON</code> on the API host (e.g.
                            Railway), then redeploy. Your <strong style={{ color: '#c8dcff' }}>GoT picks</strong> list above is
                            only your personal Spotify library — it is not the catalog.
                          </p>
                        ) : (
                          <>
                            <p style={{ margin: '0 0 12px', fontSize: '0.76rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.45 }}>
                              Loaded with Tempo&apos;s allowlisted Spotify account — not your personal library token. Your
                              Spotify is still used for playback. Appended after your own playlist selections.
                            </p>
                            {catalogPackOptions.length > 0 ? (
                              <div className="host-catalog-pack-list">
                                {catalogPackOptions.map((pack) => {
                                  const isSel = selectedCatalogPlaylists.some((p) => p.id === pack.id);
                                  return (
                                    <label
                                      key={pack.id}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        cursor: 'pointer',
                                        fontSize: '0.88rem',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSel}
                                        onChange={() => {
                                          setSelectedCatalogPlaylists((prev) =>
                                            isSel ? prev.filter((p) => p.id !== pack.id) : [...prev, { ...pack, catalog: true }]
                                          );
                                        }}
                                      />
                                      <span style={{ color: '#fff', flex: 1, minWidth: 0 }}>{pack.name}</span>
                                      <span style={{ color: '#8899aa', fontSize: '0.78rem', flexShrink: 0 }}>
                                        {pack.tracks} songs
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : catalogPrefixDiscoverySkipped ? (
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: '0.78rem',
                                  color: 'rgba(255,255,255,0.65)',
                                  lineHeight: 1.5,
                                }}
                              >
                                <strong style={{ color: '#ffc857' }}>Spotify blocked catalog discovery</strong> (rate limit /
                                quarantine on the Web API). Tempo could not list playlists for the{' '}
                                <strong style={{ color: '#c8dcff' }}>catalog</strong> token, so{' '}
                                <strong style={{ color: '#c8dcff' }}>prefix-based packs</strong> won&apos;t appear until Spotify
                                accepts <code style={{ fontSize: '0.72rem' }}>GET /v1/me/playlists</code> again. This is the same
                                quota pressure as the library warning above if host and catalog share one Spotify app.{' '}
                                <strong style={{ color: '#c8dcff' }}>Workarounds:</strong> set{' '}
                                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLIST_IDS</code> or{' '}
                                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLISTS_JSON</code> (no listing call); or use
                                a <strong style={{ color: '#c8dcff' }}>second Spotify Developer app</strong> for catalog (
                                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_SPOTIFY_CLIENT_ID</code>
                                ). Reload Official packs after cooldown.
                              </p>
                            ) : (
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: '0.78rem',
                                  color: 'rgba(255,255,255,0.65)',
                                  lineHeight: 1.5,
                                }}
                              >
                                No catalog packs matched yet. If you use{' '}
                                <strong style={{ color: '#c8dcff' }}>TEMPO_CATALOG_PLAYLIST_NAME_PREFIX</strong>, playlist
                                titles on the <strong style={{ color: '#c8dcff' }}>catalog</strong> Spotify account must{' '}
                                <strong style={{ color: '#c8dcff' }}>start with that exact prefix</strong> (e.g.{' '}
                                <code style={{ fontSize: '0.72rem' }}>GoT Friday Hits</code>, not{' '}
                                <code style={{ fontSize: '0.72rem' }}>Music Bingo - …</code>
                                ). Or set{' '}
                                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLIST_IDS</code> /{' '}
                                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLISTS_JSON</code>. New matches can take
                                up to the prefix cache window unless the server restarts.
                              </p>
                            )}
                          </>
                        )}
                        </div>
                      </div>
                    <div className="host-manager-playlist-export">
                      <p>Export a Spotify playlist from songs used this session (after finalize or play).</p>
                      <button
                        type="button"
                        onClick={createOutputPlaylist}
                        disabled={!songList || songList.length === 0 || isSpotifyConnecting}
                        className="btn-secondary"
                        style={{
                          backgroundColor: '#6b46c1',
                          borderColor: '#8b5cf6',
                          color: 'white',
                          fontSize: '0.85rem',
                          padding: '8px 14px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <ListPlus className="w-4 h-4" aria-hidden />
                        Create output playlist
                      </button>
                    </div>
                      </div>
                    </div>

                  </motion.div>
              </div>
              <div className="host-music-two-pane__rounds">
                <RoundPlanner<EventRound>
                  rounds={eventRounds}
                  onUpdateRounds={handleUpdateRounds}
                  playlists={playlistsForRoundPlanner}
                  currentRound={currentRoundIndex}
                  onStartRound={handleStartRound}
                  onSelectRoundForPrep={handleSelectRoundForPrep}
                  onSyncMixFromRound={syncMixFromRound}
                  onOpenConnection={() => setShowConnectionModal(true)}
                  gameState={gameState}
                  hostDefaultFreeSpace={freeSpaceEnabled}
                  savedCustomPatterns={savedCustomPatterns}
                  onUpdateRoundBingo={handleUpdateRoundBingoFields}
                  onSaveRound={(idx) => void handleSaveRoundAtIndex(idx)}
                  saveRoundBusy={saveRoundBusy}
                  snapshotMeetsSave={(r) => eventRoundSnapshotMeetsSaveThreshold(r, freeSpaceEnabled)}
                  onPrintPdf={(idx) => handleDownloadRoundPrintablePdf(eventRounds[idx])}
                  onCallSheet={(idx) => handleDownloadRoundCallSheetPdf(eventRounds[idx])}
                  onOpenComposite={openCompositeForRound}
                  onNewCustomPattern={handleNewCustomPattern}
                  printablePdfLoading={printablePdfLoading}
                  printableCardCount={printableCardCount}
                  onPrintableCardCountChange={setPrintableCardCount}
                  snippetLength={snippetLength}
                  onSnippetLengthChange={setSnippetLength}
                  randomStarts={randomStarts}
                  onRandomStartsChange={setRandomStarts}
                  initialFocusedIndex={roundBuilderFocusIndex}
                  prepHints={{
                    spotifyNeeded: mixNeedsHostSpotify,
                    spotifyConnected: isSpotifyConnected,
                    deviceNeeded: mixNeedsHostSpotify,
                    deviceSelected: !!selectedDevice,
                  }}
                  statusSummary={getRoundStatusSummary()}
                  onResetEvent={resetEvent}
                  onClearPrepCache={clearRoomRoundPrepStorage}
                  onCompleteCurrentRound={completeCurrentRound}
                  onResetCurrentRound={resetCurrentRound}
                  onStartNextPlanned={() => {
                    const next = getNextPlannedRound();
                    if (next >= 0) jumpToRound(next);
                  }}
                  hasNextPlanned={getNextPlannedRound() >= 0}
                />
              </div>
            </div>
            </div>
  );

  return (
    <div className="host-view">
      {!hideYoutubeCornerPlayer ? (
        <HostYoutubeIframePlayer
          videoId={youtubeHostPlayback?.videoId ?? null}
          startSeconds={(youtubeHostPlayback?.startMs ?? 0) / 1000}
          snippetSeconds={youtubeHostPlayback?.snippetSeconds ?? snippetLength}
          volume={playbackState.volume}
        />
      ) : null}
      <HostAcknowledgeModal
        open={hostAckNotification != null}
        title={hostAckNotification?.title ?? ''}
        message={hostAckNotification?.message ?? ''}
        variant={hostAckNotification?.variant ?? 'warning'}
        acknowledgeLabel="OK"
        onAcknowledge={() => setHostAckNotification(null)}
      />
      <HostAcknowledgeModal
        open={fiveByFifteenInsufficientModal != null}
        title={
          fiveByFifteenInsufficientModal?.variant === 'blocked'
            ? 'Cannot finalize as 5×15'
            : '5×15 mode unavailable'
        }
        message={
          fiveByFifteenInsufficientModal?.variant === 'blocked'
            ? 'Each of the five playlists must contribute 15 unique tracks after removing duplicate songs across all five columns (same rule as the live game). Adjust your playlists and try Finalize mix again.'
            : 'The mix was finalized, but this room could not enter true 5×15 column mode. Cards and playback are using a fallback layout instead of five fixed B–O columns. Fix the issues below and finalize again before starting if you need strict 5×15.'
        }
        variant={fiveByFifteenInsufficientModal?.variant === 'blocked' ? 'error' : 'warning'}
        detailBullets={fiveByFifteenInsufficientModal?.warnings}
        acknowledgeLabel="OK"
        onAcknowledge={() => setFiveByFifteenInsufficientModal(null)}
      />
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
            Game Host 1
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

        {isSpotifyConnected && webApiQuarantine.active && webApiQuarantineBannerText ? (
          <div
            role="status"
            aria-live="polite"
            className="host-spotify-quarantine-banner"
            style={{
              margin: '0 0 0',
              padding: '12px 18px',
              borderRadius: 10,
              background: 'rgba(255, 193, 7, 0.1)',
              border: '1px solid rgba(255, 193, 7, 0.42)',
              color: 'rgba(255, 240, 210, 0.98)',
              fontSize: '0.88rem',
              lineHeight: 1.55,
            }}
          >
            <strong style={{ color: '#ffc14a', display: 'block', marginBottom: 6 }}>Spotify is rate limiting</strong>
            {webApiQuarantineBannerText}
          </div>
        ) : null}

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
                <div className="host-manager-setup-flow">
                <div className="host-manager-grid host-manager-grid--split host-manager-grid--balanced">
                  <div className="host-manager-col">
                <motion.section
                  className="host-manager-hero host-manager-hero--compact host-manager-section"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  <div className="host-manager-hero__row">
                    <div className="host-manager-hero__main">
                      <h2 className="host-manager-hero__title">
                        <ListMusic className="w-5 h-5" style={{ color: '#00ff88' }} aria-hidden />
                        Rounds &amp; playlists
                      </h2>
                      <p className="host-manager-section__lead host-manager-hero__lead">
                        <strong style={{ color: '#c5dccf' }}>Round builder</strong> for setlists and patterns, then{' '}
                        <strong style={{ color: '#c5dccf' }}>Game</strong> to finalize and start. Spotify / device:{' '}
                        <strong style={{ color: '#c5dccf' }}>Connection</strong> in the header.
                      </p>
                      <div className="host-manager-hero__status">
                        <span className={`host-manager-hero__chip${isSpotifyConnected ? ' host-manager-hero__chip--ok' : ''}`}>
                          Spotify {isSpotifyConnected ? 'connected' : 'not connected'}
                        </span>
                        {showYoutubeMusicInConnectionModal ? (
                          <span className="host-manager-hero__chip">YouTube Music</span>
                        ) : null}
                        {currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length ? (
                          <span className="host-manager-hero__chip host-manager-hero__chip--active">
                            Prep: {eventRounds[currentRoundIndex].name}
                          </span>
                        ) : null}
                        {(isSpotifyConnected || showYoutubeMusicInConnectionModal) && (
                          <span className="host-manager-hero__chip">
                            {selectedPlaylists.length} in mix · {eventRounds.length} rounds · {playlists.length}{' '}
                            library
                          </span>
                        )}
                      </div>
                      {!(isSpotifyConnected || showYoutubeMusicInConnectionModal) ? (
                        <p className="host-manager-hero__warn">
                          Connect Spotify or YouTube in the header before Round builder.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn-primary host-manager-hero__cta"
                      onClick={() => openRoundBuilder()}
                    >
                      <ListMusic className="w-5 h-5" aria-hidden />
                      Open Round builder
                    </button>
                  </div>
                </motion.section>

          <motion.section
            className="host-manager-round host-manager-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
          >
            <h2 className="host-manager-section__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CalendarRange className="w-5 h-5" style={{ color: '#00ff88' }} aria-hidden />
              Event rules
            </h2>
            <label className="host-manager-hybrid">
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
              />
              <span>
                <strong style={{ color: '#00ff88' }}>Hybrid in-person + online</strong> — remote players can play, but only
                an in-person bingo ends the round and awards prizes.
              </span>
            </label>
            {gameState === 'playing' ? (
              <div className="host-manager-round__row" style={{ marginTop: 14 }}>
                <button type="button" onClick={completeCurrentRound} className="host-manager-round__btn host-manager-round__btn--green">
                  <CheckCircle2 className="w-4 h-4" aria-hidden />
                  Complete round
                </button>
                <button type="button" onClick={resetCurrentRound} className="host-manager-round__btn host-manager-round__btn--yellow">
                  <RotateCcw className="w-4 h-4" aria-hidden />
                  Reset round
                </button>
                {getNextPlannedRound() >= 0 ? (
                  <button type="button" onClick={() => jumpToRound(getNextPlannedRound())} className="host-manager-round__btn host-manager-round__btn--blue">
                    <SkipForward className="w-4 h-4" aria-hidden />
                    Next planned
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="host-manager-section__lead" style={{ marginTop: 12, marginBottom: 0 }}>
                Save, print, reset event, and clear prep cache: use <strong>Event actions</strong> inside Round builder.
              </p>
            )}
          </motion.section>

          <motion.section
            className="host-manager-section host-manager-section--display host-manager-display-pane font-size-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            aria-labelledby="host-manager-display-title"
          >
            <h2
              id="host-manager-display-title"
              className="host-manager-section__title"
              style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' }}
            >
              <Monitor className="w-5 h-5" style={{ color: '#00ff88' }} aria-hidden />
              Public display
            </h2>
            <p className="host-manager-section__lead">
              Projector / TV — text size and which screen to show.
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
          </motion.section>
                  </div>

                  <div className="host-manager-col">
          <motion.section
            className="host-manager-section host-manager-section--display host-manager-display-pane host-manager-display-pane--continued font-size-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            aria-labelledby="host-manager-display-title"
          >
            <p className="host-manager-section__lead host-manager-display-pane__continued-lead">
              Titles, timing, and host playback window.
            </p>
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
            <div className="host-manager-display__divider" style={{ marginTop: 14 }} />
            <p className="host-manager-display__sub">Reveal titles on projector</p>
            <p style={{ fontSize: '0.78rem', color: '#9a9a9a', marginBottom: 10, lineHeight: 1.4, maxWidth: 520 }}>
              Controls how song titles and artists appear on the public display call list (masked squares vs full text).
            </p>
            <select
              id="title-reveal-mode"
              aria-label="When to reveal full song titles on the public display"
              value={publicDisplayTitleRevealMode}
              onChange={(e) =>
                updatePublicDisplayTitleRevealMode(normalizePublicDisplayTitleRevealMode(e.target.value))
              }
              style={{
                fontSize: '0.92rem',
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(0,0,0,0.35)',
                color: '#fff',
                minWidth: 280,
                maxWidth: '100%',
                cursor: 'pointer',
                marginBottom: 12,
              }}
            >
              <option value="letter">By letter (timed reveals)</option>
              <option value="track_start">Beginning of track (full title)</option>
              <option value="track_end">End of track (full title)</option>
            </select>
            <div className="host-manager-display__divider" style={{ marginTop: 4 }} />
            <p className="host-manager-display__sub">Letter reveal timer</p>
            <p style={{ fontSize: '0.78rem', color: '#9a9a9a', marginBottom: 10, lineHeight: 1.4, maxWidth: 520 }}>
              {publicDisplayTitleRevealMode === 'letter' ? (
                <>
                  While the round is playing, the projector periodically reveals one random letter from played titles and
                  artists. Pick how often that happens (does not run during bingo verification).
                </>
              ) : (
                <>
                  Timed letter reveals are off while using beginning-of-track or end-of-track mode. Use{' '}
                  <strong style={{ color: '#c8c8c8' }}>By letter</strong> to bring back periodic reveals.
                </>
              )}
            </p>
            <select
              id="letter-reveal-interval"
              aria-label="Seconds between automatic letter reveals on the public display"
              value={letterRevealIntervalSec}
              onChange={(e) => updatePublicDisplayLetterRevealInterval(Number(e.target.value))}
              disabled={publicDisplayTitleRevealMode !== 'letter'}
              style={{
                fontSize: '0.92rem',
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(0,0,0,0.35)',
                color: '#fff',
                minWidth: 160,
                cursor: publicDisplayTitleRevealMode === 'letter' ? 'pointer' : 'not-allowed',
                opacity: publicDisplayTitleRevealMode === 'letter' ? 1 : 0.45,
              }}
            >
              {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((sec) => (
                <option key={sec} value={sec}>
                  {sec} seconds
                </option>
              ))}
            </select>
            {showYoutubeMusicInConnectionModal ? (
              <>
                <div className="host-manager-display__divider" style={{ marginTop: 14 }} />
                <p className="host-manager-display__sub">YouTube playback window</p>
                <p style={{ fontSize: '0.78rem', color: '#9a9a9a', marginBottom: 10, lineHeight: 1.4, maxWidth: 520 }}>
                  Separate window for clip audio so you can keep the projector tab focused. Allow popups for this site.
                  The corner mini-player is hidden while this window stays open.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={openYoutubeHostPlaybackWindow}
                  style={{
                    fontSize: '0.9rem',
                    padding: '10px 16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AppWindow className="w-4 h-4" aria-hidden />
                  Open YouTube playback window
                </button>
                {hideYoutubeCornerPlayer ? (
                  <p style={{ marginTop: 10, fontSize: '0.78rem', color: '#6fdfae', lineHeight: 1.4 }}>
                    Dedicated playback window is active — the corner mini-player is off so only one copy plays. Close that
                    window or tab to use the corner player again.
                  </p>
                ) : null}
              </>
            ) : null}
          </motion.section>
                  </div>
                </div>
                </div>
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

            {gameState === 'waiting' && !currentSong && eventRounds.length > 0 ? (
                <div className="host-game-prep-bar">
                  <div>
                    <p className="host-game-prep-bar__label">Active prep round</p>
                    <p className="host-game-prep-bar__value">
                      {currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length
                        ? eventRounds[currentRoundIndex].name
                        : 'Pick a round in Round builder'}
                    </p>
                  </div>
                  <button type="button" className="btn-secondary" onClick={() => openRoundBuilder()}>
                    <ListMusic className="w-4 h-4" aria-hidden />
                    Round builder
                  </button>
                </div>
              ) : null}

                  <div className="host-game-settings-panel">
                    {!gameTabRoundBuilderReady ? (
                      <div className="host-game-playback-note">
                        <p>
                          <strong>Playback:</strong> {snippetLength}s snippets ·{' '}
                          {randomStarts === 'none'
                            ? 'from start'
                            : randomStarts === 'early'
                              ? 'early random'
                              : 'random position'}
                        </p>
                        <p>
                          Change per round in{' '}
                          <button type="button" className="host-inline-link" onClick={() => openRoundBuilder()}>
                            Round builder
                          </button>
                          .
                        </p>
                      </div>
                    ) : null}
            </div>

                  {/* Main Game Controls */}
             <div className="control-buttons">
               {gameState === 'waiting' && !currentSong ? (
                 <>
                   {showPrimaryFinalizeMixButton ? (
                     <button
                       className="control-button finalize-mix"
                       onClick={() => void finalizeMix()}
                       disabled={mixGameActionsBlocked}
                     >
                       <ListChecks className="w-4 h-4" aria-hidden />
                       Finalize Mix
                     </button>
                   ) : null}
                   {mixFinalized && !gameTabRoundBuilderReady ? (
                     <div className="mix-finalized-status">
                       <p className="status-text" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                         <CheckCircle2 className="w-4 h-4" style={{ color: '#00ff88' }} aria-hidden />
                         Mix finalized — cards generated for players
                       </p>
                     </div>
                   ) : null}
                  <button
                    onClick={startGame}
                    disabled={mixGameActionsBlocked}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '14px 22px',
                      fontSize: '1.05rem',
                      fontWeight: 900,
                      letterSpacing: '0.02em',
                      borderRadius: 12,
                      border: mixGameActionsBlocked ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,255,136,0.6)',
                      color: mixGameActionsBlocked ? '#c8c8c8' : '#0b0e12',
                      background: mixGameActionsBlocked
                        ? 'rgba(255,255,255,0.08)'
                        : 'linear-gradient(180deg, #00ff88 0%, #00cc6d 100%)',
                      boxShadow: mixGameActionsBlocked
                        ? 'none'
                        : '0 10px 30px rgba(0,255,136,0.25), inset 0 1px 0 rgba(255,255,255,0.4)',
                      cursor: mixGameActionsBlocked ? 'not-allowed' : 'pointer',
                      opacity: isSpotifyConnecting && mixNeedsHostSpotify ? 0.8 : 1
                    }}
                  >
                    <Play className="btn-icon" />
                    {savedRoundRoomSyncBusy
                      ? 'Syncing room…'
                      : isSpotifyConnecting && mixNeedsHostSpotify
                        ? 'Connecting Spotify...'
                        : 'Start Game'}
                  </button>
                  {!gameTabRoundBuilderReady ? (
                    <p style={{ marginTop: 10, fontSize: '0.78rem', color: '#9a9a9a', maxWidth: 520, lineHeight: 1.4, marginLeft: 'auto', marginRight: 'auto' }}>
                      Start Game will <strong style={{ color: '#cfcfcf' }}>finalize the mix automatically</strong> if needed.
                      Use Finalize Mix first only for an early card preview on the display.
                    </p>
                  ) : null}
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
                            onClick={() => openRoundBuilder()}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                          >
                            <CalendarRange className="w-4 h-4" aria-hidden />
                            Round builder
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

                {gameState === 'waiting' && !currentSong && !hasFinalizedSongPool && !gameTabRoundBuilderReady && (
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
                      {mixPlaylistSelection.length === 0
                        ? 'Open Round builder to add playlists to a round. Connect Spotify and/or YouTube Music in Connection if needed.'
                        : 'Tap Finalize Mix or Start Game to build the bingo song pool from your selected playlists.'}
                    </p>
                  </div>
                )}

                {showFinalizedButEmptyPool && (
                  <div
                    className="finalized-playlist-section finalized-playlist-section--error"
                    style={{
                      marginTop: 20,
                      padding: '16px 18px',
                      borderRadius: 12,
                      background: 'rgba(255, 120, 80, 0.08)',
                      border: '1px solid rgba(255, 140, 100, 0.45)',
                      color: 'rgba(255, 240, 230, 0.95)',
                      fontSize: '0.9rem',
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: '#ffb090', display: 'block', marginBottom: 8 }}>
                      Mix finalized, but no track list in this view
                    </strong>
                    Spotify may have rate limited playlist fetches (429) while the server still built cards. Try Refresh on the music library, wait a few minutes, or reload this page. The rate limit is from Spotify’s Web API, not a multi-hour wait imposed by TEMPO.
                  </div>
                )}

                {/* Bingo pool — title edits; hidden on Game tab when round is saved in Round builder until live or legacy prep */}
                {hasFinalizedSongPool && (!gameTabRoundBuilderReady || mixFinalized || gameState === 'playing') && (
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
                      {mixFinalized
                        ? `Finalized Playlist (${finalizedPoolSongs.length} songs)`
                        : `Bingo pool (${finalizedPoolSongs.length} songs)`}
                    </h3>
                    <p style={{
                      color: 'rgba(255,255,255,0.7)',
                      fontSize: '0.9rem',
                      marginBottom: '16px',
                      lineHeight: '1.4'
                    }}>
                      {mixFinalized ? (
                        <>These are the songs that will be used in your bingo game.</>
                      ) : (
                        <>
                          Preview of the tracks that match your bingo layout (same trimming and dedupe rules as the server). Finalizing locks this order for playback and cards.
                        </>
                      )}{' '}
                      You can edit titles to make them more recognizable for players.
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
                    {bingoPoolUiShowsPreFinalizeSubset && (
                      <p
                        style={{
                          color: 'rgba(255,200,120,0.95)',
                          fontSize: '0.85rem',
                          marginBottom: '16px',
                          lineHeight: '1.4',
                        }}
                      >
                        {songList.length - finalizedPoolSongs.length} more song
                        {songList.length - finalizedPoolSongs.length === 1 ? '' : 's'} loaded from
                        playlists won&apos;t appear on cards with this layout—they&apos;re hidden here so the list matches what bingo uses.
                      </p>
                    )}

                    <div style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      background: 'rgba(0,0,0,0.2)'
                    }}>
                      {finalizedPoolSongs.map((song: any, index: number) => {
                        const ytf = youtubeTrackDisplayFields(song);
                        const displayTitle = getDisplaySongTitle(song.id, ytf.title);
                        const validation = validateSongTitleSync(displayTitle, ytf.title);
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
                              borderBottom: index < finalizedPoolSongs.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
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
                                by {ytf.artist}
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
              <h2 id="host-connection-modal-title">
                {showYoutubeMusicInConnectionModal ? 'Playback & connections' : 'Spotify & device'}
              </h2>
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
      {showPlaylistRoundModal && (
        <div
          className="host-connection-modal-backdrop"
          onClick={() => setShowPlaylistRoundModal(false)}
          role="presentation"
        >
          <div
            className="host-connection-modal host-connection-modal--round-hub"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-round-hub-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="host-connection-modal__header host-connection-modal__header--round-hub">
              <div className="host-playlist-round-modal__title-block">
                <h2 id="host-round-hub-modal-title">
                  <ListMusic className="w-5 h-5" style={{ color: '#00ff88' }} aria-hidden />
                  Round builder
                </h2>
                <button
                  type="button"
                  className="host-playlist-round-modal__help"
                  aria-label="How the round builder works"
                  title="Library left, round buckets right. Numbered buttons switch rounds and sync the Game tab mix (blue Mix outline). Each bucket: playlists, pattern, Save round, print/call sheet, start. Then Game tab → Start Game (Save round locks tracks; no separate finalize)."
                >
                  <HelpCircle className="w-4 h-4" aria-hidden />
                </button>
              </div>
              <button
                type="button"
                className="host-connection-modal__close"
                aria-label="Close"
                onClick={() => setShowPlaylistRoundModal(false)}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="host-connection-modal__body host-connection-modal__body--round-hub">
              {playlistRoundBuilderBody}
            </div>
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
              {bingoVerificationBehindCount > 0 ? (
                <p
                  style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(245, 208, 97, 0.12)',
                    border: '1px solid rgba(245, 208, 97, 0.45)',
                    color: '#f5d061',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                  }}
                >
                  + {bingoVerificationBehindCount} more bingo call
                  {bingoVerificationBehindCount === 1 ? '' : 's'} queued — resolve this one first (first-in, first-out).
                </p>
              ) : null}
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

                    const verCellVis = youtubeBingoSquareDisplay({
                      customSongName: square.customSongName,
                      songName: square.songName,
                      artistName: square.artistName,
                      youtubeMusic: square.youtubeMusic === true,
                      youtubeRawTitle: square.youtubeRawTitle,
                      catalogDisplayVerified: square.catalogDisplayVerified === true,
                      isFreeSpace: isBingoFreeSpaceSquare(square),
                    });
                    const verCellTitle = `${verCellVis.title}${verCellVis.artist ? ` — ${verCellVis.artist}` : ''}`;
                    
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
                        title={`${verCellTitle}\nMarked: ${isMarked ? 'YES' : 'NO'}\nPlayed: ${wasPlayed ? 'YES' : 'NO'}\n${isInWinningPattern ? 'IN WINNING PATTERN' : 'NOT in pattern'}\n${isInvalid ? 'Invalid mark' : isMarked && wasPlayed ? 'Valid mark' : isMarked ? 'Marked (not played yet)' : 'Not marked'}`}
                      >
                        {icon === 'bad' && <X size={12} aria-hidden style={{ marginBottom: 2 }} />}
                        {icon === 'good' && <Check size={12} aria-hidden style={{ marginBottom: 2, color: '#00ff88' }} />}
                        {icon === 'pending' && <span style={{ fontSize: '0.75rem', marginBottom: 2 }} aria-hidden>○</span>}
                        {icon === 'warn' && <span style={{ fontSize: '0.75rem', marginBottom: 2 }} aria-hidden>!</span>}
                        <span style={{ fontSize: '0.6rem', lineHeight: 1.1 }}>
                          {verCellVis.title.substring(0, 8)}
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

                  const listVis = youtubeBingoSquareDisplay({
                    customSongName: square.customSongName,
                    songName: square.songName,
                    artistName: square.artistName,
                    youtubeMusic: square.youtubeMusic === true,
                    youtubeRawTitle: square.youtubeRawTitle,
                    catalogDisplayVerified: square.catalogDisplayVerified === true,
                    isFreeSpace: isBingoFreeSpaceSquare(square),
                  });
                  
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
                          {listVis.title}
                        </div>
                        <div style={{ color: '#ccc', fontSize: '0.85rem' }}>
                          {listVis.artist}
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

      <CombinedPatternModal
        isOpen={combinedPatternModalOpen}
        onClose={() => setCombinedPatternModalOpen(false)}
        patternComposite={patternComposite}
        commitPatternComposite={commitPatternComposite}
        editingMaskClauseIndex={editingMaskClauseIndex}
        setEditingMaskClauseIndex={setEditingMaskClauseIndex}
        compositePaintDraft={compositePaintDraft}
        setCompositePaintDraft={setCompositePaintDraft}
        compositeRecipePickId={compositeRecipePickId}
        setCompositeRecipePickId={setCompositeRecipePickId}
        compositeRecipeSaveName={compositeRecipeSaveName}
        setCompositeRecipeSaveName={setCompositeRecipeSaveName}
        savedCompositePatterns={savedCompositePatterns}
        setSavedCompositePatterns={setSavedCompositePatterns}
        savedCustomPatterns={savedCustomPatterns}
        showToast={showToast}
        addLog={addLog}
      />

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



