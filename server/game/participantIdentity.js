/**
 * Stable participant identity (feedback P1 #4).
 * Socket ids still key room.players for most handlers; participantId survives reconnect.
 */

function ensureRoomIdentityMaps(room) {
  if (!room) return;
  if (!(room.socketsByParticipant instanceof Map)) {
    room.socketsByParticipant = new Map();
  }
}

/**
 * Stable id for a join.
 * Host: host:user:{ownerUserId} when known, else host:client:{clientId}.
 * Player: player:client:{clientId}.
 * Display / anonymous: null (socket-only until they get a clientId).
 */
function participantIdForJoin({
  isHost = false,
  isDisplay = false,
  clientId = null,
  ownerUserId = null,
  hostClientId = null,
} = {}) {
  if (isDisplay) return 'display:projector';
  if (isHost) {
    if (ownerUserId != null && Number.isFinite(Number(ownerUserId))) {
      return `host:user:${Number(ownerUserId)}`;
    }
    const cid = (clientId || hostClientId || '').trim();
    if (cid) return `host:client:${cid}`;
    return null;
  }
  const cid = typeof clientId === 'string' ? clientId.trim() : '';
  if (cid) return `player:client:${cid}`;
  return null;
}

function bindParticipantSocket(room, participantId, socketId) {
  ensureRoomIdentityMaps(room);
  if (!participantId || !socketId) return;
  room.socketsByParticipant.set(String(participantId), String(socketId));
}

function unbindParticipantSocket(room, participantId, socketId) {
  if (!room?.socketsByParticipant || !participantId) return;
  const key = String(participantId);
  if (room.socketsByParticipant.get(key) === String(socketId)) {
    room.socketsByParticipant.delete(key);
  }
}

function setHostBinding(room, { participantId, socketId, clientId } = {}) {
  if (!room) return;
  if (socketId) room.host = socketId;
  if (participantId) room.hostParticipantId = participantId;
  if (clientId) room.hostClientId = clientId;
  if (participantId && socketId) bindParticipantSocket(room, participantId, socketId);
}

function findPlayerByParticipantId(room, participantId) {
  if (!room?.players || !participantId) return null;
  const want = String(participantId);
  for (const p of room.players.values()) {
    if (p && p.participantId === want) return p;
  }
  return null;
}

function socketIdForParticipant(room, participantId) {
  if (!room || !participantId) return null;
  ensureRoomIdentityMaps(room);
  const mapped = room.socketsByParticipant.get(String(participantId));
  if (mapped) return mapped;
  const player = findPlayerByParticipantId(room, participantId);
  return player?.id || null;
}

/**
 * Resolve the live socket id for a claim / verify target.
 * Prefer participantId, then socket playerId, then display name.
 */
function resolveLivePlayerSocketId(room, { participantId, playerId, playerName } = {}) {
  if (!room?.players) return null;
  if (participantId) {
    const sid = socketIdForParticipant(room, participantId);
    if (sid && room.players.has(sid)) return sid;
    const byPid = findPlayerByParticipantId(room, participantId);
    if (byPid?.id) return byPid.id;
  }
  if (playerId && room.players.has(playerId)) return playerId;
  if (playerName) {
    const want = String(playerName).trim().toLowerCase();
    for (const [sid, p] of room.players) {
      if (!p || p.isHost) continue;
      if (String(p.name || '').trim().toLowerCase() === want) return sid;
    }
  }
  return null;
}

/**
 * Host-only gate: active host socket, host player flag, hostParticipantId match, or room owner JWT.
 */
function requireHost(socket, room) {
  if (!room || !socket) return false;
  if (room.host === socket.id) return true;
  const player = room.players.get(socket.id);
  if (player?.isHost) return true;
  const pid =
    (socket.data && socket.data.participantId) ||
    player?.participantId ||
    null;
  if (pid && room.hostParticipantId && String(pid) === String(room.hostParticipantId)) {
    return true;
  }
  const ownerUid = room.ownerUserId != null ? Number(room.ownerUserId) : null;
  const socketUid = socket.hostUserId != null ? Number(socket.hostUserId) : null;
  if (ownerUid != null && socketUid != null && ownerUid === socketUid) return true;
  return false;
}

module.exports = {
  ensureRoomIdentityMaps,
  participantIdForJoin,
  bindParticipantSocket,
  unbindParticipantSocket,
  setHostBinding,
  findPlayerByParticipantId,
  socketIdForParticipant,
  resolveLivePlayerSocketId,
  requireHost,
};
