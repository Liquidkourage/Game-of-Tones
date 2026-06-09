import React from 'react';
import { Users, QrCode, ExternalLink, Copy } from 'lucide-react';

export type HostPlayerRosterRow = {
  playerId: string;
  playerName: string;
  inPerson: boolean;
};

type HostPlayersPanelProps = {
  roomId: string;
  playerCardsCount: number;
  roster: HostPlayerRosterRow[];
  onOpenPlayerCards: () => void;
  onCopyJoinLink: () => void;
};

const HostPlayersPanel: React.FC<HostPlayersPanelProps> = ({
  roomId,
  playerCardsCount,
  roster,
  onOpenPlayerCards,
  onCopyJoinLink,
}) => {
  const joinUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?room=${encodeURIComponent(roomId)}`
      : '';
  const displayUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/display/${encodeURIComponent(roomId)}`
      : '';
  const qrSrc = joinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl)}`
    : '';

  return (
    <div className="host-players-workspace">
      <section className="host-glass-panel host-players-workspace__join">
        <h2 className="host-players-workspace__title">
          <QrCode className="host-players-workspace__title-icon" aria-hidden />
          Join room
        </h2>
        <div className="host-players-workspace__join-grid">
          {qrSrc ? (
            <img className="host-players-workspace__qr" src={qrSrc} alt="" width={160} height={160} />
          ) : null}
          <div className="host-players-workspace__urls">
            <p className="host-players-workspace__url-label">Player join</p>
            <code className="host-players-workspace__url">{joinUrl || '—'}</code>
            <button type="button" className="btn-secondary" onClick={onCopyJoinLink}>
              <Copy className="w-4 h-4" aria-hidden />
              Copy join link
            </button>
            <p className="host-players-workspace__url-label">Public display</p>
            <code className="host-players-workspace__url">{displayUrl || '—'}</code>
            {displayUrl ? (
              <a
                className="btn-secondary host-players-workspace__open-display"
                href={displayUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="w-4 h-4" aria-hidden />
                Open display
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="host-glass-panel host-players-workspace__roster">
        <div className="host-players-workspace__roster-head">
          <h2 className="host-players-workspace__title">
            <Users className="host-players-workspace__title-icon" aria-hidden />
            Roster
          </h2>
          {playerCardsCount > 0 ? (
            <button type="button" className="btn-primary host-r4-btn-primary" onClick={onOpenPlayerCards}>
              Player cards ({playerCardsCount})
            </button>
          ) : null}
        </div>
        {roster.length === 0 ? (
          <p className="host-players-workspace__empty">No players joined yet.</p>
        ) : (
          <ul className="host-players-workspace__list">
            {roster.map((p) => (
              <li key={p.playerId} className="host-players-workspace__row">
                <span className="host-players-workspace__name">{p.playerName}</span>
                {p.inPerson ? (
                  <span className="host-players-workspace__badge host-players-workspace__badge--in-person">
                    In person
                  </span>
                ) : (
                  <span className="host-players-workspace__badge host-players-workspace__badge--online">
                    Online
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default HostPlayersPanel;
