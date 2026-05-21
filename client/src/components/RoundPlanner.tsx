import React, { useState, useEffect } from 'react';
import './RoundPlanner.css';
import type { BingoPattern, PatternCompositeSpec, SavedCustomPattern } from '../patternDefinitions';
import RoundBucketSettings, { type RoundBucketBingoPatch } from './RoundBucketSettings';
import RoundBuilderPlaybackPanel from './RoundBuilderPlaybackPanel';
import RoundBuilderPrepHints from './RoundBuilderPrepHints';
import {
  ChevronDown,
  ChevronUp,
  Play,
  CheckCircle,
  Circle,
  Plus,
  Trash2,
  Music,
  Folder
} from 'lucide-react';

interface Playlist {
  id: string;
  name: string;
  tracks: number;
  description?: string;
  /** Present when row comes from YouTube Music merge (drag/drop resolution). */
  youtubeMusic?: boolean;
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
  bingoPattern?: BingoPattern;
  customPatternMask?: string[];
  patternComposite?: PatternCompositeSpec;
  freeSpaceEnabled?: boolean;
}

interface RoundPlannerProps {
  rounds: EventRound[];
  onUpdateRounds: (rounds: EventRound[]) => void;
  playlists: Playlist[];
  currentRound: number;
  onStartRound: (roundIndex: number) => void;
  /** Sync this round's playlists into the host mix + pattern/snippet UI without starting the live game */
  onSelectRoundForPrep?: (roundIndex: number) => void;
  gameState: 'waiting' | 'playing' | 'ended';
  hostDefaultFreeSpace: boolean;
  savedCustomPatterns: SavedCustomPattern[];
  onUpdateRoundBingo: (roundIndex: number, patch: RoundBucketBingoPatch) => void;
  onSaveRound?: (roundIndex: number) => void;
  saveRoundBusy?: boolean;
  snapshotMeetsSave: (round: EventRound) => boolean;
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
}

/**
 * Max round buckets in the planner. This is a UI cap so the grid stays manageable;
 * game logic stores rounds as an array and does not require exactly 6.
 */
const MAX_ROUND_BUCKETS = 12;

const RoundPlanner: React.FC<RoundPlannerProps> = ({
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
  snippetLength,
  onSnippetLengthChange,
  randomStarts,
  onRandomStartsChange,
  prepHints,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [dragOverBucket, setDragOverBucket] = useState<number | null>(null);

  const ensureSequentialNumbering = (roundsToNumber: EventRound[]) => {
    return roundsToNumber.map((round, index) => ({
      ...round,
      name: `Round ${index + 1}`
    }));
  };

  useEffect(() => {
    const hasInconsistentNumbering = rounds.some((round, index) =>
      round.name !== `Round ${index + 1}`
    );

    if (hasInconsistentNumbering) {
      const fixedRounds = ensureSequentialNumbering(rounds);
      onUpdateRounds(fixedRounds);
    }
  }, [rounds, onUpdateRounds]);

  const addRound = () => {
    if (rounds.length >= MAX_ROUND_BUCKETS) return;
    const newRound: EventRound = {
      id: `round-${Date.now()}`,
      name: `Round ${rounds.length + 1}`,
      playlistIds: [],
      playlistNames: [],
      songCount: 0,
      status: 'unplanned',
      bingoPattern: 'line',
    };
    const updatedRounds = [...rounds, newRound];
    const renumberedRounds = ensureSequentialNumbering(updatedRounds);
    onUpdateRounds(renumberedRounds);
  };

  const removeRound = (index: number) => {
    if (rounds.length > 1) {
      const filteredRounds = rounds.filter((_, i) => i !== index);
      const renumberedRounds = ensureSequentialNumbering(filteredRounds);
      onUpdateRounds(renumberedRounds);
    }
  };

  const addPlaylistToRound = (roundIndex: number, playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    const newRounds = [...rounds];
    const round = newRounds[roundIndex];

    if (round.playlistIds.includes(playlistId)) return;

    newRounds[roundIndex] = {
      ...round,
      playlistIds: [...round.playlistIds, playlist.id],
      playlistNames: [...round.playlistNames, playlist.name],
      songCount: round.songCount + playlist.tracks,
      status: round.status === 'unplanned' ? 'planned' : round.status
    };
    onUpdateRounds(newRounds);
  };

  const removePlaylistFromRound = (roundIndex: number, playlistId: string) => {
    const newRounds = [...rounds];
    const round = newRounds[roundIndex];
    const playlistIndex = round.playlistIds.indexOf(playlistId);

    if (playlistIndex === -1) return;

    const playlist = playlists.find(p => p.id === playlistId);
    const playlistTracks = playlist?.tracks || 0;

    newRounds[roundIndex] = {
      ...round,
      playlistIds: round.playlistIds.filter(id => id !== playlistId),
      playlistNames: round.playlistNames.filter((_, i) => i !== playlistIndex),
      songCount: Math.max(0, round.songCount - playlistTracks),
      status: round.playlistIds.length === 1 ? 'unplanned' : round.status
    };
    onUpdateRounds(newRounds);
  };

  const handleBucketDragOver = (e: React.DragEvent, bucketIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverBucket(bucketIndex);
  };

  const handleBucketDragLeave = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverBucket(null);
    }
  };

  const handleBucketDrop = (e: React.DragEvent, bucketIndex: number) => {
    e.preventDefault();
    const playlistId = e.dataTransfer.getData('text/plain');

    if (playlistId) {
      const playlist = playlists.find(p => p.id === playlistId);
      if (playlist) {
        addPlaylistToRound(bucketIndex, playlistId);
      }
    }

    setDragOverBucket(null);
  };

  const getStatusIcon = (status: EventRound['status'], isActive: boolean) => {
    if (isActive) return <Play className="w-4 h-4" aria-hidden />;

    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4" aria-hidden />;
      case 'planned':
        return <Circle className="w-4 h-4" aria-hidden />;
      case 'unplanned':
        return <Circle className="w-4 h-4" aria-hidden />;
      default:
        return <Circle className="w-4 h-4" aria-hidden />;
    }
  };

  const getNextRoundIndex = () => {
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i];
      if (r.status === 'planned' && (r.playlistIds || []).length > 0) return i;
    }
    return -1;
  };

  const nextRoundIndex = getNextRoundIndex();
  const canStartNextRound = () => nextRoundIndex !== -1 && gameState !== 'playing';

  const startNextRoundDisabledReason = (): string | null => {
    if (gameState === 'playing') {
      return 'Finish or pause the live game first, then start the next round.';
    }
    if (nextRoundIndex === -1) {
      const hasPlannedEmpty = rounds.some(
        r => r.status === 'planned' && (r.playlistIds || []).length === 0
      );
      if (hasPlannedEmpty) {
        return 'Add playlists to the next planned round until it shows Ready.';
      }
      return 'No round is queued yet — drag playlists into a bucket until it\'s planned and ready.';
    }
    return null;
  };

  const canStartRound = (round: EventRound) => {
    return (round.playlistIds || []).length > 0 && round.status !== 'completed';
  };

  const bucketClass = (isActive: boolean, isDragOver: boolean, isInsufficient: boolean) => {
    const parts = ['round-planner-bucket'];
    if (isActive) parts.push('is-active');
    if (isDragOver) parts.push('is-drag-over');
    if (isInsufficient) parts.push('is-warn');
    return parts.join(' ');
  };

  return (
    <div className="round-planner">
      <div className="round-planner__head">
        <div className="round-planner__head-main">
          <Folder className="w-5 h-5" aria-hidden />
          <div>
            <h3 className="round-planner__title">Round buckets</h3>
            <p className="round-planner__subtitle">
              Drag from the library or use <strong>Add to round</strong>. Up to {MAX_ROUND_BUCKETS}{' '}
              rounds.
            </p>
          </div>
        </div>
        <div className="round-planner__head-actions">
          <button
            type="button"
            disabled={!canStartNextRound()}
            title={startNextRoundDisabledReason() || 'Start the next queued round'}
            onClick={() => {
              if (!canStartNextRound()) return;
              onStartRound(nextRoundIndex);
            }}
            className="round-planner-btn round-planner-btn--primary"
          >
            <Play className="w-4 h-4" aria-hidden />
            Start next
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed((c) => !c)}
            className="round-planner-btn round-planner-btn--ghost"
            aria-expanded={!isCollapsed}
            aria-controls="round-planner-buckets"
            title={isCollapsed ? 'Show round buckets' : 'Hide round buckets'}
          >
            {isCollapsed ? (
              <>
                <ChevronDown className="w-4 h-4" aria-hidden />
                Show
              </>
            ) : (
              <>
                <ChevronUp className="w-4 h-4" aria-hidden />
                Hide
              </>
            )}
          </button>
        </div>
      </div>

      {!canStartNextRound() && startNextRoundDisabledReason() ? (
        <p className="round-planner__notice">{startNextRoundDisabledReason()}</p>
      ) : null}

      {prepHints ? (
        <RoundBuilderPrepHints
          spotifyNeeded={prepHints.spotifyNeeded}
          spotifyConnected={prepHints.spotifyConnected}
          deviceNeeded={prepHints.deviceNeeded}
          deviceSelected={prepHints.deviceSelected}
        />
      ) : null}

      {!isCollapsed && (
        <div id="round-planner-buckets">
          <div className="round-planner-buckets-wrap">
            {rounds.slice(0, MAX_ROUND_BUCKETS).map((round, index) => {
              const isActive = index === currentRound && gameState === 'playing';
              const isMixTarget = index === currentRound && gameState !== 'playing';
              const minRequired = round.songCount >= 60 ? 75 : 15;
              const isInsufficient = round.songCount > 0 && round.songCount < minRequired;
              const isDragOver = dragOverBucket === index;
              const playlistIds = round.playlistIds || [];

              return (
                <div
                  key={round.id}
                  onDragOver={(e) => handleBucketDragOver(e, index)}
                  onDragLeave={handleBucketDragLeave}
                  onDrop={(e) => handleBucketDrop(e, index)}
                  className={bucketClass(isActive, isDragOver, isInsufficient)}
                >
                  <div className="round-planner-bucket__head">
                    <span className="round-planner-bucket__title">
                      {getStatusIcon(round.status, isActive)}
                      {round.name}
                    </span>
                    <div className="round-planner-bucket__badges">
                      {isActive ? (
                        <span className="round-planner-badge round-planner-badge--active">Live</span>
                      ) : null}
                      {isMixTarget ? (
                        <span className="round-planner-badge round-planner-badge--prep">Mix</span>
                      ) : null}
                    </div>
                  </div>

                  <RoundBucketSettings
                    round={round}
                    roundIndex={index}
                    hostDefaultFreeSpace={hostDefaultFreeSpace}
                    savedCustomPatterns={savedCustomPatterns}
                    onUpdateBingo={onUpdateRoundBingo}
                    onSaveRound={onSaveRound}
                    saveRoundBusy={saveRoundBusy}
                    snapshotReady={snapshotMeetsSave(round)}
                  />

                  <div className="round-planner-bucket__drop">
                    {playlistIds.length === 0 ? (
                      <div
                        className={`round-planner-bucket__empty${isDragOver ? ' is-drag-over' : ''}`}
                      >
                        <Music className="w-4 h-4" aria-hidden />
                        <span className="round-planner-bucket__empty-title">
                          {isDragOver ? 'Drop to add' : 'Empty'}
                        </span>
                        <span>{isDragOver ? 'Release playlist' : 'Drag playlists here'}</span>
                      </div>
                    ) : (
                      <div className="round-planner-bucket__chips">
                        {playlistIds.map((playlistId) => {
                          const playlist = playlists.find((p) => p.id === playlistId);
                          if (!playlist) return null;
                          const cleanName = playlist.name
                            .replace(/^\s*GoT\s*[-–:]*\s*/i, '')
                            .trim();

                          return (
                            <div key={playlistId} className="round-planner-chip">
                              <span className="round-planner-chip__name" title={cleanName}>
                                {cleanName}
                              </span>
                              {!isActive && round.status !== 'completed' ? (
                                <button
                                  type="button"
                                  className="round-planner-chip__remove"
                                  onClick={() => removePlaylistFromRound(index, playlistId)}
                                  title="Remove playlist"
                                  aria-label={`Remove ${cleanName}`}
                                >
                                  ×
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                        {isDragOver ? (
                          <div className="round-planner-bucket__drop-hint">
                            <Plus className="w-3 h-3" aria-hidden />
                            Drop to add
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {round.songCount > 0 ? (
                    <div className="round-planner-bucket__meta">
                      {playlistIds.length} playlist{playlistIds.length !== 1 ? 's' : ''} ·{' '}
                      {round.songCount} songs
                      {isInsufficient ? (
                        <span className="round-planner-bucket__meta-warn">
                          · need {minRequired - round.songCount} more
                        </span>
                      ) : round.songCount >= minRequired ? (
                        <span className="round-planner-bucket__meta-ok">· ready</span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="round-planner-bucket__actions">
                    {onSelectRoundForPrep &&
                      gameState !== 'playing' &&
                      playlistIds.length > 0 && (
                        <button
                          type="button"
                          className="round-planner-btn round-planner-btn--grow round-planner-btn--prep"
                          onClick={() => onSelectRoundForPrep(index)}
                          title="Sync this round into the mix for Save / PDF — does not start the round"
                        >
                          Load for prep
                        </button>
                      )}
                    {!isActive && round.status !== 'completed' && canStartRound(round) ? (
                      <button
                        type="button"
                        className="round-planner-btn round-planner-btn--grow round-planner-btn--start"
                        onClick={() => onStartRound(index)}
                        title="Mark active and open Game tab"
                      >
                        <Play className="w-3 h-3" aria-hidden />
                        Start round
                      </button>
                    ) : null}
                    {rounds.length > 1 && round.status !== 'active' ? (
                      <button
                        type="button"
                        className="round-planner-btn round-planner-btn--icon"
                        onClick={() => removeRound(index)}
                        title="Remove round"
                        aria-label={`Remove ${round.name}`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            <RoundBuilderPlaybackPanel
              snippetLength={snippetLength}
              onSnippetLengthChange={onSnippetLengthChange}
              randomStarts={randomStarts}
              onRandomStartsChange={onRandomStartsChange}
            />

            {rounds.length < MAX_ROUND_BUCKETS ? (
              <button type="button" className="round-planner-add" onClick={addRound}>
                <Plus className="w-4 h-4" aria-hidden />
                Add round
                <span className="round-planner-add__hint">
                  {MAX_ROUND_BUCKETS - rounds.length} slot
                  {MAX_ROUND_BUCKETS - rounds.length !== 1 ? 's' : ''} left
                </span>
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default RoundPlanner;
