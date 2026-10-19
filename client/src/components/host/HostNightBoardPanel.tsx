import React, { useRef, useState } from 'react';
import PlayerAvatar from '../PlayerAvatar';
import NightBoardPoster from '../NightBoardPoster';
import { downloadNightBoardPngFromElement } from '../../utils/downloadNightBoardPng';

export type NightBoardWinner = {
  roundNumber: number;
  playerName: string;
  avatar?: string;
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
  roomId?: string;
  venueTitle?: string;
};

const HostNightBoardPanel: React.FC<HostNightBoardPanelProps> = ({
  plannedRounds,
  winners,
  showOnProjector,
  onToggleProjector,
  className,
  roomId,
  venueTitle,
}) => {
  const posterRef = useRef<HTMLDivElement>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
            avatar: winner?.avatar || '',
            done: Boolean(winner),
          };
        })
      : winners.map((w) => ({
          key: `winner-${w.roundNumber}`,
          label: w.roundName || `Round ${w.roundNumber}`,
          prize: (w.prize || '').trim() || '—',
          winner: w.playerName || '—',
          avatar: w.avatar || '',
          done: true,
        }));

  const exportRows = rows
    .filter((r) => r.done && r.winner !== '—')
    .map((r) => ({
      roundLabel: r.label,
      prize: r.prize === '—' ? '' : r.prize,
      winner: r.winner,
    }));

  const saveImage = async () => {
    if (!exportRows.length || !posterRef.current) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `tempo-night-board${roomId ? `-${roomId}` : ''}-${stamp}`;
      await downloadNightBoardPngFromElement(posterRef.current, base);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not save image');
    } finally {
      setExportBusy(false);
    }
  };

  if (rows.length === 0) return null;

  const dateLabel = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

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
        <div className="host-night-board__actions">
          <label className="host-night-board__toggle">
            <input
              type="checkbox"
              className="host-control-checkbox"
              checked={showOnProjector}
              onChange={(e) => onToggleProjector(e.target.checked)}
            />
            <span>Show winners on projector</span>
          </label>
          <button
            type="button"
            className="btn-secondary host-night-board__save"
            disabled={!exportRows.length || exportBusy}
            onClick={() => void saveImage()}
            title={
              exportRows.length
                ? 'Download a PNG of tonight’s board for socials'
                : 'Add a round winner before saving'
            }
          >
            {exportBusy ? 'Saving…' : 'Save night board image'}
          </button>
        </div>
      </div>
      {exportError ? (
        <p className="host-night-board__export-error" role="alert">
          {exportError}
        </p>
      ) : null}
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
            <span
              className="host-night-board__winner"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              {row.winner !== '—' ? (
                <PlayerAvatar avatar={row.avatar} name={row.winner} size="sm" />
              ) : null}
              {row.winner}
            </span>
          </li>
        ))}
      </ul>

      {/* Off-screen Stories poster for html2canvas */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: -12000,
          top: 0,
          width: 1080,
          height: 1350,
          pointerEvents: 'none',
          opacity: 1,
          zIndex: -1,
          overflow: 'hidden',
        }}
      >
        <NightBoardPoster
          ref={posterRef}
          rows={exportRows.length ? exportRows : [{ roundLabel: '—', prize: '—', winner: '—' }]}
          roomId={roomId}
          venueTitle={venueTitle}
          dateLabel={dateLabel}
        />
      </div>
    </section>
  );
};

export default HostNightBoardPanel;
