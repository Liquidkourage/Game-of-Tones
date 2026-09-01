/** Per-room guest seat: proves this browser already joined — not the public ?name= URL. */

export type PlayerSeatClaim = {
  clientId: string;
  displayName: string;
  ts: number;
};

export type PlayerJoinIntent = {
  name: string;
  ts: number;
};

function seatKey(roomId: string) {
  return `player_seat_${String(roomId || '').trim().toUpperCase()}`;
}

function joinIntentKey(roomId: string) {
  return `player_join_intent_${String(roomId || '').trim().toUpperCase()}`;
}

export function getOrCreatePlayerClientId(): string {
  try {
    const existing = localStorage.getItem('client_id');
    if (existing && existing.length >= 8) return existing;
    const next =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('client_id', next);
    return next;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export function loadPlayerSeat(roomId: string | undefined): PlayerSeatClaim | null {
  if (!roomId) return null;
  try {
    const raw = localStorage.getItem(seatKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerSeatClaim;
    if (!parsed?.clientId || !parsed?.displayName) return null;
    return {
      clientId: String(parsed.clientId),
      displayName: String(parsed.displayName).trim(),
      ts: typeof parsed.ts === 'number' ? parsed.ts : 0,
    };
  } catch {
    return null;
  }
}

export function savePlayerSeat(roomId: string | undefined, clientId: string, displayName: string) {
  if (!roomId || !clientId || !displayName.trim()) return;
  try {
    const claim: PlayerSeatClaim = {
      clientId,
      displayName: displayName.trim(),
      ts: Date.now(),
    };
    localStorage.setItem(seatKey(roomId), JSON.stringify(claim));
  } catch {
    /* ignore */
  }
}

export function clearPlayerSeat(roomId: string | undefined) {
  if (!roomId) return;
  try {
    localStorage.removeItem(seatKey(roomId));
  } catch {
    /* ignore */
  }
}

/** Home → /player navigation: one-shot proof this device chose the name (not a shared link). */
export function writePlayerJoinIntent(roomId: string, name: string) {
  try {
    const intent: PlayerJoinIntent = { name: name.trim(), ts: Date.now() };
    sessionStorage.setItem(joinIntentKey(roomId), JSON.stringify(intent));
  } catch {
    /* ignore */
  }
}

/** Read join intent without consuming (Strict Mode safe). Stale after 10 minutes. */
export function readPlayerJoinIntent(roomId: string | undefined): string | null {
  if (!roomId) return null;
  try {
    const key = joinIntentKey(roomId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerJoinIntent;
    const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
    if (!name) return null;
    if (typeof parsed.ts === 'number' && Date.now() - parsed.ts > 10 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return null;
    }
    return name;
  } catch {
    return null;
  }
}

export function clearPlayerJoinIntent(roomId: string | undefined) {
  if (!roomId) return;
  try {
    sessionStorage.removeItem(joinIntentKey(roomId));
  } catch {
    /* ignore */
  }
}

/** @deprecated use readPlayerJoinIntent + clearPlayerJoinIntent */
export function consumePlayerJoinIntent(roomId: string | undefined): string | null {
  const name = readPlayerJoinIntent(roomId);
  clearPlayerJoinIntent(roomId);
  return name;
}

export function stripNameFromPlayerUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('name')) return;
    url.searchParams.delete('name');
    const qs = url.searchParams.toString();
    window.history.replaceState({}, '', `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`);
  } catch {
    /* ignore */
  }
}
