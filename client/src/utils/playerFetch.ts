import { API_BASE } from '../config';

const JWT_KEY = 'tempo_player_jwt';

export type PlayerAccountUser = {
  id: number;
  email: string;
  displayName: string;
  avatar?: string;
  createdAt?: string;
};

export type PlayerStats = {
  gamesJoined: number;
  marksMade: number;
  bingosCalled: number;
  bingosWon: number;
  updatedAt?: string | null;
};

export type PlayerRoundHistory = {
  roomId: string;
  roundToken: string;
  marksCount: number;
  bingoCalled: boolean;
  bingoWon: boolean;
  startedAt?: string | null;
  endedAt?: string | null;
};

export function getPlayerJwt(): string | null {
  try {
    return localStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}

export function setPlayerJwt(token: string): void {
  try {
    localStorage.setItem(JWT_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearPlayerJwt(): void {
  try {
    localStorage.removeItem(JWT_KEY);
  } catch {
    /* ignore */
  }
}

export function playerFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const t = getPlayerJwt();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  return fetch(input, { credentials: 'include', ...init, headers });
}

export async function fetchPlayerSession(): Promise<{
  user: PlayerAccountUser | null;
  stats: PlayerStats | null;
  recentRounds: PlayerRoundHistory[];
  playerToken?: string;
}> {
  const res = await playerFetch(`${API_BASE || ''}/api/player/me`);
  if (!res.ok) {
    return { user: null, stats: null, recentRounds: [] };
  }
  const j = (await res.json()) as {
    user?: PlayerAccountUser | null;
    stats?: PlayerStats | null;
    recentRounds?: PlayerRoundHistory[];
    playerToken?: string;
  };
  if (j.playerToken) setPlayerJwt(j.playerToken);
  return {
    user: j.user ?? null,
    stats: j.stats ?? null,
    recentRounds: j.recentRounds ?? [],
    playerToken: j.playerToken,
  };
}

export async function playerLogout(): Promise<void> {
  clearPlayerJwt();
  try {
    await playerFetch(`${API_BASE || ''}/api/player/logout`, { method: 'POST' });
  } catch {
    /* ignore */
  }
}

export async function updatePlayerDisplayName(displayName: string): Promise<{
  user: PlayerAccountUser;
}> {
  return updatePlayerProfile({ displayName });
}

export async function updatePlayerProfile(patch: {
  displayName?: string;
  avatar?: string;
  dataUrl?: string;
  imageUrl?: string;
}): Promise<{ user: PlayerAccountUser }> {
  const body: Record<string, string> = {};
  if (patch.displayName != null) body.displayName = patch.displayName.trim();
  if (patch.avatar !== undefined) body.avatar = patch.avatar;
  if (patch.dataUrl) body.dataUrl = patch.dataUrl;
  if (patch.imageUrl) body.imageUrl = patch.imageUrl;
  const res = await playerFetch(`${API_BASE || ''}/api/player/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { user?: PlayerAccountUser; message?: string };
  if (!res.ok || !j.user) {
    throw new Error(j.message || 'Could not update profile');
  }
  return { user: j.user };
}
