import { API_BASE } from '../config';
import { hostFetch } from './hostFetch';
import type { SavedCompositePattern, SavedCustomPattern } from '../patternDefinitions';
import {
  getSavedCompositePatterns,
  getSavedCustomPatterns,
  mergeSavedCompositePatterns,
  mergeSavedCustomPatterns,
} from '../patternDefinitions';

export type OrgSharedPlaylistRef = {
  id: string;
  name: string;
  tracks?: number;
  updatedAt?: number;
};

export type OrgSharedHostAssets = {
  organizationId?: number;
  customPatterns: SavedCustomPattern[];
  compositePatterns: SavedCompositePattern[];
  playlistRefs: OrgSharedPlaylistRef[];
  updatedAt?: string | null;
};

export type PullOrgSharedHostAssetsResult =
  | { ok: true; assets: OrgSharedHostAssets }
  | { ok: false; reason: 'no_org' | 'unauthorized' | 'unavailable' | 'error' };

/** Pull org team patterns + playlist refs; merge patterns into localStorage. */
export async function pullOrgSharedHostAssets(): Promise<PullOrgSharedHostAssetsResult> {
  try {
    const r = await hostFetch(`${API_BASE || ''}/api/org/shared-host-assets`, { cache: 'no-store' });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'unauthorized' };
    if (r.status === 404) return { ok: false, reason: 'no_org' };
    if (r.status === 503) return { ok: false, reason: 'unavailable' };
    if (!r.ok) return { ok: false, reason: 'error' };
    const data = (await r.json()) as OrgSharedHostAssets;
    const custom = Array.isArray(data.customPatterns) ? data.customPatterns : [];
    const composite = Array.isArray(data.compositePatterns) ? data.compositePatterns : [];
    mergeSavedCustomPatterns(custom);
    mergeSavedCompositePatterns(composite);
    return {
      ok: true,
      assets: {
        organizationId: data.organizationId,
        customPatterns: getSavedCustomPatterns(),
        compositePatterns: getSavedCompositePatterns(),
        playlistRefs: Array.isArray(data.playlistRefs) ? data.playlistRefs : [],
        updatedAt: data.updatedAt ?? null,
      },
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Push this browser's pattern libraries (and optional playlist refs) to the org team shelf. */
export async function pushOrgSharedHostAssets(opts?: {
  mode?: 'merge' | 'replace';
  playlistRefs?: OrgSharedPlaylistRef[];
  includePatterns?: boolean;
}): Promise<boolean> {
  const mode = opts?.mode === 'replace' ? 'replace' : 'merge';
  const includePatterns = opts?.includePatterns !== false;
  const body: Record<string, unknown> = { mode };
  if (includePatterns) {
    body.customPatterns = getSavedCustomPatterns();
    body.compositePatterns = getSavedCompositePatterns();
  }
  const playlistRefs = opts?.playlistRefs;
  if (Array.isArray(playlistRefs)) {
    body.playlistRefs = playlistRefs;
  }
  try {
    const r = await hostFetch(`${API_BASE || ''}/api/org/shared-host-assets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}
