import { API_BASE } from '../config';

const JWT_KEY = 'tempo_host_jwt';

export function getHostJwt(): string | null {
  try {
    return localStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}

export function setHostJwt(token: string): void {
  try {
    localStorage.setItem(JWT_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearHostJwt(): void {
  try {
    localStorage.removeItem(JWT_KEY);
  } catch {
    /* ignore */
  }
}

/** API requests with optional host Bearer token (cross-origin dev: set REACT_APP_API_BASE). */
export function hostFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const t = getHostJwt();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  return fetch(input, { credentials: 'include', ...init, headers });
}

export function apiOrigin(): string {
  return (API_BASE || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
}

/**
 * Sign out: clear `tempo_host_jwt` then full-page GET so Set-Cookie is applied.
 * The HttpOnly session is set on the *app* origin (Google OAuth is started from `window.location`); if
 * `REACT_APP_API_BASE` is a different host (e.g. Railway), logging out *only* on the API never sends that
 * cookie, so it never clears. We hit the *page* origin first, then chain the API when they differ.
 */
export function postHostLogout(): void {
  clearHostJwt();
  if (typeof window === 'undefined') return;
  const returnTo = window.location.href;
  const page = window.location.origin.replace(/\/$/, '');
  const envApi = (API_BASE || '').trim().replace(/\/$/, '');
  const cb = `_${Date.now().toString(36)}`;

  if (!envApi || envApi === page) {
    window.location.replace(
      `${page}/api/auth/logout?return=${encodeURIComponent(returnTo)}&_cb=${cb}`
    );
    return;
  }
  // Chain: app host clears the cookie the browser has for this site, then the API host (same logic).
  const back = encodeURIComponent(returnTo);
  const secondHop = `${envApi}/api/auth/logout?return=${back}&_cb=${cb}2`;
  const first = `${page}/api/auth/logout?return=${encodeURIComponent(secondHop)}&_cb=${cb}1`;
  window.location.replace(first);
}

/**
 * Full URL to start Google host login. Always use the SPA's origin (window.location), not apiOrigin(),
 * so the OAuth round-trip and tempo_host_jwt in localStorage stay on the same site as the UI.
 * When REACT_APP_API_BASE points at another host, apiOrigin()/api/auth/google would open login on the
 * API host while the JWT is stored on the page origin — then API calls look "logged out".
 * Use one canonical app hostname in production (Spotify redirect URI + bookmarks); storage does not
 * sync across subdomains (got.* vs tempo.*), which looks like random failures until the "right" try.
 */
export function browserGoogleLoginUrl(): string {
  if (typeof window === 'undefined') return '/api/auth/google';
  return `${window.location.origin.replace(/\/$/, '')}/api/auth/google`;
}
