import React, { useState, useEffect, useCallback } from 'react';
import './RoundPlanner.css';
import type { BingoPattern, PatternCompositeSpec, SavedCustomPattern } from '../patternDefinitions';
import RoundBucketSettings, { type RoundBucketBingoPatch } from './RoundBucketSettings';
import RoundBuilderPlaybackPanel from './RoundBuilderPlaybackPanel';
import RoundBuilderPrepHints from './RoundBuilderPrepHints';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eraser,
  GripVertical,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
  Music,
} from 'lucide-react';
import {
  bingoColumnLetterForPlaylistName,
  remapIndexAfterMove,
} from '../utils/bingoColumnOrder';
import {
  applyPlaylistIdOrder,
  sortRoundPlaylistsByBingoColumns,
} from '../utils/roundPlaylistOrder';

export type RoundUpdateMeta = {
  reorder?: { from: number; to: number };
};

const CHIP_REORDER_MIME = 'application/x-got-round-chip-index';

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  youtubeMusic?: boolean;
}

export interface RoundPlannerRound {
  id: string;
  name: string;
  playlistIds: string[];
  playlistNames: string[];
  songCount: number;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  startedAt?: number;
  completedAt?: number;
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  patternComposite?: PatternCompositeSpec;
  freeSpaceEnabled?: boolean;
  customMatchAllowRotation?: boolean;
  customMatchAllowMirror?: boolean;
  linesRequired?: number;
  savedMixSnapshot?: {
    savedAt: number;
    songs: readonly unknown[];
    mixGeometry: string;
    snippetLength?: number;
    randomStarts?: 'none' | 'early' | 'random';
  };
}

interface RoundPlannerProps<TRound extends RoundPlannerRound = RoundPlannerRound> {
  rounds: TRound[];
  onUpdateRounds: (rounds: TRound[], meta?: RoundUpdateMeta) => void;
  playlists: Playlist[];
  currentRound: number;
  onStartRound: (roundIndex: number) => void;
  onSelectRoundForPrep?: (roundIndex: number) => void;
  /** Playlist-only sync for the current prep round (avoids resetting pattern/playback). */
  onSyncMixFromRound?: (roundIndex: number) => void;
  onOpenConnection?: () => void;
  gameState: 'waiting' | 'playing' | 'ended';
  hostDefaultFreeSpace: boolean;
  savedCustomPatterns: SavedCustomPattern[];
  onUpdateRoundBingo: (roundIndex: number, patch: RoundBucketBingoPatch) => void;
  onSaveRound?: (roundIndex: number) => void;
  saveRoundBusy?: boolean;
  snapshotMeetsSave: (round: TRound) => boolean;
  onPrintPdf?: (roundIndex: number) => void;
  onCallSheet?: (roundIndex: number) => void;
  onOpenComposite?: (roundIndex: number) => void;
  onNewCustomPattern?: () => void;
  printablePdfLoading?: boolean;
  printableCardCount: number;
  onPrintableCardCountChange: (n: number) => void;
  snippetLength: number;
  onSnippetLengthChange: (seconds: number) => void;
  randomStarts: 'none' | 'early' | 'random';
  onRandomStartsChange: (mode: 'none' | 'early' | 'random') => void;
  prepHints?: {
    spotifyNeeded: boolean;
    spotifyConnected: boolean;
    deviceNeeded: boolean;
    deviceSelected: boolean;
  };
  initialFocusedIndex?: number;
  statusSummary?: { completed: number; active: number; planned: number; unplanned: number };
  onResetEvent?: () => void;
  onClearPrepCache?: () => void;
  onCompleteCurrentRound?: () => void;
  onResetCurrentRound?: () => void;
  onStartNextPlanned?: () => void;
  hasNextPlanned?: boolean;
}

const MAX_ROUND_BUCKETS = 12;

function RoundPlanner<TRound extends RoundPlannerRound>({
  rounds,
  onUpdateRounds,
  playlists,
  currentRound,
  onStartRound,
  onSelectRoundForPrep,
  onSyncMixFromRound,
  onOpenConnection,
  gameState,
  hostDefaultFreeSpace,
  savedCustomPatterns,
  onUpdateRoundBingo,
  onSaveRound,
  saveRoundBusy,
  snapshotMeetsSave,
  onPrintPdf,
  onCallSheet,
  onOpenComposite,
  onNewCustomPattern,
  printablePdfLoading,
  printableCardCount,
  onPrintableCardCountChange,
  snippetLength,
  onSnippetLengthChange,
  randomStarts,
  onRandomStartsChange,
  prepHints,
  initialFocusedIndex = 0,
  statusSummary,
  onResetEvent,
  onClearPrepCache,
  onCompleteCurrentRound,
  onResetCurrentRound,
  onStartNextPlanned,
  hasNextPlanned,
}: RoundPlannerProps<TRound>) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [dragOverBucket, setDragOverBucket] = useState(false);
  const [dragChipIndex, setDragChipIndex] = useState<number | null>(null);
  const [dropChipIndex, setDropChipIndex] = useState<number | null>(null);
  const onSelectRoundForPrepRef = React.useRef(onSelectRoundForPrep);
  onSelectRoundForPrepRef.current = onSelectRoundForPrep;
  const onSyncMixFromRoundRef = React.useRef(onSyncMixFromRound);
  onSyncMixFromRoundRef.current = onSyncMixFromRound;
  const lastModalFocusRef = React.useRef<number | null>(null);

  const loadPrepForRound = useCallback(
    (roundIndex: number) => {
      if (gameState === 'playing' || !onSelectRoundForPrepRef.current) return;
      const round = rounds[roundIndex];
      if (!round || !(round.playlistIds || []).length) return;
      onSelectRoundForPrepRef.current(roundIndex);
    },
    [gameState, rounds],
  );

  const syncMixIfPrepRound = useCallback(
    (roundIndex: number) => {
      if (gameState === 'playing') return;
      const round = rounds[roundIndex];
      if (!round || !(round.playlistIds || []).length) return;
      if (roundIndex === currentRound && onSyncMixFromRoundRef.current) {
        onSyncMixFromRoundRef.current(roundIndex);
        return;
      }
      loadPrepForRound(roundIndex);
    },
    [gameState, currentRound, loadPrepForRound, rounds],
  );

  const selectRound = useCallback(
    (roundIndex: number) => {
      const clamped = Math.min(Math.max(0, roundIndex), Math.max(0, rounds.length - 1));
      setFocusedIndex(clamped);
      loadPrepForRound(clamped);
    },
    [loadPrepForRound, rounds.length],
  );

  useEffect(() => {
    const next = Math.min(Math.max(0, initialFocusedIndex), Math.max(0, rounds.length - 1));
    setFocusedIndex(next);
    if (lastModalFocusRef.current !== initialFocusedIndex) {
      lastModalFocusRef.current = initialFocusedIndex;
      loadPrepForRound(next);
    }
  }, [initialFocusedIndex, loadPrepForRound, rounds.length]);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(0, rounds.length - 1)));
  }, [rounds.length]);

  const ensureSequentialNumbering = (roundsToNumber: TRound[]) =>
    roundsToNumber.map((round, index) => ({
      ...round,
      name: `Round ${index + 1}`,
    }));

  useEffect(() => {
    const hasInconsistentNumbering = rounds.some((round, index) => round.name !== `Round ${index + 1}`);
    if (hasInconsistentNumbering) {
      onUpdateRounds(ensureSequentialNumbering(rounds));
    }
  }, [rounds, onUpdateRounds]);

  const addRound = () => {
    if (rounds.length >= MAX_ROUND_BUCKETS) return;
    const newRound = {
      id: `round-${Date.now()}`,
      name: `Round ${rounds.length + 1}`,
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned',
      bingoPattern: 'line' as BingoPattern,
    } as unknown as TRound;
    const updated = ensureSequentialNumbering([...rounds, newRound]);
    onUpdateRounds(updated);
    setFocusedIndex(updated.length - 1);
    // New bucket is empty — prep loads when playlists are added
  };

  const removeRound = (index: number) => {
    if (rounds.length <= 1) return;
    const updated = ensureSequentialNumbering(rounds.filter((_, i) => i !== index));
    onUpdateRounds(updated);
    setFocusedIndex((i) => Math.min(i, updated.length - 1));
  };

  const moveRound = (fromIndex: number, toIndex: number) => {
    if (gameState === 'playing') return;
    if (fromIndex < 0 || fromIndex >= rounds.length) return;
    if (toIndex < 0 || toIndex >= rounds.length) return;
    if (fromIndex === toIndex) return;
    const next = [...rounds];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    onUpdateRounds(ensureSequentialNumbering(next), { reorder: { from: fromIndex, to: toIndex } });
    setFocusedIndex((i) => remapIndexAfterMove(i, fromIndex, toIndex));
  };

  const setRoundPlaylistOrder = (roundIndex: number, orderedIds: string[]) => {
    const newRounds = [...rounds];
    const round = newRounds[roundIndex];
    if (!round) return;
    newRounds[roundIndex] = applyPlaylistIdOrder(round, orderedIds, playlists);
    onUpdateRounds(newRounds);
    if (roundIndex === focusedIndex) syncMixIfPrepRound(roundIndex);
  };

  const reorderPlaylistInRound = (roundIndex: number, fromIndex: number, toIndex: number) => {
    const round = rounds[roundIndex];
    if (!round) return;
    const ids = [...(round.playlistIds || [])];
    if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length) return;
    if (fromIndex === toIndex) return;
    const [id] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, id);
    setRoundPlaylistOrder(roundIndex, ids);
  };

  const sortFocusedRoundPlaylistsBingo = () => {
    const newRounds = [...rounds];
    const round = newRounds[focusedIndex];
    if (!round) return;
    newRounds[focusedIndex] = sortRoundPlaylistsByBingoColumns(round, playlists);
    onUpdateRounds(newRounds);
    syncMixIfPrepRound(focusedIndex);
  };

  const addPlaylistToRound = (roundIndex: number, playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    const newRounds = [...rounds];
    const round = newRounds[roundIndex];
    if (round.playlistIds.includes(playlistId)) return;
    let updated = {
      ...round,
      playlistIds: [...round.playlistIds, playlist.id],
      playlistNames: [...round.playlistNames, playlist.name],
      songCount: round.songCount + playlist.tracks,
      status: round.status === 'unplanned' ? 'planned' : round.status,
    } as TRound;
    updated = sortRoundPlaylistsByBingoColumns(updated, playlists);
    newRounds[roundIndex] = updated;
    onUpdateRounds(newRounds);
    if (roundIndex === focusedIndex) syncMixIfPrepRound(roundIndex);
  };

  const removePlaylistFromRound = (roundIndex: number, playlistId: string) => {
    const newRounds = [...rounds];
    const round = newRounds[roundIndex];
    const playlistIndex = round.playlistIds.indexOf(playlistId);
    if (playlistIndex === -1) return;
    const playlist = playlists.find((p) => p.id === playlistId);
    const playlistTracks = playlist?.tracks || 0;
    newRounds[roundIndex] = {
      ...round,
      playlistIds: round.playlistIds.filter((id) => id !== playlistId),
      playlistNames: round.playlistNames.filter((_, i) => i !== playlistIndex),
      songCount: Math.max(0, round.songCount - playlistTracks),
      status: round.playlistIds.length === 1 ? 'unplanned' : round.status,
    };
    onUpdateRounds(newRounds);
    if (roundIndex === focusedIndex) syncMixIfPrepRound(roundIndex);
  };

  const handleBucketDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverBucket(true);
  };

  const handleBucketDragLeave = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { clientX: x, clientY: y } = e;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverBucket(false);
    }
  };

  const handleBucketDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const chipFromRaw = e.dataTransfer.getData(CHIP_REORDER_MIME);
    if (chipFromRaw !== '') {
      const from = Number(chipFromRaw);
      const to = dropChipIndex ?? from;
      if (Number.isFinite(from) && focusedIndex >= 0) {
        reorderPlaylistInRound(focusedIndex, from, to);
      }
    } else {
      const playlistId = e.dataTransfer.getData('text/plain');
      if (playlistId && focusedIndex >= 0 && focusedIndex < rounds.length) {
        addPlaylistToRound(focusedIndex, playlistId);
      }
    }
    setDragOverBucket(false);
    setDragChipIndex(null);
    setDropChipIndex(null);
  };

  const canStartRound = (round: TRound) =>
    (round.playlistIds || []).length > 0 && round.status !== 'completed';

  const focused =
    focusedIndex >= 0 && focusedIndex < rounds.length ? rounds[focusedIndex] : null;

  if (!focused) {
    return (
      <div className="round-planner">
        <p className="round-planner__empty">No rounds yet.</p>
        <button type="button" className="round-planner-add" onClick={addRound}>
          <Plus className="w-4 h-4" aria-hidden />
          Add round
        </button>
      </div>
    );
  }

  const index = focusedIndex;
  const isLive = index === currentRound && gameState === 'playing';
  const isMixTarget = index === currentRound && gameState !== 'playing';
  const minRequired = focused.songCount >= 60 ? 75 : 15;
  const isInsufficient = focused.songCount > 0 && focused.songCount < minRequired;
  const playlistIds = focused.playlistIds || [];

  return (
    <div className="round-planner">
      <div className="round-planner__picker" role="tablist" aria-label="Select round bucket">
        {rounds.slice(0, MAX_ROUND_BUCKETS).map((round, i) => {
          const hasPl = (round.playlistIds || []).length > 0;
          const saved = snapshotMeetsSave(round);
          const isPrepMix = i === currentRound && gameState !== 'playing' && hasPl;
          let cls = 'round-planner__picker-btn';
          if (i === focusedIndex) cls += ' round-planner__picker-btn--active';
          if (isPrepMix) cls += ' round-planner__picker-btn--mix';
          if (round.status === 'completed') cls += ' round-planner__picker-btn--done';
          else if (saved) cls += ' round-planner__picker-btn--saved';
          else if (hasPl) cls += ' round-planner__picker-btn--ready';
          return (
            <button
              key={round.id}
              type="button"
              role="tab"
              aria-selected={i === focusedIndex}
              className={cls}
              onClick={() => selectRound(i)}
              title={isPrepMix ? `${round.name} — synced to Game tab mix` : round.name}
            >
              {i + 1}
            </button>
          );
        })}
        {rounds.length < MAX_ROUND_BUCKETS ? (
          <button
            type="button"
            className="round-planner__picker-btn round-planner__picker-btn--add"
            onClick={addRound}
            title="Add round"
            aria-label="Add round"
          >
            <Plus className="w-4 h-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="round-planner__picker-nav">
        <button
          type="button"
          className="round-planner__picker-arrow"
          disabled={focusedIndex <= 0}
          aria-label="Previous round"
          onClick={() => selectRound(focusedIndex - 1)}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden />
        </button>
        <span className="round-planner__picker-label">
          {focused.name}
          {isLive ? <span className="round-planner-badge round-planner-badge--active">Live</span> : null}
          {isMixTarget ? <span className="round-planner-badge round-planner-badge--prep">Mix</span> : null}
          {focused.status === 'completed' ? (
            <span className="round-planner-badge round-planner-badge--done">Done</span>
          ) : null}
        </span>
        <button
          type="button"
          className="round-planner__picker-arrow"
          disabled={focusedIndex >= rounds.length - 1}
          aria-label="Next round"
          onClick={() => selectRound(focusedIndex + 1)}
        >
          <ChevronRight className="w-4 h-4" aria-hidden />
        </button>
      </div>
      {gameState !== 'playing' && rounds.length > 1 ? (
        <div className="round-planner__round-order">
          <span className="round-planner__round-order-label">Round order</span>
          <button
            type="button"
            className="round-planner-btn round-planner-btn--ghost"
            disabled={focusedIndex <= 0}
            aria-label="Move this round earlier in the event"
            title="Move round earlier"
            onClick={() => moveRound(focusedIndex, focusedIndex - 1)}
          >
            <ArrowUp className="w-3 h-3" aria-hidden />
            Earlier
          </button>
          <button
            type="button"
            className="round-planner-btn round-planner-btn--ghost"
            disabled={focusedIndex >= rounds.length - 1}
            aria-label="Move this round later in the event"
            title="Move round later"
            onClick={() => moveRound(focusedIndex, focusedIndex + 1)}
          >
            <ArrowDown className="w-3 h-3" aria-hidden />
            Later
          </button>
        </div>
      ) : null}

      {statusSummary ? (
        <div className="round-planner__stats" aria-label="Event overview">
          <span className="round-planner__stat round-planner__stat--done">{statusSummary.completed} done</span>
          <span className="round-planner__stat round-planner__stat--active">{statusSummary.active} live</span>
          <span className="round-planner__stat">{statusSummary.planned} planned</span>
          <span className="round-planner__stat round-planner__stat--muted">{statusSummary.unplanned} empty</span>
        </div>
      ) : null}

      {prepHints ? (
        <RoundBuilderPrepHints
          spotifyNeeded={prepHints.spotifyNeeded}
          spotifyConnected={prepHints.spotifyConnected}
          deviceNeeded={prepHints.deviceNeeded}
          deviceSelected={prepHints.deviceSelected}
          onOpenConnection={onOpenConnection}
        />
      ) : null}

      {onResetEvent || onClearPrepCache || onCompleteCurrentRound ? (
        <section className="round-planner__event-actions" aria-labelledby="round-planner-event-actions-title">
          <h4 id="round-planner-event-actions-title" className="round-planner__event-actions-title">
            Event actions
          </h4>
          <div className="round-planner__event-actions-row">
            {gameState === 'playing' && onCompleteCurrentRound ? (
              <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onCompleteCurrentRound}>
                <CheckCircle2 className="w-3 h-3" aria-hidden />
                Complete round
              </button>
            ) : null}
            {gameState === 'playing' && onResetCurrentRound ? (
              <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onResetCurrentRound}>
                <RotateCcw className="w-3 h-3" aria-hidden />
                Reset round
              </button>
            ) : null}
            {hasNextPlanned && onStartNextPlanned ? (
              <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onStartNextPlanned}>
                <SkipForward className="w-3 h-3" aria-hidden />
                Next planned
              </button>
            ) : null}
            {onResetEvent ? (
              <button type="button" className="round-planner-btn round-planner-btn--danger" onClick={onResetEvent}>
                <Trash2 className="w-3 h-3" aria-hidden />
                Reset event
              </button>
            ) : null}
            {onClearPrepCache ? (
              <button type="button" className="round-planner-btn round-planner-btn--ghost" onClick={onClearPrepCache}>
                <Eraser className="w-3 h-3" aria-hidden />
                Clear prep cache
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="round-planner__main">
      <label className="round-planner__cards-pdf">
        Cards per PDF
        <input
          type="number"
          min={1}
          max={200}
          value={printableCardCount}
          disabled={printablePdfLoading}
          onChange={(e) => onPrintableCardCountChange(Number(e.target.value))}
        />
      </label>

      <div
        id="round-planner-buckets"
        className={`round-planner-bucket round-planner-bucket--focused${
          isLive ? ' is-active' : ''
        }${dragOverBucket ? ' is-drag-over' : ''}${isInsufficient ? ' is-warn' : ''}`}
        onDragOver={handleBucketDragOver}
        onDragLeave={handleBucketDragLeave}
        onDrop={handleBucketDrop}
      >
        <RoundBucketSettings
          round={focused}
          roundIndex={index}
          hostDefaultFreeSpace={hostDefaultFreeSpace}
          savedCustomPatterns={savedCustomPatterns}
          onUpdateBingo={onUpdateRoundBingo}
          onSaveRound={onSaveRound ? () => onSaveRound(index) : undefined}
          saveRoundBusy={saveRoundBusy}
          snapshotReady={snapshotMeetsSave(focused)}
          printablePdfLoading={printablePdfLoading}
          callSheetReady={snapshotMeetsSave(focused)}
          onPrintPdf={onPrintPdf ? () => onPrintPdf(index) : undefined}
          onCallSheet={onCallSheet ? () => onCallSheet(index) : undefined}
          onOpenComposite={onOpenComposite ? () => onOpenComposite(index) : undefined}
          onNewCustomPattern={onNewCustomPattern}
        />

        <div className="round-planner-bucket__drop">
          {playlistIds.length >= 2 && !isLive && focused.status !== 'completed' ? (
            <div className="round-planner-bucket__playlist-tools">
              <p className="round-planner-bucket__playlist-tools-hint">
                Top = <strong>B</strong> column, then <strong>I N G O</strong> in 5×15. Drag stems or sort below.
              </p>
              <button
                type="button"
                className="round-planner-btn round-planner-btn--ghost"
                onClick={sortFocusedRoundPlaylistsBingo}
              >
                Sort B–O
              </button>
            </div>
          ) : null}
          {playlistIds.length === 0 ? (
            <div className={`round-planner-bucket__empty${dragOverBucket ? ' is-drag-over' : ''}`}>
              <Music className="w-4 h-4" aria-hidden />
              <span className="round-planner-bucket__empty-title">
                {dragOverBucket ? 'Drop to add' : 'Empty'}
              </span>
              <span>Drag from library or use Add to round</span>
            </div>
          ) : (
            <div className="round-planner-bucket__chips">
              {playlistIds.map((playlistId, chipIndex) => {
                const playlist = playlists.find((p) => p.id === playlistId);
                if (!playlist) return null;
                const cleanName = playlist.name.replace(/^\s*GoT\s*[-–:]*\s*/i, '').trim();
                const colLetter = bingoColumnLetterForPlaylistName(playlist.name);
                const canEditChips = !isLive && focused.status !== 'completed';
                const isDropTarget = dropChipIndex === chipIndex && dragChipIndex !== null;
                return (
                  <div
                    key={playlistId}
                    className={`round-planner-chip${isDropTarget ? ' round-planner-chip--drop-target' : ''}${
                      dragChipIndex === chipIndex ? ' round-planner-chip--dragging' : ''
                    }`}
                    draggable={canEditChips}
                    onDragStart={(e) => {
                      if (!canEditChips) return;
                      e.dataTransfer.setData('text/plain', playlistId);
                      e.dataTransfer.setData(CHIP_REORDER_MIME, String(chipIndex));
                      e.dataTransfer.effectAllowed = 'move';
                      setDragChipIndex(chipIndex);
                    }}
                    onDragEnd={() => {
                      setDragChipIndex(null);
                      setDropChipIndex(null);
                    }}
                    onDragOver={(e) => {
                      if (!canEditChips || dragChipIndex === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropChipIndex(chipIndex);
                    }}
                    onDragLeave={() => {
                      setDropChipIndex((cur) => (cur === chipIndex ? null : cur));
                    }}
                    onDrop={(e) => {
                      if (!canEditChips) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const fromRaw = e.dataTransfer.getData(CHIP_REORDER_MIME);
                      const from = Number(fromRaw);
                      if (Number.isFinite(from)) {
                        reorderPlaylistInRound(index, from, chipIndex);
                      }
                      setDragChipIndex(null);
                      setDropChipIndex(null);
                    }}
                  >
                    {canEditChips ? (
                      <GripVertical className="round-planner-chip__grip" aria-hidden />
                    ) : null}
                    {colLetter ? (
                      <span className="round-planner-chip__col" title={`${colLetter} column (5×15)`}>
                        {colLetter}
                      </span>
                    ) : null}
                    <span className="round-planner-chip__name" title={cleanName}>
                      {cleanName}
                    </span>
                    {canEditChips ? (
                      <button
                        type="button"
                        className="round-planner-chip__remove"
                        onClick={() => removePlaylistFromRound(index, playlistId)}
                        aria-label={`Remove ${cleanName}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {dragOverBucket ? (
                <div className="round-planner-bucket__drop-hint">
                  <Plus className="w-3 h-3" aria-hidden />
                  Drop to add
                </div>
              ) : null}
            </div>
          )}
        </div>

        {focused.songCount > 0 ? (
          <div className="round-planner-bucket__meta">
            {playlistIds.length} playlist{playlistIds.length !== 1 ? 's' : ''} · {focused.songCount} songs
            {isInsufficient ? (
              <span className="round-planner-bucket__meta-warn"> · need {minRequired - focused.songCount} more</span>
            ) : focused.songCount >= minRequired ? (
              <span className="round-planner-bucket__meta-ok"> · ready</span>
            ) : null}
          </div>
        ) : null}

        <div className="round-planner-bucket__actions">
          {!isLive && focused.status !== 'completed' && canStartRound(focused) ? (
            <button
              type="button"
              className="round-planner-btn round-planner-btn--grow round-planner-btn--start"
              onClick={() => onStartRound(index)}
            >
              <Play className="w-3 h-3" aria-hidden />
              Start round
            </button>
          ) : null}
          {rounds.length > 1 && focused.status !== 'active' ? (
            <button
              type="button"
              className="round-planner-btn round-planner-btn--icon"
              onClick={() => removeRound(index)}
              aria-label={`Remove ${focused.name}`}
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <RoundBuilderPlaybackPanel
        snippetLength={snippetLength}
        onSnippetLengthChange={onSnippetLengthChange}
        randomStarts={randomStarts}
        onRandomStartsChange={onRandomStartsChange}
      />
      </div>
    </div>
  );
}

export default RoundPlanner;
