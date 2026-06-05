import { API_BASE } from '../config';

const JWT_KEY = 'tempo_player_jwt';

export type PlayerAccountUser = {
  id: number;
  email: string;
  displayName: string;
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
  room_id: string;
  round_token: string;
  marks_count: number;
  bingo_called: boolean;
  bingo_won: boolean;
  started_at?: string;
  ended_at?: string | null;
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
