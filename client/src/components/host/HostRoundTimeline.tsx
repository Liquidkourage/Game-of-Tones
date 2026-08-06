import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { BINGO_COLUMN_LETTERS } from '../../utils/bingoColumnOrder';
import { playlistDisplayParts } from '../../utils/roundPrintLabels';

export type RoundTimelineRow = {
  index: number;
  name: string;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  playlistCount: number;
  songCount?: number;
  playlistNames?: string[];
  saved: boolean;
  isCurrent: boolean;
  /** Optional prize label for this round. */
  prize?: string;
};

type HostRoundTimelineProps = {
  rounds: RoundTimelineRow[];
  onSelectRound: (index: number) => void;
  onAddRound?: () => void;
  canAddRound?: boolean;
  onAddLeftoversRound?: () => void;
  canAddLeftoversRound?: boolean;
  onAddRequestsRound?: () => void;
  canAddRequestsRound?: boolean;
  onRemoveRound?: (index: number) => void;
  canRemoveRound?: boolean;
  /** Reorder rounds (Earlier / Later). */
  onMoveRound?: (fromIndex: number, toIndex: number) => void;
  /** While set, that index cannot be moved (live round during play). */
  moveRoundLockedIndex?: number | null;
  onDropPlaylist?: (roundIndex: number, playlistId: string) => void;
  /** A library playlist drag is in progress: pulse every droppable round chip. */
  dropTargetsActive?: boolean;
  summary?: string;
  onOpenRounds?: () => void;
  /** Extra guidance shown in the read-only nothing-prepped state (e.g. "Add music below"). */
  emptyHint?: string;
  /** Five column letters (host pref, e.g. TEMPO); defaults to BINGO. */
  columnLetters?: readonly string[];
  className?: string;
};

const statusLabel: Record<RoundTimelineRow['status'], string> = {
  completed: 'Done',
  active: 'Live',
  planned: 'Planned',
  unplanned: 'Draft',
};

const PlaylistDisplayLabel: React.FC<{ name: string; trackCount?: number }> = ({
  name,
  trackCount,
}) => {
  const { title, poolSize } = playlistDisplayParts(name, trackCount);
  return (
    <>
      <span className="host-round-timeline__playlist-chip-name">{title}</span>
      {poolSize ? (
        <span className="host-playlist-pool-size-chip" aria-label={`${poolSize} song pool`}>
          {poolSize}+
        </span>
      ) : null}
    </>
  );
};

const HostRoundTimeline: React.FC<HostRoundTimelineProps> = ({
  rounds,
  onSelectRound,
  onAddRound,
  canAddRound = true,
  onAddLeftoversRound,
  canAddLeftoversRound = true,
  onAddRequestsRound,
  canAddRequestsRound = true,
  onRemoveRound,
  canRemoveRound = true,
  onMoveRound,
  moveRoundLockedIndex = null,
  onDropPlaylist,
  dropTargetsActive = false,
  summary,
  onOpenRounds,
  emptyHint,
  columnLetters,
  className,
}) => {
  const letters =
    columnLetters && columnLetters.length === 5 ? columnLetters : BINGO_COLUMN_LETTERS;
  const [dragOverRound, setDragOverRound] = useState<number | null>(null);

  if (rounds.length === 0) return null;

  // Read-only timeline (Game tab / setup cockpit) with nothing prepped: an empty
  // draft chip has nothing to do, so say so instead of showing it.
  const interactive = Boolean(
    onAddRound ||
      onAddLeftoversRound ||
      onAddRequestsRound ||
      onRemoveRound ||
      onMoveRound ||
      onDropPlaylist,
  );
  const nothingPrepped = rounds.every(
    (r) => r.status === 'unplanned' && r.playlistCount === 0 && !r.saved,
  );
  if (!interactive && nothingPrepped) {
    return (
      <section
        className={['host-round-timeline host-glass-panel', className].filter(Boolean).join(' ')}
        aria-label="Round timeline"
      >
        <div className="host-round-timeline__header">
          <div>
            <h2 className="host-round-timeline__title">Tonight&apos;s rounds</h2>
            <p className="host-round-timeline__summary">
              No rounds prepped yet.{emptyHint ? ` ${emptyHint}` : ''}
            </p>
          </div>
          {onOpenRounds ? (
            <div className="host-round-timeline__header-actions">
              <button type="button" className="host-round-timeline__manage btn-secondary" onClick={onOpenRounds}>
                Manage in Rounds
              </button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className={['host-round-timeline host-glass-panel', className].filter(Boolean).join(' ')}
      aria-label="Round timeline"
    >
      <div className="host-round-timeline__header">
        <div>
          <h2 className="host-round-timeline__title">Tonight&apos;s rounds</h2>
          {summary ? <p className="host-round-timeline__summary">{summary}</p> : null}
          {onMoveRound && rounds.length > 1 ? (
            <p className="host-round-timeline__summary host-round-timeline__reorder-hint">
              Use Earlier / Later to reorder.
            </p>
          ) : null}
        </div>
        <div className="host-round-timeline__header-actions">
          {onAddRound ? (
            <button
              type="button"
              className="btn-primary host-round-timeline__add"
              onClick={onAddRound}
              disabled={!canAddRound}
              title={canAddRound ? 'Add another round to this event' : 'Maximum rounds reached'}
            >
              <Plus className="w-4 h-4" aria-hidden />
              Add round
            </button>
          ) : null}
          {onAddLeftoversRound ? (
            <button
              type="button"
              className="btn-secondary host-round-timeline__add"
              onClick={onAddLeftoversRound}
              disabled={!canAddLeftoversRound}
              title={
                canAddLeftoversRound
                  ? 'Add the unplayed-songs meta-round'
                  : 'Leftovers is already on the timeline'
              }
            >
              <Plus className="w-4 h-4" aria-hidden />
              Leftovers
            </button>
          ) : null}
          {onAddRequestsRound ? (
            <button
              type="button"
              className="btn-secondary host-round-timeline__add"
              onClick={onAddRequestsRound}
              disabled={!canAddRequestsRound}
              title={
                canAddRequestsRound
                  ? 'Add the audience Requests meta-round'
                  : 'Requests is already on the timeline'
              }
            >
              <Plus className="w-4 h-4" aria-hidden />
              Requests
            </button>
          ) : null}
          {onOpenRounds ? (
            <button type="button" className="host-round-timeline__manage btn-secondary" onClick={onOpenRounds}>
              Manage in Rounds
            </button>
          ) : null}
        </div>
      </div>
      {onDropPlaylist ? (
        <p className="host-round-timeline__drop-hint">Drop a playlist onto a round to assign it.</p>
      ) : null}
      <div className="host-round-timeline__track" role="list">
        {rounds.map((r) => {
          const moveLocked =
            moveRoundLockedIndex != null && r.index === moveRoundLockedIndex;
          const canMoveEarlier = Boolean(onMoveRound) && r.index > 0 && !moveLocked;
          const canMoveLater =
            Boolean(onMoveRound) && r.index < rounds.length - 1 && !moveLocked;
          return (
          <div
            key={r.index}
            role="listitem"
            className={[
              r.isCurrent
                ? 'host-round-timeline__chip host-round-timeline__chip--current'
                : 'host-round-timeline__chip',
              // Visual drop affordances: dashed ring on empty buckets at rest, pulse on all
              // droppable buckets while a playlist drag is in progress.
              onDropPlaylist && r.playlistCount === 0 ? 'host-round-timeline__chip--drop-idle' : '',
              onDropPlaylist && dropTargetsActive ? 'host-round-timeline__chip--drop-ready' : '',
              dragOverRound === r.index ? 'host-round-timeline__chip--drag-over' : '',
              (r.songCount ?? 0) >= 75 ? 'host-round-timeline__chip--pool' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onDragEnter={(e) => {
              if (!onDropPlaylist) return;
              e.preventDefault();
              setDragOverRound(r.index);
            }}
            onDragOver={(e) => {
              if (!onDropPlaylist) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDragOverRound(r.index);
            }}
            onDragLeave={(e) => {
              if (!onDropPlaylist) return;
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverRound((cur) => (cur === r.index ? null : cur));
            }}
            onDrop={(e) => {
              if (!onDropPlaylist) return;
              e.preventDefault();
              const playlistId = e.dataTransfer.getData('text/plain');
              if (playlistId) onDropPlaylist(r.index, playlistId);
              setDragOverRound(null);
            }}
          >
            <button type="button" className="host-round-timeline__main" onClick={() => onSelectRound(r.index)}>
              <span className="host-round-timeline__name">
                {r.name}
                {r.prize ? (
                  <span className="host-round-timeline__prize"> · Prize: {r.prize}</span>
                ) : null}
              </span>
              <span className={`host-round-timeline__status host-round-timeline__status--${r.status}`}>
                {statusLabel[r.status]}
              </span>
              <span className="host-round-timeline__meta">
                {r.playlistCount === 0 ? (
                  'No playlists'
                ) : (
                  <>
                    {r.playlistCount} playlist{r.playlistCount !== 1 ? 's' : ''}
                    {/* Tempo round rule: 1 playlist (mix) or 5 (columns) */}
                    {r.playlistCount !== 1 && r.playlistCount !== 5 ? ' · needs 1 or 5' : ''}
                    {(r.songCount ?? 0) > 0 ? ` · ${r.songCount} songs` : ''}
                    {(r.songCount ?? 0) >= 50 && (r.songCount ?? 0) < 75 ? (
                      <span className="host-round-timeline__pool-nudge">
                        {' '}
                        · Need {75 - (r.songCount ?? 0)} for 75+
                      </span>
                    ) : null}
                  </>
                )}
                {r.saved ? ' · saved' : ''}
              </span>
              {r.playlistNames && r.playlistNames.length === 1 ? (
                /* Round Mix: one playlist supplies all 75 — just say the title. */
                <span
                  className="host-round-timeline__playlists"
                  title={playlistDisplayParts(r.playlistNames[0]).title}
                >
                  <PlaylistDisplayLabel
                    name={r.playlistNames[0]}
                    trackCount={(r.songCount ?? 0) > 0 ? r.songCount : undefined}
                  />
                </span>
              ) : r.playlistNames && r.playlistNames.length > 1 ? (
                /* Column mode: every playlist as a small chip, in stored order (= B–O card columns). */
                <span className="host-round-timeline__playlist-chips">
                  {r.playlistNames.map((n, i) => (
                    <span
                      key={`${i}-${n}`}
                      className="host-round-timeline__playlist-chip"
                      title={
                        r.playlistNames!.length === 5
                          ? `${letters[i]} column · ${playlistDisplayParts(n).title}`
                          : playlistDisplayParts(n).title
                      }
                    >
                      {r.playlistNames!.length === 5 ? (
                        <span className="host-round-timeline__playlist-chip-letter" aria-hidden>
                          {letters[i]}
                        </span>
                      ) : null}
                      <PlaylistDisplayLabel name={n} />
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
            {onMoveRound && rounds.length > 1 ? (
              <div className="host-round-timeline__reorder" role="group" aria-label={`Reorder ${r.name}`}>
                <button
                  type="button"
                  className="host-round-timeline__move"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveRound(r.index, r.index - 1);
                  }}
                  disabled={!canMoveEarlier}
                  title={
                    moveLocked
                      ? 'Live round — end it before moving'
                      : canMoveEarlier
                        ? `Move ${r.name} earlier`
                        : 'Already first'
                  }
                  aria-label={`Move ${r.name} earlier`}
                >
                  <ArrowUp className="w-3.5 h-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="host-round-timeline__move"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveRound(r.index, r.index + 1);
                  }}
                  disabled={!canMoveLater}
                  title={
                    moveLocked
                      ? 'Live round — end it before moving'
                      : canMoveLater
                        ? `Move ${r.name} later`
                        : 'Already last'
                  }
                  aria-label={`Move ${r.name} later`}
                >
                  <ArrowDown className="w-3.5 h-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
            {onRemoveRound ? (
              <button
                type="button"
                className="host-round-timeline__remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRound(r.index);
                }}
                disabled={!canRemoveRound}
                title={canRemoveRound ? `Delete ${r.name}` : 'Events need at least one round'}
                aria-label={`Delete ${r.name}`}
              >
                <X className="w-3.5 h-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          );
        })}
      </div>
    </section>
  );
};

export default HostRoundTimeline;
