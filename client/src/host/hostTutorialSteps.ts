import type { HostGlassNavId } from './hostGlassNav';
import type { HostSetupStep } from '../components/host/HostSetupFlow';

export type HostTutorialStepDef = {
  id: string;
  title: string;
  body: string;
  /** Highlight target in host UI */
  target?: string;
  nav?: HostGlassNavId;
  setupStep?: HostSetupStep;
};

export const HOST_TUTORIAL_STEPS: HostTutorialStepDef[] = [
  {
    id: 'playlist',
    title: 'Choose a playlist',
    body: 'Start with playlists. They decide which songs can appear on cards and in playback.',
    target: '[data-host-tutorial="playlist"]',
    nav: 'game',
    setupStep: 'playlist',
  },
  {
    id: 'criteria',
    title: 'Set criteria',
    body: 'Pick the win pattern, clip length, and other rules for this round.',
    target: '[data-host-tutorial="criteria"]',
    nav: 'game',
    setupStep: 'criteria',
  },
  {
    id: 'play',
    title: 'Review and start',
    body: 'Check the summary, build the song pool if needed, then start when the room is ready.',
    target: '[data-host-tutorial="play"]',
    nav: 'game',
    setupStep: 'play',
  },
  {
    id: 'live',
    title: 'Live host controls',
    body: 'While live: pause, skip, replay the clip, and mark songs as played from the Game tab.',
    target: '[data-host-tutorial="live-controls"]',
    nav: 'game',
  },
  {
    id: 'players',
    title: 'Players join',
    body: 'Share the room code from the header. Open Players to see who joined and manage cards.',
    target: '[data-host-tutorial="players"]',
    nav: 'players',
  },
  {
    id: 'display',
    title: 'Projector display',
    body: 'Open Display to tune projector rules and copy the public display link for the venue screen.',
    target: '[data-host-tutorial="display"]',
    nav: 'display',
  },
  {
    id: 'bingo',
    title: 'Approve or reject bingo',
    body: 'When a player calls bingo, verify the card here. Approve only if the pattern is valid.',
    target: '[data-host-tutorial="bingo-verify"]',
    nav: 'game',
  },
  {
    id: 'end-round',
    title: 'End the round',
    body: 'Use End game when the round is over. Finalize scoring before starting the next round.',
    target: '[data-host-tutorial="end-round"]',
    nav: 'game',
  },
  {
    id: 'next-round',
    title: 'Set up the next round',
    body: 'Use New round or the timeline to plan the next playlist and criteria.',
    target: '[data-host-tutorial="next-round"]',
    nav: 'game',
  },
];
