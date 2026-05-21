import React from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Eraser,
  ListMusic,
  Printer,
  RotateCcw,
  Save,
  SkipForward,
  Trash2,
} from 'lucide-react';
export interface HostRoundEventPanelRound {
  id: string;
  name: string;
  playlistIds: string[];
  songCount: number;
  status: 'completed' | 'active' | 'planned' | 'unplanned';
  completedAt?: number;
  savedMixSnapshot?: {
    songs: { length: number };
    mixGeometry: string;
    savedAt: number;
  };
}

export interface HostRoundEventPanelProps {
  rounds: HostRoundEventPanelRound[];
  currentRoundIndex: number;
  gameState: 'waiting' | 'playing' | 'ended';
  statusSummary: { completed: number; active: number; planned: number; unplanned: number };
  printableCardCount: number;
  onPrintableCardCountChange: (n: number) => void;
  printablePdfLoading: boolean;
  saveRoundBusy: boolean;
  mixGameActionsBlocked: boolean;
  snapshotMeetsSave: (roundIndex: number) => boolean;
  onSaveRound: (index: number) => void;
  onPrintPdf: (roundIndex: number) => void;
  onCallSheet: (roundIndex: number) => void;
  onLoadForPrep: (index: number) => void;
  onJumpToRound: (index: number) => void;
  onCompleteCurrentRound?: () => void;
  onResetCurrentRound?: () => void;
  onStartNextPlanned?: () => void;
  hasNextPlanned: boolean;
  onResetEvent: () => void;
  onClearPrepCache: () => void;
}

const HostRoundEventPanel: React.FC<HostRoundEventPanelProps> = ({
  rounds,
  currentRoundIndex,
  gameState,
  statusSummary,
  printableCardCount,
  onPrintableCardCountChange,
  printablePdfLoading,
  saveRoundBusy,
  mixGameActionsBlocked,
  snapshotMeetsSave,
  onSaveRound,
  onPrintPdf,
  onCallSheet,
  onLoadForPrep,
  onJumpToRound,
  onCompleteCurrentRound,
  onResetCurrentRound,
  onStartNextPlanned,
  hasNextPlanned,
  onResetEvent,
  onClearPrepCache,
}) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="host-round-hub-event"
  >
    <div className="host-round-manager-overview">
      <h4>Event overview</h4>
      <div className="host-round-manager-stats">
        <div className="host-round-manager-stat">
          <div className="host-round-manager-stat__val host-round-manager-stat__val--green">
            {statusSummary.completed}
          </div>
          <div className="host-round-manager-stat__label">Completed</div>
        </div>
        <div className="host-round-manager-stat">
          <div className="host-round-manager-stat__val host-round-manager-stat__val--blue">
            {statusSummary.active}
          </div>
          <div className="host-round-manager-stat__label">Active</div>
        </div>
        <div className="host-round-manager-stat">
          <div className="host-round-manager-stat__val host-round-manager-stat__val--yellow">
            {statusSummary.planned}
          </div>
          <div className="host-round-manager-stat__label">Planned</div>
        </div>
        <div className="host-round-manager-stat">
          <div className="host-round-manager-stat__val host-round-manager-stat__val--gray">
            {statusSummary.unplanned}
          </div>
          <div className="host-round-manager-stat__label">Unplanned</div>
        </div>
      </div>
    </div>

    <div className="host-round-hub-event__actions">
      <h4 className="host-round-hub-event__actions-title">Event actions</h4>
      <div className="host-round-hub-event__actions-row">
        {gameState === 'playing' && onCompleteCurrentRound ? (
          <button type="button" className="btn-secondary" onClick={onCompleteCurrentRound}>
            <CheckCircle2 className="w-4 h-4" aria-hidden />
            Complete current round
          </button>
        ) : null}
        {gameState === 'playing' && onResetCurrentRound ? (
          <button type="button" className="btn-secondary" onClick={onResetCurrentRound}>
            <RotateCcw className="w-4 h-4" aria-hidden />
            Reset current round
          </button>
        ) : null}
        {hasNextPlanned && onStartNextPlanned ? (
          <button type="button" className="btn-secondary" onClick={onStartNextPlanned}>
            <SkipForward className="w-4 h-4" aria-hidden />
            Start next planned
          </button>
        ) : null}
        <button type="button" className="btn-danger-outline" onClick={onResetEvent}>
          <Trash2 className="w-4 h-4" aria-hidden />
          Reset event
        </button>
        <button type="button" className="btn-secondary host-round-hub-event__clear-cache" onClick={onClearPrepCache}>
          <Eraser className="w-4 h-4" aria-hidden />
          Clear prep cache
        </button>
      </div>
    </div>

    <div className="host-round-manager-printable">
      <h4>
        <Printer className="w-4 h-4" aria-hidden />
        Printable dauber cards (PDF)
      </h4>
      <p className="host-round-hub-event__hint">
        Cards per PDF applies to <strong>Print PDF</strong> on each round and <strong>Download PDF</strong> on the Game tab.
      </p>
      <label className="host-round-hub-event__cards-label">
        Cards per PDF
        <input
          type="number"
          min={1}
          max={200}
          value={printableCardCount}
          onChange={(e) => onPrintableCardCountChange(Number(e.target.value))}
          disabled={printablePdfLoading}
          aria-label="Number of bingo cards per printable PDF export"
        />
        <span>1–200</span>
      </label>
    </div>

    <div className="host-round-hub-event__rounds-section">
      <h4>All rounds</h4>
      <p className="host-round-hub-event__hint">
        Pattern and free center are on each bucket under <strong>Build</strong>. Use <strong>Pattern</strong> for custom
        shapes and combined rules. After <strong>Save round</strong>, use Print PDF or Call sheet.
      </p>
      <div className="host-round-manager-rounds">
        {rounds.map((round, index) => {
          const isCurrentRound = index === currentRoundIndex;
          const hasPlaylists = (round.playlistIds || []).length > 0;
          const canStart = round.status !== 'completed' && hasPlaylists;
          const roundClass = isCurrentRound
            ? 'host-round-manager-round host-round-manager-round--current'
            : round.status === 'completed'
              ? 'host-round-manager-round host-round-manager-round--done'
              : canStart
                ? 'host-round-manager-round host-round-manager-round--ready'
                : 'host-round-manager-round host-round-manager-round--blocked';

          return (
            <div key={round.id} className={roundClass}>
              <div className="host-round-manager-round__top">
                <div>
                  <div className="host-round-manager-round__headline">
                    <span className="host-round-manager-round__name">{round.name}</span>
                    {isCurrentRound ? (
                      <span className="host-round-manager-badge host-round-manager-badge--current">CURRENT</span>
                    ) : null}
                    {round.status === 'completed' ? (
                      <span className="host-round-manager-badge host-round-manager-badge--done">DONE</span>
                    ) : null}
                  </div>
                  <div className="host-round-manager-round__meta">
                    {round.playlistIds.length} playlist{round.playlistIds.length !== 1 ? 's' : ''} · {round.songCount}{' '}
                    songs
                    {round.status === 'completed' && round.completedAt ? (
                      <span> · Completed {new Date(round.completedAt).toLocaleTimeString()}</span>
                    ) : null}
                    {round.savedMixSnapshot ? (
                      <>
                        <br />
                        <span className="host-round-manager-round__snap">
                          Snapshot · {round.savedMixSnapshot.songs.length} tracks ·{' '}
                          {round.savedMixSnapshot.mixGeometry} ·{' '}
                          {new Date(round.savedMixSnapshot.savedAt).toLocaleString()}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="host-round-manager-round__actions">
                  {hasPlaylists ? (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={saveRoundBusy || printablePdfLoading || mixGameActionsBlocked}
                        onClick={() => onSaveRound(index)}
                      >
                        <Save className="w-4 h-4" aria-hidden />
                        Save round
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={printablePdfLoading}
                        onClick={() => onPrintPdf(index)}
                      >
                        <Printer className="w-4 h-4" aria-hidden />
                        Print PDF
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                                disabled={printablePdfLoading || !snapshotMeetsSave(index)}
                        onClick={() => onCallSheet(index)}
                      >
                        <ListMusic className="w-4 h-4" aria-hidden />
                        Call sheet
                      </button>
                    </>
                  ) : null}
                  {gameState !== 'playing' && hasPlaylists && !isCurrentRound ? (
                    <button type="button" className="btn-secondary" onClick={() => onLoadForPrep(index)}>
                      Load for prep
                    </button>
                  ) : null}
                  {canStart && !isCurrentRound ? (
                    <button
                      type="button"
                      onClick={() => onJumpToRound(index)}
                      className="host-round-manager-start-btn"
                    >
                      Start
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </motion.div>
);

export default HostRoundEventPanel;
