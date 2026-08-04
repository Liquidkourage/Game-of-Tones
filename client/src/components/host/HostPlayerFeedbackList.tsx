import React from 'react';
import './HostPlayerFeedbackList.css';

export type PlayerFeedbackEntry = {
  id: string;
  playerName: string;
  message: string;
  submittedAt: number;
};

type HostPlayerFeedbackListProps = {
  entries: PlayerFeedbackEntry[];
};

const feedbackTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const HostPlayerFeedbackList: React.FC<HostPlayerFeedbackListProps> = ({ entries }) => {
  if (entries.length === 0) {
    return <p className="host-player-feedback-list__empty">No feedback received yet.</p>;
  }

  return (
    <ol className="host-player-feedback-list" aria-label="Player feedback, newest first">
      {[...entries].reverse().map((entry) => (
        <li key={entry.id} className="host-player-feedback-list__item">
          <div className="host-player-feedback-list__meta">
            <strong>{entry.playerName}</strong>
            <time dateTime={new Date(entry.submittedAt).toISOString()}>
              {feedbackTime.format(entry.submittedAt)}
            </time>
          </div>
          <p className="host-player-feedback-list__message">{entry.message}</p>
        </li>
      ))}
    </ol>
  );
};

export default HostPlayerFeedbackList;
