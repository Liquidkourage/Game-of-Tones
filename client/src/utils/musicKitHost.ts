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

const MUSICKIT_SCRIPT_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';

let scriptPromise: Promise<void> | null = null;

function waitForMusicKitGlobal(timeoutMs = 15000): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.MusicKit) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      if (!window.MusicKit) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('musickitloaded', onLoaded);
      resolve();
    };
    const onLoaded = () => done();
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('musickitloaded', onLoaded);
      reject(new Error('MusicKit JS loaded but did not initialize in time'));
    }, timeoutMs);

    window.addEventListener('musickitloaded', onLoaded);
    // Poll in case the event fired before we subscribed
    const poll = window.setInterval(() => {
      if (window.MusicKit) {
        window.clearInterval(poll);
        done();
      }
    }, 50);
  });
}

export function ensureMusicKitScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.MusicKit) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[src*="musickit"]`) as HTMLScriptElement | null;
      const fail = (err: Error) => {
        scriptPromise = null;
        reject(err);
      };

      const afterScriptPresent = () => {
        void waitForMusicKitGlobal()
          .then(resolve)
          .catch(fail);
      };

      if (existing) {
        afterScriptPresent();
        return;
      }

      const tag = document.createElement('script');
      tag.src = MUSICKIT_SCRIPT_SRC;
      tag.async = true;
      tag.crossOrigin = 'anonymous';
      tag.onload = () => afterScriptPresent();
      tag.onerror = () =>
        fail(
          new Error(
            'Failed to load MusicKit JS (blocked or network). If this is production, ensure CSP allows https://js-cdn.music.apple.com.',
          ),
        );
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

function readMusicUserToken(music: MusicKitInstance): string {
  const direct = typeof music.musicUserToken === 'string' ? music.musicUserToken.trim() : '';
  if (direct) return direct;
  return '';
}

/**
 * Authorize MusicKit. Works around Apple’s hang-after-Allow by also polling musicUserToken.
 */
export async function authorizeMusicKit(
  music: MusicKitInstance,
  timeoutMs = 90_000,
): Promise<string> {
  let settled = false;

  const fromPoll = new Promise<string>((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (settled) {
        window.clearInterval(timer);
        return;
      }
      const token = readMusicUserToken(music);
      if (token && music.isAuthorized) {
        window.clearInterval(timer);
        settled = true;
        resolve(token);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        window.clearInterval(timer);
        settled = true;
        reject(
          new Error(
            'Apple Music authorization timed out after Allow. Hard-refresh and try again (Referrer-Policy must allow origin).',
          ),
        );
      }
    }, 200);
  });

  const fromAuthorize = (async () => {
    try {
      const result = await music.authorize();
      const fromReturn = typeof result === 'string' ? result.trim() : '';
      const token = fromReturn || readMusicUserToken(music);
      if (!token) {
        throw new Error('Apple Music authorization was cancelled or returned no token.');
      }
      return token;
    } catch (e) {
      // If polling already got a token, ignore authorize() rejection/hang side effects.
      const token = readMusicUserToken(music);
      if (token && music.isAuthorized) return token;
      throw e;
    }
  })();

  try {
    const token = await Promise.race([fromAuthorize, fromPoll]);
    settled = true;
    return token;
  } catch (e) {
    settled = true;
    const token = readMusicUserToken(music);
    if (token && music.isAuthorized) return token;
    throw e;
  }
}

