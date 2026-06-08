/** Lightweight pointer so a closed/refreshed host tab can find the live room again. */
export const HOST_ACTIVE_ROOM_KEY = 'tempo_host_active_room';

export type HostActiveRoomPointer = {
  roomId: string;
  gameState?: string;
  updatedAt: number;
};

export function readActiveHostRoom(): HostActiveRoomPointer | null {
  try {
    const raw = sessionStorage.getItem(HOST_ACTIVE_ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HostActiveRoomPointer;
    if (!parsed?.roomId || typeof parsed.roomId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeActiveHostRoom(pointer: HostActiveRoomPointer): void {
  try {
    sessionStorage.setItem(HOST_ACTIVE_ROOM_KEY, JSON.stringify(pointer));
  } catch {
    /* ignore */
  }
}

export function clearActiveHostRoom(): void {
  try {
    sessionStorage.removeItem(HOST_ACTIVE_ROOM_KEY);
  } catch {
    /* ignore */
  }
}

/** Room was live on this device recently — wait for server room-state before showing go-live UI. */
export function hostRoomExpectsLiveRecovery(roomId: string | undefined): boolean {
  if (!roomId) return false;
  const ptr = readActiveHostRoom();
  if (!ptr || ptr.roomId !== roomId) return false;
  const gs = ptr.gameState;
  return gs === 'playing' || gs === 'paused_for_verification' || gs === 'paused';
}

/** Server payload still has an in-progress round (authoritative over transient waiting labels). */
export function roomPayloadIndicatesLiveRound(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  const gs = p.gameState;
  if (gs === 'playing' || gs === 'paused_for_verification' || gs === 'paused') return true;
  if (p.isPlaying === true) return true;
  if (p.currentSong != null) return true;
  if (typeof p.totalPlayedCount === 'number' && p.totalPlayedCount > 0) return true;
  if (Array.isArray(p.playedSongIds) && p.playedSongIds.length > 0) return true;
  if (Array.isArray(p.playedSongs) && p.playedSongs.length > 0) return true;
  return false;
}

export function hostGameStateFromRoomPayload(payload: unknown): 'waiting' | 'playing' | 'ended' {
  if (!payload || typeof payload !== 'object') return 'waiting';
  const gs = (payload as Record<string, unknown>).gameState;
  if (gs === 'ended') return 'ended';
  if (gs === 'playing' || gs === 'paused_for_verification' || gs === 'paused') return 'playing';
  if (roomPayloadIndicatesLiveRound(payload)) return 'playing';
  return 'waiting';
}

export function persistActiveHostRoomFromPayload(roomId: string, payload: unknown): void {
  const derived = hostGameStateFromRoomPayload(payload);
  const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).gameState : undefined;
  writeActiveHostRoom({
    roomId,
    gameState:
      derived === 'playing'
        ? 'playing'
        : raw != null
          ? String(raw)
          : derived,
    updatedAt: Date.now(),
  });
}
