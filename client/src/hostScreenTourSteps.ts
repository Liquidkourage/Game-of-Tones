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
      body: 'This is Game of Tones (TEMPO): your control room for one room code. Players join on their phones with the same code. Everything you do here — playlists, patterns, Start Game, and projector settings — applies to that live room.',
      placement: 'bottom',
      visible: true,
    },
    {
      id: 'connection',
      title: 'Connection',
      body: 'Connect Spotify and choose the playback device that will play clips for the room. Do this before you build rounds. Saved host preferences (snippet length, random start, reveal style) apply to new rounds on this device.',
      placement: 'bottom',
      visible: true,
    },
    {
      id: 'go-live',
      title: 'Start the show',
      body: 'When prep is ready, Start Game shuffles the 75-track pool into play order, pushes player cards, and begins playback 1→75. The bingo pool list and projector call numbers use that same order — #1 is always the first song played.',
      placement: 'bottom',
      visible: ctx.showGoLive,
    },
    {
      id: 'live-dock',
      title: 'Now playing (pinned)',
      body: 'While the round runs, this bar stays at the top: current track, position in the round (e.g. 12/75), pause/skip, and volume. The bingo pool below scrolls to highlight the active song so you can cross-check titles during the show.',
      placement: 'bottom',
      visible: ctx.showLiveDock,
    },
    {
      id: 'rounds-panel',
      title: 'Rounds & playlists',
      body: 'Plan each round here: round tabs, winning pattern, playlist order (drag from the library), Save round, printable cards, and call sheet. Five playlists use 5×15 cards; one playlist uses a 1×75 full-card style pool.',
      placement: 'right',
      visible: true,
    },
    {
      id: 'round-builder',
      title: 'Playlist library',
      body: 'Opens your Spotify playlists (and YouTube when enabled). Drag rows into the active round bucket. Track counts update so you can see if you have enough unique songs before you finalize.',
      placement: 'left',
      visible: true,
    },
    {
      id: 'round-setlist',
      title: 'Round builder details',
      body: 'Inside the planner: pick the pattern, toggle free space, finalize the mix when prompted, and use Event actions for save/print/reset. Playback snippet length and start position live under Saved host preferences.',
      placement: 'right',
      visible: true,
    },
    {
      id: 'projector-settings',
      title: 'Projector & event rules',
      body: 'This panel stays open by default. Set hybrid in-person rules, projector text size (100% = auto-fit for 1080p), reveal timing, and push Rules / Splash / Call List to the venue screen. Production shows use Auto call layout (5×15 or 1×75).',
      placement: 'left',
      visible: true,
    },
  ];

  return steps.filter((s) => s.visible !== false);
}
