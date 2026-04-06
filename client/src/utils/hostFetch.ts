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
  return fetch(input, { ...init, headers });
}

export function apiOrigin(): string {
  return (API_BASE || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
}
