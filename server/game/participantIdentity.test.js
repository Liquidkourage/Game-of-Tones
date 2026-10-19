const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  participantIdForJoin,
  setHostBinding,
  bindParticipantSocket,
  unbindParticipantSocket,
  resolveLivePlayerSocketId,
  requireHost,
} = require('./participantIdentity');

describe('participantIdentity', () => {
  it('participantIdForJoin prefers host user id and player clientId', () => {
    assert.equal(
      participantIdForJoin({ isHost: true, ownerUserId: 9, clientId: 'c' }),
      'host:user:9',
    );
    assert.equal(
      participantIdForJoin({ isHost: true, clientId: 'hc' }),
      'host:client:hc',
    );
    assert.equal(
      participantIdForJoin({ isHost: false, clientId: 'p1' }),
      'player:client:p1',
    );
    assert.equal(participantIdForJoin({ isDisplay: true }), 'display:projector');
  });

  it('setHostBinding tracks hostParticipantId + socketsByParticipant', () => {
    const room = { players: new Map() };
    setHostBinding(room, {
      participantId: 'host:user:1',
      socketId: 'sock-a',
      clientId: 'hc',
    });
    assert.equal(room.host, 'sock-a');
    assert.equal(room.hostParticipantId, 'host:user:1');
    assert.equal(room.hostClientId, 'hc');
    assert.equal(room.socketsByParticipant.get('host:user:1'), 'sock-a');
  });

  it('resolveLivePlayerSocketId prefers participantId after reconnect', () => {
    const room = {
      players: new Map([
        [
          'sock-new',
          {
            id: 'sock-new',
            name: 'Ada',
            participantId: 'player:client:ada',
            isHost: false,
          },
        ],
      ]),
      socketsByParticipant: new Map([['player:client:ada', 'sock-new']]),
    };
    assert.equal(
      resolveLivePlayerSocketId(room, {
        participantId: 'player:client:ada',
        playerId: 'sock-old',
        playerName: 'Ada',
      }),
      'sock-new',
    );
  });

  it('unbindParticipantSocket only clears matching socket', () => {
    const room = { socketsByParticipant: new Map([['p1', 's1']]) };
    unbindParticipantSocket(room, 'p1', 's2');
    assert.equal(room.socketsByParticipant.get('p1'), 's1');
    unbindParticipantSocket(room, 'p1', 's1');
    assert.equal(room.socketsByParticipant.has('p1'), false);
  });

  it('requireHost accepts host socket, hostParticipantId, or owner JWT', () => {
    const room = {
      host: 'h1',
      hostParticipantId: 'host:user:3',
      ownerUserId: 3,
      players: new Map([
        ['h2', { id: 'h2', isHost: false, participantId: 'host:user:3' }],
      ]),
    };
    assert.equal(requireHost({ id: 'h1' }, room), true);
    assert.equal(
      requireHost({ id: 'h2', data: { participantId: 'host:user:3' } }, room),
      true,
    );
    assert.equal(requireHost({ id: 'other', hostUserId: 3 }, room), true);
    assert.equal(requireHost({ id: 'stranger' }, room), false);
  });

  it('bindParticipantSocket creates the map lazily', () => {
    const room = {};
    bindParticipantSocket(room, 'p', 's');
    assert.ok(room.socketsByParticipant instanceof Map);
    assert.equal(room.socketsByParticipant.get('p'), 's');
  });
});
