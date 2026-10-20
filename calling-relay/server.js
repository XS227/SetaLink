'use strict';
/**
 * WebSocket signaling relay for RealGram calling — the "dumb pipe" that
 * PHP's lib/calling.php hands out vouchers for. This process holds no
 * database and makes no authorization decisions of its own: every
 * connection must present a voucher signed by PHP's CALL_RELAY_SECRET
 * (see voucher.js / lib/calling.php call_sign_voucher), and this file only
 * relays opaque WebRTC signaling payloads between the two sides of a room.
 *
 * *** UNVERIFIED — needs `npm install ws` which this box (1GB RAM, no
 * build step allowed per house rules) hasn't run. Syntax not even checked
 * with `node --check` since `require('ws')` will fail without the
 * package. voucher.js and presence.js (the pure logic this file wires up)
 * are both fully unit-tested; this file is the untested transport glue on
 * top of them — review carefully / test in a real environment with `ws`
 * installed before relying on it. ***
 *
 * Protocol (JSON text frames):
 *   client -> server
 *     {type:'presence:auth', token}            — register for incoming-call pushes
 *     {type:'call:join', voucher}               — join a call room as caller/callee
 *     {type:'call:signal', call_id, payload}     — forward an SDP/ICE payload to the peer
 *     {type:'call:leave', call_id}               — explicit leave (also happens on close)
 *   server -> client
 *     {type:'presence:ok'} / {type:'presence:error', message}
 *     {type:'call:joined', call_id, role}
 *     {type:'call:peer_joined', call_id}
 *     {type:'call:peer_left', call_id}
 *     {type:'call:signal', call_id, payload}
 *     {type:'call:incoming', call_id, kind, caller_user_id}  — internal push, see below
 *     {type:'error', message}
 *
 * PHP has no persistent connection to this process, so call-initiate can't
 * push straight to a socket. Instead PHP calls a small internal HTTP hook
 * after `call_initiate()` succeeds, guarded by a *separate* shared secret
 * (CALLING_RELAY_INTERNAL_SECRET, distinct from the voucher secret):
 *   POST /internal/push  { device_id, event: {type:'call:incoming', ...} }
 * This hook runs on its OWN port (CALLING_RELAY_INTERNAL_PORT), separate
 * from the public WS port, and binds 127.0.0.1 only — so it stays
 * unreachable from outside this box even if nginx's proxy rules for the
 * public WS path are ever loosened. Only nginx should ever be pointed at
 * CALLING_RELAY_PORT; nothing should proxy CALLING_RELAY_INTERNAL_PORT.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws'); // npm install ws — not yet run on this box
const { verifyVoucher } = require('./voucher.js');
const { PresenceRegistry } = require('./presence.js');

// pm2's saved dump only replays env vars it was explicitly given (an
// ecosystem `env` block, or `--env`) — ambient vars exported in the shell
// at `pm2 start` time are NOT persisted, so `pm2 resurrect`/a host reboot
// silently drops CALLING_RELAY_SECRET and crash-loops (seen in production
// 2026-08-31). Load .env.local directly so this process is self-sufficient
// regardless of how pm2 launches it; real env still wins over the file.
(function loadEnvLocal() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
})();

const PORT = parseInt(process.env.CALLING_RELAY_PORT || '8095', 10);
const INTERNAL_PORT = parseInt(process.env.CALLING_RELAY_INTERNAL_PORT || '8096', 10);
const VOUCHER_SECRET = process.env.CALLING_RELAY_SECRET || '';
const INTERNAL_SECRET = process.env.CALLING_RELAY_INTERNAL_SECRET || '';
const ROOM_MAX_AGE_MS = 10 * 60 * 1000; // belt-and-suspenders, PHP's CALL_STALE_RINGING_SECS=45s is authoritative
const PRUNE_INTERVAL_MS = 60 * 1000;

if (!VOUCHER_SECRET) {
  console.error('CALLING_RELAY_SECRET is not set — refusing to start (every voucher would fail to verify).');
  process.exit(1);
}
if (!INTERNAL_SECRET) {
  console.error('CALLING_RELAY_INTERNAL_SECRET is not set — refusing to start (the PHP push hook would be unauthenticated).');
  process.exit(1);
}

const registry = new PresenceRegistry();
let nextConnectionId = 1;

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// -- public WS transport (nginx should proxy the public wss:// path to this port) --

const connections = new Map(); // connectionId -> ws
const wsHttpServer = http.createServer((req, res) => {
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ server: wsHttpServer });

// -- internal-only HTTP hook for PHP to push events to an already-connected
//    device, on its own port, bound to 127.0.0.1, never nginx-proxied --

const internalHttpServer = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/internal/push') {
    res.writeHead(404).end();
    return;
  }
  const providedSecret = req.headers['x-internal-secret'] || '';
  if (!timingSafeEqualStr(providedSecret, INTERNAL_SECRET)) {
    res.writeHead(403).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 16_384) req.destroy(); // guard against a runaway body on a 1GB box
  });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const { device_id, event } = parsed || {};
    if (!device_id || !event || typeof event !== 'object') {
      res.writeHead(400).end();
      return;
    }
    const connectionId = registry.connectionFor(device_id);
    const ws = connectionId ? connections.get(connectionId) : null;
    if (!ws) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ delivered: false }));
      return;
    }
    send(ws, event);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ delivered: true }));
  });
});

// Khabat, 2026-07-31: temporary diagnostic logging for the ICE/TURN
// investigation (calls connect signaling-wise, media never flows, ICE
// fails ~12-19s in) — this relay had zero per-message logging before,
// so there was no way to see whether ICE candidates (esp. the slower-to-
// gather TURN ones) actually cross the wire, or whether the WS silently
// dies mid-call the way the zombie-connection comment below already
// describes. Log to stdout only (pm2 out log), nothing persisted to a
// DB — safe to strip once the live test that needs this is done.
function diagLog(event, fields) {
  console.log(`[diag] ${new Date().toISOString()} ${event} ${JSON.stringify(fields)}`);
}

wss.on('connection', (ws) => {
  const connectionId = String(nextConnectionId++);
  connections.set(connectionId, ws);
  let presenceDeviceId = null; // set once presence:auth succeeds, for logging/cleanup only
  const connectedAt = Date.now();
  let lastMessageAt = connectedAt;
  diagLog('ws_open', { connectionId });

  // Mobile carrier NAT/firewalls (and DPI middleboxes on restrictive
  // networks) commonly drop an idle TCP connection without ever sending a
  // FIN/RST — the client's socket looks OPEN locally while every frame
  // sent into it is silently black-holed. That's fatal here specifically:
  // call-initiate/accept succeed over plain HTTPS (a fresh request each
  // time), but the SDP offer/answer/ICE candidates only ever travel over
  // this one long-lived WS, so a zombie connection reproduces exactly as
  // "call connects/rings but no audio" or "auth ok but nothing happens" —
  // found live 2026-07-30, Iran real-device test, ws sessions dying after
  // a few dozen bytes. Ping every 30s and terminate anything that didn't
  // pong since the last one, so the client's own reconnect logic (already
  // has backoff) kicks in fast instead of the app sitting on a dead pipe.
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    const now = Date.now();
    const sinceLastMs = now - lastMessageAt;
    lastMessageAt = now;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'invalid JSON' });
      return;
    }
    if (!msg || typeof msg.type !== 'string') {
      send(ws, { type: 'error', message: 'missing type' });
      return;
    }
    if (msg.type !== 'call:signal') {
      diagLog('ws_message', { connectionId, deviceId: presenceDeviceId, type: msg.type, call_id: msg.call_id, sinceLastMs });
    }

    switch (msg.type) {
      case 'presence:auth': {
        const payload = verifyVoucher(VOUCHER_SECRET, msg.token);
        if (!payload || payload.role !== 'presence' || !payload.device_id) {
          send(ws, { type: 'presence:error', message: 'invalid or expired token' });
          return;
        }
        registry.register(payload.device_id, connectionId);
        presenceDeviceId = payload.device_id;
        send(ws, { type: 'presence:ok' });
        break;
      }

      case 'call:join': {
        const payload = verifyVoucher(VOUCHER_SECRET, msg.voucher);
        if (!payload || (payload.role !== 'caller' && payload.role !== 'callee') || !payload.call_id || !payload.device_id) {
          send(ws, { type: 'error', message: 'invalid or expired call voucher' });
          return;
        }
        registry.joinRoom(payload.call_id, payload.role, payload.device_id, connectionId);
        diagLog('call_join', { connectionId, deviceId: payload.device_id, call_id: payload.call_id, role: payload.role });
        send(ws, { type: 'call:joined', call_id: payload.call_id, role: payload.role });
        const peerConnectionId = registry.peerConnectionFor(payload.call_id, payload.device_id);
        const peerWs = peerConnectionId ? connections.get(peerConnectionId) : null;
        if (peerWs) {
          send(peerWs, { type: 'call:peer_joined', call_id: payload.call_id });
          send(ws, { type: 'call:peer_joined', call_id: payload.call_id });
        }
        break;
      }

      case 'call:signal': {
        if (!msg.call_id || msg.payload === undefined) {
          send(ws, { type: 'error', message: 'call:signal requires call_id and payload' });
          return;
        }
        // Route by connectionId membership rather than trusting a claimed
        // device_id in the message — joinRoom already tied this socket to
        // a verified device_id for this call_id.
        const room = registry.roomFor(msg.call_id);
        if (!room) {
          send(ws, { type: 'error', message: 'not in that call' });
          return;
        }
        const isCaller = room.caller && room.caller.connectionId === connectionId;
        const isCallee = room.callee && room.callee.connectionId === connectionId;
        if (!isCaller && !isCallee) {
          send(ws, { type: 'error', message: 'not in that call' });
          return;
        }
        const peerConnectionId = isCaller
          ? (room.callee ? room.callee.connectionId : null)
          : (room.caller ? room.caller.connectionId : null);
        const peerWs = peerConnectionId ? connections.get(peerConnectionId) : null;
        // Khabat, 2026-08-01: the ICE state telemetry added 2026-07-31
        // (CALL_ICE_STATE) proved ICE reaches 'checking'/'connecting' then
        // 'failed' ~10-20s in on every real test since, but says nothing
        // about *which* candidate types were even in play — a relay
        // (TURN) candidate never being gathered/exchanged looks identical
        // client-side to one that was exchanged but never got selected.
        // The raw SDP candidate string already crosses this relay (it's
        // the payload being forwarded below) — pull the `typ host/srflx/
        // relay/prflx` token out of it for free instead of guessing.
        let iceCandType = null;
        if (msg.payload && msg.payload.kind === 'ice' && msg.payload.candidate && typeof msg.payload.candidate.candidate === 'string') {
          const m = /\btyp (\w+)/.exec(msg.payload.candidate.candidate);
          iceCandType = m ? m[1] : null;
        }
        diagLog('call_signal', {
          connectionId, call_id: msg.call_id, from: isCaller ? 'caller' : 'callee',
          kind: msg.payload && msg.payload.kind, iceCandType, deliveredToPeer: !!peerWs,
          peerWsReady: peerWs ? peerWs.readyState === peerWs.OPEN : null, sinceLastMs,
        });
        if (peerWs) send(peerWs, { type: 'call:signal', call_id: msg.call_id, payload: msg.payload });
        break;
      }

      case 'call:leave': {
        if (!msg.call_id) return;
        // Find the device_id this connection was using in that room before leaving.
        const room = registry.roomFor(msg.call_id);
        let leavingDeviceId = null;
        if (room) {
          if (room.caller && room.caller.connectionId === connectionId) leavingDeviceId = room.caller.deviceId;
          if (room.callee && room.callee.connectionId === connectionId) leavingDeviceId = room.callee.deviceId;
        }
        const peerConnectionId = leavingDeviceId ? registry.peerConnectionFor(msg.call_id, leavingDeviceId) : null;
        if (leavingDeviceId) registry.leaveRoom(msg.call_id, leavingDeviceId);
        const peerWs = peerConnectionId ? connections.get(peerConnectionId) : null;
        if (peerWs) send(peerWs, { type: 'call:peer_left', call_id: msg.call_id });
        break;
      }

      default:
        send(ws, { type: 'error', message: `unknown type: ${msg.type}` });
    }
  });

  ws.on('close', (code, reason) => {
    diagLog('ws_close', {
      connectionId, deviceId: presenceDeviceId, code, reason: reason ? reason.toString() : '',
      msSinceLastMessage: Date.now() - lastMessageAt, msSinceConnect: Date.now() - connectedAt,
    });
    connections.delete(connectionId);
    registry.dropConnection(connectionId);
  });

  ws.on('error', (err) => {
    diagLog('ws_error', { connectionId, deviceId: presenceDeviceId, message: err && err.message });
    // 'close' still fires after 'error' on the ws lib — cleanup happens there.
  });
});

setInterval(() => registry.pruneStaleRooms(ROOM_MAX_AGE_MS), PRUNE_INTERVAL_MS).unref();

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate(); // no pong since last ping — zombie connection, drop it so the client reconnects
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS).unref();

wsHttpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`calling-relay WS listening on 127.0.0.1:${PORT} (nginx should proxy the public path here)`);
});
internalHttpServer.listen(INTERNAL_PORT, '127.0.0.1', () => {
  console.log(`calling-relay internal push hook listening on 127.0.0.1:${INTERNAL_PORT} (never nginx-proxy this one)`);
});
