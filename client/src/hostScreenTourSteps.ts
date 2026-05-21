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
      body: 'This is the control room for your room code. Players join with the same room number from the home page.',
      placement: 'bottom',
      visible: true,
    },
    {
      id: 'connection',
      title: 'Connection',
      body: 'Link Spotify and pick a playback device (or set up YouTube Music). Do this before building rounds or starting the show.',
      placement: 'bottom',
      visible: true,
    },
    {
      id: 'go-live',
      title: 'Start the show',
      body: 'When prep is done, Start Game finalizes the mix if needed and begins playback. Finalize Mix is optional for an early projector preview.',
      placement: 'bottom',
      visible: ctx.showGoLive,
    },
    {
      id: 'live-dock',
      title: 'Live show bar',
      body: 'While playing: now playing, pause/skip, volume, and quick actions stay pinned at the top so you never hunt for controls mid-round.',
      placement: 'bottom',
      visible: ctx.showLiveDock,
    },
    {
      id: 'rounds-panel',
      title: 'Rounds & playlists',
      body: 'Full round prep: numbered tabs, playlist order, patterns, Save/Print, event actions, and playback settings.',
      placement: 'right',
      visible: true,
    },
    {
      id: 'round-builder',
      title: 'Playlist library',
      body: 'Opens the Spotify/YouTube playlist grid. Drag playlists into the active round bucket on the host screen.',
      placement: 'left',
      visible: true,
    },
    {
      id: 'round-setlist',
      title: 'Rounds & playlists',
      body: 'Round tabs, patterns, playlist order, Save/Print/Call sheet, and event actions — same controls as before, now always visible here.',
      placement: 'right',
      visible: true,
    },
    {
      id: 'projector-settings',
      title: 'Projector & event rules',
      body: 'Hybrid mode, public display text size, Rules/Splash/Call List screens, title reveal timing, and YouTube playback window.',
      placement: 'left',
      visible: true,
    },
  ];

  return steps.filter((s) => s.visible !== false);
}
