import React, { useState, useEffect } from 'react';
import './RoundPlanner.css';
import type { BingoPattern, PatternCompositeSpec, SavedCustomPattern } from '../patternDefinitions';
import RoundBucketSettings, { type RoundBucketBingoPatch } from './RoundBucketSettings';
import RoundBuilderPlaybackPanel from './RoundBuilderPlaybackPanel';
import RoundBuilderPrepHints from './RoundBuilderPrepHints';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
  Music,
} from 'lucide-react';

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
  onUpdateRounds: (rounds: TRound[]) => void;
  playlists: Playlist[];
  currentRound: number;
  onStartRound: (roundIndex: number) => void;
  onSelectRoundForPrep?: (roundIndex: number) => void;
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

  useEffect(() => {
    const next = Math.min(Math.max(0, initialFocusedIndex), Math.max(0, rounds.length - 1));
    setFocusedIndex(next);
  }, [initialFocusedIndex, rounds.length]);

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
  };

  const removeRound = (index: number) => {
    if (rounds.length <= 1) return;
    const updated = ensureSequentialNumbering(rounds.filter((_, i) => i !== index));
    onUpdateRounds(updated);
    setFocusedIndex((i) => Math.min(i, updated.length - 1));
  };

  const addPlaylistToRound = (roundIndex: number, playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    const newRounds = [...rounds];
    const round = newRounds[roundIndex];
    if (round.playlistIds.includes(playlistId)) return;
    newRounds[roundIndex] = {
      ...round,
      playlistIds: [...round.playlistIds, playlist.id],
      playlistNames: [...round.playlistNames, playlist.name],
      songCount: round.songCount + playlist.tracks,
      status: round.status === 'unplanned' ? 'planned' : round.status,
    };
    onUpdateRounds(newRounds);
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
    const playlistId = e.dataTransfer.getData('text/plain');
    if (playlistId && focusedIndex >= 0 && focusedIndex < rounds.length) {
      addPlaylistToRound(focusedIndex, playlistId);
    }
    setDragOverBucket(false);
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
          let cls = 'round-planner__picker-btn';
          if (i === focusedIndex) cls += ' round-planner__picker-btn--active';
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
              onClick={() => setFocusedIndex(i)}
              title={round.name}
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
          onClick={() => setFocusedIndex((i) => Math.max(0, i - 1))}
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
          onClick={() => setFocusedIndex((i) => Math.min(rounds.length - 1, i + 1))}
        >
          <ChevronRight className="w-4 h-4" aria-hidden />
        </button>
      </div>

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
        />
      ) : null}

      {onResetEvent || onClearPrepCache || onCompleteCurrentRound ? (
        <details className="round-planner__event-actions">
          <summary>Event actions</summary>
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
        </details>
      ) : null}

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
              {playlistIds.map((playlistId) => {
                const playlist = playlists.find((p) => p.id === playlistId);
                if (!playlist) return null;
                const cleanName = playlist.name.replace(/^\s*GoT\s*[-–:]*\s*/i, '').trim();
                return (
                  <div key={playlistId} className="round-planner-chip">
                    <span className="round-planner-chip__name" title={cleanName}>
                      {cleanName}
                    </span>
                    {!isLive && focused.status !== 'completed' ? (
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
          {onSelectRoundForPrep && gameState !== 'playing' && playlistIds.length > 0 ? (
            <button
              type="button"
              className="round-planner-btn round-planner-btn--grow round-planner-btn--prep"
              onClick={() => onSelectRoundForPrep(index)}
            >
              Load for prep
            </button>
          ) : null}
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
  );
}

export default RoundPlanner;
