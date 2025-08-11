// Runtime configuration for API and Socket URLs
// In production (Railway), leave env vars unset to use same-origin requests

const defaultOrigin = typeof window !== 'undefined' ? window.location.origin : '';

export const API_BASE: string =
  (process.env.REACT_APP_API_BASE as string | undefined) || '';

export const SOCKET_URL: string =
  (process.env.REACT_APP_SOCKET_URL as string | undefined) || defaultOrigin || '';


