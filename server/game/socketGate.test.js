const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTokenBucket, createSocketGate } = require('./socketGate');

describe('createTokenBucket', () => {
  it('allows capacity then rejects until refill', () => {
    const bucket = createTokenBucket({ capacity: 2, refillPerSec: 0 });
    assert.equal(bucket.take('a'), true);
    assert.equal(bucket.take('a'), true);
    assert.equal(bucket.take('a'), false);
  });

  it('tracks sockets independently', () => {
    const bucket = createTokenBucket({ capacity: 1, refillPerSec: 0 });
    assert.equal(bucket.take('x'), true);
    assert.equal(bucket.take('y'), true);
    assert.equal(bucket.take('x'), false);
  });
});

describe('createSocketGate', () => {
  function mockSocket() {
    const handlers = new Map();
    return {
      id: 'sock-1',
      handlers,
      on(event, fn) {
        handlers.set(event, fn);
      },
      emit() {},
      trigger(event, data, ack) {
        return handlers.get(event)?.(data, ack);
      },
    };
  }

  it('rejects missing roomId when requireRoomId', () => {
    const gate = createSocketGate({
      requireHost: () => true,
      getRoom: () => ({}),
    });
    const socket = mockSocket();
    let ran = false;
    gate.on(socket, 'test-ev', { requireRoomId: true }, () => {
      ran = true;
    });
    let ackPayload = null;
    socket.trigger('test-ev', {}, (p) => {
      ackPayload = p;
    });
    assert.equal(ran, false);
    assert.equal(ackPayload.error, 'bad_payload');
  });

  it('hostOnly blocks non-host', () => {
    const gate = createSocketGate({
      requireHost: () => false,
      getRoom: () => ({ id: 'r1' }),
    });
    const socket = mockSocket();
    let ran = false;
    gate.on(socket, 'host-ev', { hostOnly: true }, () => {
      ran = true;
    });
    let ackPayload = null;
    socket.trigger('host-ev', { roomId: 'r1' }, (p) => {
      ackPayload = p;
    });
    assert.equal(ran, false);
    assert.equal(ackPayload.error, 'forbidden');
  });

  it('rate limit short-circuits handler', () => {
    const rate = createTokenBucket({ capacity: 1, refillPerSec: 0 });
    const gate = createSocketGate({
      requireHost: () => true,
      getRoom: () => ({}),
    });
    const socket = mockSocket();
    let runs = 0;
    gate.on(socket, 'rate-ev', { rate }, () => {
      runs += 1;
    });
    socket.trigger('rate-ev', { roomId: 'r1' });
    socket.trigger('rate-ev', { roomId: 'r1' });
    assert.equal(runs, 1);
  });

  it('runs handler when checks pass', () => {
    const gate = createSocketGate({
      requireHost: () => true,
      getRoom: () => ({ id: 'r1' }),
    });
    const socket = mockSocket();
    let saw = null;
    gate.on(socket, 'ok-ev', { hostOnly: true }, (data) => {
      saw = data.roomId;
    });
    socket.trigger('ok-ev', { roomId: 'r1' });
    assert.equal(saw, 'r1');
  });
});
