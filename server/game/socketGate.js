/**
 * Thin socket handler gate: optional host-only check + per-socket rate limit.
 * No zod — keep zero new deps (engineering feedback #7, incremental).
 */

/**
 * @param {{ capacity: number, refillPerSec: number }} opts
 */
function createTokenBucket({ capacity = 10, refillPerSec = 5 } = {}) {
  const buckets = new Map();
  return {
    take(key) {
      const id = String(key || '');
      if (!id) return false;
      const now = Date.now();
      let b = buckets.get(id);
      if (!b) {
        b = { tokens: capacity, updatedAt: now };
        buckets.set(id, b);
      }
      const elapsed = Math.max(0, (now - b.updatedAt) / 1000);
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
      b.updatedAt = now;
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
    /** Test helper */
    _reset() {
      buckets.clear();
    },
  };
}

/**
 * @param {{ requireHost: Function, getRoom: (roomId: string) => any }} deps
 */
function createSocketGate(deps) {
  const requireHost = deps.requireHost;
  const getRoom = deps.getRoom;

  /**
   * @param {import('socket.io').Socket} socket
   * @param {string} event
   * @param {{ hostOnly?: boolean, rate?: { take: (key: string) => boolean }, requireRoomId?: boolean }} options
   * @param {(data: any, ack?: Function) => any} handler
   */
  function on(socket, event, options, handler) {
    const opts = options && typeof options === 'object' ? options : {};
    const hostOnly = !!opts.hostOnly;
    const rate = opts.rate || null;
    const requireRoomId = opts.requireRoomId !== false;

    socket.on(event, (raw, maybeAck) => {
      const data = raw && typeof raw === 'object' ? raw : {};
      const ack = typeof maybeAck === 'function' ? maybeAck : null;

      if (rate && !rate.take(socket.id)) {
        ack?.({ ok: false, error: 'rate_limited' });
        try {
          socket.emit('error', { message: 'Too many requests — slow down.' });
        } catch (_) {}
        return;
      }

      if (requireRoomId) {
        const roomId = data.roomId;
        if (typeof roomId !== 'string' || !roomId.trim()) {
          ack?.({ ok: false, error: 'bad_payload' });
          return;
        }
      }

      if (hostOnly) {
        const room = typeof data.roomId === 'string' ? getRoom(data.roomId) : null;
        if (!requireHost(socket, room)) {
          ack?.({ ok: false, error: 'forbidden' });
          try {
            socket.emit('error', { message: 'Only the host can do that.' });
          } catch (_) {}
          return;
        }
      }

      try {
        const result = handler(data, ack);
        if (result && typeof result.then === 'function') {
          result.catch((err) => {
            console.error(`socketGate ${event}:`, err?.message || err);
            ack?.({ ok: false, error: 'server_error' });
          });
        }
      } catch (err) {
        console.error(`socketGate ${event}:`, err?.message || err);
        ack?.({ ok: false, error: 'server_error' });
      }
    });
  }

  return { on };
}

module.exports = {
  createTokenBucket,
  createSocketGate,
};
