/** MusicKit authorize popup sometimes navigates back to our host URL instead of closing. */

export const APPLE_MUSIC_AUTH_POPUP_DONE = 'got-apple-music-auth-popup-done';

function hasMusicKitStorageHints(): boolean {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) || '';
      if (k === 'ac' || k.startsWith('music.')) return true;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith('music.')) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function isLikelyAppleMusicAuthPopup(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.opener || window.opener.closed) return false;
  const ref = String(document.referrer || '');
  if (/apple\.com|itunes\.apple/i.test(ref)) return true;
  if (hasMusicKitStorageHints()) return true;
  // MusicKit auth windows are typically narrow
  if (window.outerWidth > 0 && window.outerWidth <= 560) return true;
  return false;
}

/**
 * If this tab is the leftover MusicKit auth popup on our origin, notify opener and close.
 * Returns true when we treated this window as that popup.
 */
export function closeAppleMusicAuthPopupIfNeeded(): boolean {
  if (!isLikelyAppleMusicAuthPopup()) return false;
  try {
    window.opener!.postMessage(
      {
        type: APPLE_MUSIC_AUTH_POPUP_DONE,
        href: window.location.href,
      },
      window.location.origin,
    );
  } catch {
    /* ignore */
  }
  try {
    window.close();
  } catch {
    /* ignore */
  }
  // If the browser blocked window.close(), leave a tiny message instead of the full host UI.
  try {
    document.body.innerHTML =
      '<p style="font:16px/1.4 system-ui,sans-serif;padding:24px;color:#e8eef5">Apple Music authorization finished. You can close this window.</p>';
  } catch {
    /* ignore */
  }
  return true;
}
