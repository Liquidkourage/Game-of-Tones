import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';

export type RoundTimelineRow = {
  index: number;
  name: string;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  playlistCount: number;
  songCount?: number;
  playlistNames?: string[];
  saved: boolean;
  isCurrent: boolean;
};

const MAX_CHIP_PLAYLIST_NAMES = 3;

type HostRoundTimelineProps = {
  rounds: RoundTimelineRow[];
  onSelectRound: (index: number) => void;
  onAddRound?: () => void;
  canAddRound?: boolean;
  onRemoveRound?: (index: number) => void;
  canRemoveRound?: boolean;
  onDropPlaylist?: (roundIndex: number, playlistId: string) => void;
  summary?: string;
  onOpenRounds?: () => void;
  /** Extra guidance shown in the read-only nothing-prepped state (e.g. "Add music below"). */
  emptyHint?: string;
  className?: string;
};

const statusLabel: Record<RoundTimelineRow['status'], string> = {
  completed: 'Done',
  active: 'Live',
  planned: 'Planned',
  unplanned: 'Draft',
};

const HostRoundTimeline: React.FC<HostRoundTimelineProps> = ({
  rounds,
  onSelectRound,
  onAddRound,
  canAddRound = true,
  onRemoveRound,
  canRemoveRound = true,
  onDropPlaylist,
  summary,
  onOpenRounds,
  emptyHint,
  className,
}) => {
  const [dragOverRound, setDragOverRound] = useState<number | null>(null);

  if (rounds.length === 0) return null;

  // Read-only timeline (Game tab / setup cockpit) with nothing prepped: an empty
  // draft chip has nothing to do, so say so instead of showing it.
  const interactive = Boolean(onAddRound || onRemoveRound || onDropPlaylist);
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
        {rounds.map((r) => (
          <div
            key={r.index}
            role="listitem"
            className={[
              r.isCurrent
                ? 'host-round-timeline__chip host-round-timeline__chip--current'
                : 'host-round-timeline__chip',
              dragOverRound === r.index ? 'host-round-timeline__chip--drag-over' : '',
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
              <span className="host-round-timeline__name">{r.name}</span>
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
                  </>
                )}
                {r.saved ? ' · saved' : ''}
              </span>
              {r.playlistNames && r.playlistNames.length > 0 ? (
                <span className="host-round-timeline__playlists" title={r.playlistNames.join(', ')}>
                  {r.playlistNames.slice(0, MAX_CHIP_PLAYLIST_NAMES).join(' · ')}
                  {r.playlistNames.length > MAX_CHIP_PLAYLIST_NAMES
                    ? ` +${r.playlistNames.length - MAX_CHIP_PLAYLIST_NAMES}`
                    : ''}
                </span>
              ) : null}
            </button>
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
        ))}
      </div>
    </section>
  );
};

export default HostRoundTimeline;
