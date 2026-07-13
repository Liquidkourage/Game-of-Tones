/** Lightweight pointer so a closed/refreshed host tab can find the live room again. */
export const HOST_ACTIVE_ROOM_KEY = 'tempo_host_active_room';

export type HostActiveRoomPointer = {
  roomId: string;
  gameState?: string;
  updatedAt: number;
};

export type HostGameState = 'waiting' | 'playing' | 'ended';

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
  // Bingo approved — host is between rounds (modal / prep next). Not live play.
  if (gs === 'round_complete') return false;
  if (gs === 'playing' || gs === 'paused_for_verification' || gs === 'paused') return true;
  if (p.isPlaying === true) return true;
  if (p.currentSong != null) return true;
  if (typeof p.totalPlayedCount === 'number' && p.totalPlayedCount > 0) return true;
  if (Array.isArray(p.playedSongIds) && p.playedSongIds.length > 0) return true;
  if (Array.isArray(p.playedSongs) && p.playedSongs.length > 0) return true;
  return false;
}

export function hostGameStateFromRoomPayload(payload: unknown): HostGameState {
  if (!payload || typeof payload !== 'object') return 'waiting';
  const gs = (payload as Record<string, unknown>).gameState;
  if (gs === 'ended') return 'ended';
  // Must run before call-log heuristics — round_complete still carries playedSongIds.
  if (gs === 'round_complete') return 'waiting';
  if (gs === 'playing' || gs === 'paused_for_verification' || gs === 'paused') return 'playing';
  if (roomPayloadIndicatesLiveRound(payload)) return 'playing';
  return 'waiting';
}

/**
 * Merge server room-state into host gameState.
 * Room-state may broadcast empty call-log resets while the round is still live — never downgrade playing → waiting here.
 * Exception: `round_complete` (bingo approved) is intentionally between rounds — always allow waiting.
 */
export function mergeHostGameStateFromRoomPayload(
  previous: HostGameState,
  payload: unknown,
): HostGameState {
  const derived = hostGameStateFromRoomPayload(payload);
  if (derived === 'ended') return 'ended';
  const gs =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).gameState
      : undefined;
  if (gs === 'round_complete') return 'waiting';
  if (derived === 'playing') return 'playing';
  if (previous === 'playing') return 'playing';
  return 'waiting';
}

/**
 * End the "awaiting live sync" gate only when authoritative state confirms live, ended, or a settled idle room.
 * Do not treat a bare waiting label as "not started" while this tab recently had a live round here.
 */
export function shouldClearHostAwaitingLiveSync(
  roomId: string | undefined,
  merged: HostGameState,
  payload: unknown,
): boolean {
  if (merged === 'playing' || merged === 'ended') return true;
  if (!hostRoomExpectsLiveRecovery(roomId)) return true;
  return !roomPayloadIndicatesLiveRound(payload);
}

export function persistActiveHostRoomFromPayload(roomId: string, payload: unknown): void {
  const derived = hostGameStateFromRoomPayload(payload);
  const ptr = readActiveHostRoom();
  const merged =
    ptr?.roomId === roomId && ptr.gameState === 'playing' && derived === 'waiting' ? 'playing' : derived;
  const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).gameState : undefined;
  writeActiveHostRoom({
    roomId,
    gameState:
      merged === 'playing'
        ? 'playing'
        : raw != null
          ? String(raw)
          : merged,
    updatedAt: Date.now(),
  });
}
