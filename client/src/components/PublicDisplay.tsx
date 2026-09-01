import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  QrCode
} from 'lucide-react';
import { API_BASE } from '../config';
import { cleanSongTitle } from '../utils/songTitleCleaner';
import { youtubeBingoSquareDisplay, youtubeTrackDisplayFields } from '../utils/youtubeTrackDisplay';
import {
  normalizePublicDisplayTitleRevealMode,
  type PublicDisplayTitleRevealMode,
} from '../utils/publicDisplayTitleReveal';
import { playlistDisplayParts } from '../utils/roundPrintLabels';
import {
  DISPLAY_THEME_STORAGE_KEY,
  glassForDisplayTheme,
  readStoredDisplayTheme,
  type PublicDisplayTheme,
} from '../publicDisplayGlassTheme';
import './PublicDisplayGlassTheme.css';
import {
  computeBingoCellTextScale,
  fitCallCardTextBest,
  formatCallCardTitle,
  formatCallCardArtist,
  callCardWrapSegments,
  resolveCallCardFontSizes,
  maxHeightEm,
  CALL_CARD_ARTIST_LETTER_SPACING_EM,
  CALL_CARD_COLUMN_PAD_X_PX,
  CALL_CARD_FIT_HEIGHT_SAFETY_PX,
  CALL_CARD_TITLE_LETTER_SPACING_EM,
  callCardTitleArtistGapPx,
  PUBLIC_DISPLAY_CALL_ARTIST_FONT_FAMILY,
  PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY,
  callCardLineHeightEm,
  callLetterSlotStyle,
  emergencyCallCardTypography,
  typographyFromCallCardFit,
  uncappedFullCardTypography,
  unrevealedLetterFillStyle,
  type CallCardTypography,
} from '../utils/publicDisplayCallCardText';
import type { PatternCompositeSpec, PatternCompositeClause } from '../patternDefinitions';
import {
  normalizePatternComposite,
  unionCompositeHighlightPositions,
  compositeShapeClausesUseUnionHighlight,
  normalizeLinesRequired,
  customMaskHighlightPositions,
  LINE_PATTERN_MAX_LINES,
  customPatternMaskVariants,
  clauseHighlightPositions,
  describeCompositeClauseBrief,
  describeCompositeClauseAudience,
  describeCompositePatternAudienceSentence,
  describeLinePatternLabel,
  getPatternDisplayName,
} from '../patternDefinitions';

/** Public-facing domain shown on the projector splash ("Go to …"). Display copy only — the QR code still encodes this deployment's real /player/:roomId URL. */
const PUBLIC_DISPLAY_JOIN_DOMAIN = 'TempoMusicBingo.com';

const FULL_CARD_PULSE_DURATION_SEC = 1.28;

/** Non-row-major spread so full-card pulses don't read as a single sweep. */
function fullCardPulseDelaySec(row: number, col: number): number {
  const idx = row * 5 + col;
  const perm = (idx * 17 + col * 7 + row * 11) % 25;
  return perm * (FULL_CARD_PULSE_DURATION_SEC / 25);
}

/** Standard bingo lines: rows 0–4, cols 0–4, two diagonals (same order as server listCompletedLinesPlayedStrict). */
const WINNING_LINE_PREDICATES: Array<(r: number, c: number) => boolean> = [
  (r, c) => r === 0,
  (r, c) => r === 1,
  (r, c) => r === 2,
  (r, c) => r === 3,
  (r, c) => r === 4,
  (r, c) => c === 0,
  (r, c) => c === 1,
  (r, c) => c === 2,
  (r, c) => c === 3,
  (r, c) => c === 4,
  (r, c) => r === c,
  (r, c) => r + c === 4,
];

const LINE_PREDICATE_COUNT = WINNING_LINE_PREDICATES.length;

/** Distinct projector hues for combined-pattern clauses (grid + chip accents). */
const COMPOSITE_CLAUSE_COLOR_SLOTS = 6;

const LINE_PREDICATE_DISPLAY_LABELS: readonly string[] = [
  'Top row',
  'Row 2',
  'Middle row',
  'Row 4',
  'Bottom row',
  'B column',
  'I column',
  'N column',
  'G column',
  'O column',
  'Diagonal (NW–SE)',
  'Diagonal (NE–SW)',
];

function positionsForLinePredicateIndex(lineIdx: number): string[] {
  const pred = WINNING_LINE_PREDICATES[lineIdx];
  if (!pred) return [];
  const out: string[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (pred(r, c)) out.push(`${r}-${c}`);
    }
  }
  return out;
}

/** Indices 0–4 = rows top→bottom; 5–9 = columns B–O left→right; 10 = \\ diag, 11 = / diag. */

/** When curated demos skip N, build ~5 tuples spaced around the clock (distinct indices). */
function spreadFallbackDemoTuples(n: number): number[][] {
  const seeds = [0, 2, 5, 7, 9];
  const out: number[][] = [];
  for (const s of seeds) {
    const t = Array.from({ length: n }, (_, i) =>
      (s + Math.round((i * LINE_PREDICATE_COUNT) / Math.max(n, 1))) % LINE_PREDICATE_COUNT,
    );
    if (new Set(t).size === n) out.push(t);
  }
  return out.length ? out : [Array.from({ length: n }, (_, i) => i % LINE_PREDICATE_COUNT)];
}

/**
 * Rotating demos: N===1 cycles all 12 lines alone; N>1 uses a short curated list (mixed geometry),
 * not consecutive indices, so the wall reads as “examples” rather than chasing adjacent lines.
 */

/** Dedupe composite projector demos that resolve to the same cell set (keep first label + clause). */
function dedupeCompositeDemoSequences(
  items: { label: string; positions: string[]; clauseIndex: number }[],
): { label: string; positions: string[]; clauseIndex: number }[] {
  const seen = new Set<string>();
  const out: { label: string; positions: string[]; clauseIndex: number }[] = [];
  for (const it of items) {
    const key = [...it.positions].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function buildLinePatternDemoTuples(linesRequiredNorm: number): number[][] {
  const n = Math.min(LINE_PATTERN_MAX_LINES, Math.max(1, Math.round(linesRequiredNorm)));
  if (n === 1) {
    return Array.from({ length: LINE_PREDICATE_COUNT }, (_, i) => [i]);
  }
  if (n >= LINE_PREDICATE_COUNT) {
    return [Array.from({ length: LINE_PREDICATE_COUNT }, (_, i) => i)];
  }

  const curated: Record<number, number[][]> = {
    /* Line indices: 0–4 rows (top→bottom), 5–9 cols B→O (left→right), 10 = \\ , 11 = / */
    2: [
      [2, 4],
      [0, 3],
      [5, 9],
      [6, 8],
      [0, 5],
      [2, 7],
      [10, 11],
      [1, 9],
      [4, 6],
      [5, 10],
    ],
    3: [
      [0, 2, 4],
      [5, 7, 9],
      [0, 5, 10],
      [2, 7, 11],
      [1, 6, 9],
      [4, 8, 10],
      [10, 11, 2],
    ],
    4: [
      [0, 1, 3, 4],
      [5, 6, 8, 9],
      [0, 4, 5, 9],
      [2, 7, 10, 11],
      [1, 3, 6, 8],
      [0, 2, 5, 10],
    ],
    5: [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
      [0, 2, 4, 5, 9],
      [1, 3, 10, 11, 7],
      [0, 5, 10, 4, 9],
    ],
    6: [
      [0, 1, 2, 3, 4, 7],
      [5, 6, 7, 8, 9, 2],
      [0, 2, 4, 5, 7, 9],
      [1, 3, 10, 11, 6, 8],
    ],
    7: [
      [0, 1, 2, 3, 4, 5, 9],
      [0, 1, 2, 5, 6, 7, 8],
      [0, 1, 2, 5, 7, 10, 11],
      [2, 3, 4, 6, 8, 10, 11],
    ],
    8: [
      [0, 1, 2, 3, 4, 5, 9, 10],
      [0, 1, 2, 3, 6, 7, 8, 9],
      [1, 2, 4, 9, 6, 8, 10, 11],
    ],
    9: [[0, 1, 2, 3, 4, 5, 9, 10, 11]],
    10: [[0, 1, 2, 3, 4, 5, 6, 8, 10, 11]],
    11: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  };

  const fixed = curated[n];
  if (fixed?.length) return fixed;

  return spreadFallbackDemoTuples(n);
}

/** Expand one composite clause into projector demo frames (includes line / full-card breakdown). */
function expandCompositeClauseToDemoFrames(clause: PatternCompositeClause): { label: string; positions: string[] }[] {
  if (clause.kind === 'preset' && clause.preset === 'line') {
    const need = normalizeLinesRequired(clause.linesRequired);
    const base = describeCompositeClauseBrief(clause);
    if (need <= 1) {
      return Array.from({ length: LINE_PREDICATE_COUNT }, (_, i) => ({
        label: `${base}: ${LINE_PREDICATE_DISPLAY_LABELS[i] ?? `Line ${i + 1}`}`,
        positions: positionsForLinePredicateIndex(i),
      }));
    }
    const tuples = buildLinePatternDemoTuples(need);
    return tuples.map((tuple, ti) => {
      const cells = new Set<string>();
      for (const lineIdx of tuple) {
        for (const p of positionsForLinePredicateIndex(lineIdx)) cells.add(p);
      }
      return {
        label: `${base} · example ${ti + 1}/${tuples.length}`,
        positions: Array.from(cells).sort(),
      };
    });
  }
  if (clause.kind === 'preset' && clause.preset === 'full_card') {
    const positions = clauseHighlightPositions(clause);
    return positions.length ? [{ label: describeCompositeClauseBrief(clause), positions }] : [];
  }
  const positions = clauseHighlightPositions(clause);
  if (!positions.length) return [];
  return [{ label: describeCompositeClauseBrief(clause), positions }];
}

/** Match song-playing / bingo card display titles when syncing from room-state. */
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

function normalizeSyncedSongForDisplay(song: any): Song | null {
  if (!song || typeof song !== 'object') return null;
  const id = typeof song.id === 'string' ? song.id : null;
  if (!id) return null;
  return {
    id,
    name: displayTitleFromSyncedSong(song),
    artist: displayArtistFromSyncedSong(song),
  };
}

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
    playlistName?: string;
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

type PublicDisplayVenueBrandingState = {
  eventTitle?: string;
  sponsorLine?: string;
  footerText?: string;
  runbookUrl?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
};

type PublicDisplayBallAnimSeed = {
  dx: number;
  dy: number;
  rz: number;
  rx: number;
  ry: number;
  dur: number;
  delay: number;
  shadeDur: number;
  hiliteDur: number;
  hiliteDelay: number;
  sparkleDX: number;
  sparkleDY: number;
  shadowAmp: number;
};

/** Floating T/E/M/P/O balls — shared by splash and rules overlay. */
function PublicDisplayTempoBallRow({
  seeds,
  variant,
}: {
  seeds: PublicDisplayBallAnimSeed[];
  variant: 'splash' | 'rules' | 'rulesWall' | 'sidebar';
}) {
  const ballWH =
    variant === 'splash'
      ? 'clamp(72px, min(18vmin, 14vh), 220px)'
      : variant === 'rulesWall'
        ? 'clamp(62px, min(16.5vmin, 13vh), 210px)'
        : variant === 'sidebar'
          ? 'clamp(30px, 3.4vw, 60px)'
          : 'clamp(56px, min(15vmin, 12vh), 180px)';
  const letterSize =
    variant === 'splash'
      ? 'clamp(2rem, min(8vmin, 6vh), 5.25rem)'
      : variant === 'rulesWall'
        ? 'clamp(1.72rem, min(7.2vmin, 5.6vh), 4.35rem)'
        : variant === 'sidebar'
          ? 'clamp(0.85rem, 1.35vw, 1.55rem)'
          : 'clamp(1.55rem, min(6.5vmin, 5.2vh), 3.85rem)';
  const rowGap =
    variant === 'splash'
      ? 'clamp(8px, 2vmin, 28px)'
      : variant === 'rulesWall'
        ? 'clamp(7px, 1.75vmin, 22px)'
        : variant === 'sidebar'
          ? 'clamp(4px, 0.6vw, 10px)'
          : 'clamp(5px, 1.5vmin, 18px)';
  const rowMarginTop =
    variant === 'splash'
      ? 'clamp(4px, 1vmin, 12px)'
      : variant === 'rulesWall'
        ? 'clamp(2px, 0.55vmin, 10px)'
        : variant === 'sidebar'
          ? '0px'
          : 'clamp(0px, 0.35vmin, 6px)';
  const shadowBottom = variant === 'splash' ? -28 : variant === 'rulesWall' ? -24 : variant === 'sidebar' ? -10 : -22;
  const shadowSide = variant === 'splash' ? 28 : variant === 'rulesWall' ? 24 : variant === 'sidebar' ? 10 : 22;
  const shadowH = variant === 'splash' ? 28 : variant === 'rulesWall' ? 24 : variant === 'sidebar' ? 10 : 22;

  return (
    <div
      style={{
        display: 'flex',
        gap: rowGap,
        justifyContent: 'center',
        marginTop: rowMarginTop,
        perspective: '1200px',
        position: 'relative',
        flexWrap: 'wrap',
      }}
    >
      {['T', 'E', 'M', 'P', 'O'].map((ch, i) => {
        const glow = [
          'rgba(0,255,163,0.45)',
          'rgba(0,215,255,0.45)',
          'rgba(158,123,255,0.45)',
          'rgba(255,110,199,0.45)',
          'rgba(255,209,102,0.45)',
        ][i];
        const rimInner = [
          'rgba(0,255,170,0.28)',
          'rgba(0,215,255,0.28)',
          'rgba(158,123,255,0.28)',
          'rgba(255,110,199,0.28)',
          'rgba(255,209,102,0.28)',
        ][i];
        const rimOuter = [
          'rgba(0,255,170,0.18)',
          'rgba(0,215,255,0.18)',
          'rgba(158,123,255,0.18)',
          'rgba(255,110,199,0.18)',
          'rgba(255,209,102,0.18)',
        ][i];
        const tintGradients = [
          'radial-gradient(circle at 35% 30%, #f6fffb 10%, #b7f4df 55%, #6ee7c1 100%)',
          'radial-gradient(circle at 35% 30%, #f3faff 10%, #a6dcff 55%, #5ec7ff 100%)',
          'radial-gradient(circle at 35% 30%, #f8f5ff 10%, #c5b6ff 55%, #957dff 100%)',
          'radial-gradient(circle at 35% 30%, #fff4fa 10%, #ffb1cf 55%, #ff82b8 100%)',
          'radial-gradient(circle at 35% 30%, #fff3d2 10%, #ffcf6e 55%, #ffb020 100%)',
        ];
        const seed = seeds[i] || {
          dx: 0,
          dy: 0,
          rz: 0,
          rx: 0,
          ry: 0,
          dur: 4,
          delay: 0,
          shadeDur: 6,
          hiliteDur: 6.5,
          hiliteDelay: 0.1,
          sparkleDX: 1,
          sparkleDY: -1,
          shadowAmp: 4,
        };
        const ampX = 6 + i * 2 + seed.dx;
        const ampY = 10 + (i % 3) * 2 + seed.dy;
        const rotX = 3 + i + seed.rx;
        const rotY = 4 + (i % 2) * 2 + seed.ry;
        const rotZ = 1 + (i % 2) + seed.rz;
        const dur = 3.6 + i * 0.45 + (seed.dur - 4);
        const delay = i * 0.18 + seed.delay;
        const shadeDur = 5.5 + i * 0.5 + (seed.shadeDur - 6);
        const highlightDur = 6.4 + i * 0.4 + (seed.hiliteDur - 6.5);
        const highlightDelay = 0.1 + i * 0.22 + seed.hiliteDelay;
        const sparkleDelay = 0.15 + i * 0.17 + seed.delay;
        const shadowAmp = Math.round(ampX * 0.6 + seed.shadowAmp);
        return (
          <motion.div
            key={i}
            initial={{ y: 0, rotateZ: 0, rotateX: 0, rotateY: 0, scale: 1 }}
            animate={{
              x: [-ampX, ampX, -ampX],
              y: [0, -ampY, 0],
              rotateZ: [-rotZ, rotZ, -rotZ],
              rotateX: [-rotX, rotX, -rotX],
              rotateY: [-rotY, rotY, -rotY],
            }}
            transition={{ duration: dur, delay, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              width: ballWH,
              height: ballWH,
              borderRadius: '50%',
              position: 'relative',
              transformStyle: 'preserve-3d',
              background: (() => {
                const base =
                  tintGradients[i] ||
                  'radial-gradient(circle at 35% 30%, #ffffff, #eef4fb 38%, #d2deea 62%, #b0c4d8 100%)';
                const highlight =
                  'radial-gradient(120% 120% at 30% 28%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 18%, rgba(255,255,255,0.08) 40%, rgba(0,0,0,0) 42%)';
                const shadow =
                  'radial-gradient(140% 140% at 72% 78%, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.6) 35%, rgba(0,0,0,0.0) 60%)';
                const vignette =
                  'radial-gradient(100% 100% at 50% 50%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.06) 55%, rgba(0,0,0,0) 62%)';
                return `${highlight}, ${shadow}, ${vignette}, ${base}`;
              })(),
              boxShadow: `0 28px 44px rgba(0,0,0,0.35), inset 0 -18px 24px rgba(0,0,0,0.22), inset 0 20px 26px rgba(255,255,255,0.55), 0 0 44px ${glow}`,
              border: '1px solid rgba(0,0,0,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#102436',
              fontWeight: 1000,
              fontSize: letterSize,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: `radial-gradient(circle, transparent 66%, ${rimInner} 85%, ${rimOuter} 100%)`,
                pointerEvents: 'none',
              }}
            />
            <motion.div
              initial={{ rotate: -8, opacity: 0.32 }}
              animate={{ rotate: [-8, 8, -8], opacity: [0.32, 0.26, 0.32] }}
              transition={{ duration: shadeDur, delay, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                mixBlendMode: 'multiply',
                background:
                  'conic-gradient(from 0deg, rgba(0,0,0,0.10) 0deg, rgba(255,255,255,0.06) 90deg, rgba(0,0,0,0.18) 200deg, rgba(0,0,0,0.10) 360deg)',
              }}
            />
            <motion.div
              initial={{ x: '-20%', y: '0%', opacity: 0.8 }}
              animate={{ x: ['-10%', '55%', '-10%'], y: ['2%', '-6%', '2%'], opacity: [0.85, 0.5, 0.85] }}
              transition={{ duration: highlightDur, delay: highlightDelay, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                width: '30%',
                height: '30%',
                borderRadius: '50%',
                top: '12%',
                left: 0,
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.95), rgba(255,255,255,0.1) 60%, transparent 70%)',
                filter: 'blur(1px)',
                mixBlendMode: 'screen',
                pointerEvents: 'none',
              }}
            />
            <motion.div
              initial={{ x: '60%', y: '62%', opacity: 0.3 }}
              animate={{ x: ['60%', '40%', '60%'], y: ['62%', '58%', '62%'], opacity: [0.3, 0.22, 0.3] }}
              transition={{ duration: 5.2 + i * 0.35, delay: delay * 0.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                width: '18%',
                height: '18%',
                borderRadius: '50%',
                bottom: '12%',
                right: '12%',
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.6), rgba(255,255,255,0.05) 60%, transparent 70%)',
                filter: 'blur(0.6px)',
                mixBlendMode: 'screen',
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                boxShadow: 'inset 0 0 16px rgba(255,255,255,0.45)',
              }}
            />
            <motion.div
              initial={{ opacity: 0.0 }}
              animate={{ opacity: [0.0, 0.9, 0.0], x: [0, 4, 0], y: [0, -3, 0] }}
              transition={{ duration: 2.8 + i * 0.3, delay: sparkleDelay, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                top: '18%',
                right: '16%',
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'radial-gradient(circle, #ffffff, rgba(255,255,255,0.1) 60%, transparent 70%)',
                filter: 'blur(0.5px)',
                pointerEvents: 'none',
              }}
            />
            <motion.div
              initial={{ opacity: 0.5, x: 0 }}
              animate={{ opacity: [0.5, 0.35, 0.5], x: [-shadowAmp, shadowAmp, -shadowAmp] }}
              transition={{ duration: dur, delay, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                bottom: shadowBottom,
                left: shadowSide,
                right: shadowSide,
                height: shadowH,
                borderRadius: shadowH,
                background: 'rgba(0,0,0,0.55)',
                filter: 'blur(12px)',
                zIndex: -1,
              }}
            />
            {ch}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Large licensee block for splash + rules (wall-readable vs. TEMPO balls). */
function PublicDisplayVenueBrandingHero({
  branding,
  marginBottom,
  fillSlot = false,
  compact = false,
  logoTileOnly = false,
  rulesWall = false,
}: {
  branding: PublicDisplayVenueBrandingState;
  marginBottom: string;
  /** When true, expand to parent height and vertically center content (splash left column). */
  fillSlot?: boolean;
  /** Smaller logo/type for space-constrained overlays (e.g. rules). */
  compact?: boolean;
  /** Splash third column: logo only (symmetrical tile). */
  logoTileOnly?: boolean;
  /** Rules overlay: larger than compact, tuned for wall/projector (not full splash hero). */
  rulesWall?: boolean;
}) {
  if (!(branding.logoUrl || branding.eventTitle || branding.sponsorLine)) return null;

  if (logoTileOnly && branding.logoUrl) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          marginBottom,
          ...(fillSlot ? { flex: 1, minHeight: 0 } : {}),
        }}
      >
        <img
          src={branding.logoUrl}
          alt={branding.eventTitle || 'Venue'}
          className="public-display-venue-logo public-display-venue-logo--hero"
          decoding="async"
          fetchPriority="high"
          style={
            rulesWall
              ? {
                  maxHeight: 'clamp(168px, min(36vmin, 32svh), 520px)',
                  maxWidth: 'min(96vw, 1200px)',
                  width: 'auto',
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (logoTileOnly) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          textAlign: 'center',
          marginBottom,
          padding: 'clamp(8px, 1.5vmin, 14px)',
          ...(fillSlot ? { flex: 1, minHeight: 0 } : {}),
        }}
      >
        {branding.eventTitle ? (
          <div
            style={{
              fontSize: 'clamp(1rem, min(3vmin, 2.5vh), 1.65rem)',
              fontWeight: 800,
              color: 'rgba(245,250,255,0.98)',
              lineHeight: 1.2,
            }}
          >
            {branding.eventTitle}
          </div>
        ) : null}
        {branding.sponsorLine ? (
          <div
            style={{
              fontSize: 'clamp(0.85rem, min(2.4vmin, 2vh), 1.2rem)',
              fontWeight: 600,
              color: 'rgba(200,215,225,0.9)',
              marginTop: 6,
              lineHeight: 1.25,
            }}
          >
            {branding.sponsorLine}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: fillSlot ? 'center' : undefined,
        gap: rulesWall
          ? 'clamp(5px, 1vmin, 12px)'
          : compact
            ? 'clamp(6px, 1.2vmin, 14px)'
            : 'clamp(8px, 1.8vmin, 18px)',
        marginBottom,
        width: '100%',
        maxWidth: compact ? 'min(98vw, 1000px)' : 'min(98vw, 1200px)',
        marginLeft: 'auto',
        marginRight: 'auto',
        ...(fillSlot ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
      {branding.logoUrl ? (
        <img
          src={branding.logoUrl}
          alt={branding.eventTitle || 'Venue'}
          className="public-display-venue-logo public-display-venue-logo--hero"
          decoding="async"
          fetchPriority="high"
          style={
            compact
              ? {
                  maxHeight: 'clamp(80px, min(16vmin, 14vh), 180px)',
                  maxWidth: 'min(88vw, 420px)',
                }
              : rulesWall
                ? {
                    maxHeight: 'clamp(168px, min(36vmin, 32svh), 520px)',
                    maxWidth: 'min(96vw, 1200px)',
                    width: 'auto',
                  }
                : undefined
          }
        />
      ) : null}
      {branding.eventTitle ? (
        <div
          style={{
            fontSize: rulesWall
              ? 'clamp(1.15rem, min(3.5vmin, 2.95vh), 2rem)'
              : compact
                ? 'clamp(1.08rem, min(3.2vmin, 2.65vh), 1.85rem)'
                : 'clamp(1.35rem, min(4vmin, 3.2vh), 2.5rem)',
            fontWeight: 800,
            color: 'rgba(245,250,255,0.98)',
            textAlign: 'center',
            letterSpacing: '0.04em',
            lineHeight: 1.15,
          }}
        >
          {branding.eventTitle}
        </div>
      ) : null}
      {branding.sponsorLine ? (
        <div
          style={{
            fontSize: rulesWall
              ? 'clamp(1rem, min(2.75vmin, 2.35vh), 1.45rem)'
              : compact
                ? 'clamp(0.95rem, min(2.65vmin, 2.15vh), 1.35rem)'
                : 'clamp(1.05rem, min(2.8vmin, 2.3vh), 1.6rem)',
            fontWeight: 600,
            color: 'rgba(200,215,225,0.9)',
            textAlign: 'center',
            lineHeight: 1.25,
          }}
        >
          {branding.sponsorLine}
        </div>
      ) : null}
    </div>
  );
}

function poolsOrderEqual(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Drop sparse-array holes and placeholder ids from play-order lists. */
function compactPlayedOrderIds(playedOrder: readonly string[]): string[] {
  return playedOrder.filter((id) => id && !id.startsWith('__placeholder_'));
}

/** During live play, never regress to a shorter played list from a stale room-state. */
function pickPlayedIdsForRoomStateSync(
  incoming: string[],
  local: string[],
  opts: {
    isPlaying: boolean;
    reconnecting: boolean;
    syncTimestamp?: number;
    lastSyncTs: number;
    currentSongIndex?: number;
    currentSongId?: string;
  },
): { ids: string[]; syncTs: number } {
  const inc = compactPlayedOrderIds(incoming);
  const loc = compactPlayedOrderIds(local);
  const syncTs = typeof opts.syncTimestamp === 'number' ? opts.syncTimestamp : 0;

  if (opts.reconnecting || loc.length === 0) {
    return { ids: inc, syncTs: Math.max(opts.lastSyncTs, syncTs) };
  }

  const isStale =
    syncTs > 0 && syncTs < opts.lastSyncTs && inc.length <= loc.length;

  if (isStale && opts.isPlaying) {
    console.log(
      `🔄 Display sync: ignoring stale room-state played list (ts=${syncTs} < ${opts.lastSyncTs})`,
    );
    return { ids: loc, syncTs: opts.lastSyncTs };
  }

  if (opts.isPlaying && inc.length < loc.length) {
    const prefixOk = inc.length === 0 || inc.every((id, i) => loc[i] === id);
    const idx =
      typeof opts.currentSongIndex === 'number' && opts.currentSongIndex >= 0
        ? opts.currentSongIndex
        : -1;
    if (prefixOk && idx >= 0 && inc.length === idx + 1) {
      console.log(
        `🔄 Display sync: trimming local played list (${loc.length} → ${inc.length}) — server index authoritative`,
      );
      return { ids: inc, syncTs: Math.max(opts.lastSyncTs, syncTs) };
    }
    if (
      prefixOk &&
      idx >= 0 &&
      loc.length === idx + 1 &&
      opts.currentSongId &&
      loc[loc.length - 1] === opts.currentSongId
    ) {
      console.log(
        `🔄 Display sync: keeping local played list (${loc.length} > server ${inc.length}) — matches current song`,
      );
      return { ids: loc, syncTs: Math.max(opts.lastSyncTs, syncTs) };
    }
    if (prefixOk) {
      console.log(
        `🔄 Display sync: trimming local played list (${loc.length} → ${inc.length})`,
      );
      return { ids: inc, syncTs: Math.max(opts.lastSyncTs, syncTs) };
    }
    console.log(
      `🔄 Display sync: keeping local played list (${loc.length} > server ${inc.length}) — order diverged`,
    );
    return { ids: loc, syncTs: Math.max(opts.lastSyncTs, syncTs) };
  }

  return { ids: inc, syncTs: Math.max(opts.lastSyncTs, syncTs) };
}

/** B–O playlist column (0–4) for a track id using 5×15 columns, flat pool, or cached map. */
function resolvePoolColumnForSongId(
  songId: string,
  fiveBy15Cols: string[][] | null | undefined,
  flatPoolIds: readonly string[] | null | undefined,
  idToColumn?: Record<string, number>,
): number | undefined {
  // Authoritative 5×15 columns beat a stale cached map (e.g. column-0 orphan fallback).
  if (fiveBy15Cols && fiveBy15Cols.length === 5) {
    for (let c = 0; c < 5; c++) {
      if (fiveBy15Cols[c].includes(songId)) {
        if (idToColumn && idToColumn[songId] !== c) {
          idToColumn[songId] = c;
        }
        return c;
      }
    }
  }
  const mapped = idToColumn?.[songId];
  if (typeof mapped === 'number' && mapped >= 0 && mapped < 5) return mapped;
  if (flatPoolIds && flatPoolIds.length > 0) {
    const idx = flatPoolIds.indexOf(songId);
    if (idx >= 0) return Math.floor(idx / 15);
  }
  return undefined;
}

function rebuildIdToColumnFromFiveBy15(cols: string[][]): Record<string, number> {
  const map: Record<string, number> = {};
  cols.forEach((col, c) => {
    col.forEach((id) => {
      if (id) map[id] = c;
    });
  });
  return map;
}

/** Server 5×15 column ids — never derive from flat oneBy75Ids (that list is play order). */
function authoritativeFiveBy15Columns(
  stateCols: string[][] | null | undefined,
  refCols: string[][] | null | undefined,
): string[][] | null {
  if (stateCols && stateCols.length === 5) return stateCols;
  if (refCols && refCols.length === 5) return refCols;
  return null;
}

function sortPlayedIdsInColumn(
  col: string[],
  colOrder: readonly string[],
  playedSeq: Record<string, number>,
): string[] {
  return [...col].sort((a, b) => {
    const sa = playedSeq[a] ?? Number.MAX_SAFE_INTEGER;
    const sb = playedSeq[b] ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return colOrder.indexOf(a) - colOrder.indexOf(b);
  });
}

/** Play-order columns: 5 calls stacked per column, then next column (calls 1–5 | 6–10 | 11–15 …). */
function playOrderColumnSlices(playedOrder: readonly string[]): string[][] {
  const ids = compactPlayedOrderIds(playedOrder);
  const cols: string[][] = [];
  for (let i = 0; i < ids.length; i += 5) {
    cols.push(ids.slice(i, i + 5));
  }
  return cols;
}

function countPlayOrderColumns(playedOrder: readonly string[]): number {
  return playOrderColumnSlices(playedOrder).length;
}

function poolHasTracks(ids: string[] | null | undefined): ids is string[] {
  return Array.isArray(ids) && ids.length > 0;
}

/** Base pause between 1×75 carousel column steps (~5s hold + ~1s slide). */
const CAROUSEL_BASE_DWELL_MS = 6000;

/**
 * Relative scroll speed for the leftmost visible band (higher = faster advance = shorter dwell).
 * Earliest band uses max speed; latest uses 1.0× (full base dwell). Never below 1.0×.
 */
const CAROUSEL_EARLY_SPEED = 1.5;

/**
 * Dwell (ms) before advancing one column forward on the 1×75 carousel.
 *
 * Later columns get the full base pause; earlier columns scroll faster (shorter dwell only).
 * Dwell never exceeds CAROUSEL_BASE_DWELL_MS — “more time” for late titles is relative.
 *
 * speed = 1.5 − 0.5 × (i/(N−1))^p
 * dwell = base / speed   (min base/1.5, max base)
 *
 * @param leftColumnIndex - leftmost visible band index (0 = earliest)
 * @param totalPopulatedBands - occupied 5-song bands (1–15)
 */
function carouselDwellMsForLeftColumn(leftColumnIndex: number, totalPopulatedBands: number): number {
  const bands = Math.max(1, Math.floor(totalPopulatedBands));
  const left = Math.max(0, Math.floor(leftColumnIndex));
  if (bands <= 1) return CAROUSEL_BASE_DWELL_MS;

  const maxIdx = bands - 1;
  const position = Math.min(left, maxIdx) / maxIdx;

  // More populated bands → steeper curve (early columns rush off faster; late still capped at base)
  const curvePower = 1 + (bands - 1) / 14;
  const t = Math.pow(position, curvePower);

  const speed = CAROUSEL_EARLY_SPEED - (CAROUSEL_EARLY_SPEED - 1) * t;
  return Math.round(CAROUSEL_BASE_DWELL_MS / speed);
}

/** Recency dimming disabled — every call card stays full opacity. */
function callItemRecency(
  songId: string,
  _playedOrder: string[],
  currentSongId: string | null | undefined,
): { className: string; style: React.CSSProperties } {
  const fullBright = {
    ['--call-recency-opacity' as string]: 1,
    ['--call-recency-saturate' as string]: 1,
    ['--call-recency-brightness' as string]: 1,
  };
  const isCurrent = !!(currentSongId && songId === currentSongId);
  return {
    className: isCurrent ? 'call-item--current' : '',
    style: fullBright,
  };
}

const PublicDisplay: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [fontSizeMultiplier, setFontSizeMultiplier] = useState<number>(1.0);
  const navigate = useNavigate();
  const [connectCode, setConnectCode] = useState<string>('');
  const [searchParams] = useSearchParams();
  const showNowPlaying = (searchParams.get('np') === '1') || (searchParams.get('nowPlaying') === '1');
  const debugMode = (searchParams.get('debug') === '1') || (searchParams.get('dbg') === '1');
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [headerToastTopPx, setHeaderToastTopPx] = useState<number>(78);

  /**
   * Host slider (1 = 100%). Fit runs at this zoom so title+artist stay one unit;
   * 100% = largest combined size that fits the card with no post-fit px ceiling.
   */
  const hostZoom = Math.max(
    0.5,
    Math.min(3, Number.isFinite(fontSizeMultiplier) ? fontSizeMultiplier : 1),
  );
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = document.querySelector('.app-header');
      if (el) {
        const headerRect = el.getBoundingClientRect();
        setHeaderToastTopPx(Math.round(headerRect.bottom + 8));
      }
    };
    measure();
    // Header uses motion `initial` / `animate`; remeasure after it settles (`App.tsx` ~0.8s).
    const t = window.setTimeout(measure, 900);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    const hel = document.querySelector('.app-header');
    if (hel && ro) ro.observe(hel);
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  const [roomInfo, setRoomInfo] = useState<{ id: string; playerCount: number } | null>(null);
  const [venueBranding, setVenueBranding] = useState<PublicDisplayVenueBrandingState | null>(null);

  /** Dispatched to `AppHeader` for TEMPO + licensee lockup (idea 1). */
  const DISPLAY_HEADER_BRANDING_EVENT = 'tempo-display-venue-branding';

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(DISPLAY_HEADER_BRANDING_EVENT, { detail: { branding: venueBranding } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent(DISPLAY_HEADER_BRANDING_EVENT, { detail: { branding: null } }),
      );
    };
  }, [venueBranding]);

  // Keep projector screen awake (Wake Lock API; re-acquire after tab focus).
  useEffect(() => {
    let wakeLock: { release?: () => Promise<void>; addEventListener?: (type: string, fn: () => void) => void } | null =
      null;
    const requestWakeLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<typeof wakeLock> };
        };
        if (nav.wakeLock?.request) {
          wakeLock = await nav.wakeLock.request('screen');
          wakeLock?.addEventListener?.('release', () => {
            wakeLock = null;
          });
        }
      } catch {
        // Unsupported / denied — ignore
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLock) void requestWakeLock();
    };
    void requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      try {
        void wakeLock?.release?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  /** Re-measure header offset when venue co-brand text loads (changes header height). */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = document.querySelector('.app-header');
      if (el) {
        const headerRect = el.getBoundingClientRect();
        setHeaderToastTopPx(Math.round(headerRect.bottom + 8));
      }
    }, 50);
    return () => window.clearTimeout(t);
  }, [venueBranding?.eventTitle, venueBranding?.sponsorLine]);

  /** Start fetching the venue logo as soon as we know the URL (socket delivers branding before hero mounts). */
  useEffect(() => {
    const url = venueBranding?.logoUrl?.trim();
    if (!url) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [venueBranding?.logoUrl]);

  /** HTTP hydrate: fetch branding in parallel with the socket (cuts “blank logo” until join-room completes). */
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const url = `${API_BASE || ''}/api/display/${encodeURIComponent(roomId)}/venue-branding`;
    const merge = (b: PublicDisplayVenueBrandingState | null | undefined) => {
      if (b == null) return;
      setVenueBranding((prev) => (prev != null ? prev : b));
    };
    (async () => {
      for (let i = 0; i < 4; i++) {
        if (cancelled) return;
        if (i > 0) await new Promise((r) => setTimeout(r, 320));
        try {
          const r = await fetch(url);
          if (!r.ok || cancelled) continue;
          const data = (await r.json()) as {
            ok?: boolean;
            roomExists?: boolean;
            venueBranding?: PublicDisplayVenueBrandingState | null;
          };
          if (cancelled) return;
          const b = data.venueBranding;
          if (b != null) {
            merge(b);
            if (b.logoUrl || b.eventTitle || b.sponsorLine) break;
          }
          if (data.roomExists === false) continue;
          if (data.roomExists && b == null) continue;
          break;
        } catch {
          /* retry */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  /** Same tab’s origin — correct for QR and “go to this site” when hosted on a licensee domain. */
  const playerJoinOrigin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    [],
  );
  const playerJoinUrl = useMemo(
    () => (roomId && playerJoinOrigin ? `${playerJoinOrigin}/player/${roomId}` : ''),
    [roomId, playerJoinOrigin],
  );

  const splashHasHeroBranding = useMemo(
    () =>
      !!(
        venueBranding &&
        (venueBranding.logoUrl || venueBranding.eventTitle || venueBranding.sponsorLine)
      ),
    [venueBranding],
  );

  // Splash/intro overlay (can disable with ?splash=0)
  const splashEnabled = (searchParams.get('splash') !== '0');
  const [showSplash, setShowSplash] = useState<boolean>(splashEnabled);
  
  
  
  /** Rotating projector demo for line pattern (one tuple of line indices per step). */
  const [linePatternDemoIndex, setLinePatternDemoIndex] = useState(0);
  /** Cycle orientation variants (custom) or clause highlights (composite) on the projector wall. */
  const [customPatternDemoIndex, setCustomPatternDemoIndex] = useState(0);
  const [compositePatternDemoIndex, setCompositePatternDemoIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const customDemoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const compositeDemoIntervalRef = useRef<NodeJS.Timeout | null>(null);
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
  const [patternComposite, setPatternComposite] = useState<PatternCompositeSpec | null>(null);
  const [countdownMs, setCountdownMs] = useState<number>(0);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  /** Snippet countdown label only (current clip timer). */
  const snippetCountdownSongIdRef = useRef<string | null>(null);
  /** Host paused playback — freeze countdown + letter reveals so the display stays in sync with audio. */
  const [playbackPaused, setPlaybackPaused] = useState<boolean>(false);
  const [totalPlayedCount, setTotalPlayedCount] = useState<number>(0);
  const [isVerificationPending, setIsVerificationPending] = useState<boolean>(false);
  const isVerificationPendingRef = useRef<boolean>(false);
  useEffect(() => {
    isVerificationPendingRef.current = isVerificationPending;
  }, [isVerificationPending]);
  const [displayTheme, setDisplayTheme] = useState<PublicDisplayTheme>(() => readStoredDisplayTheme());
  const pdGlass = glassForDisplayTheme(displayTheme);
  const chooseDisplayTheme = useCallback((theme: PublicDisplayTheme) => {
    setDisplayTheme(theme);
    try {
      localStorage.setItem(DISPLAY_THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, []);
  // Flag to prevent auto-reveal during reset operations
  const isResettingRef = useRef<boolean>(false);
  /** Five call columns on projector (fixed; not URL-configurable). */
  const visibleCols = 5;
  // 1x75 call list state
  const [oneBy75Ids, setOneBy75Ids] = useState<string[] | null>(null);
  const oneBy75IdsRef = useRef<string[] | null>(null);
  const poolOrderFingerprintRef = useRef<string | null>(null);
  const [fiveBy15Columns, setFiveBy15Columns] = useState<string[][] | null>(null);
  /** Keeps 5×15 columns when a late oneby75-pool arrives (must not clear fiveBy15Columns state). */
  const fiveBy15ColumnsRef = useRef<string[][] | null>(null);
  /** Host override: 5×15 BINGO columns, 1×75 carousel, or follow mix/URL. */
  const [callListMode, setCallListMode] = useState<'auto' | 'grouped' | '5x15'>('auto');
  /** Seconds between random letter picks on the projector (server default 15; clamped 5–120). */
  const [letterRevealIntervalSec, setLetterRevealIntervalSec] = useState<number>(15);
  /** When false, letters still reveal on call cards but the “Revealed: …” banner is hidden. */
  const [letterRevealToastEnabled, setLetterRevealToastEnabled] = useState<boolean>(true);
  /** Five column letters for call list headers (host pref: BINGO, TEMPO, TONES, …). */
  const [bingoColumnLetters, setBingoColumnLetters] = useState<string>('BINGO');
  /** How masked titles fill in: timed letters, full at track start, or full at track end. */
  const [titleRevealMode, setTitleRevealMode] = useState<PublicDisplayTitleRevealMode>('letter');
  const titleRevealModeRef = useRef<PublicDisplayTitleRevealMode>('letter');
  /** Bumped when reveal refs mutate so masked call lists re-render. */
  const [revealLayoutNonce, setRevealLayoutNonce] = useState(0);

  useEffect(() => {
    titleRevealModeRef.current = titleRevealMode;
  }, [titleRevealMode]);

  useEffect(() => {
    if (!gameState.isPlaying) {
      snippetCountdownSongIdRef.current = null;
    }
  }, [gameState.isPlaying]);

  const idToColumnRef = useRef<Record<string, number>>({});
  const pendingPlacementRef = useRef<Set<string>>(new Set());
  const playedOrderRef = useRef<string[]>([]);
  /** Bumped whenever playedOrderRef changes so call-list render stays in sync (refs alone do not re-render). */
  const [playedOrderRevision, setPlayedOrderRevision] = useState(0);
  const idMetaRef = useRef<Record<string, { name: string; artist: string }>>({});
  const currentIndexRef = useRef<number>(-1);
  const socketRef = useRef<any>(null);
  const revealSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingServerRevealRef = useRef(false);
  const migratedLocalRevealRef = useRef(false);
  /** False until first room-state / display-reveal-state — blocks empty client push from wiping server. */
  const revealStateHydratedRef = useRef(false);
  /** Latest applied played-list sync time — blocks out-of-order room-state from dropping calls. */
  const lastRoomStatePlayedSyncTsRef = useRef(0);

  const persistRevealStateLocally = () => {
    try {
      localStorage.setItem(`display_revealed_letters_${roomId}`, JSON.stringify(revealSequenceRef.current));
      localStorage.setItem(`display_baselines_${roomId}`, JSON.stringify(songBaselineRef.current));
    } catch {}
  };

  useEffect(() => {
    revealStateHydratedRef.current = false;
    migratedLocalRevealRef.current = false;
    lastRoomStatePlayedSyncTsRef.current = 0;
  }, [roomId]);

  /** One-time read: migrate pre-server localStorage into room state on reconnect. */
  const getStoredRevealedLetters = (): string[] => {
    try {
      const stored = localStorage.getItem(`display_revealed_letters_${roomId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  };
  
  const getStoredBaselines = (): Record<string, number> => {
    try {
      const stored = localStorage.getItem(`display_baselines_${roomId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      }
    } catch {}
    return {};
  };
  
  const revealSequenceRef = useRef<string[]>([]);
  const songBaselineRef = useRef<Record<string, number>>({});

  const syncRevealStateToServer = (opts?: { forceClear?: boolean }) => {
    if (!roomId || !socketRef.current || applyingServerRevealRef.current) return;
    if (!revealStateHydratedRef.current && !opts?.forceClear) return;
    if (revealSyncTimerRef.current) clearTimeout(revealSyncTimerRef.current);
    revealSyncTimerRef.current = setTimeout(() => {
      revealSyncTimerRef.current = null;
      if (!socketRef.current || applyingServerRevealRef.current) return;
      if (!revealStateHydratedRef.current && !opts?.forceClear) return;
      persistRevealStateLocally();
      socketRef.current.emit('display-reveal-state-update', {
        roomId,
        revealSequence: revealSequenceRef.current,
        songBaselines: songBaselineRef.current,
        carouselIndex: carouselIndexRef.current,
        forceClear: opts?.forceClear === true,
      });
    }, 200);
  };

  const playedSeqRef = useRef<Record<string, number>>({});
  const playedSeqCounterRef = useRef<number>(0);
  // Carousel state for grouped 15x5 columns (show 3 at a time)
  const [carouselIndex, setCarouselIndex] = useState<number>(0);
  const carouselIndexRef = useRef(0);
  const carouselTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Populated column bands the last time the carousel timer ran (detect 1×75 scroll-mode entry). */
  const carouselColumnCountRef = useRef(0);
  const [animating, setAnimating] = useState<boolean>(true); // kept for compatibility but no longer toggled
  const carouselViewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  const [playlistNames, setPlaylistNames] = useState<string[]>([]);

  const columnCallListLayout = useMemo((): boolean => {
    if (callListMode === 'grouped') return false;
    if (callListMode === '5x15') return true;
    const trimmedPlaylistCount = playlistNames.filter((n) => String(n || '').trim()).length;
    // Auto: five-playlist mix only — ignore stale fiveBy15 refs after switching to 1×75.
    if (trimmedPlaylistCount !== 5) return false;
    if (fiveBy15Columns && fiveBy15Columns.length === 5) return true;
    if (fiveBy15ColumnsRef.current && fiveBy15ColumnsRef.current.length === 5) return true;
    return true;
  }, [callListMode, fiveBy15Columns, playlistNames]);
  /** Columns to render for 5×15 layout: server fiveby15-pool only (not play-order flat ids). */
  const layoutFiveColumns = useMemo((): string[][] | null => {
    return authoritativeFiveBy15Columns(fiveBy15Columns, fiveBy15ColumnsRef.current);
  }, [columnCallListLayout, fiveBy15Columns, playedOrderRevision]);

  /** Play order for call-list render — ref, then React state, then current clip. */
  const playedOrderForDisplay = useMemo((): string[] => {
    const fromRef = compactPlayedOrderIds(playedOrderRef.current);
    if (fromRef.length > 0) return fromRef;
    const fromState = gameState.playedSongs.map((s) => s.id).filter(Boolean);
    if (fromState.length > 0) return fromState;
    const cur = gameState.currentSong?.id;
    return cur ? [cur] : [];
  }, [playedOrderRevision, gameState.playedSongs, gameState.currentSong]);

  /** 5×15 layout hides songs whose ids are not in the pool columns — fall back to play-order carousel. */
  const usePlayOrderCallLayout = useMemo(() => {
    if (!columnCallListLayout) return false;
    if (!layoutFiveColumns || playedOrderForDisplay.length === 0) return false;
    const poolSet = new Set(layoutFiveColumns.flat());
    return !playedOrderForDisplay.some((id) => poolSet.has(id));
  }, [columnCallListLayout, layoutFiveColumns, playedOrderForDisplay]);

  const vertViewportRef = useRef<HTMLDivElement | null>(null);
  const [rowHeightPx, setRowHeightPx] = useState<number>(0);
  /** Measured 5×15 column width — drives true text fitting (not char heuristics). */
  const [fiveBy15ColWidthPx, setFiveBy15ColWidthPx] = useState<number>(0);
  /** Carousel / play-order fallback: measured viewport height (5 equal rows, same as 5×15). */
  const [carouselViewportHeightPx, setCarouselViewportHeightPx] = useState<number>(0);
  /** Measured 1×75 column width — same approach as fiveBy15ColWidthPx. */
  const [carouselColWidthMeasuredPx, setCarouselColWidthMeasuredPx] = useState<number>(0);
  const fiveBy15CardRowPx = useMemo(
    () => (rowHeightPx > 0 ? rowHeightPx : 0),
    [rowHeightPx],
  );
  /** 1×75 carousel: five equal rows of the measured viewport (match 5×15 row split). */
  const carouselCardRowPx = useMemo(() => {
    if (carouselViewportHeightPx <= 0) return 0;
    return carouselViewportHeightPx / 5;
  }, [carouselViewportHeightPx]);
  /** One play-order column width; prefer measured column, fall back to viewport / cols. */
  const carouselColWidthPx = useMemo(() => {
    if (carouselColWidthMeasuredPx > 0) return carouselColWidthMeasuredPx;
    if (viewportWidth <= 0 || visibleCols <= 0) return 0;
    return viewportWidth / visibleCols;
  }, [carouselColWidthMeasuredPx, viewportWidth, visibleCols]);

  /**
   * Full Card + letter-reveal: keep the 5-row height lock / measured fitter.
   * Only uncap auto-height stacks when titles are plain (track_start / track_end).
   */
  const uncapFullCardCallLayout =
    (pattern === 'full_card' || pattern === 'blackout') && titleRevealMode !== 'letter';

  /** Matches renderUnifiedCallCard padding. */
  const CALL_CARD_PAD_X_PX = 6;
  /** Extra bottom air so the artist row never kisses the card border. */
  const CALL_CARD_PAD_Y_PX = 6;

  /** Re-fit card text once webfonts load (pre-load canvas measurements use the fallback font). */
  const [fontsReadyNonce, setFontsReadyNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    try {
      (document as any).fonts?.ready?.then(() => {
        if (!cancelled) setFontsReadyNonce((n) => n + 1);
      });
    } catch {}
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Pixel box available for title+artist text inside one call card (measured layout
   * minus card padding). No call-# chip — full width on every line.
   */
  function callCardFitBox(
    layout: '5x15' | 'carousel',
    _plainFullTitle: boolean,
    _masked = false,
  ): {
    boxWidthPx: number;
    boxHeightPx: number;
    firstLineWidthPx: number;
  } | null {
    const rowPx = layout === '5x15' ? fiveBy15CardRowPx : carouselCardRowPx;
    const colWidthPx = layout === '5x15' ? fiveBy15ColWidthPx : carouselColWidthPx;
    if (rowPx <= 0 || colWidthPx <= 0) return null;
    // Col clientWidth is border-box (includes column pad). Match DOM content width.
    const innerColW = Math.max(32, colWidthPx - 2 * CALL_CARD_COLUMN_PAD_X_PX);
    const contentW = Math.max(32, innerColW - 2 * CALL_CARD_PAD_X_PX);
    const boxHeightPx = Math.max(20, rowPx - 2 * CALL_CARD_PAD_Y_PX);
    return {
      boxWidthPx: contentW,
      firstLineWidthPx: contentW,
      boxHeightPx,
    };
  }

  useEffect(() => {
    setRevealLayoutNonce((n) => n + 1);
  }, [titleRevealMode]);

  // Toast for revealed letter
  const [revealToast, setRevealToast] = useState<string | null>(null);
  const [customMask, setCustomMask] = useState<Set<string>>(new Set());
  const [customPatternName, setCustomPatternName] = useState('');
  const [customMatchReverse, setCustomMatchReverse] = useState(false);
  const [customMatchAllowRotation, setCustomMatchAllowRotation] = useState(false);
  const [customMatchAllowMirror, setCustomMatchAllowMirror] = useState(false);
  const [linesRequired, setLinesRequired] = useState(1);
  const linePatternDemoTuples = useMemo(
    () => buildLinePatternDemoTuples(normalizeLinesRequired(linesRequired)),
    [linesRequired],
  );

  const customPatternDemoFrames = useMemo(() => {
    if (pattern !== 'custom' || !customMask || customMask.size === 0) return [];
    return customPatternMaskVariants(Array.from(customMask), {
      matchReverse: customMatchReverse,
      matchAllowRotation: customMatchAllowRotation,
      matchAllowMirror: customMatchAllowMirror,
    });
  }, [pattern, customMask, customMatchReverse, customMatchAllowRotation, customMatchAllowMirror]);

  /** Combined-pattern projector demos — line/full clauses expand into concrete examples; dedupe shared shapes. */
  const compositeDemoSequences = useMemo(() => {
    if (!patternComposite?.clauses?.length) return [];
    const items: { label: string; positions: string[]; clauseIndex: number }[] = [];
    patternComposite.clauses.forEach((c, clauseIndex) => {
      for (const f of expandCompositeClauseToDemoFrames(c)) {
        items.push({ ...f, clauseIndex });
      }
    });
    const deduped = dedupeCompositeDemoSequences(items);
    return deduped.length >= 2 ? deduped : [];
  }, [patternComposite]);

  const compositeDemoCycleMs = useMemo(() => {
    const n = compositeDemoSequences.length;
    if (n < 2) return 1200;
    return Math.min(1700, Math.max(760, 640 + n * 38));
  }, [compositeDemoSequences]);
  const revealToastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showWinnerBanner, setShowWinnerBanner] = useState<boolean>(false);
  const [winnerName, setWinnerName] = useState<string>('');
  /** Verified winner card (shown full-screen after host accepts bingo). */
  const [winnerCardModal, setWinnerCardModal] = useState<{
    playerName: string;
    squares: Array<{
      position: string;
      songId: string;
      songName?: string;
      customSongName?: string;
      customArtistName?: string;
      artistName?: string;
      youtubeMusic?: boolean;
      youtubeRawTitle?: string;
      catalogDisplayVerified?: boolean;
      marked?: boolean;
      isFreeSpace?: boolean;
    }>;
    winningPositions: string[];
    pattern: string;
    prize?: string | null;
  } | null>(null);
  /** Live round prize / night winners board (host prep + verify). */
  const [currentRoundName, setCurrentRoundName] = useState<string | null>(null);
  const [currentRoundPrize, setCurrentRoundPrize] = useState<string | null>(null);
  const [showNightBoard, setShowNightBoard] = useState(false);
  const [roundWinnersBoard, setRoundWinnersBoard] = useState<
    Array<{ roundNumber: number; playerName: string; prize?: string; roundName?: string }>
  >([]);
  const [roomPhase, setRoomPhase] = useState<string>('waiting');
  // Winner card stays until the host advances (reveal-winners-board) or keep-playing timeout.
  const [sponsorScreen, setSponsorScreen] = useState<{
    mediaUrl: string;
    text: string;
    qrUrl: string;
    mediaKind: 'image' | 'video';
    visible: boolean;
  }>({ mediaUrl: '', text: '', qrUrl: '', mediaKind: 'image', visible: false });
  const [remoteHybridNotice, setRemoteHybridNotice] = useState<string>('');
  // Connection status and sync management
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [socket, setSocket] = useState<any>(null);
  /** Continuous vertical scroll phase (5×15 columns stay aligned). */
  const [phasePx, setPhasePx] = useState<number>(0);
  const fiveBy15ScrollRafRef = useRef<number | null>(null);
  /** Pause global scroll phase during bingo verification. */
  const [freezeAll, setFreezeAll] = useState<boolean>(false);

  // Host/room can change call list layout mid-game; reset local scroll/phase so the swap is predictable
  // (does not clear played order, reveals, or pool data).
  useEffect(() => {
    setCarouselIndex(0);
    setPhasePx(0);
    setFreezeAll(false);
  }, [callListMode]);

  // Per-ball animation seeds (stable for component lifetime)
  const ballAnimSeedsRef = useRef<PublicDisplayBallAnimSeed[]>([]);
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
    socketRef.current = newSocket;

    const applyRevealStateFromServer = (
      state: { revealSequence?: string[]; songBaselines?: Record<string, number>; carouselIndex?: number } | null | undefined,
      opts?: { restoreCarousel?: boolean; forceClear?: boolean },
    ) => {
      if (!state || typeof state !== 'object') return;
      applyingServerRevealRef.current = true;
      try {
        if (Array.isArray(state.revealSequence)) {
          const serverSeq = state.revealSequence;
          if (opts?.forceClear) {
            revealSequenceRef.current = serverSeq;
          } else {
            const localSeq = revealSequenceRef.current;
            revealSequenceRef.current =
              serverSeq.length >= localSeq.length ? serverSeq : localSeq;
          }
        }
        if (state.songBaselines && typeof state.songBaselines === 'object') {
          if (opts?.forceClear) {
            songBaselineRef.current = { ...state.songBaselines };
          } else {
            const merged = { ...songBaselineRef.current };
            for (const [songId, baseline] of Object.entries(state.songBaselines)) {
              if (typeof baseline !== 'number' || !Number.isFinite(baseline)) continue;
              const floor = Math.max(0, Math.floor(baseline));
              const local = merged[songId];
              merged[songId] = typeof local === 'number' ? Math.max(local, floor) : floor;
            }
            songBaselineRef.current = merged;
          }
        }
        if (opts?.restoreCarousel !== false && typeof state.carouselIndex === 'number' && Number.isFinite(state.carouselIndex)) {
          const serverIdx = Math.max(0, Math.floor(state.carouselIndex));
          const localIdx = carouselIndexRef.current;
          // room-state often carries carouselIndex 0 until the display sync lands — never regress live scroll.
          const idx =
            opts?.forceClear === true
              ? serverIdx
              : serverIdx >= localIdx
                ? serverIdx
                : localIdx;
          setCarouselIndex(idx);
          carouselIndexRef.current = idx;
        }
        persistRevealStateLocally();
        setRevealLayoutNonce((n) => n + 1);
      } finally {
        applyingServerRevealRef.current = false;
      }
    };

    const hydrateRevealStateFromRoom = (payload: any, reconnecting: boolean) => {
      const serverReveal = payload?.publicDisplayRevealState;
      const serverLetterCount = Array.isArray(serverReveal?.revealSequence)
        ? serverReveal.revealSequence.length
        : 0;
      const restoreCarousel = reconnecting;

      if (serverReveal && serverLetterCount > 0) {
        applyRevealStateFromServer(serverReveal, { restoreCarousel });
      } else if (serverReveal) {
        applyRevealStateFromServer(serverReveal, { restoreCarousel });
      }

      if (revealSequenceRef.current.length === 0 && reconnecting) {
        maybeMigrateLocalRevealToServer();
      }

      revealStateHydratedRef.current = true;
    };

    const maybeMigrateLocalRevealToServer = () => {
      if (migratedLocalRevealRef.current) return;
      const localLetters = getStoredRevealedLetters();
      const localBaselines = getStoredBaselines();
      if (localLetters.length === 0 && Object.keys(localBaselines).length === 0) return;
      migratedLocalRevealRef.current = true;
      revealSequenceRef.current = localLetters;
      songBaselineRef.current = localBaselines;
      setRevealLayoutNonce((n) => n + 1);
      persistRevealStateLocally();
      newSocket.emit('display-reveal-state-update', {
        roomId,
        revealSequence: localLetters,
        songBaselines: localBaselines,
        carouselIndex: carouselIndexRef.current,
      });
      try {
        localStorage.removeItem(`display_revealed_letters_${roomId}`);
        localStorage.removeItem(`display_baselines_${roomId}`);
      } catch {}
      console.log(`🔄 Migrated ${localLetters.length} local reveal letters to server for room ${roomId}`);
    };

    /** Clears played-song refs so a new round/game cannot show the previous session's call list. */
    const resetPlayedTrackingRefs = () => {
      playedOrderRef.current = [];
      playedSeqRef.current = {} as Record<string, number>;
      playedSeqCounterRef.current = 0;
      currentIndexRef.current = -1;
      setPlayedOrderRevision((n) => n + 1);
    };

    const applyPlayedOrderFromServer = (playedIds: string[]) => {
      playedOrderRef.current = compactPlayedOrderIds(playedIds);
      playedSeqCounterRef.current = 0;
      playedIds.forEach((id: string) => {
        playedSeqCounterRef.current += 1;
        playedSeqRef.current[id] = playedSeqCounterRef.current;
      });
      setPlayedOrderRevision((n) => n + 1);
    };

    const clearCallListSessionState = () => {
      resetPlayedTrackingRefs();
      revealSequenceRef.current = [];
      songBaselineRef.current = {};
      try {
        localStorage.removeItem(`display_revealed_letters_${roomId}`);
        localStorage.removeItem(`display_baselines_${roomId}`);
      } catch {}
      setTotalPlayedCount(0);
      setCarouselIndex(0);
      carouselIndexRef.current = 0;
      carouselColumnCountRef.current = 0;
      setPhasePx(0);
      setFreezeAll(false);
      setRevealLayoutNonce((n) => n + 1);
      revealStateHydratedRef.current = true;
      syncRevealStateToServer({ forceClear: true });
    };

    const clearPoolLayoutState = () => {
      setOneBy75Ids(null);
      oneBy75IdsRef.current = null;
      poolOrderFingerprintRef.current = null;
      setFiveBy15Columns(null);
      fiveBy15ColumnsRef.current = null;
      setPlaylistNames([]);
      clearCallListSessionState();
    };

    // Connection event handlers

    newSocket.on('connect', () => {
      console.log('🖥️ PublicDisplay: Connected to server');
      setConnectionStatus('connected');
      setReconnectAttempts(0);
      
      // Join room as display (avoid joining literal "undefined" if route params are not ready yet)
      if (!roomId) {
        console.warn('🖥️ PublicDisplay: connect fired before roomId is available; skipping join-room');
      } else {
        newSocket.emit('join-room', { roomId, playerName: 'Display', isHost: false });
        newSocket.emit('sync-state', { roomId });
      }

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

      if (roomId) {
        newSocket.emit('join-room', { roomId, playerName: 'Display', isHost: false });
        newSocket.emit('sync-state', { roomId });
      }
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

    // State sync handler
    newSocket.on('room-state', (payload: any) => {
      console.log('🖥️ PublicDisplay: Received room state sync:', payload);
      try {
          if (payload) {
            if (payload.venueBranding !== undefined) {
              setVenueBranding(payload.venueBranding ?? null);
            }
          const serverSaysNoPlays =
            (typeof payload.totalPlayedCount === 'number' && payload.totalPlayedCount === 0) ||
            (Array.isArray(payload.playedSongIds) && payload.playedSongIds.length === 0);
          const shouldClearPlayedList =
            !payload.isPlaying && serverSaysNoPlays;

          setGameState(prev => ({
            ...prev,
            isPlaying: !!payload.isPlaying,
            currentSong: normalizeSyncedSongForDisplay(payload.currentSong),
            playerCount: payload.playerCount || 0,
            snippetLength: payload.snippetLength || 30,
            winners: payload.winners || prev.winners,
            playedSongs: (() => {
              if (Array.isArray(payload.playedSongs)) {
                payload.playedSongs.forEach((song: any) => {
                  if (song && typeof song === 'object' && song.id && song.name != null) {
                    idMetaRef.current[song.id] = {
                      name: displayTitleFromSyncedSong(song),
                      artist: song.artist || ''
                    };
                  }
                });
                return payload.playedSongs
                  .map((song: any) => {
                    const id = typeof song === 'string' ? song : song?.id;
                    if (!id) return null;
                    const meta = idMetaRef.current[id];
                    const name =
                      typeof song === 'object' && song.name != null
                        ? displayTitleFromSyncedSong(song)
                        : meta?.name || 'Unknown';
                    const artist =
                      typeof song === 'object' && song.artist
                        ? song.artist
                        : meta?.artist || '';
                    return { id, name, artist };
                  })
                  .filter(Boolean) as Song[];
              }
              if (shouldClearPlayedList) {
                return [];
              }
              return prev.playedSongs;
            })()
          }));
          
          if (payload.pattern) {
            setPattern(payload.pattern);
            if (payload.pattern === 'composite') {
              setPatternComposite(normalizePatternComposite(payload.patternComposite));
            } else {
              setPatternComposite(null);
            }
            if (payload.pattern === 'line' && payload.linesRequired != null) {
              setLinesRequired(normalizeLinesRequired(payload.linesRequired));
            }
            if (payload.pattern === 'custom') {
              setCustomMatchReverse(!!payload.customMatchReverse);
              setCustomMatchAllowRotation(!!payload.customMatchAllowRotation);
              setCustomMatchAllowMirror(!!payload.customMatchAllowMirror);
              if (typeof payload.customPatternName === 'string') {
                setCustomPatternName(payload.customPatternName.trim().slice(0, 80));
              }
            }
            if (payload.pattern !== 'custom') {
              setCustomMatchReverse(false);
              setCustomMatchAllowRotation(false);
              setCustomMatchAllowMirror(false);
              setCustomPatternName('');
            }
          }

          if (Array.isArray(payload.customMask)) {
            setCustomMask(new Set(payload.customMask));
          } else if (payload.pattern && payload.pattern !== 'custom') {
            setCustomMask(new Set());
          }
          
          // Update total played count for display sync
          if (typeof payload.totalPlayedCount === 'number') {
            setTotalPlayedCount(payload.totalPlayedCount);
          }
          
          // Update font size multiplier if provided
          if (typeof payload.publicDisplayFontSize === 'number') {
            setFontSizeMultiplier(payload.publicDisplayFontSize);
          }
          if (
            payload.publicDisplayCallListMode === 'grouped' ||
            payload.publicDisplayCallListMode === '5x15' ||
            payload.publicDisplayCallListMode === 'auto'
          ) {
            setCallListMode(payload.publicDisplayCallListMode);
          }

          if (
            typeof payload.letterRevealIntervalSec === 'number' &&
            Number.isFinite(payload.letterRevealIntervalSec)
          ) {
            const sec = Math.round(payload.letterRevealIntervalSec);
            setLetterRevealIntervalSec(Math.min(120, Math.max(5, sec)));
          }

          if (payload.publicDisplayTitleRevealMode !== undefined) {
            setTitleRevealMode(normalizePublicDisplayTitleRevealMode(payload.publicDisplayTitleRevealMode));
          }

          if (payload.publicDisplayLetterRevealToast !== undefined) {
            setLetterRevealToastEnabled(payload.publicDisplayLetterRevealToast !== false);
          }

          if (typeof payload.bingoColumnLetters === 'string' && payload.bingoColumnLetters.length === 5) {
            setBingoColumnLetters(payload.bingoColumnLetters.toUpperCase());
          }

          // Only apply non-empty meta from room-state. Empty strings used to wipe a good
          // host push when prep briefly had no currentRoundIndex.
          if (typeof payload.currentRoundName === 'string' && payload.currentRoundName.trim()) {
            setCurrentRoundName(payload.currentRoundName.trim());
          }
          if (typeof payload.currentRoundPrize === 'string' && payload.currentRoundPrize.trim()) {
            setCurrentRoundPrize(payload.currentRoundPrize.trim());
          }
          if (
            Array.isArray(payload.currentRoundPlaylistNames) &&
            payload.currentRoundPlaylistNames.some((name: unknown) => String(name || '').trim())
          ) {
            setPlaylistNames(payload.currentRoundPlaylistNames.slice(0, 5));
          }
          if (payload.showNightBoard !== undefined) {
            setShowNightBoard(!!payload.showNightBoard);
          }
          if (Array.isArray(payload.roundWinners)) {
            setRoundWinnersBoard(payload.roundWinners);
          }
          if (typeof payload.gameState === 'string') {
            setRoomPhase(payload.gameState);
          }
          if (payload.sponsorScreen && typeof payload.sponsorScreen === 'object') {
            const ss = payload.sponsorScreen;
            setSponsorScreen({
              mediaUrl: typeof ss.mediaUrl === 'string' ? ss.mediaUrl : '',
              text: typeof ss.text === 'string' ? ss.text : '',
              qrUrl: typeof ss.qrUrl === 'string' ? ss.qrUrl : '',
              mediaKind: ss.mediaKind === 'video' ? 'video' : 'image',
              visible: !!ss.visible,
            });
          }

          // CRITICAL: Sync currentIndexRef from server state (needed for proper display on refresh)
          if (typeof payload.currentSongIndex === 'number') {
            currentIndexRef.current = payload.currentSongIndex;
            console.log(`🔄 Synced currentIndexRef from room-state: ${payload.currentSongIndex}`);
          }
          
          // CRITICAL: Sync played songs to internal tracking from server (single source of truth)
          // This is the ONLY place where playedOrderRef should be updated
          let wasReconnecting = false;
          let hadMismatch = false;
          let playedIdsForBaselineSync: string[] | null = null;
          if (Array.isArray(payload.playedSongs) || Array.isArray(payload.playedSongIds)) {
            let playedIds: string[] = [];
            if (Array.isArray(payload.playedSongIds) && payload.playedSongIds.length > 0) {
              playedIds = compactPlayedOrderIds(payload.playedSongIds);
            } else if (Array.isArray(payload.playedSongs)) {
              playedIds = compactPlayedOrderIds(
                payload.playedSongs
                  .map((song: any) => (typeof song === 'string' ? song : song?.id))
                  .filter(Boolean),
              );
            }
            if (
              playedIds.length === 0 &&
              Array.isArray(payload.playedSongIds) &&
              payload.playedSongIds.length > 0
            ) {
              playedIds = compactPlayedOrderIds(payload.playedSongIds);
              console.log(`🔄 Display sync: using playedSongIds (${playedIds.length}) — metadata not in playedSongs`);
            }
            // Validate sync: compare local vs server state
            const serverCount = playedIds.length;
            const localCount = playedOrderRef.current.length;
            wasReconnecting = serverCount > 0 && localCount === 0;
            hadMismatch = serverCount !== localCount || JSON.stringify(playedIds) !== JSON.stringify(playedOrderRef.current);
            playedIdsForBaselineSync = playedIds;
            
            if (hadMismatch) {
              console.log(`🔄 Display sync detected mismatch: local=${localCount}, server=${serverCount} - syncing from server`);
              console.log(`🔄 Local order: [${playedOrderRef.current.slice(0, 5).join(', ')}...]`);
              console.log(`🔄 Server order: [${playedIds.slice(0, 5).join(', ')}...]`);
            }

            // Update metadata cache before applying order so call cards have titles
            if (Array.isArray(payload.playedSongs)) {
              payload.playedSongs.forEach((song: any) => {
                const sid = typeof song === 'string' ? song : song?.id;
                if (sid && typeof song === 'object' && song.name != null) {
                  idMetaRef.current[sid] = {
                    name: displayTitleFromSyncedSong(song),
                    artist: song.artist || '',
                  };
                }
              });
            }
            
            const picked = pickPlayedIdsForRoomStateSync(playedIds, playedOrderRef.current, {
              isPlaying: !!payload.isPlaying,
              reconnecting: wasReconnecting,
              syncTimestamp: payload.syncTimestamp,
              lastSyncTs: lastRoomStatePlayedSyncTsRef.current,
              currentSongIndex:
                typeof payload.currentSongIndex === 'number' ? payload.currentSongIndex : undefined,
              currentSongId: payload.currentSong?.id,
            });
            playedIds = picked.ids;
            lastRoomStatePlayedSyncTsRef.current = picked.syncTs;
            playedIdsForBaselineSync = playedIds;

            applyPlayedOrderFromServer(playedIds);
            for (const pid of playedIds) {
              if (idToColumnRef.current[pid] !== undefined) continue;
              const derived = resolvePoolColumnForSongId(
                pid,
                fiveBy15ColumnsRef.current,
                oneBy75IdsRef.current,
                idToColumnRef.current,
              );
              if (derived !== undefined) {
                idToColumnRef.current[pid] = derived;
                pendingPlacementRef.current.delete(pid);
              }
            }
            setTotalPlayedCount(playedIds.length);
            console.log(`🔄 Synced playedSeqRef to match server order (${playedIds.length} songs)`);

            if (playedIds.length > 0) {
              const payloadPlayedLen = Array.isArray(payload.playedSongs) ? payload.playedSongs.length : 0;
              if (payloadPlayedLen < playedIds.length) {
                playedIds.forEach((id: string) => {
                  if (idMetaRef.current[id]?.name) return;
                  const fromPayload = Array.isArray(payload.playedSongs)
                    ? payload.playedSongs.find(
                        (song: any) => (typeof song === 'string' ? song : song?.id) === id,
                      )
                    : null;
                  if (fromPayload && typeof fromPayload === 'object' && fromPayload.name != null) {
                    idMetaRef.current[id] = {
                      name: displayTitleFromSyncedSong(fromPayload),
                      artist: fromPayload.artist || '',
                    };
                  }
                });
              }
              if (payloadPlayedLen === 0) {
                setGameState((prev) => ({
                  ...prev,
                  playedSongs: playedIds.map((id: string) => {
                    const meta = idMetaRef.current[id];
                    return {
                      id,
                      name: meta?.name || 'Unknown',
                      artist: meta?.artist || '',
                    };
                  }),
                }));
              }
            }
          } else if (shouldClearPlayedList) {
            resetPlayedTrackingRefs();
          }

          hydrateRevealStateFromRoom(payload, wasReconnecting);

          // After server reveal hydrate: backfill baselines for played songs still missing one.
          if (
            (wasReconnecting || hadMismatch) &&
            Array.isArray(playedIdsForBaselineSync) &&
            playedIdsForBaselineSync.length > 0
          ) {
            const currentBaseline = revealSequenceRef.current.length;
            const newBaselines: Record<string, number> = {};
            playedIdsForBaselineSync.forEach((songId: string) => {
              if (songBaselineRef.current[songId] === undefined) {
                newBaselines[songId] = currentBaseline;
              }
            });
            if (Object.keys(newBaselines).length > 0) {
              songBaselineRef.current = { ...songBaselineRef.current, ...newBaselines };
              setRevealLayoutNonce((n) => n + 1);
              console.log(
                `✅ Set baselines for ${Object.keys(newBaselines).length} played songs (post-hydrate, cutoff=${currentBaseline})`,
              );
              syncRevealStateToServer();
            }
          }

          // Server is source of truth — never keep the verifying overlay after the queue clears.
          setIsVerificationPending(!!payload.bingoVerificationPending);

          const lw = payload.lastDisplayWinner;
          if (
            payload.gameState === 'round_complete' &&
            lw &&
            typeof lw.playerName === 'string' &&
            Array.isArray(lw.squares) &&
            lw.squares.length > 0
          ) {
            setWinnerCardModal((prev) => {
              if (prev) return prev;
              return {
                playerName: lw.playerName,
                squares: lw.squares,
                winningPositions: Array.isArray(lw.winningPositions) ? lw.winningPositions : [],
                pattern: typeof lw.pattern === 'string' ? lw.pattern : 'line',
                prize:
                  typeof lw.prize === 'string' && lw.prize.trim()
                    ? lw.prize.trim()
                    : typeof payload.currentRoundPrize === 'string' && payload.currentRoundPrize.trim()
                      ? payload.currentRoundPrize.trim()
                      : null,
              };
            });
          }
          
          // Use server timestamp if available, otherwise current time
          setLastSyncTime(payload.syncTimestamp || Date.now());
          
          // BUG FIX: If game is already playing when display refreshes, hide splash screen
          // This ensures refresh during active game shows game view immediately
          if (payload.isPlaying && showSplash) {
            console.log('🎮 Game already playing - hiding splash screen');
            setShowSplash(false);
          }
          
          console.log(`🖥️ PublicDisplay: Synced ${payload.totalPlayedCount || 0} played songs, ${payload.playerCount || 0} players`);
        }
      } catch (error) {
        console.error('🖥️ PublicDisplay: Error processing room state:', error);
      }
    });

    // Listen for font size updates
    newSocket.on('public-display-font-size-updated', (data: any) => {
      if (typeof data?.fontSize === 'number') {
        setFontSizeMultiplier(data.fontSize);
        console.log(`📏 Public display font size updated to ${data.fontSize}x`);
      }
    });

    newSocket.on('public-display-call-list-mode-updated', (data: any) => {
      const m = data?.mode;
      if (m === 'grouped' || m === '5x15' || m === 'auto') {
        setCallListMode(m);
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
        setTitleRevealMode(normalizePublicDisplayTitleRevealMode(data.mode));
      }
    });

    newSocket.on('public-display-letter-reveal-toast-updated', (data: any) => {
      if (data?.enabled !== undefined) {
        setLetterRevealToastEnabled(data.enabled !== false);
      }
    });

    newSocket.on('bingo-column-letters-updated', (data: any) => {
      if (typeof data?.letters === 'string' && data.letters.length === 5) {
        setBingoColumnLetters(data.letters.toUpperCase());
      }
    });

    newSocket.on('display-reveal-state', (data: any) => {
      if (data && typeof data === 'object') {
        applyRevealStateFromServer(data);
        revealStateHydratedRef.current = true;
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
      const n = Array.isArray(data?.ids) ? data.ids.length : 0;
      const nameN = Array.isArray(data?.names)
        ? data.names.filter((x: string) => String(x || '').trim()).length
        : 0;
      if (n >= 1 && n <= 75) {
        const nextIds = data.ids as string[];
        const prevPool = oneBy75IdsRef.current;
        // First pool delivery is not a "reorder" — do not wipe played songs synced from room-state.
        const poolChanged = prevPool != null && !poolsOrderEqual(prevPool, nextIds);
        // Authoritative: fiveby15-pool owns 5-playlist mixes; oneby75-pool clears stale column state.
        const keepFiveBy15 = nameN === 5;

        if (!keepFiveBy15) {
          setOneBy75Ids(nextIds);
          oneBy75IdsRef.current = nextIds;
          poolOrderFingerprintRef.current = nextIds.join('\0');
          setFiveBy15Columns(null);
          fiveBy15ColumnsRef.current = null;
        }

        if (poolChanged && !keepFiveBy15) {
          console.log(`🔄 oneby75-pool order changed (${n} ids) — clearing call list / reveal state`);
          clearCallListSessionState();
          newSocket.emit('display-reveal-state-update', {
            roomId,
            revealSequence: [],
            songBaselines: {},
            carouselIndex: 0,
            forceClear: true,
          });
        }

        if (Array.isArray(data?.names)) setPlaylistNames(data.names);
      }
    });

    // Receive 5x15 pool as 5 columns of 15 ids
    newSocket.on('fiveby15-pool', (data: any) => {
      if (Array.isArray(data?.columns) && data.columns.length === 5 && data.columns.every((c: any) => Array.isArray(c))) {
        const nameN = Array.isArray(data?.names)
          ? data.names.filter((x: string) => String(x || '').trim()).length
          : 0;
        const idN = data.columns.reduce((n: number, c: string[]) => n + (Array.isArray(c) ? c.length : 0), 0);
        try {
          const cols = data.columns.map((col: any) => col.slice(0, 15));
          fiveBy15ColumnsRef.current = cols;
          setFiveBy15Columns(cols);
          idToColumnRef.current = rebuildIdToColumnFromFiveBy15(cols);
          if (Array.isArray(data?.names)) setPlaylistNames(data.names);
          // Preload metadata for revealed titles to avoid 'Unknown'
          if (data?.meta && typeof data.meta === 'object') {
            Object.entries(data.meta).forEach(([id, m]: any) => {
              idMetaRef.current[id] = {
                name: cleanSongTitle(String(m?.name || 'Unknown')),
                artist: m?.artist || ''
              };
            });
          }
          // Flatten for meta resolution and baseline tracking order
          const flat = ([] as string[]).concat(...cols);
          setOneBy75Ids(flat);
          oneBy75IdsRef.current = flat;
          // Preserve playedOrder; reveal state comes from server (room-state / display-reveal-state)
          if (playedOrderRef.current.length === 0 && revealSequenceRef.current.length === 0) {
            resetPlayedTrackingRefs();
            revealSequenceRef.current = [];
            songBaselineRef.current = {};
          } else {
            console.log(
              `🔄 fiveby15-pool: keeping ${playedOrderRef.current.length} played song(s) in call-list order`,
            );
          }
          setPlayedOrderRevision((n) => n + 1);
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
        idToColumnRef.current = { ...idToColumnRef.current, ...data.idToColumn };
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
      const squares = (card.squares || []).map((s: any) => {
        const vis = youtubeBingoSquareDisplay({
          customSongName: s.customSongName,
          customArtistName: s.customArtistName,
          songName: s.songName,
          artistName: s.artistName,
          youtubeMusic: s.youtubeMusic === true,
          youtubeRawTitle: s.youtubeRawTitle,
          catalogDisplayVerified: s.catalogDisplayVerified === true,
          isFreeSpace: s.isFreeSpace === true,
        });
        return {
          song: {
            id: s.songId,
            name: vis.title,
            artist: vis.artist,
          },
          isPlayed: false,
          position: { row: parseInt(s.position.split('-')[0], 10), col: parseInt(s.position.split('-')[1], 10) },
        };
      });
      setGameState(prev => ({ ...prev, bingoCard: { squares, size: 5 } }));
    });

    newSocket.on('pattern-updated', (data: any) => {
      try {
        const p = data?.pattern;
        if (p) {
          setPattern(p);
          if (p === 'composite') {
            setPatternComposite(normalizePatternComposite(data.patternComposite));
          } else {
            setPatternComposite(null);
          }
          if (p === 'line' && data.linesRequired != null) {
            setLinesRequired(normalizeLinesRequired(data.linesRequired));
          }
          if (p === 'custom') {
            setCustomMatchReverse(!!data.customMatchReverse);
            setCustomMatchAllowRotation(!!data.customMatchAllowRotation);
            setCustomMatchAllowMirror(!!data.customMatchAllowMirror);
            if (typeof data.customPatternName === 'string') {
              setCustomPatternName(data.customPatternName.trim().slice(0, 80));
            }
          }
          if (p && p !== 'custom') {
            setCustomMatchReverse(false);
            setCustomMatchAllowRotation(false);
            setCustomMatchAllowMirror(false);
            setCustomPatternName('');
          }
        }
        if (Array.isArray(data?.customMask)) {
          setCustomMask(new Set(data.customMask));
        } else if (p && p !== 'custom') {
          setCustomMask(new Set());
        }
      } catch {}
    });

    newSocket.on('song-alias-updated', (data: { songId: string; title: string; artist: string }) => {
      if (!data?.songId) return;
      idMetaRef.current[data.songId] = { name: data.title, artist: data.artist };
      setGameState((prev) => {
        const squares = prev.bingoCard?.squares;
        if (!squares?.length) return prev;
        return {
          ...prev,
          bingoCard: {
            ...prev.bingoCard,
            squares: squares.map((sq) =>
              sq.song?.id === data.songId
                ? { ...sq, song: { id: data.songId, name: data.title, artist: data.artist } }
                : sq,
            ),
          },
        };
      });
    });

    newSocket.on('song-alias-cleared', (data: { songId: string }) => {
      if (!data?.songId) return;
      delete idMetaRef.current[data.songId];
    });

    newSocket.on('song-playing', (data: any) => {
      const aliased =
        typeof data.customArtistName === 'string' && data.customArtistName.trim() !== '';
      const ytf = youtubeTrackDisplayFields({
        name: data.songName,
        artist: data.artistName,
        youtubeMusic: data.youtubeMusic === true,
      });
      const song = {
        id: data.songId,
        name: data.customSongName || cleanSongTitle(ytf.title),
        artist: aliased ? String(data.customArtistName).trim() : ytf.artist,
      };
      // cache metadata for reveal lookups
      idMetaRef.current[song.id] = { name: song.name, artist: song.artist };
      if (Array.isArray(data.playedSongs)) {
        data.playedSongs.forEach((entry: any) => {
          const sid = typeof entry === 'string' ? entry : entry?.id;
          if (sid && typeof entry === 'object' && entry.name != null) {
            idMetaRef.current[sid] = {
              name: displayTitleFromSyncedSong(entry),
              artist: entry.artist || '',
            };
          }
        });
      }
      if (typeof data.currentIndex === 'number') {
        currentIndexRef.current = data.currentIndex;
      }
      
      // CRITICAL: Force refresh on first song to ensure columns are loaded
      // This is more reliable than timing delays since we know columns are ready when first song plays
      const isFirstSong = data.currentIndex === 0;
      if (isFirstSong && (!fiveBy15Columns || fiveBy15Columns.length === 0) && (!oneBy75IdsRef.current || oneBy75IdsRef.current.length === 0)) {
        console.log('🔄 First song started - forcing sync-state to get columns');
        setTimeout(() => {
          newSocket.emit('sync-state', { roomId });
        }, 100);
      }
      
      setTotalPlayedCount((prev) => {
        const fromPlayback =
          typeof data.playbackNumber === 'number' && data.playbackNumber > 0
            ? data.playbackNumber
            : typeof data.currentIndex === 'number'
              ? data.currentIndex + 1
              : prev + 1;
        return Math.max(prev, fromPlayback);
      });
      setGameState(prev => ({
        ...prev,
        isPlaying: true,
        currentSong: song,
        snippetLength: Number(data.snippetLength) || prev.snippetLength,
        playedSongs: prev.playedSongs.some((s) => s.id === song.id)
          ? prev.playedSongs
          : [...prev.playedSongs, song],
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
          const derived = resolvePoolColumnForSongId(
            song.id,
            fiveBy15ColumnsRef.current,
            oneBy75IdsRef.current,
            idToColumnRef.current,
          );
          if (derived !== undefined) {
            idToColumnRef.current[song.id] = derived;
            pendingPlacementRef.current.delete(song.id);
          } else {
            pendingPlacementRef.current.add(song.id);
          }
        }
        // room-state / song-playing playedSongIds are authoritative when present.
        const wasAlreadyCalled = playedOrderRef.current.includes(song.id);
        const serverPlayedIds = Array.isArray(data.playedSongIds)
          ? compactPlayedOrderIds(data.playedSongIds)
          : [];
        if (serverPlayedIds.length > 0) {
          applyPlayedOrderFromServer(serverPlayedIds);
          lastRoomStatePlayedSyncTsRef.current = Date.now();
          for (const pid of serverPlayedIds) {
            if (idToColumnRef.current[pid] !== undefined) continue;
            const derived = resolvePoolColumnForSongId(
              pid,
              fiveBy15ColumnsRef.current,
              oneBy75IdsRef.current,
              idToColumnRef.current,
            );
            if (derived !== undefined) {
              idToColumnRef.current[pid] = derived;
              pendingPlacementRef.current.delete(pid);
            }
          }
          console.log(
            `🔄 Updated playedOrderRef from song-playing: ${serverPlayedIds.length} song(s)`,
          );
        } else if (!wasAlreadyCalled) {
          playedOrderRef.current = [...compactPlayedOrderIds(playedOrderRef.current), song.id];
          lastRoomStatePlayedSyncTsRef.current = Date.now();
          setPlayedOrderRevision((n) => n + 1);
          console.log(
            `🔄 Updated playedOrderRef (append): song ${song.id}, total: ${playedOrderRef.current.length}`,
          );
        }
        const isNewCall = !wasAlreadyCalled;
        if (debugMode) {
          const col = idToColumnRef.current[song.id];
          try { console.log('[Display] song-playing', { index: currentIndexRef.current, id: song.id, col, name: song.name }); } catch {}
        }
        // Set baseline when song starts so letters revealed before it started stay hidden on that song
        // BUG #3 FIX: Always set baseline to current length, even if reset just happened
        // This ensures songs starting right after reset get correct baseline (0)
        const currentBaseline = revealSequenceRef.current.length;
        if (isNewCall || songBaselineRef.current[song.id] === undefined || isResettingRef.current) {
          songBaselineRef.current[song.id] = currentBaseline;
          setRevealLayoutNonce((n) => n + 1);
          syncRevealStateToServer(); // Persist baseline change
          console.log(
            `📝 Set baseline for song ${song.id} to ${currentBaseline} (newCall=${isNewCall}, reset=${isResettingRef.current})`,
          );
        }
      }
      // reset countdown timer
      setPlaybackPaused(false);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      const total = (Number(data.snippetLength) || 30) * 1000;
      const elapsed = Math.max(0, Number(data.snippetElapsedMs) || 0);
      const remaining = Math.max(0, total - elapsed);
      snippetCountdownSongIdRef.current = song.id;
      setCountdownMs(remaining);
      if (remaining <= 0) return;
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

    // Host pause/resume: freeze the snippet countdown while audio is paused, then resync from
    // the server's clip clock on resume so projector timing matches the audio exactly.
    newSocket.on('playback-paused', () => {
      setPlaybackPaused(true);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    });

    newSocket.on('playback-resumed', (data: any) => {
      setPlaybackPaused(false);
      const elapsed = Number(data?.snippetElapsedMs);
      if (!Number.isFinite(elapsed)) return; // older payload without clip clock — keep frozen value
      const total = (Number(data?.snippetLength) || 30) * 1000;
      const remaining = Math.max(0, total - Math.max(0, elapsed));
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdownMs(remaining);
      if (remaining <= 0) return;
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
      setWinnerCardModal(null);
      setIsVerificationPending(false);
      setShowNightBoard(false);
      setSponsorScreen((prev) => ({ ...prev, visible: false }));
      setRoomPhase('playing');
      setCurrentRoundName(
        typeof data?.currentRoundName === 'string' && data.currentRoundName.trim()
          ? data.currentRoundName.trim()
          : null,
      );
      setCurrentRoundPrize(
        typeof data?.currentRoundPrize === 'string' && data.currentRoundPrize.trim()
          ? data.currentRoundPrize.trim()
          : null,
      );
      if (Array.isArray(data?.roundWinners)) setRoundWinnersBoard(data.roundWinners);
      if (data?.sponsorScreen && typeof data.sponsorScreen === 'object') {
        const ss = data.sponsorScreen;
        setSponsorScreen({
          mediaUrl: typeof ss.mediaUrl === 'string' ? ss.mediaUrl : '',
          text: typeof ss.text === 'string' ? ss.text : '',
          qrUrl: typeof ss.qrUrl === 'string' ? ss.qrUrl : '',
          mediaKind: ss.mediaKind === 'video' ? 'video' : 'image',
          visible: false,
        });
      }
      setGameState(prev => ({ 
        ...prev, 
        isPlaying: true,
        snippetLength: data?.snippetLength || prev.snippetLength || 30,
        playedSongs: []
      }));
      // Hide splash when a game starts
      setShowSplash(false);
        if (data?.pattern) {
          setPattern(data.pattern);
          if (data.pattern === 'line' && data.linesRequired != null) {
            setLinesRequired(normalizeLinesRequired(data.linesRequired));
          }
          if (data.pattern === 'composite') {
            setPatternComposite(normalizePatternComposite(data.patternComposite));
          } else {
            setPatternComposite(null);
          }
          if (data.pattern === 'custom') {
            setCustomMatchReverse(!!data.customMatchReverse);
            setCustomMatchAllowRotation(!!data.customMatchAllowRotation);
            setCustomMatchAllowMirror(!!data.customMatchAllowMirror);
            if (typeof data.customPatternName === 'string') {
              setCustomPatternName(data.customPatternName.trim().slice(0, 80));
            }
          } else {
            setCustomMatchReverse(false);
            setCustomMatchAllowRotation(false);
            setCustomMatchAllowMirror(false);
            setCustomPatternName('');
          }
          if (Array.isArray(data?.customMask)) {
            try {
              setCustomMask(new Set<string>(data.customMask as string[]));
            } catch {}
          } else {
            setCustomMask(new Set());
          }
          // Emit pattern to header
          window.dispatchEvent(new CustomEvent('display-pattern', { detail: { pattern: data.pattern } }));
        }
      snippetCountdownSongIdRef.current = null;
      clearPoolLayoutState();
      if (Array.isArray(data?.currentRoundPlaylistNames)) {
        setPlaylistNames(data.currentRoundPlaylistNames.slice(0, 5));
      }
      ensureGrid();
      // Always request sync to ensure we have columns and latest state
      // Use longer delay to ensure server has finished generating cards and emitting columns
      setTimeout(() => {
        console.log('🔄 game-started: Requesting sync-state to get columns');
        newSocket.emit('sync-state', { roomId });
      }, 500); // Longer delay to ensure card generation and column emission complete
    });

    // Display control events
    newSocket.on('display-show-splash', () => {
      setShowSplash(true);
    });

    newSocket.on('display-hide-splash', () => {
      setShowSplash(false);
    });

    newSocket.on('display-reset-letters', () => {
      console.log('🔤 Resetting revealed letters on public display');
      
      // BUG #3 FIX: Set reset flag to prevent auto-reveal race conditions
      isResettingRef.current = true;
      
      // CRITICAL: Reset all baselines to current revealSequenceRef length (not 0)
      // This ensures songs that started before reset maintain their baselines
      // Songs that start after reset will get baseline = revealSequenceRef.length (which is now 0)
      const resetBaseline = revealSequenceRef.current.length; // Should be 0 after clearing, but use current for safety
      revealSequenceRef.current = [];
      
      // Recalculate baselines for all currently played songs
      // Set baseline to the length BEFORE clearing (so they don't show letters revealed after reset)
      const playedIds = playedOrderRef.current || [];
      const newBaselines: Record<string, number> = {};
      playedIds.forEach((pid: string) => {
        // Use existing baseline if it exists and is less than resetBaseline
        // Otherwise set to resetBaseline (meaning no letters revealed before reset)
        const existingBaseline = songBaselineRef.current[pid];
        if (existingBaseline !== undefined && existingBaseline <= resetBaseline) {
          newBaselines[pid] = resetBaseline; // Reset to current length (0 after clear)
        } else {
          newBaselines[pid] = resetBaseline;
        }
      });
      songBaselineRef.current = newBaselines;
      
      // Clear persisted state since we're resetting
      try {
        localStorage.removeItem(`display_revealed_letters_${roomId}`);
        localStorage.removeItem(`display_baselines_${roomId}`);
      } catch {}
      
      // Clear any pending toast
      if (revealToastTimerRef.current) {
        clearTimeout(revealToastTimerRef.current);
        revealToastTimerRef.current = null;
      }
      setRevealToast('Letters reset - auto-reveal restarting');
      setTimeout(() => {
        setRevealToast(null);
        // BUG #3 FIX: Clear reset flag after a short delay to allow baselines to stabilize
        setTimeout(() => {
          isResettingRef.current = false;
          console.log('🔤 Reset complete - auto-reveal re-enabled');
        }, 500);
      }, 3000);
    });

    newSocket.on('bingo-remote-unofficial', (data: any) => {
      try {
        const n = data?.playerName ? String(data.playerName) : '';
        if (n) {
          const msg =
            data?.reason === 'prior_session_win'
              ? `${n} completed the pattern again — already won this event; round continues`
              : `${n} completed the pattern online — round continues until an in-person win`;
          setRemoteHybridNotice(msg);
          setTimeout(() => setRemoteHybridNotice(''), 6000);
        }
      } catch {}
    });

    // Handle bingo verification pending (someone called bingo, awaiting host verification)
    newSocket.on('bingo-verification-pending', (data: any) => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setIsVerificationPending(true);
      console.log(`${data.playerName} called BINGO - awaiting verification`);
    });

    newSocket.on('bingo-verification-cleared', () => {
      setIsVerificationPending(false);
    });

    // Handle confirmed bingo wins (after host verification)
    newSocket.on('bingo-called', (data: any) => {
      // Only show winner if this is a verified/confirmed bingo
      if (data.verified && !data.awaitingVerification) {
        setIsVerificationPending(false); // Clear verification pending state
        setGameState(prev => ({ ...prev, winners: data.winners || prev.winners }));
        try {
          if (data.playerName) {
            const continueRound = data.continueRound === true;
            const isFirstWinner = data.isFirstWinner;
            const totalWinners = data.totalWinners || 1;
            const wc = data.winningCard;
            const hasWinningCard =
              wc &&
              typeof wc === 'object' &&
              Array.isArray(wc.squares) &&
              wc.squares.length > 0;

            if (hasWinningCard) {
              setShowWinnerBanner(false);
              setWinnerName('');
              setWinnerCardModal({
                playerName: String(data.playerName),
                squares: wc.squares,
                winningPositions: Array.isArray(data.winningPositions) ? data.winningPositions : [],
                pattern: typeof data.pattern === 'string' ? data.pattern : 'line',
                prize:
                  typeof data.prize === 'string' && data.prize.trim() ? data.prize.trim() : null,
              });
              playPublicCelebrationSound();
              if (continueRound) {
                // Brief celebration, then back to the live board (round keeps going).
                window.setTimeout(() => setWinnerCardModal(null), 5500);
              }
            } else {
              if (continueRound) {
                setWinnerName(`🏆 BINGO! ${data.playerName} — round continues`);
              } else if (isFirstWinner) {
                setWinnerName(`🏆 BINGO! ${data.playerName} WINS!`);
              } else {
                setWinnerName(`🎉 Another BINGO! ${data.playerName} also wins! (${totalWinners} total)`);
              }
              setShowWinnerBanner(true);
              playPublicCelebrationSound();
              const celebrationTime = continueRound ? 5000 : isFirstWinner ? 6000 : 4000;
              setTimeout(() => setShowWinnerBanner(false), celebrationTime);
            }
            if (Array.isArray(data.roundWinners)) setRoundWinnersBoard(data.roundWinners);
            // End-round: card only until host advances. Keep-playing: never pin the night board.
            if (data.showNightBoard !== undefined) setShowNightBoard(!!data.showNightBoard);
            else if (!continueRound) setShowNightBoard(false);
            if (typeof data.roundName === 'string' && data.roundName.trim()) {
              setCurrentRoundName(data.roundName.trim());
            }
            if (typeof data.prize === 'string') {
              setCurrentRoundPrize(data.prize.trim() || null);
            }
            if (!continueRound) {
              setRoomPhase('round_complete');
            }
          }
        } catch {}
      }
    });

    newSocket.on('round-complete', (data: any) => {
      setIsVerificationPending(false);
      if (Array.isArray(data?.roundWinners)) setRoundWinnersBoard(data.roundWinners);
      // Winners list waits for host advance (reveal-winners-board) — do not auto-show here.
      if (data?.showNightBoard !== undefined) setShowNightBoard(!!data.showNightBoard);
      else setShowNightBoard(false);
      if (typeof data?.roundName === 'string' && data.roundName.trim()) {
        setCurrentRoundName(data.roundName.trim());
      }
      if (typeof data?.prize === 'string') {
        setCurrentRoundPrize(data.prize.trim() || null);
      }
      setRoomPhase('round_complete');
    });

    newSocket.on('night-board-visibility', (data: any) => {
      if (data?.visible !== undefined) setShowNightBoard(!!data.visible);
      if (Array.isArray(data?.roundWinners)) setRoundWinnersBoard(data.roundWinners);
    });

    newSocket.on('public-winner-dismissed', () => {
      setWinnerCardModal(null);
      setShowWinnerBanner(false);
      setWinnerName('');
      // Night board visibility is owned by night-board-visibility / game-started / set-round.
    });

    newSocket.on('sponsor-screen-updated', (data: any) => {
      const ss = data?.sponsorScreen;
      if (!ss || typeof ss !== 'object') return;
      setSponsorScreen({
        mediaUrl: typeof ss.mediaUrl === 'string' ? ss.mediaUrl : '',
        text: typeof ss.text === 'string' ? ss.text : '',
        qrUrl: typeof ss.qrUrl === 'string' ? ss.qrUrl : '',
        mediaKind: ss.mediaKind === 'video' ? 'video' : 'image',
        visible: !!ss.visible,
      });
    });

    newSocket.on('round-display-meta', (data: any) => {
      // Authoritative host push — allow clearing round header fields when prep changes.
      if (data?.currentRoundName !== undefined) {
        setCurrentRoundName(
          typeof data.currentRoundName === 'string' && data.currentRoundName.trim()
            ? data.currentRoundName.trim()
            : null,
        );
      }
      if (data?.currentRoundPrize !== undefined) {
        setCurrentRoundPrize(
          typeof data.currentRoundPrize === 'string' && data.currentRoundPrize.trim()
            ? data.currentRoundPrize.trim()
            : null,
        );
      }
      if (Array.isArray(data?.currentRoundPlaylistNames)) {
        setPlaylistNames(data.currentRoundPlaylistNames.slice(0, 5));
      }
    });

    newSocket.on('mix-finalized', (payload: any) => {
      setWinnerCardModal(null);
      try {
        const names = Array.isArray(payload?.playlists) ? payload.playlists.map((p: any) => String(p?.name || '')) : [];
        const nameN = names.filter((x: string) => String(x || '').trim()).length;
        const listN = Array.isArray(payload?.songList) ? payload.songList.length : 0;
        setPlaylistNames(names);
        if (nameN !== 5) {
          setFiveBy15Columns(null);
          fiveBy15ColumnsRef.current = null;
        }
        
        // Switch to game mode: hide splash, show bingo card
        console.log('🎮 Mix finalized - switching to game mode');
        setShowSplash(false);
      } catch {}
      ensureGrid();
    });

    newSocket.on('game-session-ended', () => {
      setWinnerCardModal(null);
      setGameState((prev) => ({
        ...prev,
        isPlaying: false,
        currentSong: null,
      }));
      setIsVerificationPending(false);
    });

    newSocket.on('game-ended', () => {
      setWinnerCardModal(null);
      setShowNightBoard(false);
      setShowWinnerBanner(false);
      setGameState(prev => ({
        ...prev,
        isPlaying: false,
        currentSong: null,
        playedSongs: []
      }));
      resetPlayedTrackingRefs();
      setTotalPlayedCount(0);
      setIsVerificationPending(false);
      console.log('🛑 Game ended (display)');
    });

    newSocket.on('game-resumed', () => {
      setIsVerificationPending(false);
      setWinnerCardModal(null);
      setPlaybackPaused(false);
      console.log('▶️ Game resumed (display)');
    });

    newSocket.on('game-restarted', (data: any) => {
      console.log('Game restarted:', data);
      setWinnerCardModal(null);
      setShowNightBoard(false);
      setRoundWinnersBoard([]);
      setCurrentRoundName(null);
      setCurrentRoundPrize(null);
      setRoomPhase('waiting');
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
      setTotalPlayedCount(0);
      resetPlayedTrackingRefs();
      setShowWinnerBanner(false);
      setWinnerName('');
      setPlaybackPaused(false);
      snippetCountdownSongIdRef.current = null;
      
      // Clear reveal state
      revealSequenceRef.current = [];
      songBaselineRef.current = {};
      try {
        localStorage.removeItem(`display_revealed_letters_${roomId}`);
        localStorage.removeItem(`display_baselines_${roomId}`);
      } catch {}
      
      // Show restart notification briefly
      if (data.clearCard || data.resetToSetup) {
        setWinnerName('🔄 New Round Starting - Waiting for Setup...');
      } else {
        setWinnerName('🔄 Game Restarted');
      }
      setShowWinnerBanner(true);
      setTimeout(() => {
        setShowWinnerBanner(false);
        setWinnerName('');
      }, 3000);
    });

    // Handle next-round-reset event (full reset to setup)
    newSocket.on('next-round-reset', (data: any) => {
      console.log('Next round reset (public display):', data);
      setWinnerCardModal(null);
      setShowNightBoard(false);
      setCurrentRoundName(null);
      setCurrentRoundPrize(null);
      setRoomPhase('waiting');
      if (Array.isArray(data?.roundWinners)) setRoundWinnersBoard(data.roundWinners);
      // Reset display state completely
      setGameState({
        isPlaying: false,
        currentSong: null,
        playerCount: 0,
        winners: [],
        snippetLength: data.roomState?.snippetLength || 30,
        playedSongs: [],
        bingoCard: { squares: [], size: 5 }
      });
      setTotalPlayedCount(0);
      resetPlayedTrackingRefs();
      setShowWinnerBanner(false);
      setWinnerName('');
      setIsVerificationPending(false);
      snippetCountdownSongIdRef.current = null;
      
      // Clear all reveal state
      revealSequenceRef.current = [];
      songBaselineRef.current = {};
      try {
        localStorage.removeItem(`display_revealed_letters_${roomId}`);
        localStorage.removeItem(`display_baselines_${roomId}`);
      } catch {}
      
      // Show new round notification
      setWinnerName(`🔄 Round ${data.roundNumber} - Waiting for Setup...`);
      setShowWinnerBanner(true);
      setTimeout(() => {
        setShowWinnerBanner(false);
        setWinnerName('');
      }, 4000);
    });

    newSocket.on('game-reset', () => {
      setWinnerCardModal(null);
      setGameState({
        isPlaying: false,
        currentSong: null,
        playerCount: 0,
        winners: [],
        snippetLength: 30,
        playedSongs: [],
        bingoCard: { squares: [], size: 5 }
      });
      setTotalPlayedCount(0);
      resetPlayedTrackingRefs();
      clearPoolLayoutState();
      ensureGrid();
      snippetCountdownSongIdRef.current = null;
      console.log('🔁 Game reset (display)');
      revealSequenceRef.current = [];
      songBaselineRef.current = {};
      // Clear persisted state for new round
      try {
        localStorage.removeItem(`display_revealed_letters_${roomId}`);
        localStorage.removeItem(`display_baselines_${roomId}`);
      } catch {}
    });

    newSocket.on('round-pool-cleared', () => {
      clearPoolLayoutState();
      ensureGrid();
      console.log('🔁 Round pool cleared (display)');
    });

    // Staged reveal event: show name/artist hints without changing the bingo grid
    newSocket.on('call-revealed', (payload: any) => {
      console.log('📣 Call revealed:', payload);
      if (payload?.revealToDisplay) {
        const rawTitle = payload.songName != null ? String(payload.songName) : '';
        const cleanedHintTitle = rawTitle ? cleanSongTitle(rawTitle) : '';
        const sid = typeof payload.songId === 'string' ? payload.songId : undefined;
        setGameState(prev => {
          const resolvedId = sid || prev.currentSong?.id || '';
          const nextName = cleanedHintTitle || prev.currentSong?.name || '';
          const nextArtist = payload.artistName || prev.currentSong?.artist || '';
          if (resolvedId && cleanedHintTitle) {
            idMetaRef.current[resolvedId] = {
              name: cleanedHintTitle,
              artist: nextArtist || idMetaRef.current[resolvedId]?.artist || ''
            };
          }
          return {
            ...prev,
            currentSong: {
              id: resolvedId,
              name: nextName,
              artist: nextArtist
            }
          };
        });
        
        // Update reveal sequence for wheel of fortune masking (letter-by-letter mode only)
        if (titleRevealModeRef.current === 'letter') {
        try {
          const { hint, songName, artistName } = payload;
          const lettersToReveal: string[] = [];
          let revealText = '';
          
          if (hint === 'artist' && artistName) {
            revealText = `Artist: ${artistName}`;
            // Reveal all letters in artist name
            const artistChars = artistName.toUpperCase().split('');
            artistChars.forEach((ch: string) => {
              if (/^[A-Z0-9]$/.test(ch) && !revealSequenceRef.current.includes(ch)) {
                lettersToReveal.push(ch);
              }
            });
          } else if (hint === 'title' && songName) {
            const t = cleanSongTitle(String(songName));
            revealText = `Song: ${t}`;
            const titleChars = t.toUpperCase().split('');
            titleChars.forEach((ch: string) => {
              if (/^[A-Z0-9]$/.test(ch) && !revealSequenceRef.current.includes(ch)) {
                lettersToReveal.push(ch);
              }
            });
          } else if (hint === 'full' && songName && artistName) {
            const t = cleanSongTitle(String(songName));
            revealText = `${t} - ${artistName}`;
            const fullText = `${t} ${artistName}`;
            const fullChars = fullText.toUpperCase().split('');
            fullChars.forEach((ch: string) => {
              if (/^[A-Z0-9]$/.test(ch) && !revealSequenceRef.current.includes(ch)) {
                lettersToReveal.push(ch);
              }
            });
          }
          
          // Add revealed letters to sequence
          // BUG #3 FIX: Skip manual reveal if reset is in progress
          if (lettersToReveal.length > 0 && !isResettingRef.current) {
            revealSequenceRef.current = [...revealSequenceRef.current, ...lettersToReveal];
            setRevealLayoutNonce((n) => n + 1);
            console.log('🎡 Wheel of Fortune: Revealed letters:', lettersToReveal, 'Total revealed:', revealSequenceRef.current.length);
            syncRevealStateToServer(); // Persist revealed letters
          } else if (isResettingRef.current) {
            console.log('🎡 Manual reveal skipped - reset in progress');
          }
          
          if (revealText) {
            // Clear any existing toast timer
            if (revealToastTimerRef.current) {
              clearTimeout(revealToastTimerRef.current);
              revealToastTimerRef.current = null;
            }
            
            // Show the reveal toast
            setRevealToast(revealText);
            
            // Auto-hide after 5 seconds
            revealToastTimerRef.current = setTimeout(() => {
              setRevealToast(null);
              revealToastTimerRef.current = null;
            }, 5000);
          }
        } catch (error) {
          console.error('Error showing reveal toast:', error);
        }
        }

      }
    });

    return () => {
      console.log('🖥️ PublicDisplay: Cleaning up socket connection');
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      if (revealSyncTimerRef.current) {
        clearTimeout(revealSyncTimerRef.current);
        revealSyncTimerRef.current = null;
      }
      socketRef.current = null;
      newSocket.close();
    };
  }, [roomId]);

  // Periodic sync during gameplay to ensure state stays in sync with server
  useEffect(() => {
    if (!socket || !gameState.isPlaying) return;
    
    // Request sync every 30 seconds during gameplay
    const syncInterval = setInterval(() => {
      if (socket && socket.connected && gameState.isPlaying) {
        socket.emit('sync-state', { roomId });
        console.log('🔄 PublicDisplay: Periodic sync requested');
      }
    }, 30000); // 30 seconds
    
    return () => clearInterval(syncInterval);
  }, [socket, gameState.isPlaying, roomId]);

  // Host projector health: presence heartbeat while connected
  useEffect(() => {
    if (!socket?.connected || !roomId) return;
    const ping = () => {
      if (socket.connected) socket.emit('display-heartbeat', { roomId });
    };
    ping();
    const id = setInterval(ping, 12000);
    return () => clearInterval(id);
  }, [socket, roomId]);

  // Time-based letter reveal at host-configurable interval (weighted by unrevealed frequency across played songs)
  useEffect(() => {
    console.log('🎡 Auto-reveal effect triggered:', {
      isPlaying: gameState.isPlaying,
      isVerificationPending,
      letterRevealIntervalSec,
      titleRevealMode,
    });
    if (!gameState.isPlaying || isVerificationPending || playbackPaused) {
      console.log(
        '🎡 Auto-reveal disabled:',
        !gameState.isPlaying ? 'game not playing' : isVerificationPending ? 'verification pending' : 'playback paused',
      );
      return;
    }
    if (titleRevealMode !== 'letter') {
      console.log('🎡 Auto-reveal disabled: title reveal mode is not letter-by-letter');
      return;
    }
    const ms = Math.max(5000, letterRevealIntervalSec * 1000);
    console.log(`🎡 Auto-reveal enabled, starting ${letterRevealIntervalSec}s interval`);
    const interval = setInterval(() => {
      // BUG #3 FIX: Skip auto-reveal if reset is in progress
      if (isResettingRef.current) {
        console.log('🎡 Auto-reveal skipped - reset in progress');
        return;
      }
      try {
        const ids = playedOrderRef.current;
        console.log('🎡 Auto-reveal tick:', { playedSongs: ids?.length || 0, revealedLetters: revealSequenceRef.current.length });
        if (!ids || ids.length === 0) {
          console.log('🎡 No played songs yet');
          return;
        }
        const weights: Record<string, number> = {};
        for (let i = 0; i < ids.length; i++) {
          const pid = ids[i];
          const meta = idMetaRef.current[pid];
          if (!meta) continue;
          const baselineRaw = songBaselineRef.current[pid];
          const baseline =
            typeof baselineRaw === 'number' && Number.isFinite(baselineRaw)
              ? baselineRaw
              : revealSequenceRef.current.length;
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
        if (entries.length === 0) {
          console.log('🎡 All letters revealed!');
          return;
        }
        const total = entries.reduce((sum, [, w]) => sum + w, 0);
        let r = Math.random() * total;
        let revealedChar = entries[0][0];
        for (let k = 0; k < entries.length; k++) {
          const [ch, w] = entries[k];
          if (r < w) { revealedChar = ch; break; }
          r -= w;
        }
        // BUG #3 FIX: Skip auto-reveal if reset is in progress
        if (isResettingRef.current) {
          console.log('🎡 Auto-reveal skipped - reset in progress');
          return;
        }
        
        revealSequenceRef.current.push(revealedChar);
        setRevealLayoutNonce((n) => n + 1);
        console.log('🎡 Auto-revealed letter:', revealedChar, 'Total revealed:', revealSequenceRef.current.length);
        syncRevealStateToServer(); // Persist auto-revealed letter
        if (revealToastTimerRef.current) { clearTimeout(revealToastTimerRef.current); revealToastTimerRef.current = null; }
        setRevealToast(revealedChar);
        revealToastTimerRef.current = setTimeout(() => {
          setRevealToast(null);
          revealToastTimerRef.current = null;
        }, 5000);
      } catch (err) {
        console.error('🎡 Auto-reveal error:', err);
      }
    }, ms);
    return () => {
      console.log('🎡 Auto-reveal interval cleared');
      clearInterval(interval);
    };
  }, [gameState.isPlaying, isVerificationPending, playbackPaused, letterRevealIntervalSec, titleRevealMode]);

  useEffect(() => {
    carouselIndexRef.current = carouselIndex;
  }, [carouselIndex]);

  useEffect(() => {
    if (columnCallListLayout || applyingServerRevealRef.current) return;
    syncRevealStateToServer();
  }, [carouselIndex, columnCallListLayout, roomId]);

  const remeasureCarouselViewport = useCallback(() => {
    const el = carouselViewportRef.current;
    if (!el) return;
    const w = el.clientWidth || 0;
    if (w > 0) setViewportWidth(w);
    const h = el.clientHeight || 0;
    if (h > 0) setCarouselViewportHeightPx(h);
    const colEl =
      el.querySelector<HTMLElement>('.call-carousel-col-static') ||
      el.querySelector<HTMLElement>('.call-carousel-col') ||
      el.querySelector<HTMLElement>('.call-carousel-col-inner');
    const colW = colEl?.clientWidth || 0;
    if (colW > 0) setCarouselColWidthMeasuredPx(colW);
  }, []);

  const snapCarouselAfterForwardLoop = useCallback(() => {
    if (columnCallListLayout || !animating) return;
    const total = countPlayOrderColumns(playedOrderRef.current);
    if (total <= visibleCols) return;
    const idx = carouselIndexRef.current;
    if (idx < total) return;
    setAnimating(false);
    setCarouselIndex(idx - total);
    carouselIndexRef.current = idx - total;
    requestAnimationFrame(() => setAnimating(true));
  }, [columnCallListLayout, animating, visibleCols]);

  // Auto-advance the 1×75 carousel; dwell grows for later leftmost bands (see carouselDwellMsForLeftColumn).
  useEffect(() => {
    if (columnCallListLayout) return;

    let cancelled = false;

    const scheduleTick = () => {
      if (cancelled) return;
      const total = countPlayOrderColumns(playedOrderRef.current);
      const prevTotal = carouselColumnCountRef.current;
      carouselColumnCountRef.current = total;

      if (total === 0) {
        carouselTickTimerRef.current = setTimeout(scheduleTick, CAROUSEL_BASE_DWELL_MS);
        return;
      }

      if (total <= visibleCols) {
        carouselTickTimerRef.current = setTimeout(scheduleTick, CAROUSEL_BASE_DWELL_MS);
        return;
      }

      // First band past one visible window: swap static grid → scroll track and measure width.
      if (prevTotal <= visibleCols && total > visibleCols) {
        requestAnimationFrame(() => {
          remeasureCarouselViewport();
        });
      }

      const leftIdx = carouselIndexRef.current;
      const delayMs = carouselDwellMsForLeftColumn(leftIdx, total);

      carouselTickTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setCarouselIndex((prev) => {
          const next = prev + 1;
          // Step into duplicate tail once (same view as index 0); layout effect snaps to 0.
          return next > total ? prev : next;
        });
        scheduleTick();
      }, delayMs);
    };

    scheduleTick();
    return () => {
      cancelled = true;
      if (carouselTickTimerRef.current != null) {
        clearTimeout(carouselTickTimerRef.current);
        carouselTickTimerRef.current = null;
      }
    };
  }, [
    oneBy75Ids,
    visibleCols,
    columnCallListLayout,
    totalPlayedCount,
    playedOrderRevision,
    remeasureCarouselViewport,
  ]);

  const carouselScrollEnabled =
    !columnCallListLayout && countPlayOrderColumns(playedOrderForDisplay) > visibleCols;

  /** After song 26+ (6th column), static grid swaps to scroll track — measure width before first slide. */
  useLayoutEffect(() => {
    if (!carouselScrollEnabled) return;
    remeasureCarouselViewport();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      remeasureCarouselViewport();
      setAnimating(false);
      raf2 = requestAnimationFrame(() => setAnimating(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [carouselScrollEnabled, playedOrderRevision, remeasureCarouselViewport]);

  // Measure viewport width for pixel-perfect slides (one column per step)
  useEffect(() => {
    const el = carouselViewportRef.current;
    if (!el) return;
    const update = () => {
      setViewportWidth(el.clientWidth || 0);
      setCarouselViewportHeightPx(el.clientHeight || 0);
      const colEl =
        el.querySelector<HTMLElement>('.call-carousel-col-static') ||
        el.querySelector<HTMLElement>('.call-carousel-col') ||
        el.querySelector<HTMLElement>('.call-carousel-col-inner');
      const colW = colEl?.clientWidth || 0;
      if (colW > 0) setCarouselColWidthMeasuredPx(colW);
    };
    update();
    window.addEventListener('resize', update);
    const RO: any = (window as any).ResizeObserver;
    const ro = RO ? new RO(update) : null;
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
    };
  }, [
    visibleCols,
    oneBy75Ids,
    columnCallListLayout,
    totalPlayedCount,
    playedOrderRevision,
    carouselScrollEnabled,
  ]);

  // Measure per-column viewport height to derive row height (5 visible rows)
  useEffect(() => {
    const el = vertViewportRef.current;
    if (!el) return;
    const compute = () => {
      const h = el.clientHeight || 0;
      if (h > 0) setRowHeightPx(h / 5);
      const w = el.clientWidth || 0;
      if (w > 0) setFiveBy15ColWidthPx(w);
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
  }, [columnCallListLayout, layoutFiveColumns, playedOrderRevision, oneBy75Ids]);

  // 5×15: smooth aligned vertical scroll; pauses when freezeAll (e.g. bingo verify).
  useEffect(() => {
    if (!columnCallListLayout) return;
    const secondsPerRow = 6;
    let last = performance.now();
    let running = true;
    const rowPx = fiveBy15CardRowPx > 0 ? fiveBy15CardRowPx : rowHeightPx;
    if (rowPx <= 0) return;

    const step = (now: number) => {
      if (!running) return;
      const dt = (now - last) / 1000;
      last = now;
      if (!freezeAll) {
        const delta = (rowPx / secondsPerRow) * dt;
        setPhasePx((p) => p + delta);
      }
      fiveBy15ScrollRafRef.current = requestAnimationFrame(step);
    };
    fiveBy15ScrollRafRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      if (fiveBy15ScrollRafRef.current != null) {
        cancelAnimationFrame(fiveBy15ScrollRafRef.current);
        fiveBy15ScrollRafRef.current = null;
      }
    };
  }, [columnCallListLayout, fiveBy15CardRowPx, rowHeightPx, freezeAll]);

  useEffect(() => {
    setFreezeAll(isVerificationPending);
  }, [isVerificationPending]);

  // Recover play order if stats show songs but call-list refs were cleared (e.g. late fiveby15-pool).
  useEffect(() => {
    if (!socket || !roomId) return;
    if (totalPlayedCount < 1 || playedOrderForDisplay.length > 0) return;
    const t = window.setTimeout(() => {
      if (playedOrderRef.current.length === 0) {
        console.log('🔄 Display: songs played but call list empty — requesting sync-state');
        socket.emit('sync-state', { roomId });
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [socket, roomId, totalPlayedCount, playedOrderForDisplay.length, playedOrderRevision]);

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

  // Shared helper: render masked text with per-song reveal baseline and optional highlight.
  // Each A–Z / 0–9 sits in a fixed-width slot (glyph advance) so reveals never resize the word.
  const renderMaskedText = (
    text: string,
    set: Set<string>,
    highlightChar: string | null,
    letterBoxScale = 1,
    fontWeight = 700,
  ) => {
    if (!text) return null;
    const blankFill = unrevealedLetterFillStyle(letterBoxScale);
    const spacingEm =
      fontWeight >= 800
        ? CALL_CARD_ARTIST_LETTER_SPACING_EM
        : CALL_CARD_TITLE_LETTER_SPACING_EM;
    // Soft breaks on spaces / hyphens / dashes / slashes only — never mid-letter.
    const segments = callCardWrapSegments(text);
    return (
      <span style={{ whiteSpace: 'normal', letterSpacing: 0 }}>
        {segments.map((seg, si) => {
          if (seg === ' ') {
            return <span key={`ws-${si}`}>{' '}</span>;
          }
          const chars = Array.from(seg);
          const letterIdxs = chars
            .map((ch, i) => (/^[A-Za-z0-9]$/.test(ch) ? i : -1))
            .filter((i) => i >= 0);
          const lastLetterIdx = letterIdxs.length ? letterIdxs[letterIdxs.length - 1] : -1;
          return (
            <span
              key={`seg-${si}`}
              style={{
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                letterSpacing: 0,
              }}
            >
              {chars.map((ch, ci) => {
                const u = ch.toUpperCase();
                if (/^[A-Z0-9]$/.test(u)) {
                  const revealed = set.has(u);
                  const isHighlight = revealed && !!highlightChar && u === highlightChar;
                  const slot = callLetterSlotStyle(u, {
                    scale: letterBoxScale,
                    weight: fontWeight,
                    letterSpacingEm: spacingEm,
                    withGap: ci !== lastLetterIdx,
                  });
                  return (
                    <span key={`c-${si}-${ci}`} style={slot}>
                      {revealed ? (
                        <span
                          style={
                            isHighlight
                              ? { color: '#f5d061', textShadow: '0 0 6px rgba(245,208,97,0.6)' }
                              : undefined
                          }
                        >
                          {ch}
                        </span>
                      ) : (
                        <span style={blankFill} />
                      )}
                    </span>
                  );
                }
                return <span key={`c-${si}-${ci}`}>{ch}</span>;
              })}
            </span>
          );
        })}
      </span>
    );
  };

  /** Track-start / track-end use play index vs current clip — no letter-mask tiles on those modes. */
  type CallSongRevealUi =
    | { kind: 'masked'; revealedSet: Set<string> }
    | { kind: 'plain' }
    | { kind: 'playing_placeholder' };

  /** Baseline index into revealSequence; missing = no global letters apply yet (not 0). */
  const revealBaselineForSong = (songId: string): number => {
    const stored = songBaselineRef.current[songId];
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
    return revealSequenceRef.current.length;
  };

  const getCallSongRevealUi = (songId: string): CallSongRevealUi => {
    void revealLayoutNonce;
    if (titleRevealMode === 'letter') {
      const baseline = revealBaselineForSong(songId);
      return {
        kind: 'masked',
        revealedSet: new Set(revealSequenceRef.current.slice(baseline)),
      };
    }

    const order = playedOrderForDisplay;
    const songIdx = order.indexOf(songId);

    let curIdx = -1;
    const cid = gameState.currentSong?.id;
    if (cid) curIdx = order.indexOf(cid);
    if (curIdx < 0 && typeof currentIndexRef.current === 'number' && currentIndexRef.current >= 0) {
      curIdx = currentIndexRef.current;
    }

    if (titleRevealMode === 'track_start') {
      if (songIdx < 0) return { kind: 'playing_placeholder' };
      if (curIdx >= 0) {
        return songIdx <= curIdx ? { kind: 'plain' } : { kind: 'playing_placeholder' };
      }
      return { kind: 'plain' };
    }

    if (titleRevealMode === 'track_end') {
      if (songIdx < 0) return { kind: 'playing_placeholder' };
      if (curIdx >= 0) {
        return songIdx < curIdx ? { kind: 'plain' } : { kind: 'playing_placeholder' };
      }
      return { kind: 'playing_placeholder' };
    }

    const baseline = revealBaselineForSong(songId);
    return {
      kind: 'masked',
      revealedSet: new Set(revealSequenceRef.current.slice(baseline)),
    };
  };

  const typographyForCallCard = (
    songId: string,
    meta: { name: string; artist: string },
    fullCard: boolean,
    layout: '5x15' | 'carousel' = '5x15',
  ): CallCardTypography => {
    void fontsReadyNonce; // re-fit after webfonts load
    const ui = getCallSongRevealUi(songId);
    const masked = ui.kind === 'masked';
    const plainFullTitle = ui.kind === 'plain';
    const hasArtist = !!meta.artist?.trim();
    /** Letter-masked titles never use the uncapped Full Card typography shortcut. */
    const layoutFullCard = fullCard && uncapFullCardCallLayout && !masked;
    if (layoutFullCard) {
      return uncappedFullCardTypography();
    }

    // One path: measure box → fit title+artist at hostZoom → paint.
    const titleForFit = formatCallCardTitle(meta.name);
    const fitBox = callCardFitBox(layout, plainFullTitle, masked);
    if (fitBox) {
      const fit = fitCallCardTextBest(titleForFit, meta.artist, {
        ...fitBox,
        masked,
        hostZoom,
      });
      if (fit) {
        return typographyFromCallCardFit(fit, { masked, plainFullTitle, hasArtist });
      }
    }

    const rowPx = layout === '5x15' ? fiveBy15CardRowPx : carouselCardRowPx;
    if (rowPx > 0) {
      return emergencyCallCardTypography(rowPx, { plainFullTitle, hasArtist });
    }
    return {
      textScale: 1,
      titleMaxLines: 3,
      artistMaxLines: hasArtist ? 2 : 0,
      letterBoxScale: 1,
      clampContentHeight: true,
      plainFullTitle,
      lineHeightScale: 1,
    };
  };

  const callCardLineStyles = (
    typo: CallCardTypography,
    kind: 'title' | 'artist',
    fullCard: boolean,
  ): React.CSSProperties => {
    const lhScale = typo.lineHeightScale ?? 1;
    const masked = !!typo.clampContentHeight && !typo.plainFullTitle;
    const tileScale = typo.letterBoxScale > 0 ? typo.letterBoxScale : 1;
    const lh = callCardLineHeightEm(kind, lhScale, masked, tileScale);
    const { titlePx, artistPx } = resolveCallCardFontSizes({
      textScale: typo.textScale,
      hostZoom,
    });
    const fontSize = kind === 'title' ? titlePx : artistPx;
    const artistGapPx = callCardTitleArtistGapPx(
      titlePx,
      lhScale,
      masked,
      tileScale,
      artistPx,
    );
    const common: React.CSSProperties = {
      fontFamily:
        kind === 'title'
          ? PUBLIC_DISPLAY_CALL_TITLE_FONT_FAMILY
          : PUBLIC_DISPLAY_CALL_ARTIST_FONT_FAMILY,
      fontWeight: kind === 'title' ? 700 : 800,
      lineHeight: lh,
      fontSize: `${fontSize}px`,
      // Masked tiles carry their own inter-slot gaps — parent letter-spacing would not apply
      // to inline-flex and caused W/G to collide with neighboring blanks.
      letterSpacing: masked ? 0 : kind === 'title'
        ? `${CALL_CARD_TITLE_LETTER_SPACING_EM}em`
        : `${CALL_CARD_ARTIST_LETTER_SPACING_EM}em`,
      color: kind === 'title' ? '#ffffff' : '#e0e0e0',
      textShadow:
        kind === 'title' ? '0 2px 6px rgba(0,0,0,0.8)' : '0 2px 4px rgba(0,0,0,0.6)',
      whiteSpace: 'normal',
      // Soft wraps only (spaces / hyphens) — never mid-letter.
      wordBreak: 'normal',
      overflowWrap: 'normal',
      display: 'block',
      overflow: kind === 'title' ? 'hidden' : 'visible',
      textOverflow: 'clip',
      marginTop: kind === 'artist' ? (fullCard ? Math.max(6, artistGapPx * 0.5) : artistGapPx) : 0,
      paddingBottom: 0,
      // Artist must remain visible — never shrink it away when the stack is tight.
      flexShrink: kind === 'artist' ? 0 : 1,
      minHeight: 0,
    };
    return common;
  };

  /** Title-only region — may clip. Artist is rendered as a sibling so it cannot be guillotined. */
  const callSongTitleRegionStyles = (
    typo: CallCardTypography,
    fullCard: boolean,
  ): React.CSSProperties => {
    const layoutFullCard = fullCard && uncapFullCardCallLayout;
    const base: React.CSSProperties = {
      minWidth: 0,
      maxWidth: '100%',
      width: '100%',
      flex: '1 1 auto',
      minHeight: 0,
      display: 'block',
      overflow: 'hidden',
      textAlign: 'center',
      position: 'relative',
      zIndex: 1,
      boxSizing: 'border-box' as const,
    };
    if (layoutFullCard || !typo.clampContentHeight) {
      return base;
    }
    return base;
  };

  /** Call-# corner chip removed from public display. */
  const renderCallNumberOverlay = (_callNum: number | '', _fullCard: boolean): React.ReactNode =>
    null;

  /** Corner notches removed with the call-# chip — text uses full card width. */
  const renderCallCardCornerNotches = (_callNum: number | ''): React.ReactNode => null;

  const renderCallSongLines = (
    songId: string,
    meta: { name: string; artist: string },
    maskFn: (
      text: string,
      set: Set<string>,
      highlightChar: string | null,
      fontWeight: number,
    ) => React.ReactNode,
  ): { title: React.ReactNode; artist: React.ReactNode | null } => {
    const ui = getCallSongRevealUi(songId);
    const titleCaps = formatCallCardTitle(meta.name || 'Unknown');
    const artistCaps = formatCallCardArtist(meta.artist || '');
    if (ui.kind === 'plain') {
      return {
        title: <span>{titleCaps || 'UNKNOWN'}</span>,
        artist: artistCaps ? <span>{artistCaps}</span> : null,
      };
    }
    if (ui.kind === 'playing_placeholder') {
      return {
        title: (
          <span style={{ opacity: 0.92, fontWeight: 700, letterSpacing: '0.08em' }}>PLAYING…</span>
        ),
        artist: null,
      };
    }
    return {
      title: maskFn(titleCaps || 'UNKNOWN', ui.revealedSet, revealToast, 700),
      artist: artistCaps ? maskFn(artistCaps, ui.revealedSet, revealToast, 800) : null,
    };
  };

  /**
   * Single call-card chrome for 5×15 and 1×75 — same markup, motion, and row sizing
   * so a cropped card cannot reveal which display mode produced it.
   */
  const renderUnifiedCallCard = (opts: {
    songId: string;
    reactKey: string;
    callNum: number | '';
    isFullCardPattern: boolean;
    layout: '5x15' | 'carousel';
    rowPx: number;
    meta: { name: string; artist: string };
    isCurrent: boolean;
    recencyClass: string;
    recencyStyle?: React.CSSProperties;
    motionKeySuffix?: string;
  }): React.ReactNode => {
    const {
      songId,
      reactKey,
      callNum,
      isFullCardPattern,
      layout,
      rowPx,
      meta,
      isCurrent,
      recencyClass,
      recencyStyle,
      motionKeySuffix = '',
    } = opts;
    const typo = typographyForCallCard(songId, meta, isFullCardPattern, layout);
    const uncapThisCard = isFullCardPattern && uncapFullCardCallLayout;
    const hasArtist = !!meta.artist?.trim();
    const { title, artist } = renderCallSongLines(songId, meta, (t, s, h, weight) =>
      renderMaskedText(t, s, h, typo.letterBoxScale, weight),
    );
    return (
      <motion.div
        key={reactKey}
        className={`call-item ${recencyClass}`}
        initial={false}
        aria-current={isCurrent ? 'true' : undefined}
        style={{
          ...recencyStyle,
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          padding: `${CALL_CARD_PAD_Y_PX}px ${CALL_CARD_PAD_X_PX}px`,
          borderRadius: 12,
          marginBottom: 0,
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          height: uncapThisCard ? 'auto' : rowPx > 0 ? `${rowPx}px` : undefined,
          minHeight: uncapThisCard
            ? rowPx > 0
              ? rowPx
              : undefined
            : rowPx > 0
              ? rowPx
              : 44,
          overflow: uncapThisCard ? 'visible' : 'hidden',
        }}
      >
        {renderCallNumberOverlay(callNum, isFullCardPattern)}
        <div
          className="call-song-info"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            width: '100%',
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            boxSizing: 'border-box',
            textAlign: 'center',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Title may clip; artist is a sibling below so it cannot be cut off. */}
          <div
            className="call-song-title-region"
            style={callSongTitleRegionStyles(typo, isFullCardPattern)}
          >
            {renderCallCardCornerNotches(callNum)}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={(meta?.name || '') + '-t' + motionKeySuffix}
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.25 }}
                className="call-song-name"
                style={callCardLineStyles(typo, 'title', isFullCardPattern)}
              >
                {title}
              </motion.div>
            </AnimatePresence>
          </div>
          {hasArtist && artist ? (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={(meta?.artist || '') + '-a' + motionKeySuffix}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 0.85, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="call-song-artist"
                style={callCardLineStyles(typo, 'artist', isFullCardPattern)}
              >
                {artist}
              </motion.div>
            </AnimatePresence>
          ) : null}
        </div>
      </motion.div>
    );
  };

  /**
   * Audience pattern label for the call-list header (never prefixed with "Pattern:").
   * Covers line / shapes / custom name / combined — chips below expand combined clauses.
   */
  const getPatternShortName = () => {
    switch (pattern) {
      case 'line':
        return describeLinePatternLabel(linesRequired);
      case 'full_card':
      case 'blackout':
        return 'Full Card';
      case 'four_corners':
        return 'Four Corners';
      case 'x':
        return 'X';
      case 't':
        return 'T';
      case 'l':
        return 'L';
      case 'u':
        return 'U';
      case 'plus':
        return 'Plus';
      case 'custom':
        return (customPatternName || '').trim() || 'Custom';
      case 'composite':
        return patternComposite
          ? `Combined (${patternComposite.op.toUpperCase()})`
          : 'Combined';
      default:
        return getPatternDisplayName(pattern) || 'Pattern';
    }
  };

  // Legacy "Pattern: …" form for any remaining non-header uses
  const getPatternName = () => `Pattern: ${getPatternShortName()}`;

  const patternHeaderLabel = getPatternShortName();
  const roundHeaderLabel = (currentRoundName || '').trim();

  const patternLabelForWinnerModal = (p: string) => {
    switch (p) {
      case 'full_card':
        return 'Full card';
      case 'blackout':
        return 'Blackout';
      case 'four_corners':
        return 'Four corners';
      case 'x':
        return 'X';
      case 't':
        return 'T';
      case 'l':
        return 'L';
      case 'u':
        return 'U';
      case 'plus':
        return 'Plus';
      case 'custom':
        return (customPatternName || '').trim() ? (customPatternName || '').trim() : 'Custom';
      case 'composite':
        return patternComposite ? describeCompositePatternAudienceSentence(patternComposite) : 'Combined';
      case 'line':
      default:
        return describeLinePatternLabel(linesRequired);
    }
  };

  // Function to check if a square is part of the current winning line
  const isWinningSquare = (row: number, col: number) => {
    if (pattern === 'full_card' || pattern === 'blackout') {
      // For full card / blackout, all squares are winning squares
      return true;
    }
    if (pattern === 'composite' && patternComposite) {
      if (compositeShapeClausesUseUnionHighlight(patternComposite)) {
        return unionCompositeHighlightPositions(patternComposite).includes(`${row}-${col}`);
      }
      // Cycle one concrete demo frame at a time (line / multi-example clauses).
      if (compositeDemoSequences.length >= 2) {
        const frame =
          compositeDemoSequences[
            compositeDemoSequences.length === 0 ? 0 : compositePatternDemoIndex % compositeDemoSequences.length
          ];
        return frame?.positions.includes(`${row}-${col}`) ?? false;
      }
      return unionCompositeHighlightPositions(patternComposite).includes(`${row}-${col}`);
    }
    if (pattern === 'custom' && customMask && customMask.size > 0) {
      if (customPatternDemoFrames.length > 1) {
        const idx = customPatternDemoIndex % customPatternDemoFrames.length;
        return customPatternDemoFrames[idx].includes(`${row}-${col}`);
      }
      const hi = customMaskHighlightPositions(Array.from(customMask), {
        matchReverse: customMatchReverse,
        matchAllowRotation: customMatchAllowRotation,
        matchAllowMirror: customMatchAllowMirror,
      });
      return hi.includes(`${row}-${col}`);
    }
    if (pattern === 'four_corners') {
      return (row === 0 && col === 0) || (row === 0 && col === 4) || (row === 4 && col === 0) || (row === 4 && col === 4);
    }
    if (pattern === 'x') {
      return row === col || row + col === 4;
    }
    if (pattern === 't') {
      const tPositions = ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2'];
      return tPositions.includes(`${row}-${col}`);
    }
    if (pattern === 'l') {
      const lPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4'];
      return lPositions.includes(`${row}-${col}`);
    }
    if (pattern === 'u') {
      const uPositions = ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3'];
      return uPositions.includes(`${row}-${col}`);
    }
    if (pattern === 'plus') {
      const plusPositions = ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2'];
      return plusPositions.includes(`${row}-${col}`);
    }
    
    // Standard line pattern: highlight one line at a time (single-line) or N lines per demo step (multi-line)
    const tuple =
      linePatternDemoTuples[
        linePatternDemoTuples.length === 0 ? 0 : linePatternDemoIndex % linePatternDemoTuples.length
      ] ?? [0];
    return tuple.some((idx) => {
      const pred = WINNING_LINE_PREDICATES[idx];
      return pred?.(row, col) === true;
    });
  };

  useEffect(() => {
    setLinePatternDemoIndex(0);
  }, [pattern, linesRequired]);

  // Cycle line-pattern demo (single line vs N simultaneous lines)
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (pattern !== 'line') return;
    const ms = linesRequired <= 1 ? 800 : 1300;
    const len = Math.max(1, linePatternDemoTuples.length);
    intervalRef.current = setInterval(() => {
      setLinePatternDemoIndex((prev) => (prev + 1) % len);
    }, ms);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pattern, linesRequired, linePatternDemoTuples.length]);

  useEffect(() => {
    setCustomPatternDemoIndex(0);
  }, [pattern, customMask, customMatchReverse, customMatchAllowRotation, customMatchAllowMirror]);

  useEffect(() => {
    if (customDemoIntervalRef.current) {
      clearInterval(customDemoIntervalRef.current);
      customDemoIntervalRef.current = null;
    }
    if (pattern !== 'custom' || customPatternDemoFrames.length <= 1) return;
    const len = customPatternDemoFrames.length;
    customDemoIntervalRef.current = setInterval(() => {
      setCustomPatternDemoIndex((prev) => (prev + 1) % len);
    }, 1000);
    return () => {
      if (customDemoIntervalRef.current) {
        clearInterval(customDemoIntervalRef.current);
        customDemoIntervalRef.current = null;
      }
    };
  }, [pattern, customPatternDemoFrames]);

  useEffect(() => {
    setCompositePatternDemoIndex(0);
  }, [patternComposite]);

  useEffect(() => {
    if (compositeDemoIntervalRef.current) {
      clearInterval(compositeDemoIntervalRef.current);
      compositeDemoIntervalRef.current = null;
    }
    if (pattern !== 'composite' || compositeDemoSequences.length < 2) return;
    const len = compositeDemoSequences.length;
    compositeDemoIntervalRef.current = setInterval(() => {
      setCompositePatternDemoIndex((prev) => (prev + 1) % len);
    }, compositeDemoCycleMs);
    return () => {
      if (compositeDemoIntervalRef.current) {
        clearInterval(compositeDemoIntervalRef.current);
        compositeDemoIntervalRef.current = null;
      }
    };
  }, [pattern, compositeDemoSequences, compositeDemoCycleMs]);

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
          let isWinningLine = isWinningSquare(row, col);
          let linePatternDemoClass = '';
          if (pattern === 'line' && linesRequired > 1 && isWinningLine) {
            const tuple =
              linePatternDemoTuples[
                linePatternDemoTuples.length === 0 ? 0 : linePatternDemoIndex % linePatternDemoTuples.length
              ] ?? [0];
            const hitSlots: number[] = [];
            tuple.forEach((lineIdx, slot) => {
              if (WINNING_LINE_PREDICATES[lineIdx]?.(row, col)) hitSlots.push(slot);
            });
            if (hitSlots.length > 1) linePatternDemoClass = ' winning-line-overlap';
            else if (hitSlots.length === 1) linePatternDemoClass = ` winning-line-slot-${hitSlots[0] % 4}`;
          }

          const isFullCardPattern = pattern === 'full_card' || pattern === 'blackout';

          let compositeClauseColorClass = '';
          if (pattern === 'composite' && patternComposite && isWinningLine) {
            const posKey = `${row}-${col}`;
            if (compositeShapeClausesUseUnionHighlight(patternComposite)) {
              patternComposite.clauses.forEach((clause, clauseIndex) => {
                if (compositeClauseColorClass) return;
                if (clauseHighlightPositions(clause).includes(posKey)) {
                  compositeClauseColorClass = ` composite-clause-color-${clauseIndex % COMPOSITE_CLAUSE_COLOR_SLOTS}`;
                }
              });
            } else if (compositeDemoSequences.length >= 2) {
              const frame =
                compositeDemoSequences[
                  compositeDemoSequences.length === 0 ? 0 : compositePatternDemoIndex % compositeDemoSequences.length
                ];
              if (frame?.positions.includes(posKey)) {
                compositeClauseColorClass = ` composite-clause-color-${frame.clauseIndex % COMPOSITE_CLAUSE_COLOR_SLOTS}`;
              }
            } else {
              compositeClauseColorClass = ' composite-clause-color-0';
            }
          }

          const pulseFullCardFamily = isWinningLine && isFullCardPattern;

          const pulseShapeGlow =
            isWinningLine &&
            !pulseFullCardFamily &&
            (pattern === 'custom' ||
              (pattern === 'composite' &&
                (compositeShapeClausesUseUnionHighlight(patternComposite) ||
                  compositeDemoSequences.length < 2)));

          const fullCardPulseDelay = pulseFullCardFamily ? fullCardPulseDelaySec(row, col) : 0;

          rowSquares.push(
            <motion.div
              key={`${row}-${col}`}
              className={`bingo-square ${square.isPlayed ? 'played' : ''} ${isWinningLine ? 'winning' : ''}${linePatternDemoClass}${compositeClauseColorClass}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: 1,
                scale: 1,
                ...(pulseFullCardFamily && {
                  boxShadow: [
                    '0 0 1px rgba(0, 255, 150, 0.35)',
                    '0 0 26px rgba(0, 255, 230, 1)',
                    '0 0 48px rgba(220, 255, 250, 0.92)',
                    '0 0 26px rgba(0, 255, 230, 1)',
                    '0 0 1px rgba(0, 255, 150, 0.35)',
                  ],
                  scale: [1, 1.045, 1.065, 1.045, 1],
                }),
                ...(pulseShapeGlow && {
                  boxShadow: [
                    '0 0 0 rgba(0, 255, 136, 0.3)',
                    '0 0 20px rgba(0, 255, 136, 0.6)',
                    '0 0 0 rgba(0, 255, 136, 0.3)',
                  ],
                }),
              }}
              transition={{
                opacity: { duration: 0.3, delay: (row + col) * 0.05 },
                scale: pulseFullCardFamily
                  ? {
                      duration: FULL_CARD_PULSE_DURATION_SEC,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: fullCardPulseDelay,
                    }
                  : { duration: 0.3, delay: (row + col) * 0.05 },
                boxShadow: pulseFullCardFamily
                  ? {
                      duration: FULL_CARD_PULSE_DURATION_SEC,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: fullCardPulseDelay,
                    }
                  : pulseShapeGlow
                    ? {
                        duration: 2,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }
                    : { duration: 0.3, delay: (row + col) * 0.05 },
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

  const renderPlaylistNamesHeaderRow = (
    layoutMode: '5x15' | '1x75',
    activeColumnIndex: number | null = null,
  ): React.ReactNode => {
    const cleaned = playlistNames.map((raw) => playlistDisplayParts(String(raw || '')).title);
    const nonEmpty = cleaned.filter(Boolean);
    if (nonEmpty.length === 0) return null;

    const letters = bingoColumnLetters.length === 5 ? bingoColumnLetters.split('') : ['B', 'I', 'N', 'G', 'O'];
    const slotCount =
      layoutMode === '5x15' ? 5 : Math.min(5, Math.max(1, nonEmpty.length));
    const singleOneBy75 = layoutMode === '1x75' && slotCount === 1;
    /** Round mix (one playlist) still uses five carousel columns — title spans the full width. */
    const spanPlaylistTitleFullWidth =
      singleOneBy75 || (layoutMode === '5x15' && nonEmpty.length === 1);
    const labels =
      layoutMode === '5x15' ? cleaned : singleOneBy75 ? [nonEmpty[0]] : nonEmpty.slice(0, slotCount);
    const playlistTitle = spanPlaylistTitleFullWidth ? nonEmpty[0] : '';

    const idleHeaderChipStyle = {
      backgroundColor: 'rgba(139,92,246,0.14)',
      border: '2px solid rgba(139,92,246,0.3)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.28), inset 0 -3px 0 rgba(0,255,136,0.45)',
    };

    if (spanPlaylistTitleFullWidth && playlistTitle) {
      const showColumnLetters = layoutMode === '5x15';
      return (
        <div className="call-columns-header call-columns-header--1x75-single">
          {showColumnLetters ? (
            <div className="call-columns-header__letter-row">
              {letters.map((bingoLetter, i) => (
                <motion.div
                  key={`letter-${bingoLetter}-${i}`}
                  className="call-col-title call-col-title--letter-only"
                  style={{ textAlign: 'center', borderRadius: 10 }}
                  initial={false}
                  animate={idleHeaderChipStyle}
                  transition={{ duration: 0.25 }}
                >
                  <div
                    className="call-playlist-name"
                    style={{
                      color: '#00ff88',
                      fontSize: 'clamp(1.35rem, 2.75vmin, 2.15rem)',
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: '0.06em',
                      textShadow: '0 0 14px rgba(0,255,136,0.45), 0 2px 4px rgba(0,0,0,0.8)',
                    }}
                  >
                    {bingoLetter}
                  </div>
                </motion.div>
              ))}
            </div>
          ) : null}
          <motion.div
            key="playlist-span"
            className="call-col-title call-col-title--1x75-playlist-span"
            style={{ textAlign: 'center', borderRadius: 10 }}
            initial={false}
            animate={idleHeaderChipStyle}
            transition={{ duration: 0.25 }}
          >
            <div className="call-playlist-name">
              <span style={{ color: '#ffffff' }}>{playlistTitle.toLocaleUpperCase()}</span>
            </div>
          </motion.div>
        </div>
      );
    }

    return (
      <div
        className={`call-columns-header${singleOneBy75 ? ' call-columns-header--1x75-single' : ''}`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))`,
          gap: 4,
          alignItems: 'center',
        }}
      >
        {Array.from({ length: slotCount }, (_, i) => {
          const name = labels[i] || '';
          const bingoLetter = letters[i];
          const isActiveColumn = layoutMode === '5x15' && activeColumnIndex === i;

          return (
            <motion.div
              key={i}
              className="call-col-title"
              style={{ textAlign: 'center', borderRadius: 10 }}
              initial={false}
              animate={
                isActiveColumn
                  ? {
                      backgroundColor: 'rgba(0,255,136,0.16)',
                      border: '2px solid rgba(0,255,136,0.9)',
                      boxShadow: [
                        '0 0 14px rgba(0,255,136,0.35)',
                        '0 0 26px rgba(0,255,136,0.55)',
                        '0 0 14px rgba(0,255,136,0.35)',
                      ],
                    }
                  : idleHeaderChipStyle
              }
              transition={
                isActiveColumn
                  ? {
                      border: { duration: 0.25 },
                      backgroundColor: { duration: 0.25 },
                      boxShadow: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
                    }
                  : { duration: 0.25 }
              }
            >
              {name ? (
                layoutMode === '1x75' ? (
                  <div className="call-playlist-name">
                    <span style={{ color: '#ffffff' }}>{name.toLocaleUpperCase()}</span>
                  </div>
                ) : (
                  /* Two-line header: big letter on top, playlist name beneath. */
                  <div
                    className="call-playlist-name"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <span
                      className="call-col-letter"
                      style={{
                        color: '#00ff88',
                        fontSize: 'clamp(1.35rem, 2.75vmin, 2.15rem)',
                        lineHeight: 1,
                        textShadow: '0 0 14px rgba(0,255,136,0.45), 0 2px 4px rgba(0,0,0,0.8)',
                      }}
                    >
                      {bingoLetter}
                    </span>
                    <span className="call-col-playlist-label" style={{ color: '#ffffff' }}>
                      {name.toLocaleUpperCase()}
                    </span>
                  </div>
                )
              ) : layoutMode === '5x15' ? (
                <div className="call-playlist-name" style={{ color: '#00ff88' }}>
                  {bingoLetter}
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    );
  };

  const renderOneBy75Columns = () => {
    const authCols = authoritativeFiveBy15Columns(fiveBy15Columns, fiveBy15ColumnsRef.current);
    if (columnCallListLayout && !authCols) {
      return (
        <div className="call-list-content">
          <div className="no-calls">
            <p>Initializing columns…</p>
          </div>
        </div>
      );
    }
    const idsToUse = authCols ? authCols.flat() : oneBy75Ids || oneBy75IdsRef.current;
    if (!poolHasTracks(idsToUse)) return null;
    const played = new Set(playedOrderForDisplay);
    let baseCols: string[][];
    if (authCols) {
      baseCols = authCols;
    } else if (idToColumnRef.current && Object.keys(idToColumnRef.current).length > 0) {
      const colsInit: string[][] = [[], [], [], [], []];
      for (const id of idsToUse) {
        const col = idToColumnRef.current[id];
        if (col >= 0 && col < 5) colsInit[col].push(id);
      }
      baseCols = colsInit;
    } else {
      baseCols = [0, 1, 2, 3, 4].map((c) => idsToUse.slice(c * 15, c * 15 + 15));
    }
    const cols = baseCols.map((col) =>
      sortPlayedIdsInColumn(
        col.filter((id) => played.has(id)),
        col,
        playedSeqRef.current,
      ),
    );
    const shown = new Set(cols.flat());
    for (const id of playedOrderForDisplay) {
      if (shown.has(id)) continue;
      const colIdx = resolvePoolColumnForSongId(
        id,
        authCols,
        authCols ? authCols.flat() : idsToUse,
        idToColumnRef.current,
      );
      if (typeof colIdx === 'number' && colIdx >= 0 && colIdx < 5) {
        cols[colIdx] = sortPlayedIdsInColumn([...cols[colIdx], id], baseCols[colIdx] || [], playedSeqRef.current);
        idToColumnRef.current[id] = colIdx;
        shown.add(id);
      } else if (debugMode) {
        console.warn('[Display] could not resolve 5×15 column for call', id);
      }
    }
    const visibleInCols = cols.reduce((n, c) => n + c.length, 0);
    if (playedOrderForDisplay.length > 0 && visibleInCols === 0) {
      return renderSimplePlayedCallList({ withPlaylistHeaders: columnCallListLayout });
    }
    if (debugMode) {
      try {
        console.log('[Display] columns snapshot', {
          playedCount: playedOrderForDisplay.length,
          perColCounts: cols.map(c => c.length)
        });
      } catch {}
    }

    // 5x15: column index for currently playing song (header highlight for audience)
    const currentSongId = gameState.currentSong?.id;
    let activeColumnIndex: number | null = null;
    if (currentSongId) {
      const mapped = idToColumnRef.current[currentSongId];
      if (typeof mapped === 'number' && mapped >= 0 && mapped < 5) {
        activeColumnIndex = mapped;
      } else if (authCols) {
        const found = authCols.findIndex((col) => col.includes(currentSongId));
        if (found >= 0) activeColumnIndex = found;
      }
    }

    /** Full-card (blackout) mode: show full song titles without line-clamp truncation. */
    const isFullCardPattern = pattern === 'full_card' || pattern === 'blackout';
    const uncapColumn = isFullCardPattern && uncapFullCardCallLayout;

    return (
      <div className="call-list-content call-list-content--5x15">
        {renderPlaylistNamesHeaderRow('5x15', activeColumnIndex)}
        <div className="call-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, height: '100%', minHeight: 0 }}>
          {cols.map((col, ci) => (
            <div
              key={ci}
              className="call-list-column"
              style={{
                position: 'relative',
                overflow: uncapColumn ? 'auto' : 'hidden',
                height: '100%',
                minHeight: 0,
                WebkitOverflowScrolling: 'touch'
              }}
              {...(ci === 0 ? { ref: vertViewportRef as any } : {})}
            >
              {(() => {
                const shouldScroll = !uncapColumn && col.length > 5 && fiveBy15CardRowPx > 0;
                const useAbsoluteTrack = shouldScroll;
                const displayItems = shouldScroll ? [...col, ...col] : col;
                const currentSongId = gameState.currentSong?.id;
                const colHasCurrent = !!(currentSongId && col.includes(currentSongId));
                let yPx = 0;
                if (shouldScroll) {
                  const baseRows = Math.max(0, col.length - 5);
                  const loopPx = Math.max(1, col.length * fiveBy15CardRowPx);
                  // Jeff: keep the playing call on-screen — pin its column so current
                  // sits in the bottom row when possible (other columns keep scrolling).
                  if (colHasCurrent && currentSongId) {
                    const currentIdx = col.indexOf(currentSongId);
                    const pinStart = Math.max(0, Math.min(baseRows, currentIdx - 4));
                    yPx = pinStart * fiveBy15CardRowPx;
                  } else {
                    yPx = (baseRows * fiveBy15CardRowPx + phasePx) % loopPx;
                  }
                }
                return (
                  <div
                    className="call-vert-track"
                    style={{
                      position: uncapColumn || !useAbsoluteTrack ? 'relative' : 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      willChange: useAbsoluteTrack && !colHasCurrent ? 'transform' : undefined,
                      transform: useAbsoluteTrack ? `translateY(${-yPx}px)` : undefined,
                    }}
                  >
                {displayItems.map((id, ri) => {
                  const meta = idMetaRef.current[id] || { name: '', artist: '' };
                  const isCurrent = gameState.currentSong?.id === id;
                  const recency = callItemRecency(
                    id,
                    playedOrderForDisplay,
                    gameState.currentSong?.id,
                  );
                  const idx = playedOrderForDisplay.indexOf(id);
                  return renderUnifiedCallCard({
                    songId: id,
                    reactKey: id + '-' + ri,
                    callNum: idx >= 0 ? idx + 1 : '',
                    isFullCardPattern,
                    layout: '5x15',
                    rowPx: fiveBy15CardRowPx,
                    meta,
                    isCurrent,
                    recencyClass: recency.className,
                    recencyStyle: recency.style,
                    motionKeySuffix: '-' + ri,
                  });
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

  const renderCarouselCallRows = (
    group: string[],
    gi: number,
    idsToUse: string[],
    isFullCardPattern: boolean,
  ) =>
    Array.from({ length: 5 }, (_, rowIdx) => {
      const id = group[rowIdx];
      if (!id) {
        // Uncapped Full Card stacks only real songs; letter-reveal keeps empty 1fr slots
        // so early columns don't let one masked tile eat the stage.
        if (isFullCardPattern && uncapFullCardCallLayout) return null;
        return (
          <div
            key={`empty-${gi}-${rowIdx}`}
            className="call-item call-item-slot"
            aria-hidden
            style={{ visibility: 'hidden', pointerEvents: 'none' }}
          />
        );
      }
      const playIdx = playedOrderForDisplay.indexOf(id);
      const callNum = playIdx >= 0 ? playIdx + 1 : idsToUse.indexOf(id) + 1;
      const meta = idMetaRef.current[id] || { name: '', artist: '' };
      const isCurrent = gameState.currentSong?.id === id;
      const recency = callItemRecency(
        id,
        playedOrderForDisplay,
        gameState.currentSong?.id,
      );
      return renderUnifiedCallCard({
        songId: id,
        reactKey: id,
        callNum: callNum > 0 ? callNum : '',
        isFullCardPattern,
        layout: 'carousel',
        rowPx: carouselCardRowPx,
        meta,
        isCurrent,
        recencyClass: recency.className,
        recencyStyle: recency.style,
      });
    });

  /** Guaranteed-visible play-order columns when pool layout cannot show played ids. */
  const renderSimplePlayedCallList = (opts?: { withPlaylistHeaders?: boolean }) => {
    const idsToUse = oneBy75Ids || oneBy75IdsRef.current || playedOrderForDisplay;
    const isFullCardPattern = pattern === 'full_card' || pattern === 'blackout';
    const groups = playOrderColumnSlices(playedOrderForDisplay);
    const showFiveBy15Headers =
      opts?.withPlaylistHeaders === true &&
      columnCallListLayout &&
      playlistNames.filter((n) => String(n || '').trim()).length > 0;
    // Align card columns with B–O headers (always 5 for 5×15); avoid 1fr rows inside height:auto parents (0px collapse).
    const colCount = showFiveBy15Headers
      ? visibleCols
      : Math.min(visibleCols, Math.max(1, groups.length));
    const columnSlots = Array.from({ length: colCount }, (_, i) => groups[i] || []);
    return (
      <div className="call-list-content call-list-content--played-fallback">
        {showFiveBy15Headers ? renderPlaylistNamesHeaderRow('5x15') : null}
        <div
          ref={carouselViewportRef}
          className="call-carousel-viewport call-carousel-viewport--static-grid call-carousel-viewport--played-order"
          style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
        >
            {columnSlots.map((group, gi) => (
            <div
              key={`played-fb-${gi}`}
              className={`call-carousel-col-static${
                isFullCardPattern && uncapFullCardCallLayout ? ' call-carousel-col--full-card' : ''
              }`}
            >
              <div
                className={`call-carousel-col-inner call-carousel-col-inner--played-order${
                  isFullCardPattern && uncapFullCardCallLayout
                    ? ' call-carousel-col-inner--full-card'
                    : ''
                }`}
              >
                {renderCarouselCallRows(group, gi, idsToUse, isFullCardPattern)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 1×75: play-order columns (5 rows ↓, then next column →); default 5 visible columns.
  const renderOneBy75GroupedColumns = () => {
    // Use state if available, otherwise fallback to ref (for fallback mode)
    const idsToUse = oneBy75Ids || oneBy75IdsRef.current;
    if (!poolHasTracks(idsToUse)) {
      if (playedOrderForDisplay.length > 0) {
        return renderSimplePlayedCallList({ withPlaylistHeaders: columnCallListLayout });
      }
      return null;
    }
    const isFullCardPattern = pattern === 'full_card' || pattern === 'blackout';
    // CRITICAL: Use playedOrderRef as source of truth for played songs (not currentIndexRef)
    // This ensures all played songs are shown, not just up to currentIndex
    // CRITICAL FIX: Use playedOrderRef directly instead of slicing idsToUse
    // Songs may be played in different order than pool order, so slicing would exclude songs beyond position 45
    // Debug logging for tracking
    const playedCountFromOrder = playedOrderForDisplay.length;
    const playedCountFromIndex = Math.max(0, (currentIndexRef.current ?? -1) + 1);
    if (playedCountFromOrder !== playedCountFromIndex && playedCountFromOrder > 0) {
      console.log(`🔄 1x75 display: playedOrder.length=${playedCountFromOrder}, currentIndexRef=${currentIndexRef.current}`);
    }
    // CRITICAL FIX: Ensure we have the full 75-song pool
    // If idsToUse has fewer than 75 songs, log a warning but continue
    if (idsToUse.length < 75) {
      console.warn(`⚠️ 1x75 display: Pool has only ${idsToUse.length} songs (expected 75). This may cause songs beyond position ${idsToUse.length} to not display.`);
    }
    
    const allPlayCols = playOrderColumnSlices(playedOrderForDisplay);
    const total = allPlayCols.length;
    const shouldScroll = total > visibleCols;

    const staticSlots: string[][] = Array.from({ length: visibleCols }, (_, colIdx) => allPlayCols[colIdx] || []);

    const scrollGroups: string[][] = shouldScroll
      ? [...allPlayCols, ...allPlayCols.slice(0, visibleCols)]
      : staticSlots;

    const maxSlideIndex = shouldScroll ? total + visibleCols - 1 : 0;
    const effectiveIndex = shouldScroll ? Math.min(carouselIndex, maxSlideIndex) : 0;
    const colWidthPx = viewportWidth > 0 ? Math.floor(viewportWidth / visibleCols) : 0;
    const trackWidthPx = shouldScroll && colWidthPx > 0 ? scrollGroups.length * colWidthPx : 0;
    const xPx = colWidthPx > 0 ? -(effectiveIndex * colWidthPx) : 0;

    const colStyle: React.CSSProperties | undefined =
      colWidthPx > 0
        ? { flex: `0 0 ${colWidthPx}px`, width: colWidthPx, maxWidth: colWidthPx, minWidth: 0 }
        : undefined;

    if (!shouldScroll) {
      return (
        <div className="call-list-content">
          {playlistNames.filter((n) => String(n || '').trim()).length <= 1
            ? renderPlaylistNamesHeaderRow('1x75')
            : null}
          <div
            ref={carouselViewportRef}
            className="call-carousel-viewport call-carousel-viewport--static-grid"
            style={{
              gridTemplateColumns: `repeat(${visibleCols}, minmax(0, 1fr))`,
            }}
          >
            {staticSlots.map((group, gi) => (
              <div
                key={`slot-${gi}`}
                className={`call-carousel-col-static${
                  isFullCardPattern && uncapFullCardCallLayout ? ' call-carousel-col--full-card' : ''
                }`}
              >
                <div
                  className={`call-carousel-col-inner${
                    isFullCardPattern && uncapFullCardCallLayout
                      ? ' call-carousel-col-inner--full-card'
                      : ''
                  }`}
                >
                  {renderCarouselCallRows(group, gi, idsToUse, isFullCardPattern)}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="call-list-content">
        {playlistNames.filter((n) => String(n || '').trim()).length <= 1
          ? renderPlaylistNamesHeaderRow('1x75')
          : null}
        <div
          ref={carouselViewportRef}
          className="call-carousel-viewport"
          style={{ ['--carousel-visible-cols' as any]: String(visibleCols) }}
        >
          <motion.div
            className="call-carousel-track"
            style={trackWidthPx > 0 ? { width: trackWidthPx, minWidth: trackWidthPx } : undefined}
            animate={{ x: colWidthPx > 0 ? xPx : 0 }}
            transition={{ duration: animating && shouldScroll ? 1 : 0, ease: 'easeInOut' }}
            onAnimationComplete={() => {
              if (shouldScroll) snapCarouselAfterForwardLoop();
            }}
          >
            {scrollGroups.map((group, gi) => {
              // Wrap seam: last play-order column | first column (loop copy).
              const isWrapStart = shouldScroll && total > 0 && gi === total;
              return (
              <div
                key={`scroll-${gi}`}
                className={`call-carousel-col${
                  isFullCardPattern && uncapFullCardCallLayout ? ' call-carousel-col--full-card' : ''
                }${isWrapStart ? ' call-carousel-col--wrap-seam' : ''}`}
                style={colStyle}
              >
                <div
                  className={`call-carousel-col-inner${
                    isFullCardPattern && uncapFullCardCallLayout
                      ? ' call-carousel-col-inner--full-card'
                      : ''
                  }`}
                >
                  {renderCarouselCallRows(group, gi, idsToUse, isFullCardPattern)}
                </div>
              </div>
              );
            })}
          </motion.div>
        </div>
      </div>
    );
  };

  const themeToggle = (
    <div
      className="public-display-theme-toggle"
      style={{
        display: 'inline-flex',
        gap: 6,
        padding: 4,
        borderRadius: 999,
        border: `1px solid ${pdGlass.borderViolet}`,
        background: displayTheme === 'light' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.35)',
      }}
      role="group"
      aria-label="Display theme"
    >
      <button
        type="button"
        className="btn-secondary"
        aria-pressed={displayTheme === 'dark'}
        onClick={() => chooseDisplayTheme('dark')}
        style={{
          padding: '6px 12px',
          fontWeight: 800,
          fontSize: '0.85rem',
          opacity: displayTheme === 'dark' ? 1 : 0.65,
          border: displayTheme === 'dark' ? `1px solid ${pdGlass.borderMint}` : '1px solid transparent',
        }}
      >
        Dark
      </button>
      <button
        type="button"
        className="btn-secondary"
        aria-pressed={displayTheme === 'light'}
        onClick={() => chooseDisplayTheme('light')}
        style={{
          padding: '6px 12px',
          fontWeight: 800,
          fontSize: '0.85rem',
          opacity: displayTheme === 'light' ? 1 : 0.65,
          border: displayTheme === 'light' ? `1px solid ${pdGlass.borderMint}` : '1px solid transparent',
        }}
      >
        Light
      </button>
    </div>
  );

  // If no room code is present, render a landing form to connect
  if (!roomId) {
    return (
      <div
        className={`public-display-connect${displayTheme === 'light' ? ' public-display-connect--light' : ''}`}
        style={{
          position: 'fixed',
          inset: 0,
          background: pdGlass.pageBgConnect,
          color: pdGlass.snow,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            width: 'min(92vw, 680px)',
            background: pdGlass.glassPanel,
            border: `1px solid ${pdGlass.borderViolet}`,
            borderRadius: 20,
            padding: 24,
            textAlign: 'center',
            boxShadow: pdGlass.shadowGlass,
            backdropFilter: 'blur(22px)',
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 'clamp(2.2rem, 6vw, 3.2rem)', marginBottom: 8, letterSpacing: '0.04em' }}>TEMPO – Public Display</div>
          <div style={{ opacity: 0.9, marginBottom: 14 }}>Enter a room code to connect the display</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>{themeToggle}</div>
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
                background: displayTheme === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.35)',
                color: pdGlass.snow,
                border: `1px solid ${pdGlass.borderViolet}`,
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
    <div
      ref={displayRef}
      className={`public-display public-display--glass${displayTheme === 'light' ? ' public-display--light' : ''}${venueBranding ? ' public-display--venue' : ''}`}
      style={
        {
          ...(venueBranding?.primaryColor ? { '--venue-primary': venueBranding.primaryColor } : {}),
          ...(venueBranding?.accentColor ? { '--venue-accent': venueBranding.accentColor } : {}),
        } as React.CSSProperties
      }
    >
      <div
        style={{
          position: 'fixed',
          top: 10,
          right: 12,
          zIndex: 50,
          opacity: 0.85,
        }}
      >
        {themeToggle}
      </div>
      <AnimatePresence>
        {winnerCardModal && (
          <motion.div
            key={`winner-card-${winnerCardModal.playerName}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="winner-card-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2600,
              background: 'rgba(0,0,0,0.88)',
              backdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'clamp(8px, 1.2vmin, 20px)',
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 280 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'min(99vw, calc(100vw - 16px))',
                maxWidth: 'min(99vw, 2400px)',
                maxHeight: 'min(98vh, calc(100vh - 16px))',
                height: 'min(98vh, calc(100vh - 16px))',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'stretch',
                justifyContent: 'center',
                gap: 'clamp(8px, 1.5vmin, 20px)',
                background: pdGlass.glassPanelStrong,
                border: `max(3px, 0.35vmin) solid ${pdGlass.borderMintStrong}`,
                borderRadius: 'clamp(16px, 2vmin, 28px)',
                boxShadow: `${pdGlass.glowMint}, 0 32px 80px rgba(0,0,0,0.65)`,
                padding: 'clamp(10px, 1.8vmin, 20px) clamp(10px, 1.5vmin, 18px)',
                boxSizing: 'border-box',
              }}
            >
              {/* Left: winner header — wide column, large type; card sizing unchanged (center flex + min(100%, 92vh)) */}
              <div
                id="winner-card-title"
                style={{
                  flex: '0 0 auto',
                  width: 'clamp(168px, 24vw, 400px)',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  gap: 'clamp(14px, 2.5vmin, 28px)',
                  padding: 'clamp(12px, 2vmin, 28px) clamp(10px, 1.5vmin, 20px)',
                  borderRight: '1px solid rgba(255,255,255,0.12)',
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,40,32,0.12) 100%)',
                  borderRadius: 'clamp(10px, 1.2vmin, 16px)',
                }}
              >
                <div
                  style={{
                    fontSize: 'clamp(1rem, 2.4vmin, 1.75rem)',
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    opacity: 0.92,
                    fontWeight: 800,
                  }}
                >
                  Verified winner
                </div>
                <div
                  style={{
                    fontSize: 'clamp(1.75rem, 5.5vmin, 4.25rem)',
                    fontWeight: 900,
                    color: '#eafff8',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'clamp(10px, 2vmin, 22px)',
                    lineHeight: 1.08,
                    textShadow: '0 4px 28px rgba(0,0,0,0.5)',
                  }}
                >
                  <Trophy
                    style={{
                      width: 'clamp(52px, 12vmin, 128px)',
                      height: 'clamp(52px, 12vmin, 128px)',
                      flexShrink: 0,
                      filter: 'drop-shadow(0 0 24px rgba(0,255,170,0.65))',
                    }}
                    strokeWidth={2}
                  />
                  <span style={{ maxWidth: '100%', wordBreak: 'break-word' }}>{winnerCardModal.playerName}</span>
                </div>
                {winnerCardModal.prize ? (
                  <div
                    style={{
                      fontSize: 'clamp(1.1rem, 3vmin, 2.2rem)',
                      fontWeight: 800,
                      color: '#f5d061',
                      lineHeight: 1.2,
                      maxWidth: '100%',
                      wordBreak: 'break-word',
                    }}
                  >
                    Prize: {winnerCardModal.prize}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: 'clamp(1.05rem, 2.8vmin, 2.1rem)',
                    opacity: 0.9,
                    fontWeight: 800,
                    lineHeight: 1.2,
                  }}
                >
                  {patternLabelForWinnerModal(winnerCardModal.pattern)}
                </div>
              </div>

              {/* Center: maximize square card in remaining width + viewport height */}
              <div
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gridTemplateRows: 'repeat(5, 1fr)',
                  gap: 0,
                  /*
                    As large as possible: limited by column width and viewport height.
                  */
                  width: 'min(100%, 92vh)',
                  maxWidth: '100%',
                  aspectRatio: '1 / 1',
                  height: 'auto',
                  maxHeight: 'min(92vh, 100%)',
                  margin: 0,
                  flexShrink: 0,
                  minHeight: 0,
                }}
              >
                {Array.from({ length: 25 }, (_, i) => {
                  const pos = `${Math.floor(i / 5)}-${i % 5}`;
                  const sq = winnerCardModal.squares.find((s) => s.position === pos);
                  const isPattern = winnerCardModal.winningPositions.includes(pos);
                  const vis = sq
                    ? youtubeBingoSquareDisplay({
                        customSongName: sq.customSongName,
                        customArtistName: sq.customArtistName,
                        songName: sq.songName,
                        artistName: sq.artistName,
                        youtubeMusic: sq.youtubeMusic === true,
                        youtubeRawTitle: sq.youtubeRawTitle,
                        catalogDisplayVerified: sq.catalogDisplayVerified === true,
                        isFreeSpace: sq.isFreeSpace === true,
                      })
                    : { title: '', artist: '' };
                  const title = sq?.isFreeSpace ? 'FREE' : vis.title;
                  const artist = sq?.isFreeSpace ? '' : vis.artist;
                  const cellTextScale = sq?.isFreeSpace
                    ? 1
                    : computeBingoCellTextScale(String(title), String(artist));
                  const titleLineH = 1.08;
                  const artistLineH = 1.08;
                  const titleMaxLines = cellTextScale < 0.85 ? 5 : 4;
                  const artistMaxLines = cellTextScale < 0.85 ? 3 : 2;
                  return (
                    <div
                      key={pos}
                      style={{
                        borderRadius: 0,
                        padding: 'clamp(2px, 0.35vmin, 6px)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        overflow: 'hidden',
                        background: sq?.marked ? 'rgba(0,255,136,0.14)' : 'rgba(255,255,255,0.05)',
                        border: 'none',
                        boxShadow: isPattern
                          ? 'inset 0 0 0 max(3px, 0.45vmin) rgba(0,255,220,0.98), 0 0 40px rgba(0,255,180,0.45), inset 0 0 20px rgba(0,255,200,0.08)'
                          : 'inset 0 0 0 max(1px, 0.2vmin) rgba(255,255,255,0.18)',
                        minHeight: 0,
                        minWidth: 0,
                      }}
                    >
                      <div
                        className="bingo-square-text"
                        style={{
                          fontSize:
                            cellTextScale === 1
                              ? 'clamp(0.85rem, 2.65vmin, 2.2rem)'
                              : `clamp(${0.85 * cellTextScale}rem, ${2.65 * cellTextScale}vmin, ${2.2 * cellTextScale}rem)`,
                          fontWeight: 900,
                          lineHeight: titleLineH,
                          color: '#f6fffc',
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'clip',
                          maxHeight: maxHeightEm(titleLineH, titleMaxLines),
                          wordBreak: 'break-word',
                          hyphens: 'auto',
                          textShadow: '0 2px 8px rgba(0,0,0,0.35)',
                          width: '100%',
                        }}
                      >
                        {sq?.isFreeSpace ? (
                          <span
                            style={{
                              fontSize: 'clamp(1.15rem, 3.8vmin, 3rem)',
                              letterSpacing: '0.08em',
                            }}
                          >
                            FREE
                          </span>
                        ) : (
                          title
                        )}
                      </div>
                      {!sq?.isFreeSpace && artist ? (
                        <div
                          className="bingo-square-text"
                          style={{
                            fontSize:
                              cellTextScale === 1
                                ? 'clamp(0.72rem, 2.05vmin, 1.75rem)'
                                : `clamp(${0.72 * cellTextScale}rem, ${2.05 * cellTextScale}vmin, ${1.75 * cellTextScale}rem)`,
                            opacity: 0.92,
                            marginTop: 'clamp(2px, 0.35vmin, 5px)',
                            lineHeight: artistLineH,
                            fontWeight: 700,
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'clip',
                            maxHeight: maxHeightEm(artistLineH, artistMaxLines),
                            wordBreak: 'break-word',
                            width: '100%',
                          }}
                        >
                          {artist}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {sponsorScreen.visible &&
        (roomPhase !== 'playing' && roomPhase !== 'paused_for_verification') &&
        (sponsorScreen.mediaUrl || sponsorScreen.text || sponsorScreen.qrUrl) && (
        <div
          className="public-sponsor-screen"
          role="dialog"
          aria-label="Sponsor"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2700,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(16px, 3vmin, 48px)',
          }}
        >
          <div
            style={{
              width: 'min(96vw, 1400px)',
              maxHeight: 'min(94vh, 1000px)',
              display: 'grid',
              gridTemplateColumns:
                sponsorScreen.qrUrl.trim()
                  ? 'minmax(0, 1.6fr) minmax(140px, 0.55fr)'
                  : '1fr',
              gap: 'clamp(16px, 2.5vmin, 36px)',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'clamp(12px, 2vmin, 24px)',
                minWidth: 0,
                alignItems: 'center',
              }}
            >
              {sponsorScreen.mediaUrl ? (
                sponsorScreen.mediaKind === 'video' ? (
                  <video
                    key={sponsorScreen.mediaUrl}
                    src={sponsorScreen.mediaUrl}
                    autoPlay
                    muted
                    loop
                    playsInline
                    style={{
                      width: '100%',
                      maxHeight: sponsorScreen.text ? 'min(68vh, 720px)' : 'min(82vh, 860px)',
                      objectFit: 'contain',
                      borderRadius: 'clamp(12px, 1.5vmin, 20px)',
                      background: '#000',
                    }}
                  />
                ) : (
                  <img
                    src={sponsorScreen.mediaUrl}
                    alt=""
                    style={{
                      width: '100%',
                      maxHeight: sponsorScreen.text ? 'min(68vh, 720px)' : 'min(82vh, 860px)',
                      objectFit: 'contain',
                      borderRadius: 'clamp(12px, 1.5vmin, 20px)',
                      background: '#000',
                    }}
                  />
                )
              ) : null}
              {sponsorScreen.text ? (
                <div
                  style={{
                    fontSize: 'clamp(1.35rem, 3.6vmin, 2.75rem)',
                    fontWeight: 800,
                    textAlign: 'center',
                    color: '#eafff8',
                    lineHeight: 1.2,
                    maxWidth: '40ch',
                    textShadow: '0 4px 24px rgba(0,0,0,0.55)',
                  }}
                >
                  {sponsorScreen.text}
                </div>
              ) : null}
            </div>
            {sponsorScreen.qrUrl.trim() ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'clamp(10px, 1.5vmin, 16px)',
                  justifySelf: 'center',
                }}
              >
                <img
                  src={`${API_BASE || ''}/api/qr?size=640&data=${encodeURIComponent(sponsorScreen.qrUrl.trim())}`}
                  alt="Sponsor QR code"
                  style={{
                    width: 'min(28vw, 280px)',
                    height: 'min(28vw, 280px)',
                    objectFit: 'contain',
                    background: '#fff',
                    borderRadius: 16,
                    padding: 12,
                  }}
                />
                <div
                  style={{
                    fontSize: 'clamp(0.85rem, 1.6vmin, 1.15rem)',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.7)',
                  }}
                >
                  Scan
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showNightBoard && roundWinnersBoard.length > 0 && (() => {
        const nightBoardRows = roundWinnersBoard.length;
        /** Scale type down only when the list is long so every row stays readable from the floor. */
        const nightBoardDense = nightBoardRows >= 8;
        const nightBoardComfortable = nightBoardRows <= 4;
        const colTemplate = 'minmax(0, 1.15fr) minmax(0, 1.35fr) minmax(0, 1.55fr)';
        const titleSize = nightBoardDense
          ? 'clamp(1.45rem, 3.4vmin, 2.6rem)'
          : 'clamp(1.85rem, 4.4vmin, 3.4rem)';
        const headerSize = nightBoardDense
          ? 'clamp(0.95rem, 1.9vmin, 1.35rem)'
          : 'clamp(1.1rem, 2.4vmin, 1.7rem)';
        const roundSize = nightBoardDense
          ? 'clamp(1.25rem, 2.8vmin, 2.1rem)'
          : nightBoardComfortable
            ? 'clamp(1.65rem, 3.8vmin, 2.9rem)'
            : 'clamp(1.45rem, 3.3vmin, 2.5rem)';
        const prizeSize = nightBoardDense
          ? 'clamp(1.25rem, 2.8vmin, 2.1rem)'
          : nightBoardComfortable
            ? 'clamp(1.65rem, 3.8vmin, 2.9rem)'
            : 'clamp(1.45rem, 3.3vmin, 2.5rem)';
        const winnerSize = nightBoardDense
          ? 'clamp(1.55rem, 3.6vmin, 2.75rem)'
          : nightBoardComfortable
            ? 'clamp(2.1rem, 5.2vmin, 4rem)'
            : 'clamp(1.85rem, 4.4vmin, 3.4rem)';
        const rowPadY = nightBoardDense
          ? 'clamp(12px, 1.6vmin, 20px)'
          : nightBoardComfortable
            ? 'clamp(18px, 2.6vmin, 36px)'
            : 'clamp(14px, 2vmin, 28px)';
        const rowGap = nightBoardDense
          ? 'clamp(8px, 1.2vmin, 14px)'
          : 'clamp(12px, 1.8vmin, 22px)';

        return (
        <div
          className="public-night-board"
          role="region"
          aria-label="Tonight's winners"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2500,
            background: 'rgba(0,0,0,0.88)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(12px, 2.2vmin, 36px)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 'min(96vw, 1760px)',
              maxHeight: 'min(94vh, calc(100vh - 24px))',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              background: pdGlass.glassPanelStrong,
              border: `max(3px, 0.35vmin) solid ${pdGlass.borderMintStrong}`,
              borderRadius: 'clamp(16px, 2.2vmin, 28px)',
              boxShadow: `${pdGlass.glowMint}, 0 32px 80px rgba(0,0,0,0.65)`,
              padding: 'clamp(20px, 3.2vmin, 44px) clamp(22px, 3.6vmin, 52px)',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                fontSize: titleSize,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontWeight: 900,
                color: '#5dffc0',
                textAlign: 'center',
                marginBottom: 'clamp(14px, 2.4vmin, 28px)',
                flexShrink: 0,
                textShadow: '0 2px 18px rgba(0,0,0,0.55), 0 0 28px rgba(0,255,170,0.22)',
                lineHeight: 1.1,
              }}
            >
              Tonight&apos;s board
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: colTemplate,
                gap: 'clamp(12px, 2vmin, 28px)',
                padding: `0 clamp(8px, 1.2vmin, 16px) clamp(10px, 1.4vmin, 16px)`,
                fontSize: headerSize,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.72)',
                flexShrink: 0,
                borderBottom: '1px solid rgba(255,255,255,0.14)',
                marginBottom: 'clamp(10px, 1.5vmin, 18px)',
              }}
            >
              <span>Round</span>
              <span>Prize</span>
              <span style={{ textAlign: 'right' }}>Winner</span>
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: rowGap,
                flex: '1 1 auto',
                minHeight: 0,
                justifyContent: nightBoardComfortable ? 'center' : 'flex-start',
              }}
            >
              {roundWinnersBoard.map((w, idx) => (
                <li
                  key={`${w.roundNumber}-${w.playerName}-${idx}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: colTemplate,
                    gap: 'clamp(12px, 2vmin, 28px)',
                    alignItems: 'center',
                    padding: `${rowPadY} clamp(14px, 2vmin, 28px)`,
                    borderRadius: 'clamp(12px, 1.4vmin, 18px)',
                    background: 'rgba(255,255,255,0.06)',
                    border: 'max(1px, 0.18vmin) solid rgba(0,255,136,0.28)',
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: roundSize,
                      color: 'rgba(255,255,255,0.92)',
                      lineHeight: 1.15,
                      wordBreak: 'break-word',
                      textShadow: '0 2px 10px rgba(0,0,0,0.4)',
                    }}
                  >
                    {w.roundName || `Round ${w.roundNumber}`}
                  </span>
                  <span
                    style={{
                      color: '#ffe28a',
                      fontWeight: 800,
                      fontSize: prizeSize,
                      lineHeight: 1.15,
                      wordBreak: 'break-word',
                      textShadow: '0 2px 10px rgba(0,0,0,0.4)',
                    }}
                  >
                    {(w.prize || '').trim() || '—'}
                  </span>
                  <span
                    style={{
                      fontWeight: 900,
                      fontSize: winnerSize,
                      color: '#f3fffa',
                      textAlign: 'right',
                      lineHeight: 1.12,
                      wordBreak: 'break-word',
                      textShadow: '0 3px 16px rgba(0,0,0,0.5), 0 0 24px rgba(0,255,170,0.18)',
                    }}
                  >
                    {w.playerName}
                  </span>
                </li>
              ))}
            </ul>
            {roomPhase === 'round_complete' && currentRoundPrize ? (
              <div
                style={{
                  marginTop: 'clamp(14px, 2.2vmin, 24px)',
                  textAlign: 'center',
                  fontSize: nightBoardDense
                    ? 'clamp(1.05rem, 2.2vmin, 1.55rem)'
                    : 'clamp(1.2rem, 2.6vmin, 1.9rem)',
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.78)',
                  flexShrink: 0,
                  lineHeight: 1.25,
                }}
              >
                Latest prize: {currentRoundPrize}
              </div>
            ) : null}
          </div>
        </div>
        );
      })()}

      {typeof document !== 'undefined' &&
        createPortal(
      <>
      <AnimatePresence>
        {showWinnerBanner && (() => {
          const isBigWinCelebration = winnerName && !winnerName.startsWith('🔄');
          return (
          <motion.div
            key="winner-banner"
            initial={{ opacity: 0, scale: isBigWinCelebration ? 0.88 : 0.96, y: isBigWinCelebration ? 28 : 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: isBigWinCelebration ? 0.95 : 0.98, y: -12 }}
            transition={isBigWinCelebration
              ? { type: 'spring', damping: 20, stiffness: 260, mass: 0.85 }
              : { duration: 0.25 }}
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              top: `${headerToastTopPx}px`,
              marginLeft: 'auto',
              marginRight: 'auto',
              width: isBigWinCelebration ? 'min(96vw, 1500px)' : 'fit-content',
              maxWidth: isBigWinCelebration ? 'min(96vw, 1500px)' : 'min(92vw, 720px)',
              zIndex: 10020,
              background: isBigWinCelebration
                ? `linear-gradient(165deg, rgba(0,255,136,0.35) 0%, rgba(139,92,246,0.28) 50%, ${pdGlass.void} 100%)`
                : `linear-gradient(165deg, rgba(139,92,246,0.35) 0%, rgba(0,255,136,0.1) 100%)`,
              border: isBigWinCelebration
                ? `2px solid ${pdGlass.borderMintStrong}`
                : `1px solid ${pdGlass.borderViolet}`,
              backdropFilter: 'blur(14px)',
              boxShadow: isBigWinCelebration
                ? '0 0 0 1px rgba(255,255,255,0.1) inset, 0 0 80px rgba(0,255,170,0.45), 0 16px 48px rgba(0,0,0,0.5)'
                : undefined,
              color: '#f6fffc',
              padding: isBigWinCelebration
                ? 'clamp(22px, 3.8vw, 48px) clamp(28px, 5.5vw, 72px)'
                : '12px 18px',
              borderRadius: isBigWinCelebration ? 22 : 12,
              fontWeight: 900,
              letterSpacing: isBigWinCelebration ? '0.04em' : '0.03em',
              textAlign: 'center',
              textShadow: isBigWinCelebration
                ? '0 2px 0 rgba(0,0,0,0.35), 0 0 40px rgba(0,255,170,0.55), 0 0 90px rgba(0,255,200,0.25)'
                : undefined,
              fontSize: isBigWinCelebration
                ? 'clamp(1.85rem, 1.1rem + 4.2vw, 5.25rem)'
                : 'clamp(1rem, 2vw + 0.4rem, 1.65rem)',
              lineHeight: isBigWinCelebration ? 1.1 : 1.25,
            }}
          >
            {isBigWinCelebration && (
              <div
                style={{
                  fontSize: 'clamp(0.75rem, 0.35rem + 1.5vw, 1.35rem)',
                  letterSpacing: '0.28em',
                  textTransform: 'uppercase',
                  opacity: 0.92,
                  marginBottom: '0.35em',
                  fontWeight: 800,
                  textShadow: '0 1px 12px rgba(0,0,0,0.4)'
                }}
              >
                Congratulations
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35em', flexWrap: 'wrap' }}>
              {isBigWinCelebration && (
                <Trophy
                  strokeWidth={2.2}
                  style={{ flexShrink: 0, filter: 'drop-shadow(0 0 12px rgba(0,255,170,0.8))', width: 'clamp(36px, 8vw, 64px)', height: 'clamp(36px, 8vw, 64px)' }}
                  aria-hidden
                />
              )}
              <span>{winnerName}</span>
            </div>
          </motion.div>
          );
        })()}
        {remoteHybridNotice && (
          <motion.div
            key="remote-hybrid-notice"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              top: `${headerToastTopPx}px`,
              marginLeft: 'auto',
              marginRight: 'auto',
              maxWidth: 'min(92vw, 720px)',
              width: 'fit-content',
              zIndex: 10010,
              padding: '14px 20px',
              borderRadius: 14,
              background: 'linear-gradient(180deg, rgba(0,160,255,0.38), rgba(0,60,100,0.25))',
              border: '1px solid rgba(0,200,255,0.5)',
              color: '#e8f8ff',
              fontWeight: 700,
              fontSize: 'clamp(0.95rem, 2vw, 1.25rem)',
              textAlign: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            }}
          >
            {remoteHybridNotice}
          </motion.div>
        )}
        {letterRevealToastEnabled && revealToast && (
          <motion.div
            key={`toast-${revealToast}-${totalPlayedCount}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, scale: 0.7, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            style={{
              // Centered over the sidebar column (.bottom-row is 0.45fr/1.55fr → left col ≈ 22.5vw),
              // in the negative space between the QR/logo panel and the bottom edge.
              position: 'fixed',
              left: 0,
              bottom: '2.5vh',
              width: '22.5vw',
              display: 'flex',
              justifyContent: 'center',
              zIndex: 10000,
              pointerEvents: 'none',
            }}
          >
            <div className="public-display-reveal-toast">Revealed: {revealToast}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isVerificationPending && (
          <motion.div
            key="bingo-verify-freeze"
            role="status"
            aria-live="assertive"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10015,
              pointerEvents: 'none',
              background: 'rgba(6, 12, 22, 0.78)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'clamp(16px, 4vmin, 56px)',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                maxWidth: 'min(96vw, 920px)',
                textAlign: 'center',
                fontWeight: 900,
                letterSpacing: '0.04em',
                lineHeight: 1.25,
                fontSize: 'clamp(1.65rem, min(4.8vmin, 3.8vh), 3.35rem)',
                color: '#f4fffb',
                textShadow: '0 4px 28px rgba(0,0,0,0.65), 0 0 48px rgba(0,255,190,0.35)',
                padding: 'clamp(28px, 5vmin, 52px) clamp(24px, 5vmin, 56px)',
                borderRadius: 'clamp(18px, 2.5vmin, 28px)',
                background: pdGlass.glassPanelStrong,
                border: 'max(2px, 0.22vmin) solid rgba(0,255,200,0.42)',
                boxShadow:
                  '0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 72px rgba(0,255,170,0.22)',
              }}
            >
              Bingo called, confirming now... please wait!
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </>,
      document.body
        )}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2000,
              background: pdGlass.pageBg,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
              padding: 'clamp(16px, 2.5vmin, 40px) clamp(8px, 1.2vmin, 28px) clamp(28px, 4vmin, 64px)',
              overflowX: 'hidden',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
          >
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                overflow: 'hidden',
                zIndex: 0,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: '-12%',
                  left: '-6%',
                  width: 'min(75vmin, 95vw)',
                  height: 'min(75vmin, 95vw)',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(0,255,180,0.2) 0%, transparent 68%)',
                  filter: 'blur(52px)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '-8%',
                  right: '-4%',
                  width: 'min(50vmin, 65vw)',
                  height: 'min(50vmin, 65vw)',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(130,100,255,0.22) 0%, transparent 64%)',
                  filter: 'blur(44px)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0.06,
                  backgroundImage:
                    'repeating-linear-gradient(-12deg, transparent, transparent 2px, rgba(255,255,255,0.06) 2px, rgba(255,255,255,0.06) 3px)',
                }}
              />
            </div>

            <div
              style={{
                position: 'relative',
                zIndex: 1,
                width: '100%',
                maxWidth: 'min(calc(100vw - clamp(16px, 4vmin, 56px)), 2800px)',
                minWidth: 0,
                margin: '0 auto',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                width: '100%',
                gap: 'clamp(16px, 2.75vmin, 40px)',
                flex: 1,
                minHeight: 0,
              }}
            >
            <div style={{ textAlign: 'center', width: '100%', marginBottom: 'clamp(6px, 1.2vmin, 18px)', flexShrink: 0 }}>
              <div
                style={{
                  fontSize: 'clamp(5rem, 11vw, 9rem)',
                  fontWeight: 1000,
                  letterSpacing: '0.05em',
                  backgroundImage: pdGlass.titleGradient,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  textShadow: '0 10px 36px rgba(0,255,170,0.55), 0 0 28px rgba(0,255,170,0.3)',
                  display: 'none'
                }}
              >
                Tempo
              </div>
              <div style={{ fontSize: 'clamp(1.8rem, 3.8vw, 2.6rem)', opacity: 0.98, marginTop: 18, display: 'none' }}>The game is on, the volume is up, the win is yours.</div>
              <PublicDisplayTempoBallRow seeds={ballAnimSeedsRef.current} variant="splash" />
              <div
                style={{
                  fontSize: 'clamp(1.35rem, min(4.5vmin, 3.2vh), 4rem)',
                  opacity: 0.94,
                  marginTop: 'clamp(6px, 1.2vmin, 14px)',
                  fontWeight: 700,
                  color: 'rgba(240,252,255,0.95)',
                  textShadow: '0 2px 20px rgba(0,0,0,0.35)',
                }}
              >
                The game is on, the volume is up, the win is yours.
              </div>
              <motion.div
                initial={{ x: '-40%' }}
                animate={{ x: ['-40%', '140%'] }}
                transition={{
                  duration: 4.5,
                  repeat: Infinity,
                  ease: 'linear',
                  repeatType: 'mirror',
                }}
                style={{
                  height: 'max(3px, 0.4vmin)',
                  width: 'min(78%, 900px)',
                  margin: 'clamp(6px, 1.2vmin, 16px) auto 0',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)',
                  borderRadius: 4,
                  opacity: 0.85,
                }}
              />
            </div>
            <div
              className="public-display-splash-bottom"
              style={{
                gap: 'clamp(20px, 3.5vmin, 48px)',
                width: '100%',
                minWidth: 0,
                flex: 1,
                minHeight: 0,
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  maxWidth: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  minHeight: 0,
                  position: 'relative',
                  zIndex: 2,
                }}
              >
            <div
              style={{
                width: '100%',
                maxWidth: '100%',
                minWidth: 0,
                minHeight: 0,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                margin: '0 auto',
              }}
            >
              <motion.div
                className={
                  'public-display-splash-join-card' +
                  (splashHasHeroBranding ? ' public-display-splash-join-card--with-logo-tile' : '')
                }
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.2 }}
                style={{
                  minWidth: 0,
                  width: '100%',
                  flex: 1,
                  minHeight: 0,
                  maxHeight: 'min(calc(100svh - 8rem), 88vh)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: 'clamp(6px, 0.95vmin, 14px) clamp(8px, 1.2vmin, 16px)',
                  borderRadius: 'clamp(18px, 2.5vmin, 26px)',
                background: `linear-gradient(165deg, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.12) 45%, rgba(0,255,136,0.12) 100%)`,
                  border: 'max(2px, 0.25vmin) solid rgba(100, 210, 200, 0.42)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.08) inset, 0 24px 56px rgba(0,0,0,0.42), 0 0 40px rgba(0,255,200,0.08), 0 0 36px rgba(130,100,255,0.1)',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  className={
                    'public-display-splash-join-card__split' +
                    (splashHasHeroBranding && roomId
                      ? ' public-display-splash-join-card__split--triple'
                      : '') +
                    (splashHasHeroBranding && !roomId
                      ? ' public-display-splash-join-card__split--hero-pair'
                      : '')
                  }
                >
                  {roomId ? (
                    <div className="public-display-splash-join-card__scan">
                      <div className="public-display-splash-join-card__eyebrow">Phone or tablet</div>
                      <div
                        style={{
                          fontSize: 'clamp(1.92rem, min(5.6vmin, 4.75vh), 3.9rem)',
                          fontWeight: 900,
                          color: '#eafff8',
                          letterSpacing: '0.06em',
                          lineHeight: 1.2,
                        }}
                      >
                        Scan to join
                      </div>
                      <div className="public-display-splash-join-card__qr-wrap">
                        <img
                          alt="Join QR"
                          src={`${API_BASE || ''}/api/qr?size=960&data=${encodeURIComponent(playerJoinUrl)}`}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div
                    className={
                      'public-display-splash-join-card__manual' +
                      (!roomId ? ' public-display-splash-join-card__manual--solo' : '')
                    }
                    style={{ containerType: 'inline-size' }}
                  >
                    <div className="public-display-splash-join-card__eyebrow">
                      {roomId ? 'Web browser' : 'Join online'}
                    </div>
                    <div
                      style={{
                        fontSize: 'clamp(1.95rem, min(6.5vmin, 5.35vh), 4.4rem)',
                        fontWeight: 800,
                        color: 'rgba(230,240,255,0.94)',
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        lineHeight: 1.15,
                        width: '100%',
                        textAlign: 'center',
                      }}
                    >
                      OR
                    </div>
                    <div
                      style={{
                        width: '100%',
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 'clamp(8px, 1.4vmin, 14px)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 'clamp(1.78rem, min(5.4vmin, 4.75vh), 3.85rem)',
                          fontWeight: 700,
                          color: 'rgba(240,248,255,0.98)',
                          lineHeight: 1.2,
                          textAlign: 'center',
                        }}
                      >
                        Go to
                      </span>
                      <div
                        className="public-display-splash-join-url-scroller"
                        role="group"
                        aria-label="Join URL"
                        spellCheck={false}
                        data-gramm="false"
                        data-gramm_editor="false"
                        data-enable-grammarly="false"
                        style={{
                          width: '100%',
                          minWidth: 0,
                          alignSelf: 'stretch',
                          display: 'flex',
                          justifyContent: 'center',
                          overflowX: 'auto',
                          overflowY: 'hidden',
                          WebkitOverflowScrolling: 'touch',
                          paddingLeft: 'clamp(3px, 0.75vmin, 9px)',
                          paddingRight: 'clamp(3px, 0.75vmin, 9px)',
                          paddingBottom: 4,
                          scrollbarGutter: 'stable',
                          touchAction: 'pan-x',
                        }}
                      >
                        <span
                          spellCheck={false}
                          data-gramm="false"
                          data-gramm_editor="false"
                          data-enable-grammarly="false"
                          lang="en"
                          style={{
                            display: 'inline-block',
                            fontSize: 'clamp(1.05rem, calc(100cqw / 11.25), 3.25rem)',
                            fontWeight: 900,
                            lineHeight: 1.15,
                            textShadow: '0 8px 32px rgba(0,0,0,0.45), 0 0 40px rgba(180,210,255,0.12)',
                            color: '#f6faff',
                            letterSpacing: '0.03em',
                            whiteSpace: 'nowrap',
                            textDecoration: 'none',
                            textDecorationLine: 'none',
                            textUnderlineOffset: 0,
                            borderBottom: 'none',
                          }}
                        >
                          {PUBLIC_DISPLAY_JOIN_DOMAIN}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 'clamp(1.68rem, min(5.6vmin, 5vh), 3.85rem)',
                        fontWeight: 700,
                        opacity: 0.96,
                        letterSpacing: '0.02em',
                        color: 'rgba(230,240,255,0.98)',
                        lineHeight: 1.25,
                        marginTop: 0,
                        width: '100%',
                        textAlign: 'center',
                      }}
                    >
                      And enter room code
                    </div>
                    <div
                      className="public-display-splash-join-card__room-code"
                      style={{
                        fontSize: 'clamp(2.6rem, min(11vmin, 9.25vh), 6.85rem)',
                        fontWeight: 1000,
                        color: pdGlass.mint,
                        textShadow: '0 0 32px rgba(0,255,136,0.65), 0 0 40px rgba(139,92,246,0.4)',
                        lineHeight: 1,
                      }}
                    >
                      {roomInfo?.id || roomId || '—'}
                    </div>
                  </div>
                  {splashHasHeroBranding && venueBranding ? (
                    <div className="public-display-splash-join-card__logo-tile">
                      <PublicDisplayVenueBrandingHero
                        branding={venueBranding}
                        marginBottom="0"
                        fillSlot
                        logoTileOnly
                      />
                    </div>
                  ) : null}
                </div>
              </motion.div>
            </div>
            </div>
            </div>
            </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      
      
      {/* Confetti when winner banner shows (heavier for verified BINGO wins) */}
      <AnimatePresence>
        {showWinnerBanner && (
          <motion.div
            key="confetti"
            initial={{ opacity: 0 }}
            animate={{ opacity: winnerName.startsWith('🔄') ? 0.55 : 0.92 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2100 }}
          >
            {Array.from({ length: winnerName.startsWith('🔄') ? 48 : 110 }).map((_, i) => (
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
                  background: [pdGlass.mint, pdGlass.violet, pdGlass.snow, pdGlass.mint, pdGlass.violet][i % 5],
                  transform: `translateX(${Math.random() * 100}px)`
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Main Content - 16:10 Layout */}
      <div className="display-content">
        {/* Reveal toast: single instance (fixed) lives in AnimatePresence above */}
        {/* Two Column Layout: Left (pattern + info/winners), Right (call list) */}
        <div className="bottom-row">
          <div className="left-col">
            {/* Bingo Card Visualization (upper-left, fixed to ~25% viewport width) */}
            <motion.div 
              className="bingo-card-display public-pattern-panel"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <div className="bingo-card-header center public-pattern-header">
                <h2 className="pattern-title-text">
                  {roundHeaderLabel ? (
                    <span className="public-pattern-title__round">{`${roundHeaderLabel} -`}</span>
                  ) : null}
                  <span className="public-pattern-title__pattern">{patternHeaderLabel}</span>
                </h2>
                {pattern === 'custom' ? (
                  <div
                    className="composite-pattern-header-block public-custom-pattern-modifiers"
                    aria-label="Custom pattern modifiers"
                  >
                    <div className="composite-pattern-chips">
                      {customMatchReverse ? (
                        <span className="composite-pattern-chip composite-pattern-chip--c0">REVERSE</span>
                      ) : null}
                      {customMatchAllowRotation ? (
                        <span className="composite-pattern-chip composite-pattern-chip--c1">ROTATIONS</span>
                      ) : null}
                      {customMatchAllowMirror ? (
                        <span className="composite-pattern-chip composite-pattern-chip--c2">MIRRORS</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {currentRoundPrize ? (
                  <div className="public-round-prize-line" title={currentRoundPrize}>
                    {`Prize: ${currentRoundPrize}`}
                  </div>
                ) : null}
                {pattern === 'composite' && patternComposite && patternComposite.clauses.length > 0 && (
                  <div className="composite-pattern-header-block">
                    <div className="composite-pattern-and-or-hint" style={{ color: '#f5d061', textAlign: 'center' }}>
                      {patternComposite.op === 'and'
                        ? '✓ COMPLETE EVERY PART'
                        : '✓ COMPLETE ANY ONE PART'}
                    </div>
                    <div className="composite-pattern-chips">
                      {patternComposite.clauses.map((c, i) => (
                        <React.Fragment key={`${i}-${describeCompositeClauseBrief(c)}`}>
                          {i > 0 ? (
                            <span className="composite-pattern-op-pill" aria-hidden>
                              {patternComposite.op.toUpperCase()}
                            </span>
                          ) : null}
                          <span
                            className={`composite-pattern-chip composite-pattern-chip--c${i % COMPOSITE_CLAUSE_COLOR_SLOTS}`}
                            title={describeCompositeClauseAudience(c)}
                          >
                            {describeCompositeClauseBrief(c).toLocaleUpperCase()}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
                {pattern === 'composite' && compositeDemoSequences.length >= 2 && (
                  <div className="composite-pattern-spotlight-row" style={{ color: '#a8e6dc', textAlign: 'center' }}>
                    Spotlight:{' '}
                    <span style={{ color: '#ffffff', fontWeight: 800 }}>
                      {(
                        compositeDemoSequences[
                          compositePatternDemoIndex % compositeDemoSequences.length
                        ]?.label || ''
                      ).toLocaleUpperCase()}
                    </span>
                  </div>
                )}
                {showNowPlaying && gameState.currentSong && (
                  <div className="now-playing-banner" style={{ marginTop: 6, fontSize: '0.95rem' }}>
                    {currentIndexRef.current >= 0 && (
                      <span style={{ fontWeight: 800, color: '#00ff88', marginRight: 10 }}>
                        #{currentIndexRef.current + 1}
                      </span>
                    )}
                    Now Playing: {(() => {
                      const cid = gameState.currentSong!.id;
                      const ui = getCallSongRevealUi(cid);
                      if (ui.kind === 'plain') {
                        return (
                          <span>
                            <span>{gameState.currentSong!.name}</span>
                            {gameState.currentSong!.artist ? (
                              <>
                                {' — '}
                                <span>{gameState.currentSong!.artist}</span>
                              </>
                            ) : null}
                          </span>
                        );
                      }
                      if (ui.kind === 'playing_placeholder') {
                        return (
                          <span style={{ opacity: 0.92 }}>
                            <span style={{ fontWeight: 800, letterSpacing: '0.05em' }}>Playing…</span>
                            <span style={{ opacity: 0.72, marginLeft: 8 }}>(call reveals next)</span>
                          </span>
                        );
                      }
                      return (
                        <span>
                          {renderMaskedText(gameState.currentSong!.name, ui.revealedSet, revealToast)}
                          {' — '}
                          {renderMaskedText(gameState.currentSong!.artist || '', ui.revealedSet, revealToast)}
                        </span>
                      );
                    })()}
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
              {/* TEMPO balls moved here from under the QR so room code can own that slot */}
              <div
                className="public-pattern-panel__tempo-balls"
                style={{ flexShrink: 0, paddingTop: 6, paddingBottom: 2 }}
                aria-hidden
              >
                <PublicDisplayTempoBallRow seeds={ballAnimSeedsRef.current} variant="sidebar" />
              </div>
            </motion.div>
            {/* Under pattern: Info (stats + QR + room code) */}
            <div className="info-grid">
              <motion.div 
                className="quick-stats public-info-panel"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}
              >
                <div className="public-info-panel__row">
                  <div className="public-info-panel__stat">
                    <Users className="stat-icon" />
                    <div>
                      <div className="public-info-panel__value">{gameState.playerCount}</div>
                      <div className="public-info-panel__label">Players</div>
                    </div>
                  </div>
                  <div className="public-info-panel__stat">
                    <List className="stat-icon" />
                    <div>
                      <div className="public-info-panel__value">{totalPlayedCount}</div>
                      <div className="public-info-panel__label">Songs</div>
                    </div>
                  </div>
                  {gameState.currentRound && (
                    <div className="public-info-panel__stat">
                      <Crown className="stat-icon" />
                      <div>
                        <div className="public-info-panel__value">{gameState.currentRound.number}</div>
                        <div className="public-info-panel__label">Round</div>
                      </div>
                    </div>
                  )}
                </div>
                {/* QR below player/song counts */}
                {roomId && (
                  <div style={{ 
                    flex: 1,
                    textAlign: 'center', 
                    background: pdGlass.glassPanel, 
                    border: `1px solid ${pdGlass.borderViolet}`, 
                    borderRadius: 14, 
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
                      src={`${API_BASE || ''}/api/qr?size=960&data=${encodeURIComponent(playerJoinUrl)}`}
                    />
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#ddd', lineHeight: 1 }}>Scan to join</div>
                </div>
                )}
                {/* Room code under QR (former TEMPO logo slot) */}
                <div
                  className="public-info-panel__block public-info-panel__block--room"
                  style={{ flexShrink: 0, paddingBottom: 4 }}
                >
                  <div className="public-info-panel__label">Room Number:</div>
                  <div className="public-info-panel__value public-info-panel__value--room">
                    {roomInfo?.id || roomId}
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          <div className="call-col">
            {/* Tall Call List */}
            <motion.div 
              className="call-list-display"
              data-call-cols={5}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              {venueBranding?.logoUrl && !showSplash ? (
                <div className="public-display-venue-watermark" aria-hidden>
                  <img
                    src={venueBranding.logoUrl}
                    alt=""
                    decoding="async"
                    fetchPriority="low"
                  />
                </div>
              ) : null}
              <div
                className="call-list-display__body"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  flex: 1,
                  minHeight: 0,
                  position: 'relative',
                  zIndex: 2,
                }}
              >
              {/* Removed call count header and redundant BINGO row; playlist titles shown above columns */}
              {(() => {
                void playedOrderRevision;
                // CRITICAL FIX: Use ref as fallback if state isn't set yet (fixes first song not displaying)
                // Check both state and ref to ensure rendering works even when columns are still loading
                const poolIds = oneBy75Ids ?? oneBy75IdsRef.current;
                const hasPool = poolHasTracks(poolIds);
                const played = playedOrderForDisplay;
                if (hasPool) {
                  if (usePlayOrderCallLayout) {
                    return renderOneBy75GroupedColumns();
                  }
                  if (columnCallListLayout) {
                    const columnView = renderOneBy75Columns();
                    if (columnView != null) return columnView;
                  }
                  return renderOneBy75GroupedColumns();
                }

                if (played.length > 0 && columnCallListLayout) {
                  return renderSimplePlayedCallList({ withPlaylistHeaders: true });
                }

                if (playedOrderForDisplay.length > 0) {
                  return renderSimplePlayedCallList();
                }

                // Pre-game: playlist loaded, no songs yet — headers + empty five-column grid.
                const trimmedPlaylistCount = playlistNames.filter((n) => String(n || '').trim()).length;
                if (trimmedPlaylistCount > 0 && played.length === 0) {
                  const headerLayout =
                    trimmedPlaylistCount <= 1 && !columnCallListLayout ? '1x75' : '5x15';
                  return (
                    <div className="call-list-content">
                      {renderPlaylistNamesHeaderRow(headerLayout)}
                      <div
                        className="call-carousel-viewport call-carousel-viewport--static-grid"
                        style={{
                          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                          flex: 1,
                          minHeight: 0,
                        }}
                      >
                        {[0, 1, 2, 3, 4].map((ci) => (
                          <div key={ci} className="call-carousel-col-static" style={{ minHeight: 0 }} aria-hidden />
                        ))}
                      </div>
                    </div>
                  );
                }
                
                // FALLBACK: Construct 1x75 schema from played songs
                // CRITICAL FIX: Prefer oneBy75IdsRef.current if available (has full 75-song pool)
                // Only build from playedOrderRef if ref doesn't have the pool
                let fallbackIds: string[] = [];
                
                if (oneBy75IdsRef.current && oneBy75IdsRef.current.length >= 75) {
                  // Use the full pool from ref (preferred - has all 75 songs)
                  fallbackIds = [...oneBy75IdsRef.current];
                  console.log(`🔄 Using oneBy75IdsRef.current for fallback (${fallbackIds.length} songs)`);
                } else if (playedOrderForDisplay.length > 0) {
                  playedOrderForDisplay.forEach((songId) => {
                    if (songId && !fallbackIds.includes(songId)) {
                      fallbackIds.push(songId);
                    }
                  });
                  console.log(`⚠️ Fallback: Built from played order (${fallbackIds.length} songs) — pool may be incomplete`);
                }
                
                // Pad to 75 if we have fewer songs (for proper grouping)
                // Fill remaining slots with placeholder IDs that won't render
                while (fallbackIds.length < 75) {
                  fallbackIds.push(`__placeholder_${fallbackIds.length}__`);
                }
                
                // Ensure metadata is set for played songs
                // Use playedOrderRef to get all songs, then look up metadata from idMetaRef or gameState
                if (playedOrderForDisplay.length > 0) {
                  playedOrderForDisplay.forEach((songId, idx) => {
                    // Metadata should already be in idMetaRef from room-state or song-playing events
                    if (!idMetaRef.current[songId]) {
                      // Fallback: try to get from gameState.playedSongs
                      const song = gameState.playedSongs.find(s => s.id === songId);
                      if (song && song.name) {
                        idMetaRef.current[songId] = {
                          name: cleanSongTitle(song.name),
                          artist: song.artist || ''
                        };
                      }
                    }
                    // Set currentIndexRef to track how many songs have been played
                    currentIndexRef.current = idx;
                  });
                } else if (gameState.playedSongs && gameState.playedSongs.length > 0) {
                  // Fallback to gameState.playedSongs if playedOrderRef is empty
                  gameState.playedSongs.forEach((song, idx) => {
                    if (song.id && song.name) {
                      idMetaRef.current[song.id] = {
                        name: cleanSongTitle(song.name),
                        artist: song.artist || ''
                      };
                      currentIndexRef.current = idx;
                    }
                  });
                }
                
                // Temporarily override the ref so renderOneBy75GroupedColumns can use it
                const originalIds = oneBy75IdsRef.current;
                const originalIndex = currentIndexRef.current;
                oneBy75IdsRef.current = fallbackIds;
                // Set currentIndexRef to the number of real songs (not placeholders)
                currentIndexRef.current = Math.min(fallbackIds.filter(id => !id.startsWith('__placeholder_')).length - 1, 74);
                
                try {
                  // Use the 1x75 grouped columns renderer as fallback
                  const result = renderOneBy75GroupedColumns();
                  // Restore original refs
                  oneBy75IdsRef.current = originalIds;
                  currentIndexRef.current = originalIndex;
                  return result || (
                    <div className="call-list-content" style={{ height: '100%' }}>
                      <div className="no-calls">
                        <p>No songs played yet</p>
                      </div>
                    </div>
                  );
                } catch (e) {
                  // If rendering fails, restore refs and show simple fallback
                  oneBy75IdsRef.current = originalIds;
                  currentIndexRef.current = originalIndex;
                  console.warn('Fallback render failed:', e);
                  return (
                    <div className="call-list-content" style={{ height: '100%' }}>
                      <div className="no-calls">
                        <p>Initializing display...</p>
                      </div>
                    </div>
                  );
                }
              })()}
              </div>
            </motion.div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicDisplay; 