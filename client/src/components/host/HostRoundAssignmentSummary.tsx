import React from 'react';
import { AlertTriangle, Music2 } from 'lucide-react';
import './HostPlaylistLibrary.css';

export type RoundAssignmentSummaryRow = {
  index: number;
  name: string;
  playlistCount: number;
  songCount: number;
  isCurrent: boolean;
  isEmpty: boolean;
  isLowSongs: boolean;
};

export type HostRoundAssignmentSummaryProps = {
  rows: RoundAssignmentSummaryRow[];
  onSelectRound: (index: number) => void;
};

const HostRoundAssignmentSummary: React.FC<HostRoundAssignmentSummaryProps> = ({
  rows,
  onSelectRound,
}) => {
  if (rows.length === 0) return null;

  return (
    <section className="host-round-assign-summary host-glass-panel" aria-label="Round playlist assignments">
      <header className="host-round-assign-summary__head">
        <h3 className="host-round-assign-summary__title">
          <Music2 className="w-4 h-4" aria-hidden />
          Round playlist assignments
        </h3>
      </header>
      <ul className="host-round-assign-summary__list">
        {rows.map((row) => (
          <li key={row.index}>
            <button
              type="button"
              className={
                row.isCurrent
                  ? 'host-round-assign-summary__row host-round-assign-summary__row--current'
                  : 'host-round-assign-summary__row'
              }
              onClick={() => onSelectRound(row.index)}
              aria-current={row.isCurrent ? 'true' : undefined}
            >
              <span className="host-round-assign-summary__round-name">{row.name}</span>
              <span className="host-round-assign-summary__meta">
                {row.isEmpty ? (
                  <span className="host-round-assign-summary__empty">Empty</span>
                ) : (
                  <>
                    {row.playlistCount} playlist{row.playlistCount !== 1 ? 's' : ''}
                    {row.songCount > 0 ? ` · ${row.songCount} songs` : ''}
                  </>
                )}
              </span>
              {row.isLowSongs ? (
                <span className="host-round-assign-summary__warn" title="Fewer than 15 listed songs">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                  Low count
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default HostRoundAssignmentSummary;
