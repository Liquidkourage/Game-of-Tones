import React from 'react';
import { AlertTriangle } from 'lucide-react';

export type PlaylistAvailabilityIssue = {
  playlistId: string;
  playlistName: string;
  removed: number;
  unplayable: number;
  samples: Array<{ reason: string; name?: string; artist?: string }>;
};

export function buildPlaylistAvailabilityIssues(
  playlists: ReadonlyArray<{
    id: string;
    name: string;
    youtubeMusic?: boolean;
    catalog?: boolean;
    tracksRemoved?: number;
    tracksUnplayable?: number;
    unplayableSamples?: Array<{ reason: string; name?: string; artist?: string }>;
  }>,
): PlaylistAvailabilityIssue[] {
  const issues: PlaylistAvailabilityIssue[] = [];
  for (const pl of playlists) {
    if (pl.youtubeMusic || pl.catalog) continue;
    const removed = pl.tracksRemoved ?? 0;
    const unplayable = pl.tracksUnplayable ?? 0;
    if (removed + unplayable <= 0) continue;
    issues.push({
      playlistId: pl.id,
      playlistName: pl.name,
      removed,
      unplayable,
      samples: Array.isArray(pl.unplayableSamples) ? pl.unplayableSamples.slice(0, 5) : [],
    });
  }
  return issues;
}

type Props = {
  issues: PlaylistAvailabilityIssue[];
  compact?: boolean;
};

const HostPlaylistAvailabilityWarnings: React.FC<Props> = ({ issues, compact = false }) => {
  if (issues.length === 0) return null;

  const totalRemoved = issues.reduce((n, i) => n + i.removed, 0);
  const totalUnplayable = issues.reduce((n, i) => n + i.unplayable, 0);

  return (
    <div className="host-playlist-availability-warn" role="status">
      <p className="host-playlist-availability-warn__title">
        <AlertTriangle className="host-playlist-availability-warn__icon" aria-hidden />
        Some Spotify playlist rows won&apos;t play in Tempo
      </p>
      <p className="host-playlist-availability-warn__summary">
        {totalRemoved > 0 ? (
          <>
            <strong>{totalRemoved}</strong> removed from Spotify
          </>
        ) : null}
        {totalRemoved > 0 && totalUnplayable > 0 ? ' · ' : null}
        {totalUnplayable > 0 ? (
          <>
            <strong>{totalUnplayable}</strong> unavailable in your market
          </>
        ) : null}
        {!compact ? ' — excluded from the bingo pool.' : null}
      </p>
      <ul className="host-playlist-availability-warn__list">
        {issues.map((issue) => (
          <li key={issue.playlistId}>
            <strong>{issue.playlistName}</strong>
            {issue.removed > 0 ? ` · ${issue.removed} removed` : ''}
            {issue.unplayable > 0 ? ` · ${issue.unplayable} unavailable` : ''}
            {!compact && issue.samples.length > 0 ? (
              <span className="host-playlist-availability-warn__samples">
                {' '}
                — e.g.{' '}
                {issue.samples
                  .filter((s) => s.name)
                  .slice(0, 2)
                  .map((s) => `"${s.name}"${s.artist ? ` — ${s.artist}` : ''}`)
                  .join('; ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default HostPlaylistAvailabilityWarnings;
