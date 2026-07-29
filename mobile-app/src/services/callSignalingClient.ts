/**
 * callSignalingClient — the real CallSignalingClient implementation
 * (services/callService.ts's interface) against the backend agent B built
 * (docs/realgram/TASK_SPLIT.md B→A(171)): lib/calling.php (auth, vouchers,
 * call lifecycle, TURN credentials) + calling-relay/ (a separate Node
 * WebSocket process that relays opaque SDP/ICE payloads between the two
 * sides of a call once each has joined with a voucher PHP signed).
 *
 * PHP has no persistent connection to a client, so this file talks to two
 * different places: plain HTTPS POST/GET to api.php for anything durable
 * (initiate/accept/decline/end/ice-servers), and a single long-lived
 * WebSocket to the relay for anything real-time (presence, the actual
 * offer/answer/ICE exchange, incoming-call push).
 *
 * One connection per app session, not per call — `connect()` should be
 * called once (e.g. when the Inbox screen mounts) and reused across
 * however many calls happen while it's open.
 */

import {
  CallSignalingClient, RTCIceCandidateInitLike, RTCIceServerLike, RTCSessionDescriptionInitLike,
} from './callService';

const BASE_URL   = 'https://setalink.no/api.php';
const TOKEN      = 'setalink-mobile-diag-v1';
const TIMEOUT    = 10_000;
// Not wss://setalink.no/ws/call — that path sits behind the SNI-routed
// :443 -> 127.0.0.1:4430 socket, which has HTTP/2 enabled (shared with
// api.setalink.no/app.dadashi.no). nginx can't proxy a WebSocket Upgrade
// over an HTTP/2 client connection, so any client whose TLS stack offers
// h2 in ALPN gets a silent 404 instead of a call.
//
// Also NOT wss://setalink.no:4433/ws/call, a non-standard port this used
// briefly (A->B(224)) to dodge the above — real device testing showed a
// call placed from a real phone just hangs forever with no call-initiate
// ever reaching the backend, while every other request on this same
// device (same minute) succeeds fine over standard 443. A non-standard
// port is exactly what a restrictive network/carrier blocks even when
// 443 stays open — the wrong tradeoff for what this app is actually for.
//
// vpn.setalink.no is a distinct SNI hostname already covered by the
// setalink.no cert (existing SAN), routed at the stream{} layer
// (nginx.conf) to its own 127.0.0.1:4434 backend that never advertises
// h2 — same fix as before (a listener that can't negotiate h2), just on
// the standard 443 port instead of a new one, mirroring the pattern
// realcapital.no already uses for the same reason (its own SNI ->
// 127.0.0.1:4431). See docs/realgram/TASK_SPLIT.md A->B(235).
const WS_URL     = 'wss://vpn.setalink.no/ws/call';
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000];

async function callGet(action: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: any; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'request failed');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

async function callPost(action: string, queryParams: Record<string, string>, body: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ mobile: '1', action, ...queryParams });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _token: TOKEN, ...body }).toString(),
      signal: ctrl.signal,
    });
    const json = await res.json() as { ok: boolean; data?: any; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'request failed');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

type EventCb = (...args: any[]) => void;

export class RealCallSignalingClient implements CallSignalingClient {
  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private presenceToken = '';

  private listeners: Record<string, EventCb[]> = {
    incomingCall: [], offer: [], answer: [], iceCandidate: [], reject: [], hangUp: [],
  };

  // The relay only forwards call:signal to a peer that has already
  // joined the room (server.js: "if (peerWs) send(...)" -- no queuing on
  // its side). The caller joins right after placeCall(); the callee only
  // joins once the user taps Accept, which can be seconds into ringing --
  // so an offer sent immediately after createOffer() would silently be
  // dropped. Queue outgoing signals per callId until call:peer_joined
  // confirms the other side is actually in the room.
  private peerJoined = new Set<string>();
  private pendingSignals = new Map<string, Array<Record<string, unknown>>>();

  constructor(private readonly deviceId: string) {}

  /** Call once (e.g. Inbox screen mount). Safe to call again — a no-op if
   *  already connected/connecting. */
  connect(): void {
    if (this.ws || this.wsReady) return;
    this.closedByUser = false;
    this.openSocket();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.ws?.close();
    this.ws = null;
    this.wsReady = null;
  }

  private openSocket(): void {
    this.wsReady = new Promise((resolve) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.onopen = async () => {
        this.reconnectAttempt = 0;
        try {
          const { token } = await callGet('call-presence-token', { device_id: this.deviceId });
          this.presenceToken = token;
          ws.send(JSON.stringify({ type: 'presence:auth', token }));
        } catch {
          // No token (calling not enabled for this account) — socket stays
          // open but unauthenticated; join/signal calls will just fail
          // server-side, same as any other disabled-feature path.
        }
        resolve();
      };

      ws.onmessage = (event) => this.handleMessage(event.data);

      ws.onclose = () => {
        this.ws = null;
        this.wsReady = null;
        if (this.closedByUser) return;
        const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
        this.reconnectAttempt += 1;
        setTimeout(() => { if (!this.closedByUser) this.openSocket(); }, delay);
      };

      ws.onerror = () => { /* onclose fires right after, handled there */ };
    });
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'call:incoming':
        this.listeners.incomingCall.forEach((cb) => cb(msg.call_id, msg.caller_user_id));
        break;
      case 'call:signal': {
        const p = msg.payload;
        if (!p) break;
        if (p.kind === 'offer') this.listeners.offer.forEach((cb) => cb(msg.call_id, { type: 'offer', sdp: p.sdp }));
        else if (p.kind === 'answer') this.listeners.answer.forEach((cb) => cb(msg.call_id, { type: 'answer', sdp: p.sdp }));
        else if (p.kind === 'ice') this.listeners.iceCandidate.forEach((cb) => cb(msg.call_id, p.candidate));
        break;
      }
      case 'call:declined':
        this.listeners.reject.forEach((cb) => cb(msg.call_id));
        break;
      case 'call:peer_left':
      case 'call:ended':
        this.listeners.hangUp.forEach((cb) => cb(msg.call_id));
        this.peerJoined.delete(msg.call_id);
        this.pendingSignals.delete(msg.call_id);
        break;
      case 'call:peer_joined':
        this.peerJoined.add(msg.call_id);
        this.flushPendingSignals(msg.call_id);
        break;
      default:
        break;
    }
  }

  private flushPendingSignals(callId: string): void {
    const queued = this.pendingSignals.get(callId);
    if (!queued) return;
    this.pendingSignals.delete(callId);
    queued.forEach((payload) => this.wsSend({ type: 'call:signal', call_id: callId, payload }));
  }

  private async ensureConnected(): Promise<void> {
    if (!this.ws) this.connect();
    await this.wsReady;
  }

  private wsSend(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private sendSignal(callId: string, payload: Record<string, unknown>): void {
    // ICE candidates trickle in continuously, including after the peer has
    // already joined -- only the very first offer/answer needs the queue;
    // once peerJoined is set for this call, everything sends immediately.
    if (this.peerJoined.has(callId)) {
      this.wsSend({ type: 'call:signal', call_id: callId, payload });
      return;
    }
    const queue = this.pendingSignals.get(callId) ?? [];
    queue.push(payload);
    this.pendingSignals.set(callId, queue);
  }

  // ── CallSignalingClient ────────────────────────────────────────────────

  async placeCall(calleeDeviceId: string): Promise<{ callId: string }> {
    await this.ensureConnected();
    const data = await callPost('call-initiate', {}, {
      device_id: this.deviceId, peer: calleeDeviceId, kind: 'audio',
    });
    this.wsSend({ type: 'call:join', voucher: data.voucher });
    return { callId: data.call_id };
  }

  async sendOffer(callId: string, sdp: RTCSessionDescriptionInitLike): Promise<void> {
    this.sendSignal(callId, { kind: 'offer', sdp: sdp.sdp });
  }

  async sendAnswer(callId: string, sdp: RTCSessionDescriptionInitLike): Promise<void> {
    this.sendSignal(callId, { kind: 'answer', sdp: sdp.sdp });
  }

  async sendIceCandidate(callId: string, candidate: RTCIceCandidateInitLike): Promise<void> {
    this.sendSignal(callId, { kind: 'ice', candidate });
  }

  /** Callee side, once onIncomingCall fires: mints this device's own
   *  voucher and joins the relay room as callee. Not part of
   *  CallSignalingClient's interface (CallEngine's acceptIncoming doesn't
   *  need to know vouchers exist) — call this first, from wherever
   *  onIncomingCall is handled, before constructing a CallEngine. */
  async joinAsCallee(callId: string): Promise<void> {
    await this.ensureConnected();
    const data = await callPost('call-callee-voucher', {}, { device_id: this.deviceId, call_id: callId });
    this.wsSend({ type: 'call:join', voucher: data.voucher });
    await callPost('call-accept', {}, { device_id: this.deviceId, call_id: callId }).catch(() => {});
  }

  async reject(callId: string): Promise<void> {
    await callPost('call-decline', {}, { device_id: this.deviceId, call_id: callId });
  }

  async hangUp(callId: string): Promise<void> {
    await callPost('call-end', {}, { device_id: this.deviceId, call_id: callId, reason: 'hangup' });
  }

  async getIceServers(callId: string): Promise<RTCIceServerLike[]> {
    const data = await callGet('call-ice-servers', { device_id: this.deviceId, call_id: callId });
    return data.ice_servers ?? [];
  }

  onIncomingCall(cb: (callId: string, callerDeviceId: string) => void): () => void {
    this.listeners.incomingCall.push(cb);
    return () => { this.listeners.incomingCall = this.listeners.incomingCall.filter((c) => c !== cb); };
  }
  onOffer(cb: (callId: string, sdp: RTCSessionDescriptionInitLike) => void): () => void {
    this.listeners.offer.push(cb);
    return () => { this.listeners.offer = this.listeners.offer.filter((c) => c !== cb); };
  }
  onAnswer(cb: (callId: string, sdp: RTCSessionDescriptionInitLike) => void): () => void {
    this.listeners.answer.push(cb);
    return () => { this.listeners.answer = this.listeners.answer.filter((c) => c !== cb); };
  }
  onIceCandidate(cb: (callId: string, candidate: RTCIceCandidateInitLike) => void): () => void {
    this.listeners.iceCandidate.push(cb);
    return () => { this.listeners.iceCandidate = this.listeners.iceCandidate.filter((c) => c !== cb); };
  }
  onReject(cb: (callId: string) => void): () => void {
    this.listeners.reject.push(cb);
    return () => { this.listeners.reject = this.listeners.reject.filter((c) => c !== cb); };
  }
  onHangUp(cb: (callId: string) => void): () => void {
    this.listeners.hangUp.push(cb);
    return () => { this.listeners.hangUp = this.listeners.hangUp.filter((c) => c !== cb); };
  }
}
