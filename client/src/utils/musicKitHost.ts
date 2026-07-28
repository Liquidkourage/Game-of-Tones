/** Load MusicKit JS from Apple CDN and configure with a developer token. */

declare global {
  interface Window {
    MusicKit?: {
      configure: (opts: {
        developerToken: string;
        app: { name: string; build?: string };
      }) => Promise<MusicKitInstance> | MusicKitInstance;
      getInstance: () => MusicKitInstance;
    };
  }
}

export type MusicKitInstance = {
  authorize: () => Promise<string>;
  unauthorize: () => Promise<void>;
  isAuthorized: boolean;
  musicUserToken?: string;
  setQueue: (opts: { song?: string; songs?: string[] }) => Promise<unknown>;
  play: () => Promise<unknown>;
  pause: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  seekToTime: (seconds: number) => Promise<unknown> | void;
  volume: number;
};

let scriptPromise: Promise<void> | null = null;

export function ensureMusicKitScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.MusicKit) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="musickit.js"]');
      if (existing) {
        const check = () => {
          if (window.MusicKit) resolve();
          else setTimeout(check, 50);
        };
        check();
        return;
      }
      const tag = document.createElement('script');
      tag.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error('Failed to load MusicKit JS'));
      document.head.appendChild(tag);
    });
  }
  return scriptPromise;
}

/**
 * Configure MusicKit with a fresh developer token. Safe to call again when the token rotates.
 */
export async function configureMusicKit(developerToken: string): Promise<MusicKitInstance> {
  await ensureMusicKitScript();
  if (!window.MusicKit) {
    throw new Error('MusicKit failed to load');
  }
  const configured = await window.MusicKit.configure({
    developerToken,
    app: {
      name: 'Tempo',
      build: '1.0.0',
    },
  });
  return (configured as MusicKitInstance) || window.MusicKit.getInstance();
}

export function getMusicKitInstance(): MusicKitInstance | null {
  try {
    return window.MusicKit?.getInstance() ?? null;
  } catch {
    return null;
  }
}
