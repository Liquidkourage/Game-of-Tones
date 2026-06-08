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
  return gs === 'playing' || gs === 'paused_for_verification';
}
