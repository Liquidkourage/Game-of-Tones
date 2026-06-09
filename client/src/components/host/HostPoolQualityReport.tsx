import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';

type PoolSong = { id: string; name?: string; artist?: string; explicit?: boolean };

type HostPoolQualityReportProps = {
  songs: PoolSong[];
  playlistCount: number;
  mixFinalized: boolean;
};

const HostPoolQualityReport: React.FC<HostPoolQualityReportProps> = ({
  songs,
  playlistCount,
  mixFinalized,
}) => {
  const report = useMemo(() => {
    const ids = songs.map((s) => s.id);
    const unique = new Set(ids);
    const dupes = ids.length - unique.size;
    const shortTitles = songs.filter((s) => (s.name || '').trim().length > 0 && (s.name || '').trim().length < 4);
    const explicit = songs.filter((s) => s.explicit).length;
    const need75 = playlistCount === 5 || playlistCount === 1;
    const countOk = !need75 || songs.length >= 75;
    return { dupes, shortTitles, explicit, countOk, total: songs.length };
  }, [songs, playlistCount]);

  if (songs.length === 0) return null;

  const issues: string[] = [];
  if (report.dupes > 0) issues.push(`${report.dupes} duplicate track id(s) in pool`);
  if (!report.countOk) issues.push(`Need at least 75 tracks for this layout (have ${report.total})`);
  if (report.shortTitles.length > 0) {
    issues.push(`${report.shortTitles.length} very short title(s) — check display masking`);
  }

  return (
    <section className="host-pool-quality host-glass-panel" aria-label="Pool quality">
      <h2 className="host-pool-quality__title">Pool quality</h2>
      <p className="host-pool-quality__lead">
        {mixFinalized ? 'Finalized mix' : 'Preview'} · {report.total} tracks
        {report.explicit > 0 ? ` · ${report.explicit} explicit` : ''}
      </p>
      {issues.length === 0 ? null : (
        <ul className="host-pool-quality__issues">
          {issues.map((line) => (
            <li key={line}>
              <AlertTriangle className="w-4 h-4" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default HostPoolQualityReport;
