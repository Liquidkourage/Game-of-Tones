export type HostGlassNavId = 'game' | 'rounds' | 'players' | 'display' | 'settings';

export const HOST_GLASS_NAV_ITEMS: Array<{
  id: HostGlassNavId;
  label: string;
}> = [
  { id: 'game', label: 'Game' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'players', label: 'Players' },
  { id: 'display', label: 'Display' },
  { id: 'settings', label: 'Settings' },
];

const HOST_GLASS_NAV_IDS = new Set<HostGlassNavId>(HOST_GLASS_NAV_ITEMS.map((item) => item.id));

/** Parse `?tab=rounds` (etc.) from host URLs — returns null when unknown or missing. */
export function parseHostGlassNavTab(raw: string | null | undefined): HostGlassNavId | null {
  if (!raw) return null;
  const tab = raw.trim().toLowerCase() as HostGlassNavId;
  return HOST_GLASS_NAV_IDS.has(tab) ? tab : null;
}
