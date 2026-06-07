import React from 'react';
import type { HostActivityEntry } from '../../host/hostActivityLog';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

const HostActivityFeed: React.FC<{ entries: HostActivityEntry[] }> = ({ entries }) => (
  <section className="host-activity-feed host-glass-panel" aria-label="Host activity">
    <h2 className="host-activity-feed__title">Activity</h2>
    {entries.length === 0 ? (
      <p className="host-activity-feed__empty">None yet.</p>
    ) : (
      <ol className="host-activity-feed__list">
        {entries.map((e) => (
          <li
            key={e.id}
            className={`host-activity-feed__item host-activity-feed__item--${e.level}`}
          >
            <time dateTime={new Date(e.at).toISOString()}>{formatTime(e.at)}</time>
            <span>{e.message}</span>
          </li>
        ))}
      </ol>
    )}
  </section>
);

export default HostActivityFeed;
