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
