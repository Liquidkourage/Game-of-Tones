import type { HostTourStep } from './components/HostScreenTour';

export type HostTourContext = {
  gameState: 'waiting' | 'playing' | 'ended';
  hasCurrentSong: boolean;
  showGoLive: boolean;
  showLiveDock: boolean;
  showFinalizeMix: boolean;
};

export function buildHostScreenTourSteps(ctx: HostTourContext): HostTourStep[] {
  const steps: HostTourStep[] = [
    {
      id: 'header-brand',
      title: 'Your host dashboard',
      body: '',
      placement: 'bottom',
      visible: true,
    },
    {
      id: 'connection',
      title: 'Connection',
      body: '',
      placement: 'bottom',
      visible: true,
    },
    {
      id: 'go-live',
      title: 'Start the show',
      body: '',
      placement: 'bottom',
      visible: ctx.showGoLive,
    },
    {
      id: 'live-dock',
      title: 'Now playing (pinned)',
      body: '',
      placement: 'bottom',
      visible: ctx.showLiveDock,
    },
    {
      id: 'rounds-panel',
      title: 'Rounds & playlists',
      body: '',
      placement: 'right',
      visible: true,
    },
    {
      id: 'round-builder',
      title: 'Playlist library',
      body: '',
      placement: 'left',
      visible: true,
    },
    {
      id: 'players-panel',
      title: 'Players',
      body: '',
      placement: 'right',
      visible: true,
    },
    {
      id: 'settings-panel',
      title: 'Settings',
      body: '',
      placement: 'right',
      visible: true,
    },
    {
      id: 'round-setlist',
      title: 'Round builder details',
      body: '',
      placement: 'right',
      visible: true,
    },
    {
      id: 'projector-settings',
      title: 'Projector & event rules',
      body: '',
      placement: 'left',
      visible: true,
    },
  ];

  return steps.filter((s) => s.visible !== false);
}
