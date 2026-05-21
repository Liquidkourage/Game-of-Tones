import type { HostTourStep } from './components/HostScreenTour';

export type HostTourContext = {
  gameState: 'waiting' | 'playing' | 'ended';
  hasCurrentSong: boolean;
  showGoLive: boolean;
  showLiveDock: boolean;
  showRoundMeta: boolean;
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
      body: 'Your event at a glance: connection status, round counts, and the active round’s playlists, pattern, and track pool.',
      placement: 'right',
      visible: true,
    },
    {
      id: 'round-builder',
      title: 'Round builder',
      body: 'Open this to drag playlists into round buckets, set bingo patterns, Save round, print PDFs, and use Event actions (reset, clear cache).',
      placement: 'left',
      visible: true,
    },
    {
      id: 'round-setlist',
      title: 'Active round & mix',
      body: 'Shows which round is loaded, its playlists, pattern, and how many tracks are in the pool. Updates when you switch rounds in Round builder.',
      placement: 'top',
      visible: true,
    },
    {
      id: 'round-meta',
      title: 'Round controls',
      body: 'End round (stop and mark complete), Restart round (same round, fresh cards), or jump to the next planned round in your event.',
      placement: 'top',
      visible: ctx.showRoundMeta,
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
