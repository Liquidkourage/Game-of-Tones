import type { Socket } from 'socket.io-client';

/** Avoid tearing down the host socket on React Strict Mode remount (same room, ~ms apart). */
let hostSocketGen = 0;
let activeHostSocket: Socket | null = null;
let activeHostRoomId: string | null = null;
let activeHostSocketGen = 0;

export function acquireHostRoomSocket(roomId: string, createSocket: () => Socket): { socket: Socket; gen: number } {
  hostSocketGen += 1;
  const gen = hostSocketGen;
  activeHostSocketGen = gen;

  if (activeHostSocket && activeHostRoomId === roomId) {
    try {
      activeHostSocket.removeAllListeners();
    } catch {
      /* ignore */
    }
    return { socket: activeHostSocket, gen };
  }

  if (activeHostSocket) {
    try {
      activeHostSocket.removeAllListeners();
      activeHostSocket.close();
    } catch {
      /* ignore */
    }
    activeHostSocket = null;
    activeHostRoomId = null;
  }

  const socket = createSocket();
  activeHostSocket = socket;
  activeHostRoomId = roomId;
  return { socket, gen };
}

/** Defer close so a immediate remount (Strict Mode / route bounce) keeps the server host session. */
export function scheduleReleaseHostRoomSocket(gen: number, delayMs = 300): void {
  window.setTimeout(() => {
    if (activeHostSocketGen !== gen) return;
    if (!activeHostSocket) return;
    try {
      activeHostSocket.removeAllListeners();
      activeHostSocket.close();
    } catch {
      /* ignore */
    }
    activeHostSocket = null;
    activeHostRoomId = null;
  }, delayMs);
}
