import React from 'react';

export type RoundTimelineRow = {
  index: number;
  name: string;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  playlistCount: number;
  saved: boolean;
  isCurrent: boolean;
};

type HostRoundTimelineProps = {
  rounds: RoundTimelineRow[];
  onSelectRound: (index: number) => void;
  onDuplicateRound?: (index: number) => void;
  /** Short status line, e.g. "1 live · 2 planned · 4 total" */
  summary?: string;
  /** Jump to the full Rounds workspace (playlists, library, etc.) */
  onOpenRounds?: () => void;
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
  onDuplicateRound,
  summary,
  onOpenRounds,
  className,
}) => {
  if (rounds.length === 0) return null;
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
        {onOpenRounds ? (
          <button type="button" className="host-round-timeline__manage btn-secondary" onClick={onOpenRounds}>
            Manage in Rounds
          </button>
        ) : null}
      </div>
      <div className="host-round-timeline__track" role="list">
        {rounds.map((r) => (
          <div
            key={r.index}
            role="listitem"
            className={
              r.isCurrent
                ? 'host-round-timeline__chip host-round-timeline__chip--current'
                : 'host-round-timeline__chip'
            }
          >
            <button type="button" className="host-round-timeline__main" onClick={() => onSelectRound(r.index)}>
              <span className="host-round-timeline__name">{r.name}</span>
              <span className={`host-round-timeline__status host-round-timeline__status--${r.status}`}>
                {statusLabel[r.status]}
              </span>
              <span className="host-round-timeline__meta">
                {r.playlistCount} playlist{r.playlistCount !== 1 ? 's' : ''}
                {r.saved ? ' · saved' : ''}
              </span>
            </button>
            {onDuplicateRound ? (
              <button
                type="button"
                className="host-round-timeline__dup"
                title="Duplicate round"
                onClick={() => onDuplicateRound(r.index)}
              >
                Dup
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
};

export default HostRoundTimeline;
