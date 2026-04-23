import { API_BASE } from '../config';
import { hostFetch } from './hostFetch';

export type PlaylistExplicitStat = { total: number; explicitCount: number };

/**
 * POST /api/spotify/playlists/explicit-stats-batch in chunks.
 * Used by HostView for the Manager list (priority rows first, then tail). GET /playlists no longer
 * requests includeExplicitStats to avoid doubling Spotify work on first load.
 */
export async function fetchPlaylistExplicitStatsBatch(
  playlistIds: string[],
): Promise<{ merged: Record<string, PlaylistExplicitStat>; anyHttpError: boolean }> {
  const merged: Record<string, PlaylistExplicitStat> = {};
  let anyHttpError = false;
  const chunkSize = 30;
  for (let i = 0; i < playlistIds.length; i += chunkSize) {
    const chunk = playlistIds.slice(i, i + chunkSize);
    const res = await hostFetch(`${API_BASE || ''}/api/spotify/playlists/explicit-stats-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistIds: chunk }),
    });
    if (!res.ok) {
      anyHttpError = true;
      console.warn('explicit-stats-batch HTTP', res.status, res.statusText);
      continue;
    }
    const data = (await res.json()) as {
      results?: Record<string, { total?: number; explicitCount?: number; error?: string }>;
    };
    const r = data.results || {};
    for (const [pid, v] of Object.entries(r)) {
      if (
        v &&
        typeof v === 'object' &&
        typeof v.explicitCount === 'number' &&
        typeof v.total === 'number'
      ) {
        merged[String(pid)] = { total: v.total, explicitCount: v.explicitCount };
      } else if (v && typeof v === 'object' && (v as { error?: string }).error) {
        console.warn('explicit-stats playlist', pid, (v as { error?: string }).error);
      }
    }
  }
  return { merged, anyHttpError };
}

export async function runExplicitStatsWithRetries(
  ids: string[],
  maxAttempts = 3,
): Promise<Record<string, PlaylistExplicitStat>> {
  let lastMerged: Record<string, PlaylistExplicitStat> = {};
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 900 * attempt));
    }
    const { merged, anyHttpError } = await fetchPlaylistExplicitStatsBatch(ids);
    lastMerged = { ...lastMerged, ...merged };
    if (!anyHttpError) break;
  }
  return lastMerged;
}
