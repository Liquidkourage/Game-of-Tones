import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Play,
  Pause,
  SkipForward,
  Music,
  Trophy,
  Plus,
  X,
  Gamepad2,
  Link2,
  Monitor,
  BookOpen,
  Image as ImageIcon,
  ListMusic,
  ListPlus,
  ListChecks,
  CalendarRange,
  RotateCcw,
  Trash2,
  Volume2,
  VolumeX,
  Users,
  Globe,
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
  Settings,
  Copy,
  ExternalLink,
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
import SongAliasModal from './SongAliasModal';
import {
  displayTitleForSong,
  displayArtistForSong,
  patchSquaresWithAlias,
  patchSquaresClearAlias,
  type SongAliases,
} from '../utils/songAliasDisplay';
import HostAcknowledgeModal, { type HostAckVariant } from './HostAcknowledgeModal';
import BingoPoolList from './BingoPoolList';
import {
  DEFAULT_PLAYLIST_TITLE_FLAGS,
  loadHostPreferences,
  saveHostPreferences,
  sanitizeHostPreferences,
  type HostPreferencesV1,
} from '../utils/hostPreferences';
import { isSpotifyJamDevice, pickPreferredPlaybackDevice } from '../utils/spotifyDevices';
import { HostYoutubeMusicSection } from './HostYoutubeMusicSection';
import { HostYoutubeMusicPlaylistLibrary, type YoutubeMixPlaylistRow } from './HostYoutubeMusicPlaylistLibrary';
import { HostYoutubeIframePlayer, primeYoutubeHostPlaybackAudioUnlock } from './HostYoutubeIframePlayer';
import RoundPlanner from './RoundPlanner';
import { SpotifyExplicitBadge } from './SpotifyExplicitBadge';
import { cleanSongTitle } from '../utils/songTitleCleaner';
import { youtubeTrackDisplayFields, youtubeBingoSquareDisplay } from '../utils/youtubeTrackDisplay';
import {
  buildCombinedPreShowPdfBlob,
  buildPrintableBingoPdfBlob,
  type PrintableCard,
  type PrintablePdfSection,
} from '../utils/printableBingoPdf';
import { roundPatternLabelForPrint, roundPrintablePdfSubtitle, printablePlaylistLabelsFromNames } from '../utils/roundPrintLabels';
import { buildRoundCallSheetPdfBlob } from '../utils/printRoundCallSheetPdf';
import {
  normalizePublicDisplayTitleRevealMode,
  type PublicDisplayTitleRevealMode,
} from '../utils/publicDisplayTitleReveal';
import {
  canonicalPlaylistIdForMatch,
  computeEffectiveBingoPoolPreview,
  effectiveBingoPoolSongsForMix,
} from '../utils/effectiveBingoPoolPreview';
import { getYoutubeHostPlaybackChannelName } from '../utils/youtubeHostPlaybackChannel';
import { sortRoundPlaylistsByBingoColumns } from '../utils/roundPlaylistOrder';
import { validateSongTitle, validateSongTitleSync, getValidationMessage, getValidationColor } from '../utils/songTitleValidator';
import './HostView.css';
import './HostGlassTheme.css';
import HostGameDashboard from './HostGameDashboard';
import HostPlaylistAvailabilityWarnings, {
  buildPlaylistAvailabilityIssues,
} from './HostPlaylistAvailabilityWarnings';
import type { HostGlassNavId } from '../host/hostGlassNav';
import { HOST_GLASS_NAV_ITEMS, parseHostGlassNavTab } from '../host/hostGlassNav';
import { appendHostActivity, type HostActivityEntry } from '../host/hostActivityLog';
import {
  clearActiveHostRoom,
  hostRoomExpectsLiveRecovery,
  mergeHostGameStateFromRoomPayload,
  persistActiveHostRoomFromPayload,
  roomPayloadIndicatesLiveRound,
  shouldClearHostAwaitingLiveSync,
  writeActiveHostRoom,
} from '../utils/hostRoomRecovery';
import { acquireHostRoomSocket, scheduleReleaseHostRoomSocket } from '../utils/hostRoomSocket';
import HostPlayersPanel from './host/HostPlayersPanel';
import HostSettingsPanel from './host/HostSettingsPanel';
import HostPreShowChecklist, { type PreShowCheckItem } from './host/HostPreShowChecklist';
import HostRoundTimeline from './host/HostRoundTimeline';
import HostPoolQualityReport from './host/HostPoolQualityReport';
import HostGameLivePanel from './host/HostGameLivePanel';
import HostDisplayExtrasPanel from './host/HostDisplayExtrasPanel';
import type { HostSetupStep } from './host/HostSetupFlow';
import HostSetupCockpit from './host/HostSetupCockpit';
import HostSetupPlaylistStep from './host/HostSetupPlaylistStep';
import HostSetupPlayStep from './host/HostSetupPlayStep';
import HostPlaylistRoundAssignMenu from './host/HostPlaylistRoundAssignMenu';
import HostSelectedRoundPanel from './host/HostSelectedRoundPanel';
import HostRoundsTabWorkspace from './host/HostRoundsTabWorkspace';
import HostTutorial from './host/HostTutorial';
import { HOST_TUTORIAL_STEPS } from '../host/hostTutorialSteps';
import {
  isHostTutorialCompleted,
  isHostTutorialSuggestionDismissed,
  resetHostTutorialProgress,
  setHostTutorialCompleted,
  setHostTutorialSuggestionDismissed,
} from '../host/hostTutorialStorage';
import './host/HostSetupFlow.css';
import './host/HostSetupCockpit.css';
import './host/HostPlaylistLibrary.css';
import './host/HostRoundsTabWorkspace.css';
import './host/HostTutorial.css';
import './HostFormControls.css';

const MAX_CUSTOM_PATTERN_NAME_EMIT = 80;
const SPOTIFY_SKIP_AUTO_CONNECT_KEY = 'spotify_skip_auto_connect';

function positionsKeyForMatch(arr: readonly string[]): string {
  return [...arr].sort().join(',');
}

/** Map server playback / finalized-order / mix-finalized rows to host `Song` list. */
function songsFromServerPlaybackPayload(order: unknown): Song[] {
  if (!Array.isArray(order)) return [];
  return order
    .map((o: any) => {
      const id = o?.id;
      if (id == null || String(id).trim() === '') return null;
      return {
        id: String(id),
        name: typeof o?.name === 'string' ? o.name : '',
        artist: typeof o?.artist === 'string' ? o.artist : '',
        explicit: o?.explicit === true,
        youtubeMusic: o?.youtubeMusic === true,
        sourcePlaylistId: o?.sourcePlaylistId != null ? String(o.sourcePlaylistId) : undefined,
        sourcePlaylistName: typeof o?.sourcePlaylistName === 'string' ? o.sourcePlaylistName : undefined,
      } as Song;
    })
    .filter((s): s is Song => s != null);
}

/** Match projector/player sync payloads so host refresh shows aliased titles immediately. */
function displayTitleFromSyncedSong(song: {
  name?: string;
  customSongName?: string | null;
} | null | undefined): string {
  if (!song) return '';
  const custom = song.customSongName;
  if (custom != null && String(custom).trim() !== '') return String(custom);
  return cleanSongTitle(String(song.name || ''));
}

function displayArtistFromSyncedSong(song: {
  artist?: string;
  customArtistName?: string | null;
} | null | undefined): string {
  if (!song) return '';
  const custom = song.customArtistName;
  if (custom != null && String(custom).trim() !== '') return String(custom);
  return typeof song.artist === 'string' ? song.artist : '';
}

function normalizeSyncedSongForHost(song: any): Song | null {
  if (!song || typeof song !== 'object') return null;
  const id = song.id != null ? String(song.id).trim() : '';
  if (!id) return null;
  return {
    id,
    name: displayTitleFromSyncedSong(song),
    artist: displayArtistFromSyncedSong(song),
    explicit: song.explicit === true,
    youtubeMusic: song.youtubeMusic === true,
    sourcePlaylistId: song.sourcePlaylistId != null ? String(song.sourcePlaylistId) : undefined,
    sourcePlaylistName: typeof song.sourcePlaylistName === 'string' ? song.sourcePlaylistName : undefined,
  };
}

function normalizeRoomGameStateForHost(gameState: unknown): 'waiting' | 'playing' | 'ended' {
  if (gameState === 'ended') return 'ended';
  if (gameState === 'playing' || gameState === 'paused_for_verification' || gameState === 'paused') {
    return 'playing';
  }
  return 'waiting';
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
  /** Unique tracks loaded this session (may be less than Spotify list total until fetched). */
  tracksLoaded?: number;
  /** Rows dropped while loading — deleted/null on Spotify. */
  tracksRemoved?: number;
  /** Rows dropped — Spotify marked not playable in host market. */
  tracksUnplayable?: number;
  unplayableSamples?: Array<{ reason: string; name?: string; artist?: string }>;
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

const MAX_EVENT_ROUNDS = 12;

function ensureEventRoundNames(rounds: EventRound[]): EventRound[] {
  return rounds.map((round, index) => ({ ...round, name: `Round ${index + 1}` }));
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
  /** Playlist ids at save time — live pool UI ignores snapshot when this differs from the bucket. */
  playlistIdsAtSave?: string[];
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

/** Stagger host playlist-tracks calls — multi-playlist mixes were bursting Spotify after OAuth reconnect. */
function delayMsBetweenPlaylistTrackFetches(index: number, total: number): number {
  if (index <= 0) return 0;
  const base = total >= 4 ? 950 : total >= 2 ? 750 : 550;
  const step = total >= 4 ? 320 : 220;
  return Math.min(4000, base + index * step);
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

function roundPlaylistIdsKey(ids: string[] | undefined): string {
  return (ids || [])
    .map((id) => canonicalPlaylistIdForMatch(String(id)))
    .filter(Boolean)
    .sort()
    .join(',');
}

function roundSnapshotMatchesCurrentPlaylists(round: EventRound): boolean {
  const snap = round.savedMixSnapshot;
  if (!snap?.songs?.length) return false;
  const atSave = snap.playlistIdsAtSave ?? [];
  if (atSave.length === 0) return false;
  return roundPlaylistIdsKey(atSave) === roundPlaylistIdsKey(round.playlistIds);
}

/** Playlist column order frozen at Save round — required for 5×15 printable card geometry. */
function playlistIdsForRoundExport(round: EventRound): string[] {
  const atSave = round.savedMixSnapshot?.playlistIdsAtSave;
  if (atSave?.length) return [...atSave];
  return [...(round.playlistIds || [])];
}

/** Stem playlist labels for printable PDF headers (5×15 columns or 1×75 title). */
function playlistStemPrintLabelsForRound(
  round: EventRound,
): { columnLabels?: string[]; singlePlaylistTitle?: string } {
  const ids = playlistIdsForRoundExport(round);
  const names = ids.map((id) => {
    const i = round.playlistIds.indexOf(id);
    return i >= 0 ? round.playlistNames[i] || '' : '';
  });
  return printablePlaylistLabelsFromNames(names);
}

/** Saved mix is tied to a specific playlist set — clear when buckets change after Save. */
function clearSnapshotIfPlaylistsChanged(next: EventRound, prev?: EventRound): EventRound {
  if (!prev?.savedMixSnapshot?.songs?.length) return next;
  if (roundPlaylistIdsKey(next.playlistIds) === roundPlaylistIdsKey(prev.playlistIds)) return next;
  const { savedMixSnapshot: _removed, ...rest } = next;
  return rest as EventRound;
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
  isJam?: boolean;
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

/** Row-major 5×5 order for host grids — must match player card CSS grid (position `row-col`). */
function bingoSquaresInGridOrder<T extends { position?: string }>(
  squares: T[] | undefined | null,
): T[] {
  const list = squares ?? [];
  const out: T[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const pos = `${row}-${col}`;
      const sq = list.find((s) => s.position === pos);
      out.push((sq ?? ({ position: pos } as T)));
    }
  }
  return out;
}

/** Stable fingerprint for host player-card payloads so we detect mark changes, not only played-song count. */
function hostPlayerCardSnapshot(cardData: {
  card?: { squares?: Array<{ position?: string; marked?: boolean }> };
  playedSongs?: string[];
  inPerson?: boolean;
}) {
  const played = [...(cardData.playedSongs || [])].sort().join(',');
  const marks = (cardData.card?.squares || [])
    .map((s) => `${s.position ?? ''}:${s.marked ? 1 : 0}`)
    .sort()
    .join('|');
  return `${cardData.inPerson === false ? '0' : '1'}#${played}#${marks}`;
}

/** Remote/online join (?remote=1) — shown on host player cards and bingo verification. */
function mixRowsNeedHostSpotify(rows: Playlist[] | null): boolean {
  if (!rows || rows.length === 0) return false;
  return rows.some((p) => p.youtubeMusic !== true && p.catalog !== true);
}

function OnlinePlayerBadge({ compact }: { compact?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 8,
        padding: compact ? '2px 7px' : '3px 9px',
        borderRadius: 999,
        fontSize: compact ? '0.68rem' : '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        color: '#7ec8ff',
        background: 'rgba(66, 153, 225, 0.18)',
        border: '1px solid rgba(126, 200, 255, 0.45)',
        verticalAlign: 'middle',
      }}
      title="Joined online (remote link)"
    >
      <Globe className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden />
      Online
    </span>
  );
}

/** Spotify may return HTML in playlist descriptions; strip tags for display. */
function stripPlaylistDescriptionHtml(raw: string): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Match public display: trim optional "GoT" playlist prefix for column headers. */
function stripGotPlaylistPrefix(raw: string): string {
  return raw.replace(/^\s*GoT\s*[-�:]*\s*/i, '').trim();
}

/** "Short" names: trim a leading title flag (e.g. "GoT - ", "Tempo: ") from a playlist name. */
function stripTitleFlagPrefix(raw: string, flags: string[]): string {
  const name = String(raw || '').trim();
  const sorted = [...flags].sort((a, b) => b.length - a.length);
  for (const flag of sorted) {
    const f = flag.trim();
    if (!f) continue;
    if (name.toLowerCase().startsWith(f.toLowerCase())) {
      const stripped = name
        .slice(f.length)
        .replace(/^\s*[-–:]*\s*/, '')
        .trim();
      return stripped || name;
    }
  }
  return name;
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

/** Host-configured title flags ("GoT, Game of Tones") → trimmed list for matching. */
function parsePlaylistTitleFlags(raw: string): string[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when a playlist title carries one of the host's flags (auto-created "<flag> output" playlists excluded). */
function playlistMatchesTitleFlags(name: string, flags: string[]): boolean {
  if (flags.length === 0) return true;
  const nameLower = (name || '').toLowerCase();
  if (flags.some((flag) => nameLower.includes(`${flag.toLowerCase()} output`))) return false;
  return flags.some((flag) => nameLower.includes(flag.toLowerCase()));
}

/** Picks/All library filter (same rules as visible playlist effect). YouTube Music playlists always pass through. */
function filterBasePlaylistsForMix(
  playlists: Playlist[],
  showAllPlaylists: boolean,
  titleFlags: string[],
): Playlist[] {
  const ytm = playlists.filter((p: Playlist) => !!p.youtubeMusic);
  const rest = playlists.filter((p: Playlist) => !p.youtubeMusic);
  const spotifyPart = showAllPlaylists
    ? rest
    : rest.filter((p: Playlist) => playlistMatchesTitleFlags(p.name, titleFlags));
  return [...spotifyPart, ...ytm];
}

/** GoT label = eligibility tag for the shared Tempo Library (public playlists for all hosts). */
function isGotLabeledPlaylist(name: string): boolean {
  const nameLower = (name || '').toLowerCase();
  if (nameLower.includes('game of tones output') || nameLower.includes('gameoftones output')) {
    return false;
  }
  return (
    /^got\s*[-–:]*\s*/i.test(name || '') ||
    nameLower.includes('game of tones') ||
    nameLower.includes('gameoftones')
  );
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
  const gameStateRef = useRef<'waiting' | 'playing' | 'ended'>('waiting');
  const [hostAwaitingLiveSync, setHostAwaitingLiveSync] = useState(() => hostRoomExpectsLiveRecovery(roomId));
  const hostRoomHydrating =
    hostAwaitingLiveSync && gameState !== 'playing' && gameState !== 'ended';
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    setHostAwaitingLiveSync(hostRoomExpectsLiveRecovery(roomId));
  }, [roomId]);

  /** Authoritative in-memory room snapshot (same source as socket sync-state). Runs before socket connects. */
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`${API_BASE || ''}/api/rooms/${encodeURIComponent(roomId)}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!r.ok) {
          // Room may still exist server-side until the socket reconnects; keep the live-sync gate open.
          return;
        }
        const data = await r.json();
        const merged = mergeHostGameStateFromRoomPayload(gameStateRef.current, data);
        gameStateRef.current = merged;
        setGameState(merged);
        persistActiveHostRoomFromPayload(roomId, data);
        if (merged === 'playing') {
          setHostAwaitingLiveSync(false);
          setHostGlassNav('game');
        } else if (shouldClearHostAwaitingLiveSync(roomId, merged, data)) {
          setHostAwaitingLiveSync(false);
        }
      } catch {
        /* socket sync remains primary */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

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
  const [catalogPacksRefreshing, setCatalogPacksRefreshing] = useState(false);
  /** Client-side countdown mirror of server manual-refresh cooldown (ms). */
  const [catalogPacksCooldownRemainingMs, setCatalogPacksCooldownRemainingMs] = useState(0);
  const [catalogPacksRefreshHint, setCatalogPacksRefreshHint] = useState<string | null>(null);
  const catalogPacksRefreshInFlightRef = useRef(false);
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

  const playlistAvailabilityIssues = useMemo(
    () => buildPlaylistAvailabilityIssues(mixPlaylistSelection),
    [mixPlaylistSelection],
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
  const [finalizeMixBusy, setFinalizeMixBusy] = useState(false);
  const [finalizeMixElapsedSec, setFinalizeMixElapsedSec] = useState(0);
  /** Mirrors isSpotifyConnected for callbacks declared above sync effects (catalog schedule, socket reconnect). */
  const isSpotifyConnectedRef = useRef(false);
  const [pendingVerification, setPendingVerification] = useState<any>(null);
  /** Additional bingo claims waiting after the current verification modal (FIFO). */
  const [bingoVerificationBehindCount, setBingoVerificationBehindCount] = useState(0);
  const [displayPresence, setDisplayPresence] = useState<{
    connected: boolean;
    lastSeenAt: number | null;
    stale: boolean;
  }>({ connected: false, lastSeenAt: null, stale: false });
  const [markPlayedBusy, setMarkPlayedBusy] = useState(false);
  const bingoVerificationModalRef = useRef<HTMLDivElement | null>(null);
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
  const pendingRoomDeviceIdRef = useRef<string | null>(null);
  const connectionModalOpenedByUserRef = useRef(false);
  const connectionModalDismissedRef = useRef(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [spotifyJamActive, setSpotifyJamActive] = useState(false);
  const [venueSpotifyJamMode, setVenueSpotifyJamMode] = useState(false);

  const playbackDeviceNotInList = useMemo(() => {
    if (!mixNeedsHostSpotify || !isSpotifyConnected || isLoadingDevices) return false;
    if (!selectedDevice?.id) return true;
    if (devices.length === 0) return false;
    if (devices.some((d) => d.id === selectedDevice.id)) return false;
    if (venueSpotifyJamMode && devices.some((d) => isSpotifyJamDevice(d))) return false;
    return true;
  }, [
    mixNeedsHostSpotify,
    isSpotifyConnected,
    isLoadingDevices,
    selectedDevice,
    devices,
    venueSpotifyJamMode,
  ]);

  /** Selected device is online (in the list) but not Spotify's active playback target — honest readiness, not a blocker. */
  const selectedDeviceInactive = useMemo(() => {
    if (!mixNeedsHostSpotify || !isSpotifyConnected || isLoadingDevices) return false;
    if (!selectedDevice?.id) return false;
    const d = devices.find((x) => x.id === selectedDevice.id);
    return !!d && d.is_active === false;
  }, [mixNeedsHostSpotify, isSpotifyConnected, isLoadingDevices, selectedDevice, devices]);

  const selectablePlaybackDevices = useMemo(() => {
    if (venueSpotifyJamMode) {
      return devices.filter((d) => isSpotifyJamDevice(d));
    }
    return devices.filter((d) => !isSpotifyJamDevice(d));
  }, [devices, venueSpotifyJamMode]);

  const mixGameActionsBlocked = useMemo(
    () =>
      mixPlaylistSelection.length === 0 ||
      (mixNeedsHostSpotify && (!isSpotifyConnected || isSpotifyConnecting)) ||
      (mixNeedsHostSpotify && playbackDeviceNotInList) ||
      savedRoundRoomSyncBusy ||
      finalizeMixBusy,
    [
      mixPlaylistSelection.length,
      mixNeedsHostSpotify,
      isSpotifyConnected,
      isSpotifyConnecting,
      playbackDeviceNotInList,
      savedRoundRoomSyncBusy,
      finalizeMixBusy,
    ]
  );

  useEffect(() => {
    if (!finalizeMixBusy) {
      setFinalizeMixElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => setFinalizeMixElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [finalizeMixBusy]);

  const [randomStarts, setRandomStarts] = useState<'none' | 'early' | 'random'>(() => {
    const saved = localStorage.getItem('game-random-starts');
    return (saved as 'none' | 'early' | 'random') || 'none';
  });
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [playbackTrackNumber, setPlaybackTrackNumber] = useState<number | null>(null);
  const [playbackTrackTotal, setPlaybackTrackTotal] = useState<number | null>(null);
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
  /** Projector banner when a letter is revealed (letters still reveal when off). */
  const [publicDisplayLetterRevealToast, setPublicDisplayLetterRevealToast] = useState<boolean>(true);

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
  const updatePublicDisplayLetterRevealToast = (enabled: boolean) => {
    setPublicDisplayLetterRevealToast(enabled);
    if (socket && roomId) {
      socket.emit('set-public-display-letter-reveal-toast', { roomId, enabled });
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
  const [songAliases, setSongAliases] = useState<SongAliases>({});
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
  const [joinedPlayersRoster, setJoinedPlayersRoster] = useState<
    Map<string, { playerName: string; inPerson: boolean }>
  >(new Map());
  const [playerCardsVersion, setPlayerCardsVersion] = useState<number>(0); // Force re-render trigger
  const [playerCardsFullscreen, setPlayerCardsFullscreen] = useState<boolean>(false);
  /** When overlay is open: false = centered modal, true = viewport-filling panel */
  const [playerCardsMaximized, setPlayerCardsMaximized] = useState<boolean>(false);
  const [showBingoPoolModal, setShowBingoPoolModal] = useState(false);
  const [hostGlassNav, setHostGlassNav] = useState<HostGlassNavId>(
    () => parseHostGlassNavTab(searchParams.get('tab')) ?? 'game',
  );
  const [hostSetupStep, setHostSetupStep] = useState<HostSetupStep>('playlist');
  const [hostTutorialOpen, setHostTutorialOpen] = useState(false);
  const [hostTutorialStep, setHostTutorialStep] = useState(0);
  const [showTutorialSuggestion, setShowTutorialSuggestion] = useState(
    () => !isHostTutorialCompleted() && !isHostTutorialSuggestionDismissed(),
  );
  const [activityLog, setActivityLog] = useState<HostActivityEntry[]>([]);
  const [youtubeMusicConnected, setYoutubeMusicConnected] = useState(false);
  const [youtubeStatusReady, setYoutubeStatusReady] = useState(false);
  const [canUndoSkip, setCanUndoSkip] = useState(false);
  const roundsPanelRef = useRef<HTMLElement>(null);
  const hostShellMainRef = useRef<HTMLDivElement>(null);
  const displaySettingsRef = useRef<HTMLDetailsElement>(null);
  /** 5�15 mode: playlist title per column (from `fiveby15-pool`, else five selected playlists). */
  const [bingoColumnPlaylistNames, setBingoColumnPlaylistNames] = useState<string[]>([]);
  const [roundBuilderFocusIndex, setRoundBuilderFocusIndex] = useState(0);
  const compositeEditRoundIndexRef = useRef(0);
  const [libraryPlaylistDragActive, setLibraryPlaylistDragActive] = useState(false);

  const onHostGlassNav = useCallback((id: HostGlassNavId) => {
    setHostGlassNav(id);
    hostShellMainRef.current?.scrollTo({ top: 0 });
    if (id === 'rounds') {
      setTimeout(() => {
        hostShellMainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
    }
  }, []);

  const openPlaylistLibrary = useCallback(() => {
    onHostGlassNav('rounds');
  }, [onHostGlassNav]);

  const openHostTutorial = useCallback((step = 0) => {
    resetHostTutorialProgress();
    setHostTutorialStep(step);
    setHostTutorialOpen(true);
  }, []);

  const closeHostTutorial = useCallback((finished: boolean) => {
    setHostTutorialOpen(false);
    if (finished) {
      setHostTutorialCompleted(true);
      setShowTutorialSuggestion(false);
    }
  }, []);

  useEffect(() => {
    if (!hostTutorialOpen) return;
    const step = HOST_TUTORIAL_STEPS[hostTutorialStep];
    if (!step) return;
    if (step.nav) onHostGlassNav(step.nav);
    if (step.setupStep) setHostSetupStep(step.setupStep);
  }, [hostTutorialOpen, hostTutorialStep, onHostGlassNav]);

  useEffect(() => {
    const tab = parseHostGlassNavTab(searchParams.get('tab'));
    if (!tab) return;
    onHostGlassNav(tab);
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, onHostGlassNav]);

  const hostNavIcons: Record<HostGlassNavId, React.ReactNode> = useMemo(
    () => ({
      game: <Gamepad2 aria-hidden />,
      rounds: <ListMusic aria-hidden />,
      players: <Users aria-hidden />,
      display: <Monitor aria-hidden />,
      settings: <Settings aria-hidden />,
    }),
    [],
  );

  const openRoundBuilder = useCallback((focusIndex?: number) => {
    const idx =
      focusIndex !== undefined
        ? focusIndex
        : Math.max(0, currentRoundIndexRef.current >= 0 ? currentRoundIndexRef.current : 0);
    setRoundBuilderFocusIndex(idx);
    onHostGlassNav('rounds');
  }, [onHostGlassNav]);
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

  const hostPlaybackSystemsReady = useMemo(() => {
    if (isSpotifyConnected && (!mixNeedsHostSpotify || (!!selectedDevice?.id && !playbackDeviceNotInList))) {
      return true;
    }
    if (showYoutubeMusicInConnectionModal && youtubeMusicConnected) return true;
    return false;
  }, [
    isSpotifyConnected,
    mixNeedsHostSpotify,
    selectedDevice,
    playbackDeviceNotInList,
    showYoutubeMusicInConnectionModal,
    youtubeMusicConnected,
  ]);

  const dismissConnectionModal = useCallback(() => {
    if (!hostPlaybackSystemsReady) {
      connectionModalDismissedRef.current = true;
    }
    setShowConnectionModal(false);
  }, [hostPlaybackSystemsReady]);

  const [spotifyInitialCheckDone, setSpotifyInitialCheckDone] = useState(false);
  const initialConnectionPromptRef = useRef(false);
  const spotifyAutoConnectAttemptedRef = useRef(false);
  const prevSpotifyConnectedRef = useRef<boolean | undefined>(undefined);
  /** Google-linked host profile from server (`users` table via /api/auth/me). */
  const [hostAccount, setHostAccount] = useState<{
    id: number;
    email?: string | null;
    displayName?: string | null;
  } | null | undefined>(undefined);
  const hostPrefsHydratedRef = useRef(false);
  /** Bumped after each prefs hydration (localStorage, then DB) so the room push re-runs with fresh values. */
  const [hostPrefsHydrationNonce, setHostPrefsHydrationNonce] = useState(0);
  const hostPrefsPutTimerRef = useRef<number | null>(null);
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

  /** Dev / audit trail — console + in-app activity feed (Settings tab). */
  const addLog = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const line = `[TEMPO host] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    setActivityLog((prev) => appendHostActivity(prev, message, level));
  }, []);

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
  /** false = only playlists matching the host's title flags; true = full Spotify library list. */
  const [showAllPlaylists, setShowAllPlaylists] = useState<boolean>(false);
  /** Host-configurable, comma-separated title flags for the picks/All toggle (saved per host account). */
  const [playlistTitleFlags, setPlaylistTitleFlags] = useState<string>(DEFAULT_PLAYLIST_TITLE_FLAGS);
  /** Inline title-flags editor in the library toolbar. */
  const [showTitleFlagsEditor, setShowTitleFlagsEditor] = useState<boolean>(false);
  /** Playlist table: Spotify order until user sorts by name or track count */
  const [playlistSort, setPlaylistSort] = useState<{
    key: 'none' | 'name' | 'tracks';
    dir: 'asc' | 'desc';
  }>({ key: 'none', dir: 'asc' });
  const [playlistLibraryPage, setPlaylistLibraryPage] = useState(0);
  /** Library source: host's own Spotify, shared Tempo Library (GoT-labeled catalog), or YouTube. */
  const [playlistLibrarySource, setPlaylistLibrarySource] = useState<'spotify' | 'tempo' | 'youtube'>(
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
      if (!response.ok) return;
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
  const loadCatalogPacks = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      const forceRefresh = opts?.forceRefresh === true;
      if (forceRefresh) {
        if (catalogPacksRefreshInFlightRef.current) return;
        catalogPacksRefreshInFlightRef.current = true;
        setCatalogPacksRefreshing(true);
      }
      if (!readHostSpotifyWebEnabled()) {
        if (!forceRefresh) {
          setCatalogPacksProbeDone(true);
          setCatalogPacksFetchOk(false);
          setCatalogPacksConfigured(false);
          setCatalogPackOptions([]);
          setCatalogPacksFetchUnauthorized(false);
          setCatalogPrefixDiscoverySkipped(false);
        }
        if (forceRefresh) {
          catalogPacksRefreshInFlightRef.current = false;
          setCatalogPacksRefreshing(false);
        }
        return;
      }
      try {
        const url = forceRefresh
          ? `${API_BASE || ''}/api/spotify/catalog/packs?force=1`
          : `${API_BASE || ''}/api/spotify/catalog/packs`;
        const res = await hostFetch(url);
        if (!res.ok) {
          if (forceRefresh) {
            let warnMsg = 'Could not refresh official packs.';
            if (res.status === 429) {
              try {
                const d = (await res.json()) as { message?: string; retryAfterSec?: number };
                const retryMin =
                  typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0
                    ? ` Try again in about ${Math.max(1, Math.ceil(d.retryAfterSec / 60))} min.`
                    : '';
                warnMsg = (d.message || 'Spotify is rate-limiting catalog requests.') + retryMin;
              } catch {
                warnMsg = 'Spotify is rate-limiting catalog requests. Wait and try again.';
              }
            }
            setCatalogPacksRefreshHint(warnMsg);
            showHostAckNotification({
              id: 'catalog-packs-refresh-failed',
              title: 'Official packs refresh',
              variant: 'warning',
              message: warnMsg,
            });
          } else {
            setCatalogPacksFetchOk(false);
            setCatalogPacksConfigured(false);
            setCatalogPackOptions([]);
            setCatalogPacksFetchUnauthorized(res.status === 401);
            setCatalogPrefixDiscoverySkipped(false);
          }
          return;
        }
        setCatalogPacksFetchUnauthorized(false);
        const data = (await res.json()) as {
          success?: boolean;
          configured?: boolean;
          packs?: Array<{ id: string; name: string; tracks: number; catalog?: boolean }>;
          catalogPrefixDiscoverySkipped?: boolean;
          refreshSkipped?: boolean;
          cooldownRemainingMs?: number;
          manualRefreshCooldownMs?: number;
          message?: string;
          refreshFailed?: boolean;
          catalogCacheStale?: boolean;
          manualRefresh?: boolean;
        };
        if (!data.success) {
          if (!forceRefresh) {
            setCatalogPacksFetchOk(false);
            setCatalogPacksConfigured(false);
            setCatalogPackOptions([]);
            setCatalogPrefixDiscoverySkipped(false);
          } else {
            showHostAckNotification({
              id: 'catalog-packs-refresh-failed',
              title: 'Official packs refresh',
              variant: 'warning',
              message: 'Could not refresh official packs.',
            });
          }
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
          })),
        );

        if (typeof data.cooldownRemainingMs === 'number' && data.cooldownRemainingMs > 0) {
          setCatalogPacksCooldownRemainingMs(Math.ceil(data.cooldownRemainingMs));
        } else if (
          forceRefresh &&
          data.manualRefresh === true &&
          typeof data.manualRefreshCooldownMs === 'number' &&
          data.manualRefreshCooldownMs > 0
        ) {
          setCatalogPacksCooldownRemainingMs(Math.ceil(data.manualRefreshCooldownMs));
        }

        if (data.refreshSkipped && data.message) {
          setCatalogPacksRefreshHint(data.message);
          showHostAckNotification({
            id: 'catalog-packs-refresh-cooldown',
            title: 'Official packs refresh',
            variant: 'warning',
            message: data.message,
          });
        } else if (data.refreshFailed && data.message) {
          setCatalogPacksRefreshHint(data.message);
          showHostAckNotification({
            id: 'catalog-packs-refresh-stale',
            title: 'Official packs refresh',
            variant: 'warning',
            message: data.message,
          });
        } else if (data.catalogPrefixDiscoverySkipped && data.message) {
          setCatalogPacksRefreshHint(data.message);
          showHostAckNotification({
            id: 'catalog-packs-prefix-skipped',
            title: 'Official packs refresh',
            variant: 'warning',
            message: data.message,
          });
        } else if (forceRefresh && data.manualRefresh) {
          setCatalogPacksRefreshHint(null);
          showHostAckNotification({
            id: 'catalog-packs-refresh-ok',
            title: 'Official packs refreshed',
            variant: 'info',
            message:
              packs.length > 0
                ? `Loaded ${packs.length} official pack${packs.length === 1 ? '' : 's'} from the catalog.`
                : 'Catalog refresh completed — no matching packs found yet.',
          });
        } else if (data.message) {
          setCatalogPacksRefreshHint(data.message);
        }
      } catch {
        if (!forceRefresh) {
          setCatalogPacksFetchOk(false);
          setCatalogPacksConfigured(false);
          setCatalogPackOptions([]);
          setCatalogPacksFetchUnauthorized(false);
          setCatalogPrefixDiscoverySkipped(false);
        } else {
          showHostAckNotification({
            id: 'catalog-packs-refresh-network',
            title: 'Official packs refresh',
            variant: 'warning',
            message: 'Network error while refreshing official packs. Showing the last loaded list.',
          });
        }
      } finally {
        if (!forceRefresh) {
          setCatalogPacksProbeDone(true);
        } else {
          catalogPacksRefreshInFlightRef.current = false;
          setCatalogPacksRefreshing(false);
          setCatalogPacksProbeDone(true);
        }
      }
    },
    [showHostAckNotification],
  );

  useEffect(() => {
    if (catalogPacksCooldownRemainingMs <= 0) return;
    const id = globalThis.setInterval(() => {
      setCatalogPacksCooldownRemainingMs((prev) => {
        const next = Math.max(0, prev - 1000);
        if (next <= 0) setCatalogPacksRefreshHint(null);
        return next;
      });
    }, 1000);
    return () => globalThis.clearInterval(id);
  }, [catalogPacksCooldownRemainingMs > 0]);

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
          const updated = data.cacheUpdatedAt ? new Date(String(data.cacheUpdatedAt)) : null;
          const formatted =
            updated && !Number.isNaN(updated.getTime())
              ? updated.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
              : '';
          setSpotifyListCacheInfo(
            formatted ? `Saved library • Last updated ${formatted}` : 'Saved library',
          );
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
        // Reset to flagged picks by default when playlists are reloaded
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
        } else if (data && data.error === 'spotify_upstream_unavailable') {
          // Transient Spotify outage — Spotify stays connected; do not show reconnect copy.
          setSpotifyError(null);
          showHostAckNotification({
            id: 'playlists-spotify_upstream_unavailable',
            title: 'Spotify API temporarily unavailable',
            variant: 'warning',
            message:
              'Spotify is connected, but Spotify’s API is temporarily unavailable while loading your library. Your saved library is shown — try Refresh in a moment (no need to reconnect).',
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



  const parsedPlaylistTitleFlags = useMemo(
    () => parsePlaylistTitleFlags(playlistTitleFlags),
    [playlistTitleFlags],
  );

  /** Toggle label for the host's curated picks (first flag, e.g. "GoT"). */
  const playlistTitleFlagLabel = parsedPlaylistTitleFlags[0] ?? 'Flagged';

  /** "Short" names strip list: host flags plus the shared GoT label so Tempo Library names also shorten. */
  const titleFlagStripList = useMemo(
    () => Array.from(new Set([...parsedPlaylistTitleFlags, 'GoT', 'Game of Tones'])),
    [parsedPlaylistTitleFlags],
  );

  // Filter playlists by query (assigned playlists remain visible for reuse/caution UI)
  const filteredPlaylists = useMemo(() => {
    if (!playlistQuery) return visiblePlaylists;
    const q = playlistQuery.toLowerCase();
    return visiblePlaylists.filter((p) => {
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.owner || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    });
  }, [visiblePlaylists, playlistQuery]);

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
    if (playlistLibrarySource === 'youtube') {
      return sortedFilteredPlaylists.filter((p) => p.youtubeMusic);
    }
    // 'spotify' (My Spotify). The 'tempo' source renders the shared catalog list instead of this table.
    return sortedFilteredPlaylists.filter((p) => !p.youtubeMusic && !p.catalog);
  }, [sortedFilteredPlaylists, playlistLibrarySource]);

  /** Shared Tempo Library: catalog packs, strictly filtered by the GoT label (eligibility tag). */
  const tempoLibraryPacks = useMemo(() => {
    const gotOnly = catalogPackOptions.filter((p) => isGotLabeledPlaylist(p.name));
    const q = playlistQuery.trim().toLowerCase();
    if (!q) return gotOnly;
    return gotOnly.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q),
    );
  }, [catalogPackOptions, playlistQuery]);

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
    return { spotify, youtube, tempo: tempoLibraryPacks.length };
  }, [sortedFilteredPlaylists, tempoLibraryPacks.length]);

  useEffect(() => {
    setPlaylistLibraryPage(0);
  }, [playlistQuery, showAllPlaylists, parsedPlaylistTitleFlags, playlistSort.key, playlistSort.dir, playlistLibrarySource]);

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

  /** Shown when the library table has no rows (search or filter). */
  const playlistLibraryEmptyMessage = useMemo(() => {
    const q = playlistQuery.trim();
    if (q) return 'No playlists match your search.';
    const merged = [...playlists, ...youtubeMusicPlaylists];
    if (merged.length === 0) {
      if (isSpotifyConnected && spotifyMyPlaylistsTotal === 0) {
        return 'Spotify reports 0 playlists for the connected account. Create playlists in Spotify or connect YouTube Music under Connection, then refresh.';
      }
      return 'No playlists loaded yet. Connect Spotify and/or YouTube Music under Connection, then refresh your library.';
    }
    if (!showAllPlaylists && playlists.length > 0) {
      const flagged = playlists.filter((p) =>
        playlistMatchesTitleFlags(p.name, parsedPlaylistTitleFlags),
      );
      if (flagged.length === 0) {
        return `Spotify returned ${playlists.length} playlist(s), but none match your title flags (${
          parsedPlaylistTitleFlags.join(', ') || 'none set'
        }). Switch to "All", or change your flags under Saved host preferences.`;
      }
    }
    return 'No playlists in this view.';
  }, [
    playlistQuery,
    playlists,
    youtubeMusicPlaylists,
    showAllPlaylists,
    parsedPlaylistTitleFlags,
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

  // Update visible playlists when library loads or filter mode changes (keep assigned rows visible)
  useEffect(() => {
    const merged = [...playlists, ...youtubeMusicPlaylists];
    if (merged.length > 0) {
      const basePlaylists = filterBasePlaylistsForMix(merged, showAllPlaylists, parsedPlaylistTitleFlags);
      setVisiblePlaylists(
        basePlaylists.filter((p: Playlist) => normalizeSpotifyPlaylistId(p.id) !== ''),
      );
    } else {
      setVisiblePlaylists([]);
    }
  }, [playlists, youtubeMusicPlaylists, showAllPlaylists, parsedPlaylistTitleFlags]);

  /** YouTube Music connection status (for auto-open connection when no system is linked). */
  useEffect(() => {
    if (!showYoutubeMusicInConnectionModal) {
      setYoutubeStatusReady(true);
      setYoutubeMusicConnected(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await hostFetch(`${API_BASE || ''}/api/youtube/music/status?_=${Date.now()}`, {
          cache: 'no-store',
        });
        const data = (await r.json().catch(() => ({}))) as { connected?: boolean };
        if (!cancelled) setYoutubeMusicConnected(!!data.connected);
      } catch {
        if (!cancelled) setYoutubeMusicConnected(false);
      } finally {
        if (!cancelled) setYoutubeStatusReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showYoutubeMusicInConnectionModal, ytMusicLibraryRefreshNonce]);

  /** Open connection modal until Spotify and/or YouTube is ready (unless host dismissed). */
  useEffect(() => {
    if (!spotifyInitialCheckDone) return;
    if (showYoutubeMusicInConnectionModal && !youtubeStatusReady) return;
    if (hostPlaybackSystemsReady) {
      connectionModalDismissedRef.current = false;
      return;
    }
    if (connectionModalDismissedRef.current) return;
    if (!initialConnectionPromptRef.current) {
      initialConnectionPromptRef.current = true;
    }
    setShowConnectionModal(true);
  }, [
    spotifyInitialCheckDone,
    youtubeStatusReady,
    showYoutubeMusicInConnectionModal,
    hostPlaybackSystemsReady,
  ]);


  /** Spotify lost mid-show: reopen Connection; only auto-close after reconnect if host did not open it manually. */
  useEffect(() => {
    const prev = prevSpotifyConnectedRef.current;
    if (spotifyInitialCheckDone && prev === true && isSpotifyConnected === false) {
      connectionModalOpenedByUserRef.current = false;
      setShowConnectionModal(true);
    }
    if (
      prev === false &&
      isSpotifyConnected === true &&
      !connectionModalOpenedByUserRef.current
    ) {
      setShowConnectionModal(false);
    }
    prevSpotifyConnectedRef.current = isSpotifyConnected;
  }, [isSpotifyConnected, spotifyInitialCheckDone]);

  useEffect(() => {
    if (!showConnectionModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissConnectionModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showConnectionModal, dismissConnectionModal]);

  useEffect(() => {
    if (!showConnectionModal) return;
    const restoreTo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (!showConnectionModalScrollRef.current) {
        document.body.style.overflow = restoreTo;
      }
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

  const syncVenueSpotifyJamModeToRoom = useCallback(
    (enabled: boolean) => {
      if (!socket || !roomId) return;
      try {
        socket.emit('set-venue-spotify-jam-mode', { roomId, venueSpotifyJamMode: enabled });
      } catch {
        /* ignore */
      }
    },
    [socket, roomId],
  );

  const syncSelectedPlaybackDeviceToRoom = useCallback(
    (device: Device | null) => {
      if (!socket || !roomId) return;
      try {
        socket.emit('set-selected-playback-device', {
          roomId,
          deviceId: device?.id ?? null,
          device: device
            ? { id: device.id, name: device.name, type: device.type || 'Computer' }
            : null,
        });
      } catch {
        /* ignore */
      }
    },
    [socket, roomId],
  );

  const loadDevices = useCallback(async (options?: { force?: boolean }) => {
    if (!readHostSpotifyWebEnabled()) return;
    const force = options?.force === true;
    const now = Date.now();
    if (!force && now - lastLoadDevicesAtRef.current < LOAD_DEVICES_MIN_GAP_MS) {
      return;
    }
    try {
      setIsLoadingDevices(true);
      console.log('Loading Spotify devices...');
      const refreshQuery = force ? '?refresh=1' : '';
      const response = await hostFetch(`${API_BASE || ''}/api/spotify/devices${refreshQuery}`);
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
        setSpotifyJamActive(!!data.jamActive);
        console.log('Devices loaded:', data.devices.length, 'devices');
        console.log('Device details:', data.devices);
        if (data.currentDevice) {
          console.log('Current playback device:', data.currentDevice.name, data.currentDevice.id);
        }

        const pendingId = pendingRoomDeviceIdRef.current;
        const deviceList = data.devices as Device[];
        const picked = pickPreferredPlaybackDevice(deviceList, {
          pendingId: pendingId ?? undefined,
          savedId: data.savedDevice?.id,
          currentId: data.currentDevice?.id,
          venueJamMode: venueSpotifyJamMode,
        });
        if (pendingId && picked?.id === pendingId) {
          pendingRoomDeviceIdRef.current = null;
        }
        if (picked) {
          setSelectedDevice(picked);
          syncSelectedPlaybackDeviceToRoom(picked);
          console.log('Playback device selected:', picked.name);
        }
      } else {
        console.error('Failed to load devices:', data.error);
      }
    } catch (error) {
      console.error('Error loading devices:', error);
    } finally {
      lastLoadDevicesAtRef.current = Date.now();
      setIsLoadingDevices(false);
    }
  }, [syncSelectedPlaybackDeviceToRoom, venueSpotifyJamMode]);

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
          try {
            sessionStorage.removeItem(SPOTIFY_SKIP_AUTO_CONNECT_KEY);
          } catch {
            /* ignore */
          }
          setIsSpotifyConnected(true);
          setIsSpotifyConnecting(false);
          setlistDebounceExtraAfterSpotifyConnectMsRef.current = 2400;
          await loadPlaylists();
          await new Promise((r) => setTimeout(r, 1500));
          await loadDevices();
          deviceRetryTimer = window.setTimeout(() => {
            if (!ac.signal.aborted) void loadDevices({ force: true });
          }, 4000);
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
  const lastLoadDevicesOnSocketReconnectAtRef = useRef(0);
  const lastLoadDevicesAtRef = useRef(0);
  const LOAD_DEVICES_MIN_GAP_MS = 12_000;
  /** Last non-empty list sent in finalize-mix (React state can lag right after setSongList / socket events). */
  const lastFinalizeMixSongListRef = useRef<Song[] | null>(null);
  /** Mirror songList for incremental setlist fetches (avoids refetching every playlist on each new selection). */
  const songListRef = useRef<Song[]>([]);
  /** Playlist ids we have already fully loaded track lists for. */
  const fullyLoadedPlaylistIdsRef = useRef<Set<string>>(new Set());
  /** Playlist id -> epoch ms until which auto track hydration is skipped after a Spotify 5xx (mirrors server cooldown; manual Refresh bypasses). */
  const playlistTracksUnavailableUntilRef = useRef<Map<string, number>>(new Map());
  /** Extra debounce once after Spotify OAuth / reconnect before setlist import (ms). */
  const setlistDebounceExtraAfterSpotifyConnectMsRef = useRef(0);
  const webApiQuarantineRef = useRef(webApiQuarantine);
  webApiQuarantineRef.current = webApiQuarantine;
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

  /** Room-level finalize applies to one playlist mix — clear when switching to another round's prep. */
  const [finalizedMixPlaylistKey, setFinalizedMixPlaylistKey] = useState<string | null>(null);

  const clearPrepMixPlaybackState = useCallback(() => {
    setMixFinalized(false);
    setFinalizedMixPlaylistKey(null);
    setFinalizedOrder(null);
    finalizedOrderRef.current = null;
    finalizedOrderPlaylistKeyRef.current = null;
    pendingFinalizePlaylistKeyRef.current = null;
    lastFinalizePlaylistKeyRef.current = null;
    lastFinalizeMixSongListRef.current = null;
  }, []);

  /** Call log + now-playing UI for the prior round — reset when picking another round in prep. */
  const clearPrepRoundCallLogUi = useCallback(() => {
    setPlayedInOrder([]);
    setCurrentSong(null);
    setPlaybackTrackNumber(null);
    setPlaybackTrackTotal(null);
    setIsPlaying(false);
    setYoutubeHostPlayback(null);
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: false,
      currentSong: null,
      duration: 0,
      currentTime: 0,
    }));
  }, []);

  const notifyServerPrepRoundSwitch = useCallback(() => {
    if (socket && roomId) {
      socket.emit('prep-select-round', { roomId });
    }
  }, [socket, roomId]);

  const applyLoadedTrackCountsFromSongs = useCallback((songs: Song[]) => {
    const perPlaylist = new Map<string, number>();
    const seenPerPlaylist = new Map<string, Set<string>>();
    for (const s of songs) {
      const pidRaw = s.sourcePlaylistId != null ? String(s.sourcePlaylistId).trim() : '';
      if (!pidRaw || !s.id) continue;
      const pid = canonicalPlaylistIdForMatch(pidRaw);
      let seen = seenPerPlaylist.get(pid);
      if (!seen) {
        seen = new Set();
        seenPerPlaylist.set(pid, seen);
      }
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      perPlaylist.set(pid, (perPlaylist.get(pid) ?? 0) + 1);
    }
    const merge = (prev: Playlist[]) =>
      prev.map((pl) => {
        const loaded = perPlaylist.get(canonicalPlaylistIdForMatch(pl.id));
        if (loaded == null) return pl;
        return { ...pl, tracksLoaded: loaded };
      });
    setPlaylists(merge);
    setSelectedPlaylists(merge);
    setSelectedCatalogPlaylists(merge);
  }, []);

  type PlaylistLoadStats = {
    removed?: number;
    unplayable?: number;
    samples?: Array<{ reason: string; name?: string; artist?: string }>;
  };

  const applyPlaylistLoadStats = useCallback((playlistId: string, stats: PlaylistLoadStats) => {
    const removed = stats.removed ?? 0;
    const unplayable = stats.unplayable ?? 0;
    const samples = Array.isArray(stats.samples) ? stats.samples.slice(0, 5) : [];
    const merge = (prev: Playlist[]) =>
      prev.map((pl) => {
        if (canonicalPlaylistIdForMatch(pl.id) !== canonicalPlaylistIdForMatch(playlistId)) {
          return pl;
        }
        return {
          ...pl,
          tracksRemoved: removed,
          tracksUnplayable: unplayable,
          unplayableSamples: samples,
        };
      });
    setPlaylists(merge);
    setSelectedPlaylists(merge);
    setSelectedCatalogPlaylists(merge);
  }, []);

  const disconnectSpotify = useCallback(async () => {
    try {
      try {
        sessionStorage.setItem(SPOTIFY_SKIP_AUTO_CONNECT_KEY, '1');
      } catch {
        /* ignore */
      }
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
    if (isSpotifyJamDevice(selectedDevice) && !venueSpotifyJamMode) {
      alert('Enable “Venue uses Spotify Jam” in Connection before selecting a Jam session as the playback device.');
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
        body: JSON.stringify({ device: selectedDevice, venueSpotifyJamMode }),
      });

      const data = await response.json();
      if (data.success) {
        console.log('Device saved successfully:', data.message);
        syncSelectedPlaybackDeviceToRoom(selectedDevice);
        alert(`Device saved: ${selectedDevice.name}`);
      } else {
        console.error('Failed to save device:', data.error);
        alert(data.message || data.error || 'Failed to save device');
      }
    } catch (error) {
      console.error('Error saving device:', error);
      alert('Error saving device');
    }
  }, [selectedDevice, syncSelectedPlaybackDeviceToRoom, venueSpotifyJamMode]);

  /** Room socket handlers — refs so io() is not recreated when loadPlaylists / mix selection changes. */
  const loadPlaylistsSocketRef = useRef(loadPlaylists);
  loadPlaylistsSocketRef.current = loadPlaylists;
  const loadDevicesSocketRef = useRef(loadDevices);
  loadDevicesSocketRef.current = loadDevices;
  const disconnectSpotifySocketRef = useRef(disconnectSpotify);
  disconnectSpotifySocketRef.current = disconnectSpotify;
  const invalidateSetlistBuildCacheSocketRef = useRef(invalidateSetlistBuildCache);
  invalidateSetlistBuildCacheSocketRef.current = invalidateSetlistBuildCache;
  const showHostAckNotificationSocketRef = useRef(showHostAckNotification);
  showHostAckNotificationSocketRef.current = showHostAckNotification;
  const navigateSocketRef = useRef(navigate);
  navigateSocketRef.current = navigate;
  const spotifyStatusCheckInFlightRef = useRef(false);

  useEffect(() => {
    if (!hostAuthBootstrapDone) return;

    console.log('HostView useEffect triggered');
    console.log('Current window.location.pathname:', window.location.pathname);
    console.log('Current window.location.href:', window.location.href);
    console.log('Room ID from params:', roomId);

    // Load saved custom patterns
    setSavedCustomPatterns(getSavedCustomPatterns());
    setSavedCompositePatterns(getSavedCompositePatterns());
    
    // Initialize socket connection (shared per room; deferred release on unmount for Strict Mode remounts)
    const hostJwt = getHostJwt();
    const { socket: newSocket, gen: hostSocketGeneration } = acquireHostRoomSocket(roomId || '', () =>
      io(SOCKET_URL || undefined, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        auth: { token: hostJwt || '' },
      }),
    );
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
    const applyPlayersRoster = (
      players: Array<{ playerId?: string; playerName?: string; inPerson?: boolean }>,
    ) => {
      if (!Array.isArray(players)) return;
      setJoinedPlayersRoster(
        new Map(
          players
            .filter((p) => p?.playerId)
            .map((p) => [
              String(p.playerId),
              {
                playerName: p.playerName || 'Unknown',
                inPerson: p.inPerson !== false,
              },
            ]),
        ),
      );
    };

    newSocket.on('room-players-roster', (data: any) => {
      applyPlayersRoster(data?.players);
    });

    newSocket.on('player-joined', (data: any) => {
      console.log('Player joined:', data);
      if (!data?.isHost && data?.playerId) {
        setJoinedPlayersRoster((prev) => {
          const next = new Map(prev);
          next.set(String(data.playerId), {
            playerName: data.playerName || 'Unknown',
            inPerson: data.inPerson !== false,
          });
          return next;
        });
      }
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

    newSocket.on('display-presence', (data: any) => {
      setDisplayPresence({
        connected: !!data?.connected,
        lastSeenAt: typeof data?.lastSeenAt === 'number' ? data.lastSeenAt : null,
        stale: !!data?.stale,
      });
    });

    newSocket.on('replay-snippet-result', (data: any) => {
      if (data?.ok) {
        addLog('Replayed current snippet', 'info');
        showToast('Replayed clip', 'info');
      } else {
        showToast('Could not replay clip', 'error');
      }
    });

    newSocket.on('undo-skip-result', (data: any) => {
      if (data?.ok) {
        setCanUndoSkip(false);
        addLog('Undid last skip', 'info');
        showToast('Undid last skip', 'info');
      } else {
        showToast('Cannot undo skip (window expired or playback busy)', 'warn');
      }
    });

    newSocket.on('mark-song-played-result', (data: any) => {
      setMarkPlayedBusy(false);
      if (!data?.ok) {
        showToast('Could not mark track as played', 'error');
        return;
      }
      const songId = data.songId as string | undefined;
      if (songId) {
        const title = getDisplaySongTitle(songId, data.songName || '');
        const artist = getDisplaySongArtist(songId, data.artistName || '');
        setPlayedInOrder((prev) => {
          if (prev.some((p) => p.id === songId)) return prev;
          return [...prev, { id: songId, name: title, artist }];
        });
      }
      addLog(data.added ? 'Marked current track as played' : 'Track was already marked played', 'info');
      showToast(data.added ? 'Marked as played' : 'Already marked played', 'info');
    });

    newSocket.on('song-marked-played', (data: any) => {
      const songId = data?.songId as string | undefined;
      if (!songId) return;
      const title = getDisplaySongTitle(songId, data.songName || '');
      const artist = getDisplaySongArtist(songId, data.artistName || '');
      setPlayedInOrder((prev) => {
        if (prev.some((p) => p.id === songId)) return prev;
        return [...prev, { id: songId, name: title, artist }];
      });
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
          setGameState('waiting');
          gameStateRef.current = 'waiting';
          if (roomId) {
            writeActiveHostRoom({ roomId, gameState: 'waiting', updatedAt: Date.now() });
          }
          setEventRounds((prev) => {
            const cur = currentRoundIndexRef.current;
            if (cur < 0 || cur >= prev.length || prev[cur].status === 'completed') return prev;
            const next = [...prev];
            next[cur] = { ...next[cur], status: 'completed', completedAt: Date.now() };
            try {
              localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
            } catch {
              /* ignore */
            }
            return next;
          });
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
      gameStateRef.current = 'playing';
      setGameState('playing');
      if (roomId) {
        writeActiveHostRoom({ roomId, gameState: 'playing', updatedAt: Date.now() });
      }
      setHostAwaitingLiveSync(false);
      console.log('?? SET GAME STATE TO PLAYING');
      setIsStartingGame(false);
      setBingoColumnPlaylistNames([]);
      addLog('Game started - state set to playing', 'info');
      setShowSongList(false);
      schedulePlayerCardsRefresh(800);
      const playback = songsFromServerPlaybackPayload(data?.playbackOrder);
      if (playback.length > 0) {
        finalizedOrderRef.current = playback;
        setFinalizedOrder(playback);
        setSongList(playback);
        applyLoadedTrackCountsFromSongs(playback);
        lastFinalizeMixSongListRef.current = playback;
        addLog(
          `Playback order (${playback.length} tracks, #1: ${playback[0]?.name || '?'})`,
          'info',
        );
      }
      if (roomId) {
        newSocket.emit('request-finalized-order', { roomId });
      }
    });

    // Receive playback order (same sequence as automatic playback / call numbers).
    newSocket.on('finalized-order', (data: any) => {
      try {
        const arr = songsFromServerPlaybackPayload(data?.order);
        if (arr.length > 0) {
          finalizedOrderRef.current = arr;
          setFinalizedOrder(arr);
          setSongList(arr);
          applyLoadedTrackCountsFromSongs(arr);
          lastFinalizeMixSongListRef.current = arr;
          finalizedOrderPlaylistKeyRef.current =
            pendingFinalizePlaylistKeyRef.current ?? mixPlaylistSelectionKeyRef.current;
          pendingFinalizePlaylistKeyRef.current = null;
          addLog(
            `Playback order (${arr.length} tracks, #1: ${arr[0]?.name || '?'})`,
            'info',
          );
        }
      } catch (e) {
        console.warn('Failed to parse finalized order:', e);
      }
    });

    newSocket.on('song-playing', (data: any) => {
      const snippetLengthSec =
        typeof data.snippetLength === 'number' && Number.isFinite(data.snippetLength)
          ? data.snippetLength
          : 30;
      const snippetDurationMs = Math.max(0, snippetLengthSec * 1000);
      const snippetElapsedMs =
        typeof data.snippetElapsedMs === 'number' && Number.isFinite(data.snippetElapsedMs)
          ? Math.min(snippetDurationMs, Math.max(0, data.snippetElapsedMs))
          : 0;
      const yt =
        data.youtubeMusic === true &&
        typeof data.youtubeVideoId === 'string' &&
        data.youtubeVideoId.length > 0;
      if (yt) {
        setYoutubeHostPlayback({
          videoId: data.youtubeVideoId,
          startMs: typeof data.startMs === 'number' ? data.startMs : 0,
          snippetSeconds: snippetLengthSec,
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
        duration: snippetDurationMs,
        currentTime: snippetElapsedMs,
      }));
      setPlayedInOrder(prev => {
        if (prev.find(p => p.id === data.songId)) return prev; // prevent dupes
        return [...prev, { id: data.songId, name: displayTitleForUi, artist: ytf.artist }];
      });
      if (typeof data.playbackNumber === 'number' && data.playbackNumber > 0) {
        setPlaybackTrackNumber(data.playbackNumber);
      } else if (typeof data.currentIndex === 'number') {
        setPlaybackTrackNumber(data.currentIndex + 1);
      }
      if (typeof data.totalSongs === 'number' && data.totalSongs > 0) {
        setPlaybackTrackTotal(data.totalSongs);
      }

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

    newSocket.on('final-song-started', (data: { songNumber?: number; totalSongs?: number; snippetSec?: number }) => {
      const n = data.songNumber ?? 75;
      const total = data.totalSongs ?? 75;
      const sec = data.snippetSec ?? 30;
      showHostAckNotificationSocketRef.current({
        title: 'Final song',
        message: `Song ${n} of ${total} finished. Playback stops now (${sec}s snippet complete).`,
        variant: 'warning',
      });
      playHostAlertSound();
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

    const patchHostPlayerCardsForAlias = (songId: string, title: string, artist: string) => {
      setPlayerCards((prev) => {
        const next = new Map(prev);
        Array.from(next.entries()).forEach(([pid, card]) => {
          if (!card?.squares) return;
          next.set(pid, {
            ...card,
            squares: patchSquaresWithAlias(card.squares, songId, title, artist),
          });
        });
        return next;
      });
      setPlayerCardsVersion((v) => v + 1);
      setPendingVerification((pv: any) => {
        if (!pv?.playerCard?.squares) return pv;
        return {
          ...pv,
          playerCard: {
            ...pv.playerCard,
            squares: patchSquaresWithAlias(pv.playerCard.squares, songId, title, artist),
          },
        };
      });
    };

    const patchHostPlayerCardsClearAlias = (songId: string) => {
      setPlayerCards((prev) => {
        const next = new Map(prev);
        Array.from(next.entries()).forEach(([pid, card]) => {
          if (!card?.squares) return;
          next.set(pid, {
            ...card,
            squares: patchSquaresClearAlias(card.squares, songId),
          });
        });
        return next;
      });
      setPlayerCardsVersion((v) => v + 1);
      setPendingVerification((pv: any) => {
        if (!pv?.playerCard?.squares) return pv;
        return {
          ...pv,
          playerCard: {
            ...pv.playerCard,
            squares: patchSquaresClearAlias(pv.playerCard.squares, songId),
          },
        };
      });
    };

    newSocket.on('song-alias-updated', (data: { songId: string; title: string; artist: string }) => {
      if (!data?.songId) return;
      setSongAliases((prev) => ({
        ...prev,
        [data.songId]: { title: data.title, artist: data.artist },
      }));
      patchHostPlayerCardsForAlias(data.songId, data.title, data.artist);
    });

    newSocket.on('song-alias-cleared', (data: { songId: string }) => {
      if (!data?.songId) return;
      setSongAliases((prev) => {
        const next = { ...prev };
        delete next[data.songId];
        return next;
      });
      patchHostPlayerCardsClearAlias(data.songId);
    });

    newSocket.on('all-song-aliases-response', (data: SongAliases) => {
      setSongAliases(data || {});
    });

    newSocket.on('song-alias-error', (data: { message?: string }) => {
      const msg = data?.message?.trim();
      if (msg) window.alert(msg);
    });

    newSocket.on('game-ended', () => {
      setGamePaused(false);
      setIsPlaying(false);
      setGameState('ended');
      setYoutubeHostPlayback(null);
      setPlaybackTrackNumber(null);
      setPlaybackTrackTotal(null);
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
      setPlaybackTrackNumber(null);
      setPlaybackTrackTotal(null);
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
      setRevealMode('off');
      setSongList([]);
      setFinalizedOrder([]);
      finalizedOrderPlaylistKeyRef.current = null;
      pendingFinalizePlaylistKeyRef.current = null;
      lastFinalizeMixSongListRef.current = null;
      invalidateSetlistBuildCacheSocketRef.current();
      
      // Preserve round winners history
      if (data.roundWinners) {
        setRoundWinners(data.roundWinners);
      }
      
      addLog(`Round ${data.roundNumber} - Fresh setup ready! Select playlists to start.`, 'info');
      setHostSetupStep('playlist');
      console.log('? Host UI reset complete - ready for new round setup');
    });

    // NEW: Handle game session ended
    newSocket.on('game-session-ended', (data: any) => {
      console.log('Game session ended:', data);
      setRoundComplete(null);
      setGameState('ended');
      clearActiveHostRoom();
      setHostAwaitingLiveSync(false);
      setIsPlaying(false);
      void disconnectSpotifySocketRef.current();
      if (data.roundWinners) {
        setRoundWinners(data.roundWinners);
      }
      addLog(`Game session ended after ${data.totalRounds} rounds`, 'info');
    });

    newSocket.on('sync-state-response', (data: any) => {
      console.log('Sync state response:', data);
      const wasAlreadyPlaying = gameStateRef.current === 'playing';
      const merged = mergeHostGameStateFromRoomPayload(gameStateRef.current, data);
      gameStateRef.current = merged;
      setGameState(merged);
      if (roomId) {
        persistActiveHostRoomFromPayload(roomId, data);
      }
      if (merged === 'playing') {
        setHostAwaitingLiveSync(false);
        // Jump to Game only when entering a live game (load/reconnect) — mid-playback syncs
        // (e.g. each new track) must not yank the host off the tab they're working on.
        if (!wasAlreadyPlaying) setHostGlassNav('game');
      } else if (shouldClearHostAwaitingLiveSync(roomId, merged, data)) {
        setHostAwaitingLiveSync(false);
      }
      if (data.gameState) {
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
      if (data?.playerId) {
        setJoinedPlayersRoster((prev) => {
          const next = new Map(prev);
          next.delete(String(data.playerId));
          return next;
        });
      }
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

    newSocket.on('public-display-letter-reveal-toast-updated', (data: any) => {
      if (data?.enabled !== undefined) {
        setPublicDisplayLetterRevealToast(data.enabled !== false);
      }
    });

    newSocket.on('room-state', (payload: any) => {
      const wasAlreadyPlaying = gameStateRef.current === 'playing';
      const merged = mergeHostGameStateFromRoomPayload(gameStateRef.current, payload);
      gameStateRef.current = merged;
      setGameState(merged);
      if (roomId) {
        persistActiveHostRoomFromPayload(roomId, payload);
      }
      if (merged === 'playing') {
        setHostAwaitingLiveSync(false);
        // Server broadcasts room-state after every song start — only snap to the Game tab when
        // first entering a live game, never while the host is browsing another tab mid-playback.
        if (!wasAlreadyPlaying) setHostGlassNav('game');
      } else if (shouldClearHostAwaitingLiveSync(roomId, merged, payload)) {
        setHostAwaitingLiveSync(false);
      }
      if (payload?.isPlaying !== undefined) {
        setIsPlaying(!!payload.isPlaying);
      }
      if (payload?.bingoVerificationPending !== undefined || payload?.gameState !== undefined) {
        setGamePaused(
          payload?.bingoVerificationPending === true || payload?.gameState === 'paused_for_verification',
        );
      }
      const shouldHydrateLiveSnippetLength =
        payload?.isPlaying === true ||
        payload?.gameState === 'playing' ||
        payload?.gameState === 'paused_for_verification' ||
        payload?.gameState === 'paused' ||
        payload?.currentSong != null;
      if (shouldHydrateLiveSnippetLength && payload?.snippetLength !== undefined) {
        const nextSnippetLength = Number(payload.snippetLength);
        if (Number.isFinite(nextSnippetLength) && nextSnippetLength > 0) {
          setSnippetLength(Math.round(nextSnippetLength));
        }
      }
      if (shouldHydrateLiveSnippetLength && payload?.randomStarts !== undefined) {
        const rs = payload.randomStarts;
        if (rs === 'none' || rs === 'early' || rs === 'random') {
          setRandomStarts(rs);
        }
      }
      if (payload?.currentSong !== undefined) {
        const syncedSong = normalizeSyncedSongForHost(payload.currentSong);
        setCurrentSong(syncedSong);
        setPlaybackState((prev) => ({
          ...prev,
          isPlaying: payload?.isPlaying !== undefined ? !!payload.isPlaying : prev.isPlaying,
          currentSong: syncedSong,
          duration:
            syncedSong && typeof payload?.snippetLength === 'number'
              ? payload.snippetLength * 1000
              : syncedSong
                ? prev.duration
                : 0,
          currentTime: syncedSong ? prev.currentTime : 0,
        }));
        if (!syncedSong) {
          setYoutubeHostPlayback(null);
        }
      }
      if (Array.isArray(payload?.winners)) {
        setWinners(payload.winners);
      }
      if (Array.isArray(payload?.roundWinners)) {
        setRoundWinners(payload.roundWinners);
      }
      if (payload?.mixFinalized !== undefined) {
        setMixFinalized(!!payload.mixFinalized);
      }
      if (payload?.pattern) {
        const incomingPat = payload.pattern === 'blackout' ? 'full_card' : payload.pattern;
        setPattern(incomingPat);
        if (incomingPat === 'composite' && payload.patternComposite != null) {
          const normalized = normalizePatternComposite(payload.patternComposite);
          if (normalized) setPatternComposite(normalized);
        }
        if (incomingPat === 'line' && payload.linesRequired != null) {
          setLinesRequired(normalizeLinesRequired(payload.linesRequired));
        }
        if (incomingPat === 'custom') {
          setCustomMatchAllowRotation(!!payload.customMatchAllowRotation);
          setCustomMatchAllowMirror(!!payload.customMatchAllowMirror);
          if (Array.isArray(payload.customMask)) {
            const nextMask = payload.customMask.map((pos: any) => String(pos));
            setCustomMask(nextMask);
            setCustomPattern(nextMask);
          }
        } else {
          setCustomMatchAllowRotation(false);
          setCustomMatchAllowMirror(false);
          setCustomMask([]);
        }
      }
      if (Array.isArray(payload?.playlists)) {
        const syncedPlaylists = payload.playlists
          .map((playlist: any) => {
            const id = playlist?.id != null ? String(playlist.id).trim() : '';
            if (!id) return null;
            return {
              id,
              name: typeof playlist?.name === 'string' ? playlist.name : 'Playlist',
              tracks:
                typeof playlist?.tracks === 'number'
                  ? playlist.tracks
                  : typeof playlist?.trackCount === 'number'
                    ? playlist.trackCount
                    : 0,
              description: typeof playlist?.description === 'string' ? playlist.description : undefined,
              public: playlist?.public === true,
              collaborative: playlist?.collaborative === true,
              owner: typeof playlist?.owner === 'string' ? playlist.owner : undefined,
              hasExplicitTracks: playlist?.hasExplicitTracks === true,
              tracksLoaded: typeof playlist?.tracksLoaded === 'number' ? playlist.tracksLoaded : undefined,
              catalog: playlist?.catalog === true,
              youtubeMusic: playlist?.youtubeMusic === true,
            } as Playlist;
          })
          .filter((playlist: Playlist | null): playlist is Playlist => playlist != null);

        setSelectedPlaylists(syncedPlaylists.filter((playlist: Playlist) => !playlist.catalog));
        setSelectedCatalogPlaylists(
          syncedPlaylists.filter((playlist: Playlist) => playlist.catalog).map((playlist: Playlist) => ({
            ...playlist,
            catalog: true,
          })),
        );
        setPlaylists((prev) => {
          const merged = new Map(prev.map((playlist) => [normalizeSpotifyPlaylistId(playlist.id), playlist]));
          syncedPlaylists.forEach((playlist: Playlist) => {
            const id = normalizeSpotifyPlaylistId(playlist.id);
            const existing = merged.get(id);
            merged.set(id, existing ? { ...existing, ...playlist } : playlist);
          });
          return Array.from(merged.values());
        });
        if (payload?.mixFinalized === true) {
          const syncedPlaylistKey = selectionPlaylistKey(syncedPlaylists);
          if (syncedPlaylistKey) {
            setFinalizedMixPlaylistKey(syncedPlaylistKey);
            finalizedOrderPlaylistKeyRef.current = syncedPlaylistKey;
          }
        }
      }
      if (Array.isArray(payload?.playedSongs)) {
        const detailedPlayedSongs = payload.playedSongs
          .map((song: any) => normalizeSyncedSongForHost(song))
          .filter((song: Song | null): song is Song => song != null);
        if (detailedPlayedSongs.length > 0) {
          const deduped = detailedPlayedSongs.filter(
            (song: Song, index: number, arr: Song[]) =>
              arr.findIndex((candidate: Song) => candidate.id === song.id) === index,
          );
          setPlayedInOrder(
            deduped.map(({ id, name, artist }: Song) => ({ id, name, artist })),
          );
        } else if (
          gameStateRef.current !== 'playing' &&
          ((typeof payload?.totalPlayedCount === 'number' && payload.totalPlayedCount === 0) ||
            (Array.isArray(payload?.playedSongIds) && payload.playedSongIds.length === 0))
        ) {
          setPlayedInOrder([]);
        }
      }
      if (typeof payload?.currentSongIndex === 'number' && Number.isFinite(payload.currentSongIndex)) {
        setPlaybackTrackNumber(payload.currentSongIndex + 1);
      } else if (payload?.currentSong == null) {
        setPlaybackTrackNumber(null);
      }
      if (typeof payload?.totalSongs === 'number' && Number.isFinite(payload.totalSongs) && payload.totalSongs > 0) {
        setPlaybackTrackTotal(payload.totalSongs);
      } else if (payload?.totalSongs === 0 || payload?.currentSong == null) {
        setPlaybackTrackTotal(null);
      }
      if (typeof payload?.selectedDeviceId === 'string' && payload.selectedDeviceId.trim() !== '') {
        pendingRoomDeviceIdRef.current = payload.selectedDeviceId.trim();
      }
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
      if (payload?.publicDisplayLetterRevealToast !== undefined) {
        setPublicDisplayLetterRevealToast(payload.publicDisplayLetterRevealToast !== false);
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
                playedSongs: cardData.playedSongs || [],
                inPerson: cardData.inPerson !== false,
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
      if (roomId && gameStateRef.current === 'playing') {
        const now = Date.now();
        if (now - lastResumePingAtRef.current > 10000) {
          lastResumePingAtRef.current = now;
          setTimeout(() => {
            try { newSocket.emit('resume-song', { roomId }); } catch {}
          }, 500);
        }
      }
      void (async () => {
        try {
          const response = await hostFetch(`${API_BASE || ''}/api/spotify/status?_=${Date.now()}`);
          const data = (await response.json()) as { connected?: boolean; webApiQuarantine?: unknown };
          writeHostSpotifyWebEnabled(data.connected === true);
          if (data.webApiQuarantine != null) {
            setWebApiQuarantine(normalizeWebApiQuarantine(data.webApiQuarantine));
          }
          if (data.connected === true) {
            setIsSpotifyConnected(true);
            setIsSpotifyConnecting(false);
            const now = Date.now();
            if (now - lastLoadPlaylistsOnSocketReconnectAtRef.current > 90_000) {
              lastLoadPlaylistsOnSocketReconnectAtRef.current = now;
              await loadPlaylistsSocketRef.current();
            }
            if (now - lastLoadDevicesOnSocketReconnectAtRef.current > 60_000) {
              lastLoadDevicesOnSocketReconnectAtRef.current = now;
              await new Promise((r) => setTimeout(r, 1200));
              await loadDevicesSocketRef.current();
            }
            await new Promise((r) => setTimeout(r, 800));
            await fetchPlaybackState();
          } else {
            setIsSpotifyConnected(false);
          }
        } catch (e) {
          console.warn('Reconnect Spotify status refresh failed:', e);
        }
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
      gameStateRef.current = 'waiting';
      setGameState('waiting');
      clearActiveHostRoom();
      setCurrentSong(null);
      setWinners([]);
      setMixFinalized(false);
      lastFinalizePlaylistKeyRef.current = null;
      setSongList([]);
      invalidateSetlistBuildCacheSocketRef.current();
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
      showHostAckNotificationSocketRef.current({
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

    newSocket.on('host-join-denied', (data: any) => {
      console.warn('host-join-denied:', data);
      addLog(data.message || 'This room already has a host.', 'error');
      if (data.reason === 'host_not_approved') {
        try {
          sessionStorage.setItem('skip_prefill_host_nav', '1');
        } catch {
          /* ignore */
        }
        navigateSocketRef.current(`/?mode=host&auth_error=host_not_approved`);
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
        navigateSocketRef.current(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
        return;
      }
      if (data.reason === 'not_room_owner') {
        try {
          sessionStorage.setItem('skip_prefill_host_nav', '1');
        } catch {
          /* ignore */
        }
        navigateSocketRef.current(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
        return;
      }
      /** Room already has an active host socket (other tab, other device, or race). Never send the host UI to /player — that was confusing and looked like a random redirect. */
      if (data.reason === 'room_has_host') {
        try {
          sessionStorage.setItem('skip_prefill_host_nav', '1');
        } catch {
          /* ignore */
        }
        navigateSocketRef.current(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
        return;
      }
      try {
        sessionStorage.setItem('skip_prefill_host_nav', '1');
      } catch {
        /* ignore */
      }
      if (roomId) {
        navigateSocketRef.current(`/?mode=host&prefillRoom=${encodeURIComponent(roomId || '')}`);
      } else {
        navigateSocketRef.current('/?mode=host');
      }
    });

    // Handle successful room join
    newSocket.on('room-joined', (data: any) => {
      console.log('Successfully joined room:', data);
      if (typeof data?.hybridInPersonPlusOnline === 'boolean') {
        setHybridInPersonPlusOnline(data.hybridInPersonPlusOnline);
      }
      addLog(`Joined room ${roomId} successfully`, 'info');
      if (roomId) {
        newSocket.emit('sync-state', { roomId });
        newSocket.emit('request-finalized-order', { roomId });
      }
    });

    // Join as host after the socket is connected so the handshake runs first; re-read JWT at emit time.
    const onConnectJoin = () => emitHostJoinImpl();
    emitHostJoinImpl = () => {
      if (!roomId || hostJoinEmitted) return;
      hostJoinEmitted = true;
      console.log('Joining room as host');
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
      if (spotifyStatusCheckInFlightRef.current) return;
      spotifyStatusCheckInFlightRef.current = true;
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
        if (!response.ok) {
          console.warn('Spotify status HTTP', response.status);
          setIsSpotifyConnected(false);
          setIsSpotifyConnecting(false);
          return;
        }
        const data = (await response.json()) as { connected?: boolean; webApiQuarantine?: unknown };
        writeHostSpotifyWebEnabled(data.connected === true);
        if (data.webApiQuarantine != null) {
          setWebApiQuarantine(normalizeWebApiQuarantine(data.webApiQuarantine));
        }

        if (data.connected) {
          try {
            sessionStorage.removeItem(SPOTIFY_SKIP_AUTO_CONNECT_KEY);
          } catch {
            /* ignore */
          }
          console.log('Spotify already connected, loading playlists...');
          console.log('?? Status API returned connected=true, setting state to true');
          setIsSpotifyConnected(true);
          setIsSpotifyConnecting(false);
          await loadPlaylistsSocketRef.current();
          await new Promise((r) => setTimeout(r, 1500));
          await loadDevicesSocketRef.current();
          
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
        spotifyStatusCheckInFlightRef.current = false;
        setSpotifyInitialCheckDone(true);
      }
    };

    checkSpotifyStatus();

    // Cleanup socket listeners; defer close so refresh/remount does not instantly drop a live server room
    return () => {
      newSocket.off('connect', onConnectJoin);
      if (playerCardsRefreshTimer) clearTimeout(playerCardsRefreshTimer);
      scheduleReleaseHostRoomSocket(hostSocketGeneration);
      spotifyStatusCheckInFlightRef.current = false;
      // Clear any pending volume timeout
      if (volumeTimeout) {
        clearTimeout(volumeTimeout);
      }
    };
  }, [hostAuthBootstrapDone, roomId, hostPlayerName, clientId]);

  useEffect(() => {
    spotifyAutoConnectAttemptedRef.current = false;
  }, [roomId]);

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
        try {
          sessionStorage.removeItem(SPOTIFY_SKIP_AUTO_CONNECT_KEY);
        } catch {
          /* ignore */
        }
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

  const connectSpotifyRef = useRef(connectSpotify);
  useEffect(() => {
    connectSpotifyRef.current = connectSpotify;
  }, [connectSpotify]);

  /** On host room load: start Spotify OAuth when tokens are missing (once per visit unless host disconnected). */
  useEffect(() => {
    if (!hostAuthBootstrapDone || !spotifyInitialCheckDone || !roomId) return;
    if (isSpotifyConnected || isSpotifyConnecting) return;
    if (showYoutubeMusicInConnectionModal && !mixNeedsHostSpotify) return;
    try {
      if (new URLSearchParams(window.location.search).get('spotify') === 'connected') return;
      if (sessionStorage.getItem(SPOTIFY_SKIP_AUTO_CONNECT_KEY) === '1') return;
    } catch {
      /* ignore */
    }
    if (spotifyAutoConnectAttemptedRef.current) return;
    spotifyAutoConnectAttemptedRef.current = true;
    initialConnectionPromptRef.current = true;
    void connectSpotifyRef.current();
  }, [
    hostAuthBootstrapDone,
    spotifyInitialCheckDone,
    roomId,
    isSpotifyConnected,
    isSpotifyConnecting,
    showYoutubeMusicInConnectionModal,
    mixNeedsHostSpotify,
  ]);

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
    /** Server free-center flag for this finalize (defaults to host free-center toggle). */
    freeSpace?: boolean;
  }): Promise<boolean> => {
    const playlists = opts?.playlists ?? mixPlaylistSelection;
    if (!socket || playlists.length === 0) return false;
    const freeSpaceForPayload = opts?.freeSpace ?? freeSpaceEnabled;

    const targetKey = selectionPlaylistKey(playlists);
    const uiKey = selectionPlaylistKey(mixPlaylistSelection);

    const inFlight = finalizeMixPromiseRef.current;
    if (inFlight) {
      setFinalizeMixBusy(true);
      addLog('Waiting for finalize already in progress…', 'info');
      return inFlight;
    }

    setFinalizeMixBusy(true);
    finalizeMixInFlightRef.current = true;

    const run = async (): Promise<boolean> => {
      try {
        let listToSend: Song[];

        if (opts?.songListOverride && opts.songListOverride.length > 0) {
          addLog('Applying saved round snapshot to the room (display + player cards)…', 'info');
          listToSend = opts.songListOverride.map(cloneSongForSnapshot);
        } else if (
          mixFinalized &&
          targetKey === uiKey &&
          finalizedOrderRef.current &&
          finalizedOrderRef.current.length > 0 &&
          finalizedOrderPlaylistKeyRef.current === targetKey
        ) {
          addLog('Reshuffling finalized mix for a new pool order…', 'info');
          listToSend = finalizedOrderRef.current.map((s) => ({ ...s }));
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
          const perListCounts = playlists.map((pl) => {
            const canon = canonicalPlaylistIdForMatch(String(pl.id));
            const n = listToSend.filter(
              (s) => canonicalPlaylistIdForMatch(String(s.sourcePlaylistId || '')) === canon,
            ).length;
            return { name: pl.name, count: n };
          });
          const trueShort = perListCounts.filter((p) => p.count < 15);
          if (trueShort.length > 0) {
            const warnings = trueShort.map(
              (p) =>
                `Playlist "${p.name}" has only ${p.count} track(s) in the mix (needs 15). Reload playlists or check tags.`,
            );
            addLog('Finalize blocked: each of five playlists needs at least 15 tracks in the mix.', 'error');
            warnings.forEach((line) => addLog(`  ${line}`, 'warn'));
            setFiveByFifteenInsufficientModal({ variant: 'blocked', warnings });
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
            const fk = selectionPlaylistKey(playlists);
            finalizedOrderPlaylistKeyRef.current = fk;
            lastFinalizePlaylistKeyRef.current = fk;
            setFinalizedMixPlaylistKey(fk);
            const finalizedSongs = songsFromServerPlaybackPayload(data?.songList);
            if (finalizedSongs.length > 0) {
              finalizedOrderRef.current = finalizedSongs;
              setFinalizedOrder(finalizedSongs);
              setSongList(finalizedSongs);
              applyLoadedTrackCountsFromSongs(finalizedSongs);
              lastFinalizeMixSongListRef.current = finalizedSongs;
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
        setFinalizeMixBusy(false);
      }
    };

    const p = run();
    finalizeMixPromiseRef.current = p;
    return p;
  };

  const fetchPrintableCardsFromServer = useCallback(
    (
      count: number,
      emitBody: Record<string, unknown>,
    ): Promise<{ cards: PrintableCard[]; freeSpace: boolean; logoUrl?: string }> => {
      if (!socket || !roomId) {
        return Promise.reject(new Error('Connect to the room first.'));
      }
      return new Promise((resolve, reject) => {
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const cleanup = () => {
          socket.off('printable-cards-result', onOk);
          socket.off('printable-cards-error', onErr);
          if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
        };
        const onOk = (payload: any) => {
          cleanup();
          const cards = Array.isArray(payload?.cards) ? payload.cards : [];
          if (cards.length === 0) {
            reject(new Error('No cards returned from server.'));
            return;
          }
          const logoUrl =
            payload?.venueBranding && typeof payload.venueBranding.logoUrl === 'string'
              ? payload.venueBranding.logoUrl
              : undefined;
          resolve({
            cards,
            freeSpace: !!payload?.freeSpace,
            logoUrl,
          });
        };
        const onErr = (payload: any) => {
          cleanup();
          let msg =
            typeof payload?.message === 'string'
              ? payload.message
              : 'Could not generate printable cards.';
          if (typeof payload?.orgPortalUrl === 'string' && payload.orgPortalUrl.trim()) {
            msg += `\n\nOpen Account: ${payload.orgPortalUrl.trim()}`;
          }
          reject(new Error(msg));
        };
        timeoutId = globalThis.setTimeout(() => {
          cleanup();
          reject(new Error('Timed out waiting for printable cards. Try again.'));
        }, 90000);
        socket.on('printable-cards-result', onOk);
        socket.on('printable-cards-error', onErr);
        socket.emit('request-printable-cards', { roomId, count, ...emitBody });
      });
    },
    [socket, roomId],
  );

  const handlePreviewPrintPdf = useCallback(() => {
    if (!socket || !roomId) return;
    void (async () => {
      setPrintablePdfLoading(true);
      try {
        let finalizedOk = mixFinalized;
        if (!finalizedOk) finalizedOk = await finalizeMix();
        if (!finalizedOk) return;
        const { cards, freeSpace, logoUrl } = await fetchPrintableCardsFromServer(1, { previewOnly: true });
        const blob = await buildPrintableBingoPdfBlob(cards, {
          freeSpace,
          logoUrl,
          previewWatermark: true,
          subtitle: 'Preview — watermarked sample',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tempo-preview-${roomId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Could not build preview PDF.');
      } finally {
        setPrintablePdfLoading(false);
      }
    })();
  }, [socket, roomId, mixFinalized, finalizeMix, fetchPrintableCardsFromServer]);

  const requestPrintablePdfDownload = useCallback(
    (opts: {
      pdfSubtitle: string;
      fileSlug: string;
      freeSpace?: boolean;
      roundName?: string;
      patternLabel?: string;
      roomLabel?: string;
      columnLabels?: string[];
      singlePlaylistTitle?: string;
      roundExport?: {
        songs: Song[];
        mixGeometry: SavedMixGeometry;
        playlistIds: string[];
        freeSpace?: boolean;
      };
    }) => {
      if (!socket || !roomId) return;

      void (async () => {
        const useSnapshot = !!(opts.roundExport?.songs?.length);
        if (!useSnapshot) {
          let finalizedOk = mixFinalized;
          if (!finalizedOk) finalizedOk = await finalizeMix();
          if (!finalizedOk) return;
        }

        const count = Math.min(200, Math.max(1, Math.floor(Number(printableCardCount)) || 30));
        setPrintablePdfLoading(true);
        try {
          const { cards, freeSpace, logoUrl } = await fetchPrintableCardsFromServer(count, {
            ...(opts.freeSpace !== undefined ? { freeSpace: opts.freeSpace } : {}),
            ...(useSnapshot && opts.roundExport
              ? {
                  roundExport: {
                    songs: opts.roundExport.songs.map(cloneSongForSnapshot),
                    mixGeometry: opts.roundExport.mixGeometry,
                    playlistIds: opts.roundExport.playlistIds,
                    freeSpace: opts.freeSpace,
                  },
                }
              : {}),
          });
          const blob = await buildPrintableBingoPdfBlob(cards, {
            freeSpace,
            subtitle: opts.pdfSubtitle,
            roundName: opts.roundName,
            patternLabel: opts.patternLabel,
            roomLabel: opts.roomLabel ?? `Room ${roomId}`,
            columnLabels: opts.columnLabels,
            singlePlaylistTitle: opts.singlePlaylistTitle,
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
          window.alert(e instanceof Error ? e.message : 'Could not build printable PDF.');
        } finally {
          setPrintablePdfLoading(false);
        }
      })();
    },
    [
      socket,
      roomId,
      mixFinalized,
      printableCardCount,
      finalizeMix,
      fetchPrintableCardsFromServer,
    ],
  );

  const roundPrintMetaFor = useCallback(
    (round: EventRound) => ({
      roundName: round.name,
      roomLabel: `Room ${roomId}`,
      pattern: round.bingoPattern ?? 'line',
      linesRequired: round.linesRequired,
      patternComposite: round.patternComposite,
    }),
    [roomId],
  );

  /** Printable PDF from saved round snapshot (pre-show) — not the live room pool. */
  const handleDownloadRoundPrintablePdf = useCallback(
    (round: EventRound | undefined) => {
      if (!round) return;
      const ids = playlistIdsForRoundExport(round);
      if (ids.length === 0) return;
      if (!eventRoundSnapshotMeetsSaveThreshold(round, freeSpaceEnabled)) {
        window.alert(
          'Save this round first. Print PDF uses the frozen snapshot from Save round (same pool as the call sheet), not the current live mix.',
        );
        return;
      }
      const snap = round.savedMixSnapshot!;
      const fs = round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : freeSpaceEnabled;
      const meta = roundPrintMetaFor(round);
      const safeSlug = (round.name || 'round').replace(/[^\w\-]+/g, '_').slice(0, 48);
      requestPrintablePdfDownload({
        pdfSubtitle: roundPrintablePdfSubtitle(meta),
        fileSlug: safeSlug,
        freeSpace: fs,
        roundName: round.name,
        patternLabel: roundPatternLabelForPrint(meta),
        roomLabel: meta.roomLabel,
        ...playlistStemPrintLabelsForRound(round),
        roundExport: {
          songs: snap.songs,
          mixGeometry: snap.mixGeometry,
          playlistIds: ids,
          freeSpace: fs,
        },
      });
    },
    [requestPrintablePdfDownload, freeSpaceEnabled, roundPrintMetaFor],
  );

  /** One PDF: host call lists for all saved rounds, then printable bingo cards. */
  const handlePrintAllPreShowPdf = useCallback(() => {
    if (!socket || !roomId) {
      window.alert('Connect to the room first.');
      return;
    }
    const saved = eventRoundsRef.current.filter((r) =>
      eventRoundSnapshotMeetsSaveThreshold(r, freeSpaceEnabled),
    );
    if (saved.length === 0) {
      window.alert('No saved rounds yet. Use Save round on each bucket you want in the export.');
      return;
    }

    void (async () => {
      const count = Math.min(200, Math.max(1, Math.floor(Number(printableCardCount)) || 30));
      setPrintablePdfLoading(true);
      try {
        const callSections = saved.map((round) => {
          const meta = roundPrintMetaFor(round);
          return {
            roundName: round.name,
            roomLabel: `Room ${roomId}`,
            patternLabel: roundPatternLabelForPrint(meta),
            tracks: round.savedMixSnapshot!.songs.map((s) => ({
              name: s.name,
              artist: s.artist,
            })),
          };
        });
        const cardSections: PrintablePdfSection[] = [];
        for (const round of saved) {
          const snap = round.savedMixSnapshot!;
          const fs =
            round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : freeSpaceEnabled;
          const meta = roundPrintMetaFor(round);
          const exportPlaylistIds = playlistIdsForRoundExport(round);
          const { cards, freeSpace, logoUrl } = await fetchPrintableCardsFromServer(count, {
            freeSpace: fs,
            roundExport: {
              songs: snap.songs.map(cloneSongForSnapshot),
              mixGeometry: snap.mixGeometry,
              playlistIds: exportPlaylistIds,
              freeSpace: fs,
            },
          });
          cardSections.push({
            cards,
            opts: {
              freeSpace,
              subtitle: roundPrintablePdfSubtitle(meta),
              roundName: round.name,
              patternLabel: roundPatternLabelForPrint(meta),
              roomLabel: meta.roomLabel,
              ...playlistStemPrintLabelsForRound(round),
              logoUrl,
            },
          });
        }
        const blob = await buildCombinedPreShowPdfBlob(callSections, cardSections);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tempo-pre-show-all-rounds-${roomId}-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error(e);
        window.alert(e instanceof Error ? e.message : 'Could not build pre-show PDF.');
      } finally {
        setPrintablePdfLoading(false);
      }
    })();
  }, [
    socket,
    roomId,
    freeSpaceEnabled,
    printableCardCount,
    fetchPrintableCardsFromServer,
    roundPrintMetaFor,
  ]);

  const handleDownloadRoundCallSheetPdf = useCallback(
    (round: EventRound | undefined) => {
      if (!round) return;
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
        const meta = roundPrintMetaFor(round);
        const blob = buildRoundCallSheetPdfBlob({
          roundName: round.name,
          roomLabel: `Room ${roomId}`,
          patternLabel: roundPatternLabelForPrint(meta),
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
    [roomId, freeSpaceEnabled, roundPrintMetaFor],
  );

  const startGame = async (opts?: { roundOverride?: EventRound | null; playlistsOverride?: Playlist[] | null }) => {
    if (!socket) {
      console.error('Socket not connected');
      return false;
    }

    const roundForStart =
      opts?.roundOverride ??
      (currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length ? eventRounds[currentRoundIndex] : null);
    const playlistsForStart =
      opts?.playlistsOverride && opts.playlistsOverride.length > 0 ? opts.playlistsOverride : mixPlaylistSelection;
    const needsHostSpotifyForStart = playlistsForStart.some(
      (p) => p.youtubeMusic !== true && p.catalog !== true,
    );

    if (needsHostSpotifyForStart && !isSpotifyConnected) {
      alert('Spotify is not connected. Open Connection in the header and connect Spotify first.');
      return false;
    }

    const freeSpaceForStart =
      roundForStart?.freeSpaceEnabled !== undefined
        ? roundForStart.freeSpaceEnabled
        : freeSpaceEnabled;
    const needSnapTracks = freeSpaceForStart ? 24 : 25;
    const snapPool = roundForStart?.savedMixSnapshot?.songs;
    const useSavedRoundPlayback =
      !!roundForStart && !!snapPool && snapPool.length >= needSnapTracks;

    if (!useSavedRoundPlayback && playlistsForStart.length === 0) {
      alert('Please select at least one playlist or official catalog pack');
      return false;
    }

    if (needsHostSpotifyForStart && !selectedDevice) {
      connectionModalOpenedByUserRef.current = false;
      setShowConnectionModal(true);
      alert(
        'Please select a Spotify playback device first.\n\nPick a device under Playback device in the Connection panel (also under Settings), or open Spotify on your target device and tap Refresh devices.'
      );
      return false;
    }

    if (needsHostSpotifyForStart && playbackDeviceNotInList) {
      connectionModalOpenedByUserRef.current = false;
      setShowConnectionModal(true);
      alert(
        'Your selected Spotify device is not available right now. Open Spotify on that device, tap Refresh devices in Connection, and pick it again.'
      );
      return false;
    }

    if (needsHostSpotifyForStart && selectedDevice) {
      syncSelectedPlaybackDeviceToRoom(selectedDevice);
    }

    const resolveSongListForStart = () =>
      finalizedOrder && finalizedOrder.length > 0
        ? finalizedOrder
        : songList.length > 0
          ? songList
          : lastFinalizeMixSongListRef.current ?? [];

    if (!useSavedRoundPlayback && resolveSongListForStart().length === 0) {
      alert(
        needsHostSpotifyForStart
          ? 'No songs loaded from playlists. Ensure Spotify is connected and playlists have tracks, then try again.'
          : 'No songs loaded. Open Connection and connect YouTube Music if needed, load playlists, then try Show Playlists or Start Game again.'
      );
      return false;
    }

    try {
      if (!useSavedRoundPlayback && !mixFinalized) {
        addLog('Finalizing mix before start...', 'info');
        const ok = await finalizeMix(opts?.playlistsOverride ? { playlists: playlistsForStart } : undefined);
        if (!ok) {
          alert(
            'Could not finalize the mix in time. Try Show Playlists, wait for the confirmation, then Start Game.'
          );
          return false;
        }
      }

      let songListForStart = useSavedRoundPlayback && snapPool
        ? snapPool.map(cloneSongForSnapshot)
        : resolveSongListForStart();

      if (songListForStart.length === 0) {
        alert('No song pool is available. Refresh the page or load playlists again.');
        return false;
      }

      console.log('Starting game with playlists:', playlistsForStart);
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
            'This round uses a combined pattern but it could not be loaded. Configure Combined (AND/OR) in Round builder.',
          );
          setIsStartingGame(false);
          return false;
        }
        compositeForStart = spec;
      }

      if (patternForStart === 'custom' && maskForStart.length === 0) {
        window.alert(
          'This round uses a custom pattern but no squares are saved. Choose a saved custom pattern in Round builder.',
        );
        setIsStartingGame(false);
        return false;
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
        addLog('Starting game from saved round — server shuffles playback order, then plays 1→N', 'info');
      } else if (mixFinalized) {
        addLog('Starting game — server shuffles playback order from your bingo pool, then plays 1→N', 'info');
      }

      socket.emit('start-game', {
        roomId,
        playlists: playlistsForStart,
        snippetLength,
        deviceId: needsHostSpotifyForStart && selectedDevice ? selectedDevice.id : undefined,
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
      return true;
    } catch (error) {
      console.error('Error starting game:', error);
      setIsStartingGame(false);
      return false;
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
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: 4,
              }}
            >
              <span>{playerData.playerName}</span>
              {(playerData.inPerson === false ||
                joinedPlayersRoster.get(playerId)?.inPerson === false) && (
                <OnlinePlayerBadge compact={compact} />
              )}
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
              {bingoSquaresInGridOrder(playerData.card.squares).map((square: any) => {
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
                  customArtistName: square.customArtistName,
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

  useEffect(() => {
    if (!showBingoPoolModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowBingoPoolModal(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [showBingoPoolModal]);

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
      clearPrepMixPlaybackState();
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
    clearPrepMixPlaybackState();
    setSongList([]);
    invalidateSetlistBuildCache();
    setGameState('waiting');
    setCurrentSong(null);
    setWinners([]);
    setRoundComplete(null);
    setRoundWinners([]);
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

  const handleEditSongAlias = (song: { id: string; title: string; artist: string }) => {
    setEditingSong(song);
    setShowSongTitleModal(true);
  };

  const handleSaveSongAlias = (songId: string, title: string, artist: string) => {
    if (socket && roomId) {
      socket.emit('set-song-alias', { roomId, songId, title, artist });
    }
  };

  const handleClearSongAlias = (songId: string) => {
    if (socket && roomId) {
      socket.emit('clear-song-alias', { roomId, songId });
    }
  };

  const playbackSettingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (playbackSettingsSyncTimerRef.current) {
        clearTimeout(playbackSettingsSyncTimerRef.current);
        playbackSettingsSyncTimerRef.current = null;
      }
    };
  }, []);

  const syncLivePlaybackSettingsToServer = useCallback(
    (patch: { snippetLength?: number; randomStarts?: 'none' | 'early' | 'random' }) => {
      if (!socket || !roomId) return;
      const gs = gameStateRef.current;
      if (gs !== 'playing') return;
      try {
        socket.emit('set-playback-settings', { roomId, ...patch });
      } catch {
        /* ignore */
      }
    },
    [socket, roomId],
  );

  const handleSnippetLengthChange = useCallback(
    (seconds: number) => {
      const n = Math.min(120, Math.max(5, Math.round(seconds)));
      setSnippetLength(n);
      if (playbackSettingsSyncTimerRef.current) {
        clearTimeout(playbackSettingsSyncTimerRef.current);
      }
      playbackSettingsSyncTimerRef.current = setTimeout(() => {
        playbackSettingsSyncTimerRef.current = null;
        syncLivePlaybackSettingsToServer({ snippetLength: n });
      }, 200);
    },
    [syncLivePlaybackSettingsToServer],
  );

  const handleRandomStartsChange = useCallback(
    (mode: 'none' | 'early' | 'random') => {
      setRandomStarts(mode);
      syncLivePlaybackSettingsToServer({ randomStarts: mode });
    },
    [syncLivePlaybackSettingsToServer],
  );

  const getDisplaySongTitle = (songId: string, originalTitle: string) =>
    displayTitleForSong(songId, originalTitle, songAliases);

  const getDisplaySongArtist = (songId: string, originalArtist: string) =>
    displayArtistForSong(songId, originalArtist, songAliases);

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
        setCanUndoSkip(true);
        window.setTimeout(() => setCanUndoSkip(false), 15000);
        console.log('Skipped to next track via socket');
      }
    } catch (error) {
      console.error('Error skipping song:', error);
    }
  };

  const undoLastSkip = useCallback(() => {
    if (!socket || !roomId) return;
    socket.emit('undo-skip-song', { roomId });
  }, [socket, roomId]);

  const replayCurrentClip = useCallback(() => {
    if (!socket || !roomId) return;
    socket.emit('replay-current-snippet', { roomId });
  }, [socket, roomId]);

  const markCurrentSongPlayed = useCallback(() => {
    if (!socket || !roomId || !currentSong?.id) return;
    setMarkPlayedBusy(true);
    socket.emit('mark-current-song-played', { roomId });
  }, [socket, roomId, currentSong?.id]);

  const openBingoVerification = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    bingoVerificationModalRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    playHostAlertSound();
  }, []);

  const bingoVerificationCount = pendingVerification ? 1 + bingoVerificationBehindCount : 0;


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

  /** Close round-complete celebration without starting the next round or ending the session. */
  const dismissRoundCompleteModal = useCallback(() => {
    setEventRounds((prev) => {
      const cur = currentRoundIndexRef.current;
      if (cur < 0 || cur >= prev.length || prev[cur].status === 'completed') return prev;
      const next = [...prev];
      next[cur] = { ...next[cur], status: 'completed', completedAt: Date.now() };
      try {
        if (roomId) localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setRoundComplete(null);
    setGamePaused(true);
    gameStateRef.current = 'waiting';
    setGameState('waiting');
    showToast('Round marked complete — use Round Planner to prep or start the next round when ready.', 'info');
    addLog('Round complete modal dismissed — current round marked complete', 'info');
  }, [showToast, addLog, roomId]);





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

      /** Multi-playlist mixes (5×15): same track may appear once per column playlist — do not collapse by id only. */
      const allowSameTrackAcrossPlaylists = rows.length > 1;

      const dedupeAndShuffle = (songs: Song[]) => {
        const seen = new Set<string>();
        const uniqueSongs = songs.filter((song) => {
          if (!song?.id) return false;
          const pid = canonicalPlaylistIdForMatch(String(song.sourcePlaylistId || ''));
          const key =
            allowSameTrackAcrossPlaylists && pid ? `${pid}::${song.id}` : song.id;
          if (seen.has(key)) return false;
          seen.add(key);
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
        applyLoadedTrackCountsFromSongs(shuffledSongs);
        console.log(`Setlist: ${shuffledSongs.length} songs (reused already-loaded tracks)`);
        return shuffledSongs;
      }

      try {
        let allSongs: Song[] = [...kept];

        const needsHostSpotifyApi = toFetch.some((p) => !p.youtubeMusic && p.catalog !== true);
        if (needsHostSpotifyApi && !readHostSpotifyWebEnabled()) {
          setSongList([]);
          return [];
        }
        if (needsHostSpotifyApi && webApiQuarantineRef.current.active === true) {
          if (kept.length > 0) {
            const shuffledSongs = dedupeAndShuffle(kept);
            if (genRef.current !== myBuild) return [];
            setSongList(shuffledSongs);
            applyLoadedTrackCountsFromSongs(shuffledSongs);
            return shuffledSongs;
          }
          showHostAckNotification({
            id: 'setlist-skipped-quarantine',
            title: 'Spotify rate limit',
            variant: 'warning',
            message:
              'TEMPO is pausing Spotify track imports after a recent rate limit. Wait for cooldown, then change your mix selection or tap Refresh on a playlist.',
          });
          setSongList([]);
          return [];
        }

        let skippedForUpstreamCooldown = 0;
        for (let i = 0; i < toFetch.length; i++) {
          if (genRef.current !== myBuild) {
            return [];
          }
          const playlist = toFetch[i];
          // Recent Spotify 5xx for this playlist: skip auto-rehydration until the cooldown
          // passes (stable warning instead of a request/banner loop). Manual Refresh (force)
          // bypasses this; the server still enforces its own org+playlist cooldown.
          if (!opts?.force && playlist.catalog !== true && playlist.youtubeMusic !== true) {
            const unavailableUntil = playlistTracksUnavailableUntilRef.current.get(playlist.id) || 0;
            if (unavailableUntil > Date.now()) {
              skippedForUpstreamCooldown += 1;
              continue;
            }
          }
          const gapMs = delayMsBetweenPlaylistTrackFetches(i, toFetch.length);
          if (gapMs > 0) {
            await new Promise((r) => setTimeout(r, gapMs));
          }
          const qs = new URLSearchParams();
          if (playlist.name) qs.set('playlistName', playlist.name);
          if (opts?.force) qs.set('refresh', '1');
          const q = qs.toString();
          const catalog = playlist.catalog === true;
          const yt = playlist.youtubeMusic === true;
          const url = yt
            ? `${API_BASE || ''}/api/youtube/music/playlist/${encodeURIComponent(playlist.id)}/items${q ? `?${q}` : ''}`
            : catalog
            ? `${API_BASE || ''}/api/spotify/catalog/playlist/${playlist.id}${q ? `?${q}` : ''}`
            : `${API_BASE || ''}/api/spotify/playlist-tracks/${playlist.id}${q ? `?${q}` : ''}`;
          const response = await hostFetch(url, { cache: 'no-store' });
          const data = (await response.json()) as {
            success?: boolean;
            tracks?: Song[];
            loadStats?: PlaylistLoadStats;
            webApiQuarantine?: unknown;
            error?: string;
            message?: string;
            retryAfterSec?: number;
            upstreamUnavailable?: boolean;
            cacheMessage?: string;
          };

          if (genRef.current !== myBuild) {
            return [];
          }
          if (data.webApiQuarantine != null) {
            setWebApiQuarantine(normalizeWebApiQuarantine(data.webApiQuarantine));
          }
          if (response.status === 429) {
            showHostAckNotification({
              id: 'setlist-playlist-tracks-429',
              title: 'Spotify rate limit',
              variant: 'warning',
              message:
                'Stopped importing playlist tracks — Spotify is rate-limiting. Loaded tracks are kept; wait and retry.',
            });
            break;
          }
          if (response.status === 503 && data.error === 'spotify_upstream_unavailable') {
            // Transient Spotify outage, not an auth problem — Spotify stays connected, no reconnect prompt.
            // Remember the cooldown so this playlist is not auto-refetched in a loop.
            const waitSec =
              typeof data.retryAfterSec === 'number' && data.retryAfterSec > 0 ? data.retryAfterSec : 45;
            playlistTracksUnavailableUntilRef.current.set(playlist.id, Date.now() + waitSec * 1000);
            showHostAckNotification({
              id: 'setlist-playlist-tracks-503',
              title: 'Spotify API temporarily unavailable',
              variant: 'warning',
              message:
                'Spotify is connected, but Spotify’s API is temporarily unavailable while loading playlist tracks. Cached tracks are used where possible — try again in a moment (no need to reconnect).',
            });
            continue;
          }
          if (data.success && data.tracks && data.upstreamUnavailable) {
            showHostAckNotification({
              id: 'setlist-playlist-tracks-stale-cache',
              title: 'Using cached tracks',
              variant: 'warning',
              message: data.cacheMessage || 'Using cached tracks because Spotify is temporarily unavailable.',
            });
          }
          if (data.success && data.tracks) {
            const plCanon = canonicalPlaylistIdForMatch(playlist.id);
            const rows = (yt ? data.tracks.map((t) => ({ ...t, youtubeMusic: true as const })) : data.tracks).map(
              (t) => ({
                ...t,
                sourcePlaylistId:
                  t.sourcePlaylistId != null && String(t.sourcePlaylistId).trim() !== ''
                    ? t.sourcePlaylistId
                    : plCanon,
                sourcePlaylistName:
                  typeof t.sourcePlaylistName === 'string' && t.sourcePlaylistName.trim() !== ''
                    ? t.sourcePlaylistName
                    : playlist.name,
              }),
            );
            allSongs.push(...rows);
            fullyLoadedPlaylistIdsRef.current.add(playlist.id);
            playlistTracksUnavailableUntilRef.current.delete(playlist.id);
            if (!catalog && !yt) {
              applyPlaylistExplicitKnowledge(playlist.id, data.tracks, setPlaylists, setSelectedPlaylists);
            }
            if (!catalog && !yt && data.loadStats) {
              applyPlaylistLoadStats(playlist.id, data.loadStats);
            }
          }
        }

        if (skippedForUpstreamCooldown > 0) {
          showHostAckNotification({
            id: 'setlist-playlist-tracks-503',
            title: 'Spotify API temporarily unavailable',
            variant: 'warning',
            message: `Spotify is connected, but Spotify’s API is temporarily unavailable for ${skippedForUpstreamCooldown} playlist${
              skippedForUpstreamCooldown !== 1 ? 's' : ''
            }. TEMPO will retry automatically on the next build — or tap Refresh to retry now.`,
          });
        }

        const shuffledSongs = dedupeAndShuffle(allSongs);
        if (genRef.current !== myBuild) {
          return [];
        }
        setSongList(shuffledSongs);
        applyLoadedTrackCountsFromSongs(shuffledSongs);
        console.log(`Generated ${shuffledSongs.length} shuffled songs (fetched ${toFetch.length} playlist(s), reused ${kept.length} track(s) from buffer)`);
        return shuffledSongs;
      } catch (error) {
        console.error('Error generating song list:', error);
        return [];
      }
    },
    [mixPlaylistSelection, isSpotifyConnected, setPlaylists, setSelectedPlaylists, applyLoadedTrackCountsFromSongs, applyPlaylistLoadStats]
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

  const rejectBingo = useCallback(async () => {
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
      reason: 'Invalid bingo pattern',
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
          description: `TEMPO output — Room ${roomId} — ${mixPlaylistSelection.map(p => p.name).join(', ')}`
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
            setPlaybackState(prev => ({ ...prev, isPlaying: spotifyIsPlaying }));
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
    const extra = setlistDebounceExtraAfterSpotifyConnectMsRef.current;
    setlistDebounceExtraAfterSpotifyConnectMsRef.current = 0;
    const debounceMs = 750 + (extra > 0 ? extra : 0);
    const t = window.setTimeout(() => {
      if (finalizeMixInFlightRef.current) return;
      void generateSongListRef.current({ reason: 'selection' });
    }, debounceMs);
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
  const lastForegroundResyncAtRef = React.useRef<number>(0);
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

  const resyncHostRoomState = useCallback(() => {
    if (!socket || !roomId) return;
    if (hostRoomExpectsLiveRecovery(roomId)) {
      setHostAwaitingLiveSync(true);
    }
    try {
      socket.emit('sync-state', { roomId });
      socket.emit('request-finalized-order', { roomId });
      socket.emit('request-player-cards', { roomId });
    } catch {
      /* ignore */
    }
  }, [socket, roomId]);

  useEffect(() => {
    if (!socket || !roomId) return;

    const resyncFromForeground = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastForegroundResyncAtRef.current < 4000) return;
      lastForegroundResyncAtRef.current = now;
      ignorePollingUntilRef.current = now + 8000;

      if (hostRoomExpectsLiveRecovery(roomId)) {
        setHostAwaitingLiveSync(true);
      }
      try {
        socket.emit('sync-state', { roomId });
        socket.emit('request-finalized-order', { roomId });
        socket.emit('request-player-cards', { roomId });
        // Do not resume-song here — server transfer+resume causes ~0.5s Spotify blips when the
        // host tab regains focus even though Connect playback never paused. Use play if truly paused.
      } catch {
        /* ignore */
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      resyncFromForeground();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resyncFromForeground();
      }
    };

    window.addEventListener('focus', resyncFromForeground);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', resyncFromForeground);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [socket, roomId]);

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
      setEventRounds((prev) => {
        const next = newRounds.map((r, i) => clearSnapshotIfPlaylistsChanged(r, prev[i]));
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
        } catch (error) {
          console.warn('Failed to save rounds to localStorage:', error);
        }
        return next;
      });
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
    },
    [roomId],
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

  /** Sync mix + fetch tracks for this round. Pass roundOverride right after add/remove — ref lags one commit. */
  const syncMixFromRound = useCallback(
    (roundIndex: number, roundOverride?: EventRound) => {
      const round = roundOverride ?? eventRoundsRef.current[roundIndex];
      if (!round || !(round.playlistIds || []).length) return;
      setRoundBuilderFocusIndex(roundIndex);
      applyRoundPlaylistsToMixSelection(round);
      const merged = resolveMixPlaylistRowsForRound(round);
      if (merged?.length) {
        void generateSongListRef.current({ reason: 'selection', playlists: merged });
      }
    },
    [applyRoundPlaylistsToMixSelection, resolveMixPlaylistRowsForRound],
  );

  /** Resolve a library, YouTube, or catalog pack row for round bucket add/remove. */
  const resolvePlaylistForRoundAssign = useCallback(
    (playlistId: string): Playlist | undefined => {
      const canon = canonicalPlaylistIdForMatch(String(playlistId));
      const fromLibrary = playlistsForRoundPlanner.find(
        (p) => canonicalPlaylistIdForMatch(String(p.id)) === canon,
      );
      if (fromLibrary) return fromLibrary;
      const fromCatalog = catalogPackOptions.find(
        (p) => canonicalPlaylistIdForMatch(String(p.id)) === canon,
      );
      return fromCatalog ? { ...fromCatalog, catalog: true } : undefined;
    },
    [playlistsForRoundPlanner, catalogPackOptions],
  );

  /** During live play, only the round currently being played is locked — all other rounds stay fully editable. */
  const roundLockedForLivePlay = useCallback((roundIndex: number) => {
    return gameStateRef.current === 'playing' && roundIndex === currentRoundIndexRef.current;
  }, []);

  /** Same behavior as dragging a library row into a round bucket (RoundPlanner drop). */
  const addPlaylistToRoundBucket = useCallback(
    (roundIndex: number, playlistId: string) => {
      if (roundLockedForLivePlay(roundIndex)) {
        showToast('That round is live — end the round before changing its playlists. Other rounds stay editable.', 'info');
        return;
      }
      const playlist = resolvePlaylistForRoundAssign(playlistId);
      if (!playlist) return;
      const prev = eventRoundsRef.current;
      if (roundIndex < 0 || roundIndex >= prev.length) return;
      const round = prev[roundIndex];
      const newPid = canonicalPlaylistIdForMatch(playlist.id);
      if (round.playlistIds.some((id) => canonicalPlaylistIdForMatch(id) === newPid)) return;

      const tracks = Math.max(0, Number(playlist.tracks) || 0);
      let updated: EventRound = {
        ...round,
        playlistIds: [...round.playlistIds, playlist.id],
        playlistNames: [...round.playlistNames, playlist.name],
        songCount: round.songCount + tracks,
        status: round.status === 'unplanned' ? 'planned' : round.status,
      };
      updated = sortRoundPlaylistsByBingoColumns(updated, playlistsForRoundPlanner);
      updated = clearSnapshotIfPlaylistsChanged(updated, round);

      setEventRounds((cur) => {
        if (roundIndex < 0 || roundIndex >= cur.length) return cur;
        const newRounds = [...cur];
        newRounds[roundIndex] = updated;
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(newRounds));
        } catch (error) {
          console.warn('Failed to save rounds to localStorage:', error);
        }
        return newRounds;
      });
      syncMixFromRound(roundIndex, updated);
    },
    [resolvePlaylistForRoundAssign, playlistsForRoundPlanner, roomId, syncMixFromRound, roundLockedForLivePlay, showToast],
  );

  const removePlaylistFromRoundBucket = useCallback(
    (roundIndex: number, playlistId: string) => {
      if (roundLockedForLivePlay(roundIndex)) {
        showToast('That round is live — end the round before changing its playlists. Other rounds stay editable.', 'info');
        return;
      }
      const prev = eventRoundsRef.current;
      if (roundIndex < 0 || roundIndex >= prev.length) return;
      const round = prev[roundIndex];
      const canon = canonicalPlaylistIdForMatch(String(playlistId));
      const playlistIndex = round.playlistIds.findIndex(
        (id) => canonicalPlaylistIdForMatch(String(id)) === canon,
      );
      if (playlistIndex === -1) return;

      const playlist = resolvePlaylistForRoundAssign(playlistId);
      const playlistTracks = Math.max(0, Number(playlist?.tracks) || 0);
      let updated: EventRound = {
        ...round,
        playlistIds: round.playlistIds.filter((_, i) => i !== playlistIndex),
        playlistNames: round.playlistNames.filter((_, i) => i !== playlistIndex),
        songCount: Math.max(0, round.songCount - playlistTracks),
        status: round.playlistIds.length === 1 ? 'unplanned' : round.status,
      };
      updated = clearSnapshotIfPlaylistsChanged(updated, round);

      setEventRounds((cur) => {
        if (roundIndex < 0 || roundIndex >= cur.length) return cur;
        const newRounds = [...cur];
        newRounds[roundIndex] = updated;
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(newRounds));
        } catch (error) {
          console.warn('Failed to save rounds to localStorage:', error);
        }
        return newRounds;
      });
      if (updated.playlistIds.length > 0) {
        syncMixFromRound(roundIndex, updated);
      }
    },
    [resolvePlaylistForRoundAssign, roomId, syncMixFromRound, roundLockedForLivePlay, showToast],
  );

  const handleFocusRoundForLibrary = useCallback((roundIndex: number) => {
    // During live play, currentRoundIndex is the live round pointer — browsing rounds for
    // prep must not move it (it drives round-complete bookkeeping and the live dashboard).
    if (gameStateRef.current !== 'playing') setCurrentRoundIndex(roundIndex);
    setRoundBuilderFocusIndex(roundIndex);
  }, []);

  /** Round shown in the selected-round details panel on the Rounds tab (falls back to Round 1). Uses the prep focus index so browsing/editing rounds mid-game never tracks or moves the live round pointer. */
  const selectedRoundForPanel = useMemo(() => {
    if (eventRounds.length === 0) return null;
    const idx =
      roundBuilderFocusIndex >= 0 && roundBuilderFocusIndex < eventRounds.length
        ? roundBuilderFocusIndex
        : currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length
          ? currentRoundIndex
          : 0;
    const round = eventRounds[idx];
    const ids = round.playlistIds || [];
    const names = round.playlistNames || [];
    return {
      index: idx,
      name: round.name,
      status: round.status,
      songCount: round.songCount ?? 0,
      playlists: ids.map((id, i) => ({
        id: String(id),
        name: stripTitleFlagPrefix(String(names[i] ?? id), titleFlagStripList),
      })),
    };
  }, [eventRounds, roundBuilderFocusIndex, currentRoundIndex, titleFlagStripList]);

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
      const hasSavedSnapshot =
        eventRoundSnapshotMeetsSaveThreshold(round, freeSpaceEnabled) &&
        Boolean(round.savedMixSnapshot?.songs?.length);

      if (switchingRound) {
        clearPrepRoundCallLogUi();
        notifyServerPrepRoundSwitch();
        if (!hasSavedSnapshot) {
          clearPrepMixPlaybackState();
        }
        applyRoundBingoToHost(round, { restorePlaybackFromSnapshot: true });
        setCurrentRoundIndex(roundIndex);
        setRoundBuilderFocusIndex(roundIndex);
        const playlistNames = round.playlistNames.join(', ');
        showToast(`${round.name} — mix loaded for prep (${playlistNames})`, 'success');
        addLog(`Prep select ${round.name}: ${playlistNames}`, 'info');
      } else {
        setCurrentRoundIndex(roundIndex);
        setRoundBuilderFocusIndex(roundIndex);
      }

      if (
        hasSavedSnapshot &&
        mixRows &&
        socket &&
        roomId
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
      clearPrepMixPlaybackState,
      clearPrepRoundCallLogUi,
      notifyServerPrepRoundSwitch,
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

    /** Live show: snapshot to local prep only — never finalize-mix (would replace cards + projector mid-round). */
    const isLiveRound = gameState === 'playing';
    const liveRoundIndex = currentRoundIndexRef.current;

    let restoreLiveHostMix: (() => void) | null = null;
    if (isLiveRound) {
      const liveRound =
        liveRoundIndex >= 0 ? eventRoundsRef.current[liveRoundIndex] : null;
      const liveMixSnapshot = mixPlaylistSelectionRef.current.map((p) => ({ ...p }));
      const liveSongListSnapshot = songListRef.current.map(cloneSongForSnapshot);
      const liveFinalizedSnapshot = finalizedOrderRef.current?.map(cloneSongForSnapshot) ?? null;
      restoreLiveHostMix = () => {
        if (liveRound) {
          applyRoundPlaylistsToMixSelection(liveRound);
        } else if (liveMixSnapshot.length > 0) {
          setSelectedPlaylists(liveMixSnapshot.filter((p) => p.catalog !== true));
          setSelectedCatalogPlaylists(liveMixSnapshot.filter((p) => p.catalog === true));
        }
        setSongList(liveSongListSnapshot);
        if (liveFinalizedSnapshot && liveFinalizedSnapshot.length > 0) {
          finalizedOrderRef.current = liveFinalizedSnapshot;
          setFinalizedOrder(liveFinalizedSnapshot);
        }
      };
    } else {
      applyRoundPlaylistsToMixSelection(round0);
    }

    const blockIfFivePlaylistsTooShort = (listToSend: Song[]): boolean => {
      if (mixRows.length !== 5) return true;
      const perListCounts = mixRows.map((pl) => {
        const canon = canonicalPlaylistIdForMatch(String(pl.id));
        const n = listToSend.filter(
          (s) => canonicalPlaylistIdForMatch(String(s.sourcePlaylistId || '')) === canon,
        ).length;
        return { name: pl.name, count: n };
      });
      const trueShort = perListCounts.filter((p) => p.count < 15);
      if (trueShort.length === 0) return true;
      const warnings = trueShort.map(
        (p) =>
          `Playlist "${p.name}" has only ${p.count} track(s) in the mix (needs 15). Reload playlists or check tags.`,
      );
      addLog('Save round blocked: each of five playlists needs at least 15 tracks in the mix.', 'error');
      warnings.forEach((line) => addLog(`  ${line}`, 'warn'));
      setFiveByFifteenInsufficientModal({ variant: 'blocked', warnings });
      return false;
    };

    setSaveRoundBusy(true);
    try {
      let pool: Song[];

      if (isLiveRound) {
        addLog(
          `Saving ${round0.name} locally only — live round in progress (room, player cards, and projector unchanged).`,
          'info',
        );
        const listToSend = await generateSongList({
          force: true,
          reason: 'finalize',
          playlists: mixRows,
        });
        if (listToSend.length === 0) {
          window.alert(
            'No songs could be loaded from this round\'s playlists. Check Spotify / YouTube under Connection, then try Save round again.',
          );
          addLog('Save round: no tracks loaded (live/local path).', 'warn');
          return;
        }
        if (!blockIfFivePlaylistsTooShort(listToSend)) return;
        pool = listToSend.map(cloneSongForSnapshot);
      } else {
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
        pool = fo.map(cloneSongForSnapshot);
      }

      const r = eventRoundsRef.current[roundIndex];
      if (!r) return;

      const roundScoped = songsForRoundFromFinalizedPool(r, pool).map(cloneSongForSnapshot);
      const { songs: filtered, mode: poolMode } = effectiveBingoPoolSongsForMix(
        mixRows,
        roundScoped.length > 0 ? roundScoped : pool,
      );
      const filteredSongs = filtered.map((s) => {
        const full =
          roundScoped.find((x) => x.id === s.id) || pool.find((x) => x.id === s.id);
        return cloneSongForSnapshot(full || (s as Song));
      });
      const fs = r.freeSpaceEnabled !== undefined ? r.freeSpaceEnabled : freeSpaceEnabled;
      const need = fs ? 24 : 25;
      if (filteredSongs.length < need) {
        const stalePoolHint =
          !isLiveRound && pool.length > 0 && filteredSongs.length === 0
            ? ' The finalized playback pool still looked like a different mix — tap Show Playlists once on the host screen, then Save round again.'
            : '';
        const transientHint =
          filteredSongs.length === 0
            ? ' If Spotify is temporarily unavailable, cached tracks are used when possible — wait a moment and try Save again (no need to reconnect Spotify).'
            : '';
        window.alert(
          `Only ${filteredSongs.length} of ${need} card-ready tracks loaded for this round. Spotify-listed playlist totals only count once tracks are loaded and deduped.${stalePoolHint}${transientHint} Add playlists or save again after tracks finish loading.`,
        );
        return;
      }

      const snap: SavedRoundMixSnapshot = {
        savedAt: Date.now(),
        songs: filteredSongs,
        mixGeometry:
          poolMode === '5x15' ? '5x15' : poolMode === '1x75' ? '1x75' : deriveMixGeometryForSnapshot(mixRows, filteredSongs.length),
        snippetLength,
        randomStarts,
        playlistIdsAtSave: [...(r.playlistIds || [])],
      };

      setEventRounds((prev) => {
        if (roundIndex < 0 || roundIndex >= prev.length) return prev;
        const next = [...prev];
        next[roundIndex] = {
          ...next[roundIndex],
          savedMixSnapshot: snap,
          songCount: filteredSongs.length,
          status: next[roundIndex].status === 'active' ? 'active' : 'planned',
        };
        try {
          localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      if (!isLiveRound || roundIndex === liveRoundIndex) {
        setCurrentRoundIndex(roundIndex);
      }
      const liveNote = isLiveRound ? ' — local prep; live round unchanged' : '';
      showToast(`Saved ${r.name} — ${filteredSongs.length} tracks (${snap.mixGeometry})${liveNote}`, 'success');
      addLog(
        `Round snapshot saved: ${r.name}, ${filteredSongs.length} tracks${isLiveRound ? ' (local only, live room untouched)' : ''}`,
        'info',
      );
    } finally {
      if (isLiveRound) {
        restoreLiveHostMix?.();
      }
      setSaveRoundBusy(false);
    }
  };


  const handleStartRound = useCallback((roundIndex: number) => {
    const round = eventRounds[roundIndex];
    if (!round || round.playlistIds.length === 0) {
      alert('Please select at least one playlist for this round first.');
      return;
    }

    const mixRowsForRound = resolveMixPlaylistRowsForRound(round);
    if (mixRowsNeedHostSpotify(mixRowsForRound)) {
      if (!isSpotifyConnected) {
        connectionModalOpenedByUserRef.current = false;
        setShowConnectionModal(true);
        showToast('Connect Spotify in Connection before starting this round.', 'warn');
        addLog(`${round.name}: blocked — Spotify not connected`, 'warn');
        return;
      }
      if (webApiQuarantine.active) {
        showHostAckNotification({
          id: 'round-start-quarantine',
          title: 'Spotify API cooldown',
          variant: 'warning',
          message:
            'Spotify is in a short cooldown after rate limits. Wait for the timer, then refresh Connection before Start round.',
        });
        return;
      }
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

    clearPrepRoundCallLogUi();
    notifyServerPrepRoundSwitch();

    const loaded = applyRoundPlaylistsToMixSelection(round);
    if (loaded) {
      const playlistNames = round.playlistNames.join(', ');
      addLog(`Started ${round.name}: ${playlistNames}`, 'info');
    }

    applyRoundBingoToHost(round, { restorePlaybackFromSnapshot: true });
    const mixRows = resolveMixPlaylistRowsForRound(round);
    const hasSavedSnapshot =
      eventRoundSnapshotMeetsSaveThreshold(round, freeSpaceEnabled) &&
      Boolean(round.savedMixSnapshot?.songs?.length);
    const roundMixKey = mixRows ? selectionPlaylistKey(mixRows) : '';
    const cardsAlreadyDealtForRound =
      Boolean(roundMixKey) &&
      mixFinalized &&
      finalizedMixPlaylistKey === roundMixKey &&
      lastFinalizePlaylistKeyRef.current === roundMixKey;

    if (
      loaded &&
      mixRows &&
      socket &&
      roomId &&
      hasSavedSnapshot &&
      !cardsAlreadyDealtForRound
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
    } else if (loaded && cardsAlreadyDealtForRound) {
      addLog(`${round.name}: Start round — keeping player cards from prep load`, 'info');
    }

    // Store updated rounds
    try {
      localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(updatedRounds));
    } catch (error) {
      console.warn('Failed to save rounds to localStorage:', error);
    }

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
    mixFinalized,
    clearPrepRoundCallLogUi,
    notifyServerPrepRoundSwitch,
    finalizedMixPlaylistKey,
    isSpotifyConnected,
    webApiQuarantine.active,
    showToast,
    showHostAckNotification,
    resolveMixPlaylistRowsForRound,
  ]);

  // Advanced round management functions
  const jumpToRound = useCallback((roundIndex: number) => {
    if (roundIndex >= 0 && roundIndex < eventRounds.length) {
      const round = eventRounds[roundIndex];
      if (round.status !== 'completed' && (round.playlistIds || []).length > 0) {
        handleStartRound(roundIndex);
        addLog(`Jumped to ${round.name}`, 'info');
      }
    }
  }, [eventRounds, handleStartRound]);

  const completeCurrentRound = useCallback(() => {
    setEventRounds((prev) => {
      const cur = currentRoundIndexRef.current;
      if (cur < 0 || cur >= prev.length) return prev;
      if (prev[cur].status === 'completed') return prev;
      const next = [...prev];
      next[cur] = {
        ...next[cur],
        status: 'completed',
        completedAt: Date.now(),
      };
      try {
        if (roomId) localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      addLog(`Completed ${next[cur].name}`, 'info');
      return next;
    });
  }, [roomId, addLog]);

  const emitRoundPlaybackReset = useCallback(() => {
    if (!socket || !roomId) return false;
    socket.emit('reset-game', { roomId, stopPlayback: true });
    return true;
  }, [socket, roomId]);

  const handleRestartRound = useCallback(() => {
    if (
      !window.confirm(
        'Restart this round?\n\nStops playback and clears cards. The same round stays active — use Start Game when ready.',
      )
    ) {
      return;
    }
    if (!emitRoundPlaybackReset()) {
      showToast('Not connected — cannot restart round', 'error');
      return;
    }
    setRoundComplete(null);
    setRoundWinners([]);
    addLog('Restart round requested', 'info');
  }, [emitRoundPlaybackReset, addLog, showToast]);

  const handleEndRound = useCallback(() => {
    if (
      !window.confirm(
        'End this round?\n\nStops playback, clears cards, and marks the round complete.',
      )
    ) {
      return;
    }
    if (!emitRoundPlaybackReset()) {
      showToast('Not connected — cannot end round', 'error');
      return;
    }
    completeCurrentRound();
    addLog('Round ended by host', 'info');
  }, [emitRoundPlaybackReset, completeCurrentRound, addLog, showToast]);

  const resetCurrentRound = handleRestartRound;

  const getNextPlannedRound = useCallback(() => {
    const rounds = eventRoundsRef.current;
    if (!rounds.length) return -1;

    const isPlannedRound = (round: EventRound | undefined) =>
      !!round && round.status === 'planned' && (round.playlistIds || []).length > 0;

    const cur = currentRoundIndexRef.current;
    if (cur >= 0) {
      for (let i = cur + 1; i < rounds.length; i += 1) {
        if (isPlannedRound(rounds[i])) return i;
      }
    }

    return rounds.findIndex((round) => isPlannedRound(round));
  }, []);

  const requestGameResetAck = useCallback(async () => {
    if (!socket || !roomId) return false;

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const cleanup = () => {
        socket.off('game-reset', onReset);
        window.clearTimeout(timeoutId);
      };
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(ok);
      };
      const onReset = () => finish(true);
      const timeoutId = window.setTimeout(() => finish(false), 8000);

      socket.on('game-reset', onReset);
      socket.emit('reset-game', { roomId, stopPlayback: true });
    });
  }, [socket, roomId]);

  const handlePrepareNextPlannedRound = useCallback(() => {
    const nextIndex = getNextPlannedRound();
    if (nextIndex < 0) {
      showToast('No planned round with playlists found.', 'info');
      return;
    }
    const round = eventRoundsRef.current[nextIndex];
    completeCurrentRound();
    jumpToRound(nextIndex);
    setRoundComplete(null);
    setGamePaused(true);
    gameStateRef.current = 'waiting';
    setGameState('waiting');
    showToast(
      `${round?.name || 'Next round'} loaded for prep — review the mix, then tap Start Game when ready.`,
      'info',
    );
    addLog(`Prepared ${round?.name || 'next round'} for host review (no auto-start)`, 'info');
  }, [getNextPlannedRound, completeCurrentRound, jumpToRound, showToast, addLog]);

  const handleStartNextPlannedRound = useCallback(async () => {
    const nextIndex = getNextPlannedRound();
    if (nextIndex < 0) {
      handleStartNextRound();
      return;
    }

    const round = eventRoundsRef.current[nextIndex];
    if (!round || !(round.playlistIds || []).length) {
      window.alert('Add playlists to the next round first.');
      return;
    }

    const mixRows = resolveMixPlaylistRowsForRound(round);
    if (!mixRows) {
      window.alert(
        'No playlists from the next planned round matched your library. Use Connection to refresh, or re-drag playlists from the library into that bucket.',
      );
      return;
    }

    const freeSpaceForRound =
      round.freeSpaceEnabled !== undefined ? round.freeSpaceEnabled : freeSpaceEnabled;
    const needsSnapshotTracks = freeSpaceForRound ? 24 : 25;
    const hasSavedSnapshot = Boolean(
      round.savedMixSnapshot?.songs?.length && round.savedMixSnapshot.songs.length >= needsSnapshotTracks,
    );
    if (!hasSavedSnapshot) {
      jumpToRound(nextIndex);
      setRoundComplete(null);
      showToast('Loaded the next planned round for prep. Save the round to enable one-click auto start.', 'info');
      addLog(`Loaded ${round.name} for prep — save the round snapshot to auto-start it next time`, 'warn');
      return;
    }

    const confirmed = window.confirm(
      `Start "${round.name}" now?\n\nThis clears the finished round, loads that round's saved mix, and begins playback.`,
    );
    if (!confirmed) return;

    const needsHostSpotifyForRound = mixRows.some((p) => p.youtubeMusic !== true && p.catalog !== true);
    if (needsHostSpotifyForRound && !isSpotifyConnected) {
      window.alert('Spotify is not connected. Open Connection in the header and connect Spotify first.');
      return;
    }
    if (needsHostSpotifyForRound && !selectedDevice) {
      connectionModalOpenedByUserRef.current = false;
      setShowConnectionModal(true);
      window.alert(
        'Please select a Spotify playback device first.\n\nPick a device under Playback device in the Connection panel (also under Settings), or open Spotify on your target device and tap Refresh devices.',
      );
      return;
    }
    if (needsHostSpotifyForRound && playbackDeviceNotInList) {
      connectionModalOpenedByUserRef.current = false;
      setShowConnectionModal(true);
      window.alert(
        'Your selected Spotify device is not available right now. Open Spotify on that device, tap Refresh devices in Connection, and pick it again.',
      );
      return;
    }

    const loaded = applyRoundPlaylistsToMixSelection(round);
    if (!loaded) {
      window.alert(
        'No playlists from the next planned round matched your library. Use Connection to refresh, or re-drag playlists from the library into that bucket.',
      );
      return;
    }

    applyRoundBingoToHost(round, { restorePlaybackFromSnapshot: true });
    setRoundBuilderFocusIndex(nextIndex);
    setCurrentRoundIndex(nextIndex);
    setEventRounds((prev) => {
      const now = Date.now();
      const next = [...prev];
      const prevIndex = currentRoundIndexRef.current;
      if (prevIndex >= 0 && prevIndex < next.length && prevIndex !== nextIndex) {
        next[prevIndex] = {
          ...next[prevIndex],
          status: 'completed',
          completedAt: now,
        };
      }
      if (nextIndex >= 0 && nextIndex < next.length) {
        next[nextIndex] = {
          ...next[nextIndex],
          status: 'active',
          startedAt: now,
          completedAt: undefined,
        };
      }
      try {
        localStorage.setItem(`event-rounds-${roomId}`, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

    addLog(`Advancing to ${round.name}...`, 'info');
    const resetOk = await requestGameResetAck();
    if (!resetOk) {
      showToast('Timed out while clearing the finished round. Try again.', 'error');
      addLog('Timed out waiting for room reset before starting next planned round', 'error');
      return;
    }

    const started = await startGame({ roundOverride: round, playlistsOverride: mixRows });
    if (started) {
      setRoundComplete(null);
      addLog(`Started ${round.name}`, 'info');
    }
  }, [
    addLog,
    applyRoundBingoToHost,
    applyRoundPlaylistsToMixSelection,
    freeSpaceEnabled,
    getNextPlannedRound,
    handleStartNextRound,
    isSpotifyConnected,
    jumpToRound,
    playbackDeviceNotInList,
    requestGameResetAck,
    resolveMixPlaylistRowsForRound,
    roomId,
    selectedDevice,
    showToast,
    startGame,
  ]);

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

  /** Load saved host defaults: localStorage immediately, then the DB copy (cross-device source of truth). */
  useEffect(() => {
    if (!hostAccount?.id) return;
    const hostId = hostAccount.id;
    hostPrefsHydratedRef.current = false;
    const apply = (p: Partial<HostPreferencesV1>) => {
      if (p.snippetLength != null) setSnippetLength(p.snippetLength);
      if (p.randomStarts != null) setRandomStarts(p.randomStarts);
      if (p.publicDisplayFontSize != null) setPublicDisplayFontSize(p.publicDisplayFontSize);
      if (p.publicDisplayTitleRevealMode != null) {
        setPublicDisplayTitleRevealMode(p.publicDisplayTitleRevealMode);
      }
      if (p.letterRevealIntervalSec != null) setLetterRevealIntervalSec(p.letterRevealIntervalSec);
      if (p.publicDisplayLetterRevealToast != null) {
        setPublicDisplayLetterRevealToast(p.publicDisplayLetterRevealToast);
      }
      if (p.freeSpaceEnabled != null) setFreeSpaceEnabled(p.freeSpaceEnabled);
      if (p.venueSpotifyJamMode != null) setVenueSpotifyJamMode(p.venueSpotifyJamMode);
      if (p.playlistTitleFlags != null) setPlaylistTitleFlags(p.playlistTitleFlags);
    };
    apply(loadHostPreferences(hostId));
    hostPrefsHydratedRef.current = true;
    setHostPrefsHydrationNonce((n) => n + 1);

    let cancelled = false;
    if (getHostJwt()) {
      void (async () => {
        try {
          const r = await hostFetch(`${API_BASE || ''}/api/host/preferences`);
          if (!r.ok || cancelled) return;
          const d = (await r.json()) as { preferences?: unknown };
          const serverPrefs = sanitizeHostPreferences(d?.preferences);
          if (cancelled || Object.values(serverPrefs).every((v) => v == null)) return;
          apply(serverPrefs);
          saveHostPreferences(hostId, serverPrefs);
          setHostPrefsHydrationNonce((n) => n + 1);
        } catch {
          /* offline or server without DB — localStorage copy stands */
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [hostAccount?.id]);

  /** Persist host defaults whenever controls change (localStorage cache + debounced DB save). */
  useEffect(() => {
    if (!hostAccount?.id || !hostPrefsHydratedRef.current) return;
    const prefs = {
      snippetLength,
      randomStarts,
      publicDisplayFontSize,
      publicDisplayTitleRevealMode,
      letterRevealIntervalSec,
      publicDisplayLetterRevealToast,
      freeSpaceEnabled,
      venueSpotifyJamMode,
      playlistTitleFlags,
    };
    saveHostPreferences(hostAccount.id, prefs);
    try {
      localStorage.setItem('game-snippet-length', String(snippetLength));
      localStorage.setItem('game-random-starts', randomStarts);
      localStorage.setItem('bingo-free-space', freeSpaceEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (getHostJwt()) {
      if (hostPrefsPutTimerRef.current) window.clearTimeout(hostPrefsPutTimerRef.current);
      hostPrefsPutTimerRef.current = window.setTimeout(() => {
        hostPrefsPutTimerRef.current = null;
        void (async () => {
          try {
            await hostFetch(`${API_BASE || ''}/api/host/preferences`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ preferences: { v: 1, ...prefs } }),
            });
          } catch {
            /* offline — localStorage copy stands, retried on next change */
          }
        })();
      }, 1200);
    }
    return () => {
      if (hostPrefsPutTimerRef.current) {
        window.clearTimeout(hostPrefsPutTimerRef.current);
        hostPrefsPutTimerRef.current = null;
      }
    };
  }, [
    hostAccount?.id,
    snippetLength,
    randomStarts,
    publicDisplayFontSize,
    publicDisplayTitleRevealMode,
    letterRevealIntervalSec,
    publicDisplayLetterRevealToast,
    freeSpaceEnabled,
    venueSpotifyJamMode,
    playlistTitleFlags,
  ]);

  /** Sync venue Jam mode to server when pref or socket changes. */
  useEffect(() => {
    if (!socket || !roomId || !hostPrefsHydratedRef.current) return;
    syncVenueSpotifyJamModeToRoom(venueSpotifyJamMode);
  }, [socket, roomId, venueSpotifyJamMode, syncVenueSpotifyJamModeToRoom]);

  /** Re-pick playback device when venue Jam mode toggles. */
  useEffect(() => {
    if (!readHostSpotifyWebEnabled() || devices.length === 0) return;
    const picked = pickPreferredPlaybackDevice(devices, { venueJamMode: venueSpotifyJamMode });
    if (picked && picked.id !== selectedDevice?.id) {
      setSelectedDevice(picked);
      syncSelectedPlaybackDeviceToRoom(picked);
    }
  }, [venueSpotifyJamMode]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only on mode toggle

  /**
   * Push loaded prefs to the room once socket is ready, and again after each prefs hydration
   * (nonce). Read saved prefs from storage instead of state: this effect's closure can predate
   * the hydration setState (same commit), and pushing the stale defaults (15s letter reveal)
   * to the room made the room-state echo overwrite the host's saved values.
   */
  useEffect(() => {
    if (!socket || !roomId || !hostAccount?.id || !hostPrefsHydratedRef.current) return;
    const saved = loadHostPreferences(hostAccount.id);
    updatePublicDisplayFontSize(saved.publicDisplayFontSize ?? publicDisplayFontSize);
    updatePublicDisplayTitleRevealMode(saved.publicDisplayTitleRevealMode ?? publicDisplayTitleRevealMode);
    updatePublicDisplayLetterRevealInterval(saved.letterRevealIntervalSec ?? letterRevealIntervalSec);
    updatePublicDisplayLetterRevealToast(saved.publicDisplayLetterRevealToast ?? publicDisplayLetterRevealToast);
    updatePublicDisplayCallListMode('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- room sync after socket ready / prefs hydrate
  }, [socket, roomId, hostAccount?.id, hostPrefsHydrationNonce]);

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
    const ridx = currentRoundIndex;
    const activeRound = ridx >= 0 && ridx < eventRounds.length ? eventRounds[ridx] : null;
    const snapshotMatchesPrep =
      activeRound &&
      mixPlaylistSelection.length > 0 &&
      prepRoundPlaylistOrderMatchesMix(activeRound.playlistIds, mixPlaylistSelection) &&
      eventRoundSnapshotMeetsSaveThreshold(activeRound, freeSpaceEnabled) &&
      roundSnapshotMatchesCurrentPlaylists(activeRound) &&
      (activeRound.savedMixSnapshot?.songs?.length ?? 0) > 0;
    const snapshotSongs = snapshotMatchesPrep ? activeRound!.savedMixSnapshot!.songs : null;

    if (finalizedOrder && finalizedOrder.length > 0) {
      return finalizedOrder;
    }
    if (snapshotSongs?.length && !mixFinalized) {
      return snapshotSongs;
    }
    if (mixFinalized) {
      return [];
    }
    if (!songList.length || mixPlaylistSelection.length === 0) {
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
    gameState,
    currentSong,
  ]);

  /** Tracks already played in pool order (for bingo pool checkmarks). */
  const bingoPoolPlayedSongIds = useMemo(() => {
    const set = new Set<string>();
    const curId = currentSong?.id;
    const curIdx = curId ? finalizedPoolSongs.findIndex((s) => s.id === curId) : -1;
    if (curIdx > 0) {
      for (let i = 0; i < curIdx; i++) set.add(finalizedPoolSongs[i].id);
    }
    for (const p of playedInOrder) set.add(p.id);
    return set;
  }, [finalizedPoolSongs, currentSong?.id, playedInOrder]);

  const bingoPoolUiShowsPreFinalizeSubset =
    !mixFinalized && songList.length > 0 && finalizedPoolSongs.length < songList.length;

  const hasFinalizedSongPool = finalizedPoolSongs.length > 0;
  /** Server said mix is finalized but this UI has no tracks (e.g. client fetches got 429; rare timing). */
  const showFinalizedButEmptyPool = mixFinalized && finalizedPoolSongs.length === 0;

  const bingoPoolSectionTitle = mixFinalized
    ? gameState === 'playing'
      ? `Playback order (${finalizedPoolSongs.length} songs)`
      : `Bingo pool (${finalizedPoolSongs.length} songs)`
    : `Bingo pool (${finalizedPoolSongs.length} songs)`;

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
    prepRoundPlaylistsMatchMix &&
    roundSnapshotMatchesCurrentPlaylists(currentPrepRoundForFinalizeUi);

  const hostActiveRoundSummary = useMemo(() => {
    const round =
      currentRoundIndex >= 0 && currentRoundIndex < eventRounds.length
        ? eventRounds[currentRoundIndex]
        : null;
    const playlistNames =
      round?.playlistNames?.length
        ? round.playlistNames
        : mixPlaylistSelection.map((p) => p.name);
    const poolCount = finalizedPoolSongs.length;
    const playedCount = playedInOrder.length;
    const remainingCount = Math.max(0, poolCount - playedCount);
    const percentComplete =
      poolCount > 0 ? Math.min(100, Math.round((playedCount / poolCount) * 100)) : 0;
    const roundStatus = round?.status ?? null;
    const roundStatusLabel = (() => {
      switch (roundStatus) {
        case 'active':
          return 'Live';
        case 'completed':
          return 'Completed';
        case 'planned':
          return 'Planned';
        case 'unplanned':
          return 'Draft';
        default:
          return gameState === 'playing' ? 'Live' : gameState === 'ended' ? 'Ended' : '—';
      }
    })();
    const titleRevealLabel =
      publicDisplayTitleRevealMode === 'letter'
        ? `By letter (${letterRevealIntervalSec}s)`
        : publicDisplayTitleRevealMode === 'track_start'
          ? 'Title at clip start'
          : 'Title at clip end';
    const randomStartsLabel =
      randomStarts === 'random'
        ? 'Random start'
        : randomStarts === 'early'
          ? 'Early random'
          : 'Fixed start';
    const playersOnlineCount = Array.from(playerCards.entries()).filter(
      ([id, d]) => d.inPerson === false || joinedPlayersRoster.get(id)?.inPerson === false,
    ).length;
    const lastPlayed =
      playedInOrder.length > 0 ? playedInOrder[playedInOrder.length - 1] : null;
    return {
      roundName: round?.name ?? null,
      roundStatus,
      roundStatusLabel,
      playlistNames,
      patternLabel: getPatternDisplayName(pattern),
      poolCount,
      playedCount,
      remainingCount,
      percentComplete,
      titleRevealLabel,
      randomStartsLabel,
      mixFinalized,
      savedRound: Boolean(round?.savedMixSnapshot?.songs?.length),
      playersOnlineCount,
      winnersCount: winners.length,
      lastPlayed: lastPlayed
        ? { name: getDisplaySongTitle(lastPlayed.id, lastPlayed.name), artist: lastPlayed.artist }
        : null,
    };
  }, [
    currentRoundIndex,
    eventRounds,
    mixPlaylistSelection,
    pattern,
    finalizedPoolSongs.length,
    playedInOrder,
    mixFinalized,
    gameState,
    publicDisplayTitleRevealMode,
    letterRevealIntervalSec,
    randomStarts,
    playerCards,
    joinedPlayersRoster,
    winners.length,
    getDisplaySongTitle,
  ]);

  const showPrimaryFinalizeMixButton =
    !mixFinalized && !savedRoundSnapshotMakesFinalizeRedundant && mixPlaylistSelection.length > 0;
  /** Round builder saved this round — host screen is go-live only (no mix/finalize/PDF chrome). */
  const gameTabRoundBuilderReady = savedRoundSnapshotMakesFinalizeRedundant;

  const mixFinalizedForCurrentPrep = useMemo(() => {
    if (!mixFinalized || gameTabRoundBuilderReady) return false;
    const prepKey = selectionPlaylistKey(mixPlaylistSelection);
    if (!prepKey || !finalizedMixPlaylistKey) return false;
    return finalizedMixPlaylistKey === prepKey;
  }, [mixFinalized, gameTabRoundBuilderReady, mixPlaylistSelection, finalizedMixPlaylistKey]);

  /** Saved round or finalized mix for this round's playlists — one host-facing "ready" state. */
  const prepRoundReadyForGoLive = gameTabRoundBuilderReady || mixFinalizedForCurrentPrep;

  const setupPlaylistReady =
    mixPlaylistSelection.length > 0 &&
    currentRoundIndex >= 0 &&
    (eventRounds[currentRoundIndex]?.playlistIds?.length ?? 0) > 0;

  const setupCriteriaReady = setupPlaylistReady;

  const showHostSetupCockpit =
    gameState === 'waiting' && !hostRoomHydrating && hostGlassNav === 'game';

  const getBingoPoolTrackCountForRound = useCallback(
    (roundIndex: number) => {
      if (roundIndex < 0 || roundIndex >= eventRounds.length) return 0;
      const round = eventRounds[roundIndex];
      if (!round?.playlistIds?.length) return 0;
      const mixRows = resolveMixPlaylistRowsForRound(round);
      if (!mixRows?.length) return 0;

      const songsForRound =
        songList.length > 0
          ? songList.filter((s) =>
              mixRows.some(
                (pl) =>
                  canonicalPlaylistIdForMatch(pl.id) ===
                  canonicalPlaylistIdForMatch(String(s.sourcePlaylistId || '')),
              ),
            )
          : [];

      if (songsForRound.length > 0) {
        return computeEffectiveBingoPoolPreview(mixRows, songsForRound).pool.length;
      }
      return 0;
    },
    [eventRounds, resolveMixPlaylistRowsForRound, songList],
  );

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
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          marginBottom: 12,
          fontSize: '0.88rem',
          color: 'rgba(255,255,255,0.88)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={venueSpotifyJamMode}
          onChange={(e) => setVenueSpotifyJamMode(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Venue uses Spotify Jam</strong>
        </span>
      </label>
      {venueSpotifyJamMode && !spotifyJamActive && devices.length > 0 && (
        <p style={{ marginBottom: 12, fontSize: '0.82rem', color: '#ffb347', lineHeight: 1.45 }}>
          Jam mode is on but no active Jam session was found. Start Jam on the venue speaker, then tap{' '}
          <strong>Refresh devices</strong>.
        </p>
      )}
      {spotifyJamActive && !venueSpotifyJamMode && (
        <p style={{ marginBottom: 12, fontSize: '0.82rem', color: '#ffb347', lineHeight: 1.45 }}>
          Spotify Jam is active. If the show must run through Jam, enable <strong>Venue uses Spotify Jam</strong> above.
        </p>
      )}
      {spotifyJamActive && venueSpotifyJamMode && (
        <p style={{ marginBottom: 12, fontSize: '0.82rem', color: '#8fd9a8', lineHeight: 1.45 }}>
          Jam session detected — Tempo will route playback through it and will not fight the venue speaker.
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <select
          aria-label="Spotify playback device"
          value={selectedDevice?.id ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            const d = selectablePlaybackDevices.find((x) => x.id === id) ?? null;
            if (d && isSpotifyJamDevice(d) && !venueSpotifyJamMode) return;
            setSelectedDevice(d);
            syncSelectedPlaybackDeviceToRoom(d);
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
          {selectablePlaybackDevices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {isSpotifyJamDevice(d) ? ' (Jam)' : ''}
              {d.is_active ? ' (active)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void loadDevices({ force: true })}
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
      {playbackDeviceNotInList && selectedDevice && (
        <p style={{ marginTop: 10, fontSize: '0.8rem', color: '#ff8a8a', fontWeight: 600 }}>
          Selected device “{selectedDevice.name}” is not online. Refresh devices, open Spotify on that device,
          then select it again before Start Game.
        </p>
      )}
      {!playbackDeviceNotInList && selectedDeviceInactive && selectedDevice && (
        <p style={{ marginTop: 10, fontSize: '0.8rem', color: '#ffb347', fontWeight: 600 }}>
          “{selectedDevice.name}” is selected but currently inactive. Open Spotify on {selectedDevice.name} and
          press play/pause once, then tap Refresh devices. Playback will be transferred there at Start Game.
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

  const renderHostRoundPlanner = useCallback(
    (setupSurface: 'playlists' | 'criteria' | 'full' = 'full') => (
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
        onPrintPdf={(idx) => handleDownloadRoundPrintablePdf(eventRoundsRef.current[idx])}
        onPrintAllPreShow={handlePrintAllPreShowPdf}
        onPreviewPrint={handlePreviewPrintPdf}
        savedRoundCount={eventRounds.filter((r) =>
          eventRoundSnapshotMeetsSaveThreshold(r, freeSpaceEnabled),
        ).length}
        onCallSheet={(idx) => handleDownloadRoundCallSheetPdf(eventRoundsRef.current[idx])}
        onOpenComposite={openCompositeForRound}
        onNewCustomPattern={handleNewCustomPattern}
        printablePdfLoading={printablePdfLoading}
        printableCardCount={printableCardCount}
        onPrintableCardCountChange={setPrintableCardCount}
        snippetLength={snippetLength}
        onSnippetLengthChange={handleSnippetLengthChange}
        randomStarts={randomStarts}
        onRandomStartsChange={handleRandomStartsChange}
        initialFocusedIndex={roundBuilderFocusIndex}
        onFocusedRoundChange={setRoundBuilderFocusIndex}
        prepHints={{
          spotifyNeeded: mixNeedsHostSpotify,
          spotifyConnected: isSpotifyConnected,
          deviceNeeded: mixNeedsHostSpotify,
          deviceSelected: !!selectedDevice,
        }}
        statusSummary={getRoundStatusSummary()}
        onResetEvent={resetEvent}
        onClearPrepCache={clearRoomRoundPrepStorage}
        onEndRound={handleEndRound}
        hostControlsHydrating={hostRoomHydrating}
        onResetCurrentRound={resetCurrentRound}
        onStartNextPlanned={() => {
          const next = getNextPlannedRound();
          if (next >= 0) jumpToRound(next);
        }}
        hasNextPlanned={getNextPlannedRound() >= 0}
        poolTrackCountForRound={getBingoPoolTrackCountForRound}
        setupSurface={setupSurface}
        hideRoundPicker={setupSurface !== 'full'}
      />
    ),
    [
      eventRounds,
      handleUpdateRounds,
      playlistsForRoundPlanner,
      currentRoundIndex,
      handleStartRound,
      handleSelectRoundForPrep,
      syncMixFromRound,
      gameState,
      freeSpaceEnabled,
      savedCustomPatterns,
      handleUpdateRoundBingoFields,
      saveRoundBusy,
      handleDownloadRoundPrintablePdf,
      handlePrintAllPreShowPdf,
      handlePreviewPrintPdf,
      handleDownloadRoundCallSheetPdf,
      openCompositeForRound,
      handleNewCustomPattern,
      printablePdfLoading,
      printableCardCount,
      snippetLength,
      handleSnippetLengthChange,
      randomStarts,
      handleRandomStartsChange,
      roundBuilderFocusIndex,
      mixNeedsHostSpotify,
      isSpotifyConnected,
      selectedDevice,
      getRoundStatusSummary,
      resetEvent,
      clearRoomRoundPrepStorage,
      handleEndRound,
      hostRoomHydrating,
      resetCurrentRound,
      getNextPlannedRound,
      jumpToRound,
      getBingoPoolTrackCountForRound,
    ],
  );

  const hostRoundPlanner = renderHostRoundPlanner('full');

  /** Tempo Library tab: shared catalog playlists, restricted to the GoT label (eligibility tag for all hosts). */
  const tempoLibrarySection = (
    <div className="host-playlist-round-modal__catalog host-tempo-library">
      <div
        className="host-playlist-round-modal__catalog-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <p
          style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}
        >
          Public playlists available to every host, filtered to the GoT label.
        </p>
        {catalogPacksConfigured ? (
          <button
            type="button"
            className="btn-secondary host-playlist-library-toolbar__icon-btn"
            disabled={
              catalogPacksRefreshing ||
              catalogPacksCooldownRemainingMs > 0 ||
              !catalogPacksFetchOk
            }
            aria-label={
              catalogPacksRefreshing
                ? 'Refreshing Tempo Library'
                : catalogPacksCooldownRemainingMs > 0
                  ? 'Tempo Library refresh on cooldown'
                  : 'Refresh Tempo Library'
            }
            title={
              catalogPacksCooldownRemainingMs > 0
                ? `Refresh available in ${Math.max(1, Math.ceil(catalogPacksCooldownRemainingMs / 60000))} min`
                : 'Refresh Tempo Library from the shared catalog (uses Spotify API quota; 5 min cooldown)'
            }
            onClick={() => void loadCatalogPacks({ forceRefresh: true })}
          >
            <RotateCcw
              className={`w-4 h-4${catalogPacksRefreshing ? ' host-playlist-library-toolbar__spin' : ''}`}
              aria-hidden
            />
          </button>
        ) : null}
      </div>
      {catalogPacksRefreshHint || catalogPacksCooldownRemainingMs > 0 ? (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: '0.74rem',
            color: 'rgba(255,255,255,0.55)',
            lineHeight: 1.45,
          }}
          role="status"
        >
          {catalogPacksRefreshHint ||
            `Tempo Library refresh available in ${Math.max(1, Math.ceil(catalogPacksCooldownRemainingMs / 60000))} min.`}
        </p>
      ) : null}
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
                Couldn&apos;t load the Tempo Library (network or server error). Reload the page or use{' '}
                <strong style={{ color: '#c8dcff' }}>Retry loading playlists</strong> if Spotify failed.
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
            Railway), then redeploy. <strong style={{ color: '#c8dcff' }}>My Spotify</strong> is only your
            personal library — it is not the shared Tempo Library.
          </p>
        ) : (
          <>
            {tempoLibraryPacks.length > 0 ? (
              <div className="host-catalog-pack-list">
                {tempoLibraryPacks.map((pack) => {
                  const isSel = selectedCatalogPlaylists.some((p) => p.id === pack.id);
                  return (
                    <div
                      key={pack.id}
                      className="host-catalog-pack-row"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: '0.88rem',
                        flexWrap: 'wrap',
                      }}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', pack.id);
                        e.dataTransfer.effectAllowed = 'copy';
                        setLibraryPlaylistDragActive(true);
                      }}
                      onDragEnd={() => setLibraryPlaylistDragActive(false)}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSel}
                          aria-label={`Include in game mix: ${pack.name}`}
                          onChange={() => {
                            setSelectedCatalogPlaylists((prev) =>
                              isSel ? prev.filter((p) => p.id !== pack.id) : [...prev, { ...pack, catalog: true }]
                            );
                          }}
                        />
                        <span style={{ color: '#fff', flex: 1, minWidth: 0 }}>
                          {stripGoTPrefix ? stripTitleFlagPrefix(pack.name, titleFlagStripList) : pack.name}
                        </span>
                        <span style={{ color: '#8899aa', fontSize: '0.78rem', flexShrink: 0 }}>
                          {pack.tracks} songs
                        </span>
                      </label>
                      <HostPlaylistRoundAssignMenu
                        playlistId={pack.id}
                        playlistName={stripGoTPrefix ? stripTitleFlagPrefix(pack.name, titleFlagStripList) : pack.name}
                        rounds={eventRounds}
                        onAssign={(roundIndex) => addPlaylistToRoundBucket(roundIndex, pack.id)}
                        onUnassign={(roundIndex) =>
                          removePlaylistFromRoundBucket(roundIndex, pack.id)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : playlistQuery.trim() ? (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
                No Tempo Library playlists match your search.
              </p>
            ) : catalogPackOptions.length > 0 ? (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
                The catalog returned {catalogPackOptions.length} playlist(s), but none carry the{' '}
                <strong style={{ color: '#c8dcff' }}>GoT</strong> label, so none are eligible for the shared
                Tempo Library.
              </p>
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
                quota pressure as the library warning if host and catalog share one Spotify app.{' '}
                <strong style={{ color: '#c8dcff' }}>Workarounds:</strong> set{' '}
                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLIST_IDS</code> or{' '}
                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_PLAYLISTS_JSON</code> (no listing call); or use
                a <strong style={{ color: '#c8dcff' }}>second Spotify Developer app</strong> for catalog (
                <code style={{ fontSize: '0.72rem' }}>TEMPO_CATALOG_SPOTIFY_CLIENT_ID</code>
                ). Refresh the Tempo Library after cooldown.
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
                No shared playlists matched yet. If you use{' '}
                <strong style={{ color: '#c8dcff' }}>TEMPO_CATALOG_PLAYLIST_NAME_PREFIX</strong>, playlist
                titles on the <strong style={{ color: '#c8dcff' }}>catalog</strong> Spotify account must{' '}
                <strong style={{ color: '#c8dcff' }}>start with that exact prefix</strong> (e.g.{' '}
                <code style={{ fontSize: '0.72rem' }}>GoT Friday Hits</code>, not{' '}
                <code style={{ fontSize: '0.72rem' }}>TEMPO — …</code>
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
  );

  const playlistRoundBuilderBody = (
              <div className="host-playlist-round-modal-root host-playlist-library-inline">
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
                            ['spotify', 'My Spotify', playlistLibrarySourceCounts.spotify, 'Playlists from your connected Spotify account'],
                            ['tempo', 'Tempo Library', playlistLibrarySourceCounts.tempo, 'Shared GoT-labeled playlists available to all hosts'],
                            ['youtube', 'YouTube', playlistLibrarySourceCounts.youtube, 'YouTube Music playlists'],
                          ] as const
                        ).map(([id, label, count, hint]) => (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={playlistLibrarySource === id}
                            title={`${hint} (${count})`}
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
                      {playlistLibrarySource === 'spotify' ? (
                        <div
                          role="group"
                          aria-label="My Spotify scope"
                          className="host-playlist-library-toolbar__scope"
                        >
                          <button
                            type="button"
                            className={!showAllPlaylists ? 'is-active' : ''}
                            title={`Only playlists whose titles match your flags (${
                              parsedPlaylistTitleFlags.join(', ') || 'none set'
                            }) — edit flags under Saved host preferences`}
                            onClick={() => {
                              setShowAllPlaylists(false);
                              setPlaylistQuery('');
                            }}
                          >
                            {playlistTitleFlagLabel}
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
                          <button
                            type="button"
                            className="host-playlist-library-toolbar__flags-edit"
                            aria-expanded={showTitleFlagsEditor}
                            aria-label="Edit playlist title flags"
                            title={`Edit your title flags (currently: ${playlistTitleFlags || 'none set'})`}
                            onClick={() => setShowTitleFlagsEditor((v) => !v)}
                          >
                            <Settings className="w-3.5 h-3.5" aria-hidden />
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
                        title={`Hide title flag prefix on playlist names (${titleFlagStripList.join(', ')})`}
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
                          onClick={() => {
                            invalidateSetlistBuildCache();
                            void loadPlaylists({ forceRefresh: true }).then(() => {
                              void generateSongListRef.current({ force: true, reason: 'selection' });
                            });
                          }}
                        >
                          <RotateCcw
                            className={`w-4 h-4${spotifyPlaylistsRefreshing ? ' host-playlist-library-toolbar__spin' : ''}`}
                            aria-hidden
                          />
                        </button>
                      ) : null}
                    </div>
                    {showTitleFlagsEditor && playlistLibrarySource === 'spotify' ? (
                      <div className="host-playlist-library-flags-editor" role="group" aria-label="Playlist title flags">
                        <label className="host-playlist-library-flags-editor__field">
                          <span className="host-playlist-library-flags-editor__label">Title flags</span>
                          <input
                            type="text"
                            value={playlistTitleFlags}
                            maxLength={200}
                            placeholder={DEFAULT_PLAYLIST_TITLE_FLAGS}
                            onChange={(e) => setPlaylistTitleFlags(e.target.value)}
                          />
                        </label>
                        <span className="host-playlist-library-flags-editor__hint">
                          Comma-separated. Playlists whose titles contain a flag show under the
                          &ldquo;{playlistTitleFlagLabel}&rdquo; toggle. Saved to your host account.
                        </span>
                        <button
                          type="button"
                          className="btn-secondary host-playlist-library-flags-editor__done"
                          onClick={() => setShowTitleFlagsEditor(false)}
                        >
                          Done
                        </button>
                      </div>
                    ) : null}
                    {(spotifyError || spotifyListCacheInfo) && (
                      <div className="host-playlist-library-alerts">
                        {spotifyListCacheInfo ? (
                          <p className="host-playlist-library-alerts__cache" role="status">
                            {spotifyListCacheInfo}
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
                                invalidateSetlistBuildCache();
                                void loadPlaylists({ forceRefresh: true }).then(() => {
                                  void generateSongListRef.current({ force: true, reason: 'selection' });
                                });
                              }}
                            >
                              Retry
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                    <div className="host-playlist-library-table-zone">
                    <h3 className="host-playlist-library-table-zone__title">
                      {playlistLibrarySource === 'tempo'
                        ? 'Tempo Library — shared playlists for all hosts'
                        : playlistLibrarySource === 'youtube'
                          ? 'YouTube playlists'
                          : 'My Spotify playlists'}
                    </h3>
                    {playlistLibrarySource === 'tempo' ? (
                      tempoLibrarySection
                    ) : (
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
                            {playlistLibrarySource === 'youtube'
                              ? 'No YouTube playlists loaded — connect under Connection, then refresh in More options.'
                              : playlistLibraryEmptyMessage}
                        </div>
                        ) : (
                          paginatedPlaylists.map((p) => {
                          const isSelected = selectedPlaylists.some(sp => sp.id === p.id);
                          const listedCount = Math.max(0, Number(p.tracks) || 0);
                          const loadedCount =
                            p.tracksLoaded != null && p.tracksLoaded > 0 ? p.tracksLoaded : null;
                          const trackCount = loadedCount ?? listedCount;
                          const availGap = (p.tracksRemoved ?? 0) + (p.tracksUnplayable ?? 0);
                          const isInsufficient = trackCount < 15;
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
                                setLibraryPlaylistDragActive(true);
                              }}
                              onDragEnd={() => setLibraryPlaylistDragActive(false)}
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
                                  {stripGoTPrefix ? stripTitleFlagPrefix(p.name, titleFlagStripList) : p.name}
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
                                    parsedPlaylistTitleFlags.length > 0 &&
                                    playlistMatchesTitleFlags(p.name, parsedPlaylistTitleFlags) && (
                                      <span
                                        style={{
                                          fontSize: '0.7rem',
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          background: 'rgba(0, 255, 136, 0.2)',
                                          color: '#00ff88',
                                          border: '1px solid rgba(0, 255, 136, 0.3)',
                                        }}
                                        title={`Matches your title flags (${parsedPlaylistTitleFlags.join(', ')})`}
                                      >
                                        {playlistTitleFlagLabel}
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
                                  <span title={
                                    loadedCount != null && loadedCount !== listedCount
                                      ? `${loadedCount} unique tracks loaded this session · ${listedCount} listed on Spotify`
                                      : undefined
                                  }>
                                    {loadedCount != null && loadedCount !== listedCount ? (
                                      <>
                                        {loadedCount} loaded
                                        <span style={{ opacity: 0.65, marginLeft: 4 }}>
                                          · {listedCount} listed
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        {trackCount} {p.youtubeMusic ? 'videos' : 'songs'}
                                      </>
                                    )}
                                  </span>
                                </span>
                                {availGap > 0 && !p.youtubeMusic && !p.catalog ? (
                                  <span className="host-playlist-library-row__avail-warn" title="Excluded from Tempo pool">
                                    {p.tracksUnplayable ? `${p.tracksUnplayable} unavailable` : null}
                                    {p.tracksUnplayable && p.tracksRemoved ? ' · ' : null}
                                    {p.tracksRemoved ? `${p.tracksRemoved} removed` : null}
                                  </span>
                                ) : null}
                              </span>
                              <span
                                role="presentation"
                                className="host-playlist-library-row__assign"
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <HostPlaylistRoundAssignMenu
                                  playlistId={p.id}
                                  playlistName={stripGoTPrefix ? stripTitleFlagPrefix(p.name, titleFlagStripList) : p.name}
                                  rounds={eventRounds}
                                  onAssign={(roundIndex) => addPlaylistToRoundBucket(roundIndex, p.id)}
                                  onUnassign={(roundIndex) =>
                                    removePlaylistFromRoundBucket(roundIndex, p.id)
                                  }
                                />
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
                    )}
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
                    <div className="host-manager-playlist-export">
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
  );

  const formatDisplaySyncAge = (lastSeenAt: number | null): string => {
    if (lastSeenAt == null) return 'never';
    const sec = Math.max(0, Math.floor((Date.now() - lastSeenAt) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    return `${Math.floor(sec / 60)}m ago`;
  };

  const displaySyncLabel = formatDisplaySyncAge(displayPresence.lastSeenAt);

  const hostPlayerRoster = useMemo(() => {
    const rows: Array<{ playerId: string; playerName: string; inPerson: boolean }> = [];
    const seen = new Set<string>();
    for (const [playerId, d] of Array.from(joinedPlayersRoster.entries())) {
      seen.add(playerId);
      rows.push({ playerId, playerName: d.playerName, inPerson: d.inPerson });
    }
    for (const [playerId, card] of Array.from(playerCards.entries())) {
      if (seen.has(playerId)) continue;
      rows.push({
        playerId,
        playerName: String(card?.playerName || 'Player'),
        inPerson: card?.inPerson !== false,
      });
    }
    return rows;
  }, [joinedPlayersRoster, playerCards]);

  const preShowChecklistItems = useMemo((): PreShowCheckItem[] => {
    const items: PreShowCheckItem[] = [
      {
        id: 'connection',
        label: 'Playback connected (Spotify and/or YouTube)',
        ok: hostPlaybackSystemsReady,
        warn: !hostPlaybackSystemsReady,
        detail: hostPlaybackSystemsReady ? undefined : 'Open Connection in the header',
      },
      ...(mixNeedsHostSpotify && isSpotifyConnected
        ? [
            {
              id: 'device',
              label: 'Spotify device active',
              ok:
                !!selectedDevice?.id && !playbackDeviceNotInList && !selectedDeviceInactive,
              warn:
                !!selectedDevice?.id && (playbackDeviceNotInList || selectedDeviceInactive),
              detail: !selectedDevice?.id
                ? 'Pick a device in Connection'
                : playbackDeviceNotInList
                  ? `${selectedDevice.name} is offline — refresh devices`
                  : selectedDeviceInactive
                    ? `Open Spotify on ${selectedDevice.name}, then refresh devices`
                    : selectedDevice.name,
            } satisfies PreShowCheckItem,
          ]
        : []),
      {
        id: 'display',
        label: 'Projector display connected',
        ok: displayPresence.connected && !displayPresence.stale,
        warn: displayPresence.connected && displayPresence.stale,
        detail: displayPresence.connected ? displaySyncLabel : 'Open /display/' + roomId,
      },
      {
        id: 'mix',
        label: 'Bingo pool built for this round',
        ok: hasFinalizedSongPool || mixFinalized,
        detail: hasFinalizedSongPool ? `${finalizedPoolSongs.length} tracks` : 'Use Show playlists on Game',
      },
      {
        id: 'round',
        label: 'Active round has playlists assigned',
        ok:
          currentRoundIndex >= 0 &&
          (eventRounds[currentRoundIndex]?.playlistIds?.length ?? 0) > 0,
      },
    ];
    return items;
  }, [
    hostPlaybackSystemsReady,
    mixNeedsHostSpotify,
    isSpotifyConnected,
    selectedDevice,
    playbackDeviceNotInList,
    selectedDeviceInactive,
    displayPresence,
    displaySyncLabel,
    hasFinalizedSongPool,
    mixFinalized,
    finalizedPoolSongs.length,
    currentRoundIndex,
    eventRounds,
    roomId,
  ]);

  const roundTimelineRows = useMemo(
    () =>
      eventRounds.map((r, index) => ({
        index,
        name: r.name,
        status: r.status,
        playlistCount: r.playlistIds?.length ?? 0,
        songCount: r.songCount ?? 0,
        playlistNames: (r.playlistNames || []).map((n) =>
          stripTitleFlagPrefix(String(n || ''), titleFlagStripList),
        ),
        saved: Boolean(r.savedMixSnapshot?.songs?.length),
        isCurrent: index === currentRoundIndex,
      })),
    [eventRounds, currentRoundIndex, titleFlagStripList],
  );

  const roundTimelineSummary = useMemo(() => {
    const completed = eventRounds.filter((r) => r.status === 'completed').length;
    const active = eventRounds.filter((r) => r.status === 'active').length;
    const planned = eventRounds.filter(
      (r) => r.status === 'planned' && (r.playlistIds || []).length > 0,
    ).length;
    const draft = eventRounds.filter(
      (r) => r.status === 'unplanned' || (r.playlistIds || []).length === 0,
    ).length;
    const total = eventRounds.length;
    const parts: string[] = [];
    if (active > 0) parts.push(`${active} live`);
    if (planned > 0) parts.push(`${planned} planned`);
    if (completed > 0) parts.push(`${completed} done`);
    if (draft > 0) parts.push(`${draft} draft`);
    if (parts.length === 0) return `${total} round${total === 1 ? '' : 's'}`;
    return `${parts.join(' · ')} · ${total} total`;
  }, [eventRounds]);

  const callLogRows = useMemo(
    () =>
      playedInOrder.map((s, i) => ({
        id: s.id,
        name: s.name,
        artist: s.artist,
        index: i + 1,
      })),
    [playedInOrder],
  );

  const handleAddRound = useCallback(() => {
    if (eventRounds.length >= MAX_EVENT_ROUNDS) return;
    const newRound: EventRound = {
      id: `round-${Date.now()}`,
      name: `Round ${eventRounds.length + 1}`,
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned',
      bingoPattern: 'line',
    };
    const updated = ensureEventRoundNames([...eventRounds, newRound]);
    handleUpdateRounds(updated);
    const newIndex = updated.length - 1;
    // Mid-game, currentRoundIndex is the live round pointer — only move the prep focus.
    if (gameState !== 'playing') setCurrentRoundIndex(newIndex);
    setRoundBuilderFocusIndex(newIndex);
    addLog(`Added ${newRound.name}`, 'info');
  }, [eventRounds, gameState, handleUpdateRounds, addLog]);

  const handleRemoveRound = useCallback(
    (roundIndex: number) => {
      if (gameState === 'playing' && roundIndex === currentRoundIndex) {
        showToast('That round is live — end the round before deleting it. Other rounds can be deleted.', 'info');
        return;
      }
      if (eventRounds.length <= 1) return;
      const round = eventRounds[roundIndex];
      if (!round) return;
      const hasContent =
        (round.playlistIds?.length ?? 0) > 0 || Boolean(round.savedMixSnapshot?.songs?.length);
      if (
        hasContent &&
        !window.confirm(`Delete ${round.name}? Its playlist assignments and saved mix will be removed.`)
      ) {
        return;
      }
      const updated = ensureEventRoundNames(eventRounds.filter((_, i) => i !== roundIndex));
      handleUpdateRounds(updated);
      const clampToUpdated = (cur: number) => {
        const next = cur > roundIndex ? cur - 1 : cur;
        return Math.max(0, Math.min(next, updated.length - 1));
      };
      setCurrentRoundIndex(clampToUpdated);
      setRoundBuilderFocusIndex(clampToUpdated);
      addLog(`Deleted ${round.name}`, 'info');
    },
    [eventRounds, gameState, currentRoundIndex, handleUpdateRounds, addLog, showToast],
  );

  const handleExportEventRecap = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      roomId,
      gameState,
      rounds: eventRounds,
      winners,
      roundWinners,
      playedInOrder,
      currentRoundIndex,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tempo-recap-${roomId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('Exported event recap JSON', 'info');
  }, [roomId, gameState, eventRounds, winners, roundWinners, playedInOrder, currentRoundIndex, addLog]);

  const handleCopyJoinLink = useCallback(() => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(roomId || '')}`;
    void navigator.clipboard.writeText(url).then(
      () => showToast('Join link copied', 'success'),
      () => showToast('Could not copy link', 'error'),
    );
  }, [roomId]);

  const publicDisplayUrl = roomId
    ? `${window.location.origin}/display/${encodeURIComponent(roomId)}`
    : '';

  const handleCopyDisplayLink = useCallback(() => {
    if (!publicDisplayUrl) return;
    void navigator.clipboard.writeText(publicDisplayUrl).then(
      () => showToast('Display link copied', 'success'),
      () => showToast('Could not copy link', 'error'),
    );
  }, [publicDisplayUrl]);

  useEffect(() => {
    if (hostGlassNav !== 'game' || gameState !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        void pauseSong();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void skipSong();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        replayCurrentClip();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        markCurrentSongPlayed();
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (pendingVerification) openBingoVerification();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    hostGlassNav,
    gameState,
    pauseSong,
    skipSong,
    replayCurrentClip,
    markCurrentSongPlayed,
    pendingVerification,
    openBingoVerification,
  ]);

  return (
    <div className="host-view host-glass-theme">
      <div className="host-view__bg" aria-hidden />
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
        <div className="host-shell">
          <nav className="host-sidebar host-glass-panel" aria-label="Host navigation">
            {HOST_GLASS_NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  hostGlassNav === item.id
                    ? 'host-sidebar__btn host-sidebar__btn--active'
                    : 'host-sidebar__btn'
                }
                aria-current={hostGlassNav === item.id ? 'page' : undefined}
                onClick={() => onHostGlassNav(item.id)}
              >
                {hostNavIcons[item.id]}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="host-shell__main" ref={hostShellMainRef}>
        {/* Header */}
        <div className="host-header host-header--r4">
          <div className="host-header__brand">
            <h1 className="host-header__title">
              <Gamepad2 className="host-header__icon" aria-hidden />
              <span className="host-header__title-text">
                <span className="host-header__app">TEMPO</span>
                <span className="host-header__role">Host</span>
              </span>
            </h1>
            <p className="host-header__room-pill">
              {gameState === 'playing' ? (
                <span className="host-header__live-dot" aria-hidden />
              ) : null}
              Room <strong>{roomId}</strong>
              <span className="host-header__state">
                {gameState === 'playing'
                  ? ' · Live'
                  : gameState === 'ended'
                    ? ' · Ended'
                    : ' · Setup'}
              </span>
            </p>
          </div>
          <div className="room-info host-header__toolbar">
            <button
              type="button"
              className="btn-secondary host-connection-toolbar-btn"
              onClick={() => openHostTutorial(0)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              title="Guided host training"
            >
              <BookOpen className="w-4 h-4" aria-hidden />
              Guide
            </button>
            {hostAccount ? (
              <span
                className="host-account-chip"
                title={
                  [hostAccount.displayName, hostAccount.email].filter(Boolean).join(' · ') ||
                  `Host account #${hostAccount.id}`
                }
              >
                {hostAccount.displayName?.trim() ||
                  hostAccount.email?.split('@')[0]?.trim() ||
                  `Account #${hostAccount.id}`}
              </span>
            ) : hostAccount === null ? (
              <span className="host-account-chip host-account-chip--muted" title="Sign in from home (Google) to link a host account.">
                No Tempo account linked
              </span>
            ) : null}
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

        {showTutorialSuggestion && !hostTutorialOpen ? (
          <div className="host-tutorial-suggest" role="status">
            <span>New to hosting? Take the guided tour.</span>
            <div className="host-tutorial-suggest__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setHostTutorialSuggestionDismissed();
                  setShowTutorialSuggestion(false);
                }}
              >
                Dismiss
              </button>
              <button type="button" className="btn-primary" onClick={() => openHostTutorial(0)}>
                Start guide
              </button>
            </div>
          </div>
        ) : null}

        {/* Main Content */}
        <div className="host-content host-content--dashboard" style={{ paddingBottom: '20px' }}>
          <div className="tab-content host-unified host-glass-workspace">
            {showHostSetupCockpit && (hostGlassNav === 'game' || hostGlassNav === 'rounds') ? (
              <HostSetupCockpit
                status={{
                  roomId: roomId || '',
                  gameState,
                  playbackReady: hostPlaybackSystemsReady,
                  displayConnected: displayPresence.connected,
                  displayStale: displayPresence.stale,
                  displaySyncLabel,
                }}
                rounds={roundTimelineRows}
                roundSummary={roundTimelineSummary}
                onSelectRound={handleSelectRoundForPrep}
                step={hostSetupStep}
                onStepChange={setHostSetupStep}
                playlistReady={setupPlaylistReady}
                criteriaReady={setupCriteriaReady}
                playReady={prepRoundReadyForGoLive}
              >
                {hostSetupStep === 'playlist' ? (
                  <HostSetupPlaylistStep
                    roundName={hostActiveRoundSummary.roundName}
                    playlistNames={hostActiveRoundSummary.playlistNames}
                    playlistReady={setupPlaylistReady}
                    spotifyCacheInfo={spotifyListCacheInfo}
                    onGoToRounds={() => onHostGlassNav('rounds')}
                  />
                ) : null}
                {hostSetupStep === 'criteria' ? (
                  <div className="host-setup-step">
                    <header className="host-setup-step__header">
                      <p className="host-setup-step__eyebrow">Step 2 · Criteria</p>
                      <h2 className="host-setup-step__title">Set how this round plays</h2>
                    </header>
                    <section
                      className="host-rounds-panel host-manager-section"
                      aria-labelledby="host-setup-criteria-title"
                      data-host-tutorial="criteria"
                    >
                      <div className="host-rounds-panel__planner">
                        {renderHostRoundPlanner('criteria')}
                      </div>
                    </section>
                  </div>
                ) : null}
                {hostSetupStep === 'play' ? (
                  <HostSetupPlayStep
                    roomId={roomId ?? null}
                    roundName={hostActiveRoundSummary.roundName}
                    playlistNames={hostActiveRoundSummary.playlistNames}
                    patternLabel={hostActiveRoundSummary.patternLabel}
                    snippetLength={snippetLength}
                    randomStartsLabel={hostActiveRoundSummary.randomStartsLabel}
                    titleRevealLabel={hostActiveRoundSummary.titleRevealLabel}
                    poolCount={hostActiveRoundSummary.poolCount}
                    prepRoundReadyForGoLive={prepRoundReadyForGoLive}
                    showPrimaryFinalizeMixButton={showPrimaryFinalizeMixButton}
                    mixGameActionsBlocked={mixGameActionsBlocked}
                    finalizeMixBusy={finalizeMixBusy}
                    finalizeMixElapsedSec={finalizeMixElapsedSec}
                    savedRoundRoomSyncBusy={savedRoundRoomSyncBusy}
                    isSpotifyConnecting={isSpotifyConnecting}
                    mixNeedsHostSpotify={mixNeedsHostSpotify}
                    playlistAvailabilityIssues={playlistAvailabilityIssues}
                    preShowChecklistItems={preShowChecklistItems}
                    onFinalizeMix={() => void finalizeMix()}
                    onStartGame={() => void startGame()}
                  />
                ) : null}
              </HostSetupCockpit>
            ) : null}

            {hostGlassNav === 'game' && !showHostSetupCockpit && (
              <>
                <div data-host-tutorial="next-round">
                  <HostRoundTimeline
                    className="host-round-timeline--game"
                    rounds={roundTimelineRows}
                    summary={roundTimelineSummary}
                    onSelectRound={handleSelectRoundForPrep}
                  />
                </div>
                  <HostGameDashboard
                    gameState={gameState}
                    currentSong={currentSong}
                    gamePaused={gamePaused}
                    pendingVerification={pendingVerification}
                    onReplayClip={replayCurrentClip}
                    onMarkPlayed={markCurrentSongPlayed}
                    markPlayedBusy={markPlayedBusy}
                    isPlaying={isPlaying}
                    isMuted={isMuted}
                    playbackState={playbackState}
                    playbackTrackNumber={playbackTrackNumber}
                    playbackTrackTotal={playbackTrackTotal}
                    snippetLength={snippetLength}
                    roundName={hostActiveRoundSummary.roundName}
                    patternLabel={hostActiveRoundSummary.patternLabel}
                    poolCount={hostActiveRoundSummary.poolCount}
                    playedCount={hostActiveRoundSummary.playedCount}
                    remainingCount={hostActiveRoundSummary.remainingCount}
                    percentComplete={hostActiveRoundSummary.percentComplete}
                    roundStatus={hostActiveRoundSummary.roundStatus}
                    roundStatusLabel={hostActiveRoundSummary.roundStatusLabel}
                    titleRevealLabel={hostActiveRoundSummary.titleRevealLabel}
                    randomStartsLabel={hostActiveRoundSummary.randomStartsLabel}
                    mixFinalized={hostActiveRoundSummary.mixFinalized}
                    savedRound={hostActiveRoundSummary.savedRound}
                    playersOnlineCount={hostActiveRoundSummary.playersOnlineCount}
                    winnersCount={hostActiveRoundSummary.winnersCount}
                    lastPlayed={hostActiveRoundSummary.lastPlayed}
                    playlistNames={hostActiveRoundSummary.playlistNames}
                    poolSongs={finalizedPoolSongs}
                    playlistAvailabilityIssues={playlistAvailabilityIssues}
                    prepRoundReadyForGoLive={prepRoundReadyForGoLive}
                    showPrimaryFinalizeMixButton={showPrimaryFinalizeMixButton}
                    mixGameActionsBlocked={mixGameActionsBlocked}
                    finalizeMixBusy={finalizeMixBusy}
                    finalizeMixElapsedSec={finalizeMixElapsedSec}
                    savedRoundRoomSyncBusy={savedRoundRoomSyncBusy}
                    isSpotifyConnecting={isSpotifyConnecting}
                    mixNeedsHostSpotify={mixNeedsHostSpotify}
                    gameTabRoundBuilderReady={gameTabRoundBuilderReady}
                    hasFinalizedSongPool={hasFinalizedSongPool}
                    playerCardsCount={playerCards.size}
                    onPause={pauseSong}
                    onSkip={skipSong}
                    onMuteToggle={handleMuteToggle}
                    onVolumeChange={handleVolumeChange}
                    setIsMuted={setIsMuted}
                    setPlaybackVolume={(v) => setPlaybackState((prev) => ({ ...prev, volume: v }))}
                    onStartGame={startGame}
                    onFinalizeMix={() => void finalizeMix()}
                    onEndGame={endGame}
                    onNewRoundSetup={confirmAndNewRound}
                    onOpenLibrary={openPlaylistLibrary}
                    onOpenPool={() => setShowBingoPoolModal(true)}
                    onOpenPlayerCards={openPlayerCardsModal}
                    onResetDisplayLetters={resetDisplayLetters}
                    onResumeGame={handleManualResumeGame}
                    getDisplaySongTitle={getDisplaySongTitle}
                    getDisplaySongArtist={getDisplaySongArtist}
                    callLog={callLogRows}
                    canUndoSkip={canUndoSkip}
                    onUndoSkip={undoLastSkip}
                    hostRoomHydrating={hostRoomHydrating}
                    onResyncRoomState={resyncHostRoomState}
                  />

                {!showHostSetupCockpit &&
                gameState === 'waiting' &&
                  !hostRoomHydrating &&
                  !currentSong &&
                  !hasFinalizedSongPool &&
                  !gameTabRoundBuilderReady ? (
                  <div className="host-r4-alert host-glass-panel">
                    <p className="host-r4-alert__title">No song mix yet</p>
                    <p className="host-r4-alert__body">
                      {mixPlaylistSelection.length === 0
                        ? 'Use Playlist setup to add playlists and assign them to a round. Connect Spotify / YouTube via Connection in the header.'
                        : 'Use Build song pool or Start game on the Play step to build the bingo pool.'}
                    </p>
                  </div>
                ) : null}

                {!showHostSetupCockpit && showFinalizedButEmptyPool ? (
                  <div className="host-r4-alert host-r4-alert--warn host-glass-panel" role="alert">
                    <p className="host-r4-alert__title">Mix finalized, but no track list in this view</p>
                    <p className="host-r4-alert__body">
                      Spotify may have rate limited playlist fetches. Try Refresh in Library, wait a few minutes, or
                      reload this page.
                    </p>
                  </div>
                ) : null}

                {gameState === 'playing' && bingoVerificationCount > 0 ? (
                  <div data-host-tutorial="bingo-verify">
                  <HostGameLivePanel
                    bingoVerificationCount={bingoVerificationCount}
                    pendingPlayerName={pendingVerification?.playerName ?? null}
                    onOpenBingoVerification={openBingoVerification}
                  />
                  </div>
                ) : (
                  <div data-host-tutorial="bingo-verify" className="host-tutorial-anchor" aria-hidden />
                )}
              </>
            )}

            {hostGlassNav === 'players' && roomId ? (
              <div data-host-tutorial="players">
                <HostPlayersPanel
                  roomId={roomId}
                  playerCardsCount={playerCards.size}
                  roster={hostPlayerRoster}
                  onOpenPlayerCards={openPlayerCardsModal}
                  onCopyJoinLink={handleCopyJoinLink}
                />
              </div>
            ) : null}

            {hostGlassNav === 'settings' ? (
              <div>
              <HostSettingsPanel
                connectionPanel={hostConnectionPanel}
                roomId={roomId ?? null}
                activityEntries={activityLog}
                onExportEventRecap={handleExportEventRecap}
                hybridInPersonPlusOnline={hybridInPersonPlusOnline}
                onHybridChange={(v) => {
                  setHybridInPersonPlusOnline(v);
                  try {
                    socket?.emit('set-hybrid-mode', { roomId, hybridInPersonPlusOnline: v });
                  } catch {
                    /* ignore */
                  }
                }}
                snippetLength={snippetLength}
                onSnippetLengthChange={handleSnippetLengthChange}
                randomStarts={randomStarts}
                onRandomStartsChange={handleRandomStartsChange}
                playlistTitleFlags={playlistTitleFlags}
                onPlaylistTitleFlagsChange={setPlaylistTitleFlags}
                publicDisplayTitleRevealMode={publicDisplayTitleRevealMode}
                onTitleRevealModeChange={(raw) =>
                  updatePublicDisplayTitleRevealMode(normalizePublicDisplayTitleRevealMode(raw))
                }
                letterRevealIntervalSec={letterRevealIntervalSec}
                onLetterRevealIntervalChange={updatePublicDisplayLetterRevealInterval}
                publicDisplayLetterRevealToast={publicDisplayLetterRevealToast}
                onLetterRevealToastChange={updatePublicDisplayLetterRevealToast}
              />
              </div>
            ) : null}

            {hostGlassNav === 'rounds' ? (
              <HostRoundsTabWorkspace
                timeline={
                  <HostRoundTimeline
                    className="host-round-timeline--rounds-tab"
                    rounds={roundTimelineRows}
                    summary={roundTimelineSummary}
                    onSelectRound={handleFocusRoundForLibrary}
                    onAddRound={handleAddRound}
                    canAddRound={eventRounds.length < MAX_EVENT_ROUNDS}
                    onRemoveRound={handleRemoveRound}
                    canRemoveRound={eventRounds.length > 1}
                    onDropPlaylist={addPlaylistToRoundBucket}
                  />
                }
                library={<div data-host-tutorial="playlist">{playlistRoundBuilderBody}</div>}
                summary={
                  selectedRoundForPanel ? (
                    <HostSelectedRoundPanel
                      roundName={selectedRoundForPanel.name}
                      status={selectedRoundForPanel.status}
                      songCount={selectedRoundForPanel.songCount}
                      playlists={selectedRoundForPanel.playlists}
                      canEdit={
                        !(gameState === 'playing' && selectedRoundForPanel.index === currentRoundIndex)
                      }
                      onRemovePlaylist={(playlistId) =>
                        removePlaylistFromRoundBucket(selectedRoundForPanel.index, playlistId)
                      }
                      onDropPlaylist={(playlistId) =>
                        addPlaylistToRoundBucket(selectedRoundForPanel.index, playlistId)
                      }
                    />
                  ) : null
                }
                footer={
                  gameState === 'waiting' ? (
                    <p className="host-rounds-tab-workspace__continue" role="status">
                      Assign playlists here, then continue on the <strong>Game</strong> tab for Criteria and
                      Play.
                    </p>
                  ) : null
                }
                advanced={
                  gameState !== 'waiting' ? (
                    <>
                      <details className="host-setup-advanced-details host-glass-panel">
                        <summary>Pool quality report</summary>
                        <HostPoolQualityReport
                          songs={finalizedPoolSongs.length > 0 ? finalizedPoolSongs : songList}
                          playlistCount={mixPlaylistSelection.length}
                          mixFinalized={mixFinalized}
                        />
                      </details>
                      <details className="host-setup-advanced-details host-glass-panel">
                        <summary>Full round planner</summary>
                        <div className="host-rounds-panel__planner">{hostRoundPlanner}</div>
                      </details>
                    </>
                  ) : null
                }
              />
            ) : null}

            {hostGlassNav === 'display' && (
          <details ref={displaySettingsRef} className="host-event-settings" open data-host-tutorial="display">
            <summary className="host-event-settings__summary">
              <Monitor className="w-5 h-5" aria-hidden />
              Projector &amp; event rules
            </summary>
            <div className="host-event-settings__body">

          <section className="host-glass-panel host-display-link-panel" aria-label="Public display link">
            <h2
              className="host-manager-section__title"
              style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' }}
            >
              <Monitor className="w-5 h-5" style={{ color: '#00ff88' }} aria-hidden />
              Display link
            </h2>
            <code className="host-display-link-panel__url">{publicDisplayUrl || '—'}</code>
            <div className="host-display-link-panel__actions">
              <button type="button" className="btn-secondary" onClick={handleCopyDisplayLink}>
                <Copy className="w-4 h-4" aria-hidden />
                Copy link
              </button>
              {publicDisplayUrl ? (
                <a className="btn-primary" href={publicDisplayUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-4 h-4" aria-hidden />
                  Open display
                </a>
              ) : null}
            </div>
          </section>

          <motion.section
            className="host-manager-round host-manager-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
          >
            <h2 className="host-manager-section__title host-event-settings__hidden-heading">
              Event rules
            </h2>
          </motion.section>

          <HostDisplayExtrasPanel
            displayConnected={displayPresence.connected}
            displayStale={displayPresence.stale}
            displaySyncLabel={displaySyncLabel}
            publicDisplayCallListMode={publicDisplayCallListMode}
            publicDisplayFontSize={publicDisplayFontSize}
            publicDisplayTitleRevealMode={publicDisplayTitleRevealMode}
            letterRevealIntervalSec={letterRevealIntervalSec}
            publicDisplayLetterRevealToast={publicDisplayLetterRevealToast}
            onApplyPreset={(p) => {
              updatePublicDisplayFontSize(p.publicDisplayFontSize);
              updatePublicDisplayTitleRevealMode(p.publicDisplayTitleRevealMode);
              updatePublicDisplayLetterRevealInterval(p.letterRevealIntervalSec);
              if (p.publicDisplayLetterRevealToast != null) {
                updatePublicDisplayLetterRevealToast(p.publicDisplayLetterRevealToast);
              }
              addLog(`Applied display preset "${p.name}"`, 'info');
            }}
          />

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
                  {publicDisplayFontSize.toFixed(1)}× vs auto-fit
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => updatePublicDisplayFontSize(1)}
                style={{ fontSize: '0.85rem', padding: '10px 14px' }}
              >
                Reset to 100% (auto-fit)
              </button>
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

          {showYoutubeMusicInConnectionModal ? (
          <motion.section
            className="host-manager-section host-manager-section--display host-manager-display-pane host-manager-display-pane--continued font-size-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            aria-labelledby="host-manager-display-title"
          >
              <>
                <div className="host-manager-display__divider" style={{ marginTop: 14 }} />
                <p className="host-manager-display__sub">YouTube playback window</p>
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
          </motion.section>
          ) : null}
            </div>
          </details>
            )}

          </div>
        </div>
          </div>
        </div>


      </motion.div>

      {showConnectionModal && (
        <div
          className="host-connection-modal-backdrop"
          onClick={dismissConnectionModal}
          role="presentation"
        >
          <div
            className="host-connection-modal host-glass-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-connection-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="host-connection-modal__header">
              <h2 id="host-connection-modal-title" className="host-glass-modal__title">
                {showYoutubeMusicInConnectionModal ? 'Playback & connections' : 'Spotify & device'}
              </h2>
              <button
                type="button"
                className="host-connection-modal__close"
                aria-label="Close"
                onClick={dismissConnectionModal}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="host-connection-modal__body">{hostConnectionPanel}</div>
          </div>
        </div>
      )}
      {showBingoPoolModal && hasFinalizedSongPool && (
        <div
          className="host-connection-modal-backdrop"
          onClick={() => setShowBingoPoolModal(false)}
          role="presentation"
        >
          <div
            className="host-connection-modal host-glass-modal host-connection-modal--bingo-pool host-bingo-pool-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-bingo-pool-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="host-connection-modal__header">
              <h2 id="host-bingo-pool-modal-title" className="host-glass-modal__title">
                <ListChecks className="host-glass-modal__title-icon" aria-hidden />
                {bingoPoolSectionTitle}
              </h2>
              <button
                type="button"
                className="host-connection-modal__close"
                aria-label="Close"
                onClick={() => setShowBingoPoolModal(false)}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="host-connection-modal__body host-connection-modal__body--bingo-pool">
              {bingoPoolUiShowsPreFinalizeSubset && (
                <p className="host-bingo-pool-modal__subset-warn">
                  {songList.length - finalizedPoolSongs.length} more song
                  {songList.length - finalizedPoolSongs.length === 1 ? '' : 's'} loaded from
                  playlists won&apos;t appear on cards with this layout—they&apos;re hidden here so the list
                  matches what bingo uses.
                </p>
              )}
              <HostPlaylistAvailabilityWarnings issues={playlistAvailabilityIssues} />
              <BingoPoolList
                songs={finalizedPoolSongs}
                currentSongId={currentSong?.id}
                playedSongIds={bingoPoolPlayedSongIds}
                getDisplaySongTitle={getDisplaySongTitle}
                songAliases={songAliases}
                getDisplaySongArtist={getDisplaySongArtist}
                onEditSongAlias={handleEditSongAlias}
              />
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
            className="host-connection-modal host-glass-modal host-player-cards-modal"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="host-connection-modal__header host-player-cards-modal__header">
            <div style={{ minWidth: 0 }}>
              <h2 id="host-player-cards-modal-title" className="host-glass-modal__title">
                <Users className="host-glass-modal__title-icon" aria-hidden />
                Player Cards &amp; Progress
              </h2>
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
          <div className="host-player-cards-modal__body">
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
            ref={bingoVerificationModalRef}
            id="host-bingo-verification-modal"
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
              <p
                style={{
                  fontSize: '1.2rem',
                  color: '#fff',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                <strong>{pendingVerification.playerName}</strong>
                {pendingVerification.inPerson === false ? <OnlinePlayerBadge /> : null}
                <span>called BINGO!</span>
              </p>
              {pendingVerification.inPerson === false ? (
                <p style={{ color: '#7ec8ff', fontSize: '0.85rem', marginBottom: 8 }}>
                  Joined online (remote link).
                  {hybridInPersonPlusOnline
                    ? ' Hybrid mode: round/prize still needs an in-person winner unless you approve this as the official win.'
                    : null}
                </p>
              ) : null}
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
                  {bingoSquaresInGridOrder(pendingVerification.playerCard.squares).map((square: any) => {
                    const isInWinningPattern = pendingVerification.winningPatternPositions?.includes(square.position);
                    const wasPlayed =
                      isBingoFreeSpaceSquare(square) ||
                      (pendingVerification.playedSongs?.some((song: any) => song.id === square.songId) ?? false);
                    const isMarked = square.marked === true; // Explicit check for true
                    const isInvalid = isMarked && !wasPlayed;

                    const verCellVis = youtubeBingoSquareDisplay({
                      customSongName: square.customSongName,
                      customArtistName: square.customArtistName,
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
                    customArtistName: square.customArtistName,
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
                onClick={() => void rejectBingo()}
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
              position: 'relative',
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
            <button
              type="button"
              onClick={dismissRoundCompleteModal}
              aria-label="Close and return to host"
              title="Back to host (decide later)"
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                padding: 0,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#e8e8e8',
                cursor: 'pointer',
              }}
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
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
                type="button"
                onClick={dismissRoundCompleteModal}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '2px solid rgba(255, 255, 255, 0.28)',
                  borderRadius: '10px',
                  padding: '14px 24px',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: '#f4f4f4',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                Back to host (mark round complete)
              </button>

              {getNextPlannedRound() >= 0 ? (
                <button
                  type="button"
                  onClick={handlePrepareNextPlannedRound}
                  style={{
                    background: 'rgba(0, 170, 255, 0.12)',
                    border: '2px solid rgba(0, 170, 255, 0.55)',
                    borderRadius: '10px',
                    padding: '14px 24px',
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    color: '#8edcff',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 170, 255, 0.2)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 170, 255, 0.12)';
                  }}
                >
                  Prepare next round (no auto-start)
                </button>
              ) : null}

              <button
                onClick={getNextPlannedRound() >= 0 ? () => void handleStartNextPlannedRound() : handleStartNextRound}
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
                {getNextPlannedRound() >= 0 ? 'Start next planned round now' : 'Start next round'}
              </button>

              {getNextPlannedRound() >= 0 ? (
                <button
                  onClick={handleStartNextRound}
                  style={{
                    background: 'rgba(0, 170, 255, 0.12)',
                    border: '2px solid rgba(0, 170, 255, 0.55)',
                    borderRadius: '10px',
                    padding: '12px 24px',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    color: '#8edcff',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 170, 255, 0.2)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 170, 255, 0.12)';
                  }}
                >
                  Fresh Setup Instead
                </button>
              ) : null}

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
              Bingo approved and playback paused. <strong style={{ color: '#ccc', fontStyle: 'normal' }}>Back to host</strong>{' '}
              marks this round complete. Use <strong style={{ color: '#ccc', fontStyle: 'normal' }}>Prepare next round</strong>{' '}
              to load the next bucket without starting playback, or{' '}
              <strong style={{ color: '#ccc', fontStyle: 'normal' }}>Start next planned round now</strong> when you are ready to go live.
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
        <SongAliasModal
          isOpen={showSongTitleModal}
          onClose={() => {
            setShowSongTitleModal(false);
            setEditingSong(null);
          }}
          onSave={handleSaveSongAlias}
          onClear={handleClearSongAlias}
          songId={editingSong.id}
          originalTitle={editingSong.title}
          originalArtist={editingSong.artist}
          aliasTitle={songAliases[editingSong.id]?.title}
          aliasArtist={songAliases[editingSong.id]?.artist}
        />
      )}

      <HostTutorial
        open={hostTutorialOpen}
        stepIndex={hostTutorialStep}
        onStepChange={setHostTutorialStep}
        onClose={closeHostTutorial}
      />

    </div>
  );
};

export default HostView;



