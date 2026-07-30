import React from 'react';

export type NightBoardWinner = {
  roundNumber: number;
  playerName: string;
  prize?: string;
  roundName?: string;
};

export type NightBoardPlannedRound = {
  name: string;
  prize?: string;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
};

type HostNightBoardPanelProps = {
  plannedRounds: NightBoardPlannedRound[];
  winners: NightBoardWinner[];
  showOnProjector: boolean;
  onToggleProjector: (visible: boolean) => void;
  className?: string;
};

const HostNightBoardPanel: React.FC<HostNightBoardPanelProps> = ({
  plannedRounds,
  winners,
  showOnProjector,
  onToggleProjector,
  className,
}) => {
  const winnerByRound = new Map<number, NightBoardWinner>();
  winners.forEach((w) => {
    if (typeof w.roundNumber === 'number') winnerByRound.set(w.roundNumber, w);
  });

  const rows =
    plannedRounds.length > 0
      ? plannedRounds.map((r, i) => {
          const winner = winnerByRound.get(i + 1);
          return {
            key: `round-${i + 1}`,
            label: r.name || `Round ${i + 1}`,
            prize: (winner?.prize || r.prize || '').trim() || '—',
            winner: winner?.playerName?.trim() || '—',
            done: Boolean(winner),
          };
        })
      : winners.map((w) => ({
          key: `winner-${w.roundNumber}`,
          label: w.roundName || `Round ${w.roundNumber}`,
          prize: (w.prize || '').trim() || '—',
          winner: w.playerName || '—',
          done: true,
        }));

  if (rows.length === 0) return null;

  return (
    <section
      className={['host-night-board host-glass-panel', className].filter(Boolean).join(' ')}
      aria-label="Tonight's prize board"
    >
      <div className="host-night-board__header">
        <div>
          <h2 className="host-night-board__title">Tonight&apos;s board</h2>
          <p className="host-night-board__summary">Round · prize · winner</p>
        </div>
        <label className="host-night-board__toggle">
          <input
            type="checkbox"
            className="host-control-checkbox"
            checked={showOnProjector}
            onChange={(e) => onToggleProjector(e.target.checked)}
          />
          <span>Show winners on projector</span>
        </label>
      </div>
      <ul className="host-night-board__list">
        {rows.map((row) => (
          <li
            key={row.key}
            className={
              row.done ? 'host-night-board__row host-night-board__row--done' : 'host-night-board__row'
            }
          >
            <span className="host-night-board__round">{row.label}</span>
            <span className="host-night-board__prize">{row.prize}</span>
            <span className="host-night-board__winner">{row.winner}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default HostNightBoardPanel;
