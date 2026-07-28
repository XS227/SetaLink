'use strict';
/**
 * Pure in-memory presence + call-room routing core for the calling relay.
 * No transport dependency (ws/socket.io) — the server wires real sockets to
 * this via opaque "connectionId" handles, so this file is unit-testable
 * with plain node+assert on a box that can't `npm install`.
 *
 * This holds NO durable state and makes NO authorization decisions — PHP
 * (lib/calling.php) is the source of truth for whether a call is allowed
 * to exist and who's allowed to join it (via the signed voucher each side
 * presents on connect). This registry only tracks which live connection to
 * route signaling messages to for a given call_id, and cleans up when a
 * connection or call goes away.
 */

class PresenceRegistry {
  constructor() {
    this._byDevice = new Map(); // deviceId -> connectionId ("I can receive a ring")
    this._rooms = new Map();    // callId -> { caller, callee, createdAt } participant = {deviceId, connectionId} | null
  }

  // -- presence: is this device online to receive a ring? --

  register(deviceId, connectionId) {
    if (!deviceId || !connectionId) throw new TypeError('deviceId and connectionId are required');
    this._byDevice.set(deviceId, connectionId);
  }

  // Only clears the entry if it still points at THIS connection — guards
  // against a late close event from an old connection evicting a newer one
  // that already re-registered for the same device.
  unregister(deviceId, connectionId) {
    if (this._byDevice.get(deviceId) === connectionId) {
      this._byDevice.delete(deviceId);
    }
  }

  isOnline(deviceId) {
    return this._byDevice.has(deviceId);
  }

  connectionFor(deviceId) {
    return this._byDevice.get(deviceId) ?? null;
  }

  // -- call rooms: voucher-authorized signaling relay for one call_id --

  joinRoom(callId, role, deviceId, connectionId) {
    if (role !== 'caller' && role !== 'callee') throw new TypeError(`invalid role: ${role}`);
    if (!callId || !deviceId || !connectionId) throw new TypeError('callId, deviceId and connectionId are required');
    let room = this._rooms.get(callId);
    if (!room) {
      room = { caller: null, callee: null, createdAt: Date.now() };
      this._rooms.set(callId, room);
    }
    room[role] = { deviceId, connectionId };
    return room;
  }

  leaveRoom(callId, deviceId) {
    const room = this._rooms.get(callId);
    if (!room) return;
    if (room.caller && room.caller.deviceId === deviceId) room.caller = null;
    if (room.callee && room.callee.deviceId === deviceId) room.callee = null;
    if (!room.caller && !room.callee) this._rooms.delete(callId);
  }

  // Returns the OTHER participant's connectionId for a call, or null if
  // they haven't joined yet (or already left) — the caller/server decides
  // what "peer not there yet" means (e.g. buffer briefly vs. drop).
  peerConnectionFor(callId, deviceId) {
    const room = this._rooms.get(callId);
    if (!room) return null;
    if (room.caller && room.caller.deviceId === deviceId) return room.callee ? room.callee.connectionId : null;
    if (room.callee && room.callee.deviceId === deviceId) return room.caller ? room.caller.connectionId : null;
    return null;
  }

  roomFor(callId) {
    return this._rooms.get(callId) ?? null;
  }

  // Drops rooms nobody has touched since creation for longer than
  // maxAgeMs — belt-and-suspenders against a room leaking forever if both
  // sides vanish without a clean call-end (PHP's own CALL_STALE_RINGING
  // sweep is the authoritative timeout; this just stops the relay's memory
  // from growing unboundedly in the meantime).
  pruneStaleRooms(maxAgeMs, now = Date.now()) {
    let pruned = 0;
    for (const [callId, room] of this._rooms) {
      if (now - room.createdAt > maxAgeMs) {
        this._rooms.delete(callId);
        pruned++;
      }
    }
    return pruned;
  }

  // Drops all presence/room membership tied to a connectionId in one pass
  // — called on socket close, when we may not know which call(s), if any,
  // that connection was part of.
  dropConnection(connectionId) {
    for (const [deviceId, cid] of this._byDevice) {
      if (cid === connectionId) this._byDevice.delete(deviceId);
    }
    for (const [callId, room] of this._rooms) {
      let changed = false;
      if (room.caller && room.caller.connectionId === connectionId) { room.caller = null; changed = true; }
      if (room.callee && room.callee.connectionId === connectionId) { room.callee = null; changed = true; }
      if (changed && !room.caller && !room.callee) this._rooms.delete(callId);
    }
  }
}

module.exports = { PresenceRegistry };
