'use strict';
/**
 * Plain node+assert tests for presence.js. Run with:
 *   node calling-relay/test-presence.js
 */

const assert = require('assert');
const { PresenceRegistry } = require('./presence.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

check('register/unregister/isOnline round-trip', () => {
  const reg = new PresenceRegistry();
  assert.strictEqual(reg.isOnline('dev-1'), false);
  reg.register('dev-1', 'conn-a');
  assert.strictEqual(reg.isOnline('dev-1'), true);
  assert.strictEqual(reg.connectionFor('dev-1'), 'conn-a');
  reg.unregister('dev-1', 'conn-a');
  assert.strictEqual(reg.isOnline('dev-1'), false);
});

check('register throws without deviceId/connectionId', () => {
  const reg = new PresenceRegistry();
  assert.throws(() => reg.register('', 'conn-a'), TypeError);
  assert.throws(() => reg.register('dev-1', ''), TypeError);
});

check('unregister is a no-op if a newer connection already replaced it', () => {
  const reg = new PresenceRegistry();
  reg.register('dev-1', 'conn-old');
  reg.register('dev-1', 'conn-new');
  reg.unregister('dev-1', 'conn-old'); // late close event from the old socket
  assert.strictEqual(reg.isOnline('dev-1'), true);
  assert.strictEqual(reg.connectionFor('dev-1'), 'conn-new');
});

check('joinRoom rejects an invalid role', () => {
  const reg = new PresenceRegistry();
  assert.throws(() => reg.joinRoom('call-1', 'spectator', 'dev-1', 'conn-a'), TypeError);
});

check('peerConnectionFor is null until both sides have joined', () => {
  const reg = new PresenceRegistry();
  assert.strictEqual(reg.peerConnectionFor('call-1', 'dev-1'), null);
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a');
  assert.strictEqual(reg.peerConnectionFor('call-1', 'dev-1'), null);
  reg.joinRoom('call-1', 'callee', 'dev-2', 'conn-b');
  assert.strictEqual(reg.peerConnectionFor('call-1', 'dev-1'), 'conn-b');
  assert.strictEqual(reg.peerConnectionFor('call-1', 'dev-2'), 'conn-a');
});

check('leaveRoom removes only that participant, room persists for the other', () => {
  const reg = new PresenceRegistry();
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a');
  reg.joinRoom('call-1', 'callee', 'dev-2', 'conn-b');
  reg.leaveRoom('call-1', 'dev-1');
  assert.strictEqual(reg.peerConnectionFor('call-1', 'dev-2'), null);
  assert.ok(reg.roomFor('call-1'));
});

check('leaveRoom deletes the room once both sides have left', () => {
  const reg = new PresenceRegistry();
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a');
  reg.joinRoom('call-1', 'callee', 'dev-2', 'conn-b');
  reg.leaveRoom('call-1', 'dev-1');
  reg.leaveRoom('call-1', 'dev-2');
  assert.strictEqual(reg.roomFor('call-1'), null);
});

check('leaveRoom on an unknown call is a silent no-op', () => {
  const reg = new PresenceRegistry();
  assert.doesNotThrow(() => reg.leaveRoom('no-such-call', 'dev-1'));
});

check('pruneStaleRooms drops only rooms older than maxAgeMs', () => {
  const reg = new PresenceRegistry();
  reg.joinRoom('call-old', 'caller', 'dev-1', 'conn-a');
  reg.joinRoom('call-new', 'caller', 'dev-2', 'conn-b');
  const future = Date.now() + 100_000;
  const pruned = reg.pruneStaleRooms(50_000, future);
  assert.strictEqual(pruned, 2); // both created "now", both older than 50s as of +100s
  assert.strictEqual(reg.roomFor('call-old'), null);
  assert.strictEqual(reg.roomFor('call-new'), null);
});

check('pruneStaleRooms keeps rooms younger than maxAgeMs', () => {
  const reg = new PresenceRegistry();
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a');
  const pruned = reg.pruneStaleRooms(50_000, Date.now() + 1_000);
  assert.strictEqual(pruned, 0);
  assert.ok(reg.roomFor('call-1'));
});

check('dropConnection clears presence for that connection', () => {
  const reg = new PresenceRegistry();
  reg.register('dev-1', 'conn-a');
  reg.dropConnection('conn-a');
  assert.strictEqual(reg.isOnline('dev-1'), false);
});

check('dropConnection does not clear presence for a different connection', () => {
  const reg = new PresenceRegistry();
  reg.register('dev-1', 'conn-a');
  reg.dropConnection('conn-other');
  assert.strictEqual(reg.isOnline('dev-1'), true);
});

check('dropConnection clears only the matching side of a room, keeps the other', () => {
  const reg = new PresenceRegistry();
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a');
  reg.joinRoom('call-1', 'callee', 'dev-2', 'conn-b');
  reg.dropConnection('conn-a');
  assert.strictEqual(reg.peerConnectionFor('call-1', 'dev-2'), null);
  assert.ok(reg.roomFor('call-1'));
});

check('dropConnection deletes the room once both sides are dropped', () => {
  const reg = new PresenceRegistry();
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a');
  reg.joinRoom('call-1', 'callee', 'dev-2', 'conn-b');
  reg.dropConnection('conn-a');
  reg.dropConnection('conn-b');
  assert.strictEqual(reg.roomFor('call-1'), null);
});

check('a device can rejoin a room under a new connectionId (reconnect)', () => {
  const reg = new PresenceRegistry();
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a');
  reg.joinRoom('call-1', 'callee', 'dev-2', 'conn-b');
  reg.dropConnection('conn-a'); // caller's socket drops
  reg.joinRoom('call-1', 'caller', 'dev-1', 'conn-a2'); // reconnects
  assert.strictEqual(reg.peerConnectionFor('call-1', 'dev-2'), 'conn-a2');
});

console.log(`\n${passed} test(s) passed`);
