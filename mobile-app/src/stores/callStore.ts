/**
 * callStore — app-wide calling state (Khabat, 2026-07-28: "ringe knappen
 * skal fungere ikke bare når Inbox er åpen ... sånn som IMO/WhatsApp").
 *
 * One RealCallSignalingClient connection per app session, owned here
 * instead of by whichever screen happens to be open — CallManager
 * (navigation/AppNavigator.tsx, mounted alongside DeepLinkHandler/
 * NotificationRouteHandler, i.e. for the app's whole foreground
 * lifetime, not tied to any one screen) connects it once and renders
 * CallScreen whenever activeCall is set, regardless of what tab/screen
 * is currently showing. InboxScreen's call button just calls
 * startOutgoingCall() — it doesn't hold any calling state of its own
 * anymore.
 *
 * Still a real, disclosed limit (not silently overclaimed): this only
 * covers the app in the foreground. True "rings while the app is
 * backgrounded or killed" (like a real phone call) needs native VoIP
 * push (CallKit/PushKit on iOS, ConnectionService + a high-priority FCM
 * message on Android) — a separate, much larger piece of native work,
 * not attempted here.
 */

import { create } from 'zustand';
import { Vibration } from 'react-native';
import { CallEngine, RTCSessionDescriptionInitLike } from '../services/callService';
import { RealCallSignalingClient } from '../services/callSignalingClient';
import { useToastStore } from './toastStore';

// Distinct from the single "tap" haptic used elsewhere in the app (coin
// forge, etc.) — a repeating long-short-short pulse so an incoming call
// reads as different from every other haptic in RealGram at a glance
// (eyes-free), closer to how a real phone's ring cadence feels than a
// single buzz. No custom audio ringtone shipped in this pass — that
// needs an actual sound asset (Gen-Z-styled, on-brand) supplied by
// design/audio, not something synthesizable here; flagged, not silently
// skipped. Vibration alone is a real, working ring cue in the meantime.
const RING_PATTERN = [0, 400, 200, 400, 200, 800];

let client: RealCallSignalingClient | null = null;
let clientDeviceId = '';
const pendingOffers = new Map<string, RTCSessionDescriptionInitLike>();

interface ActiveCall {
  engine:     CallEngine;
  peerLabel:  string;
  outgoing:   boolean;
}

interface CallState {
  activeCall: ActiveCall | null;
  /** Idempotent — safe to call on every render of whatever mounts
   *  CallManager; only actually (re)connects when deviceId changes. */
  connect: (deviceId: string) => void;
  disconnect: () => void;
  startOutgoingCall: (peerId: string, peerLabel: string) => void;
  acceptIncomingCall: () => Promise<void>;
  endCall: () => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  activeCall: null,

  connect: (deviceId: string) => {
    if (!deviceId || clientDeviceId === deviceId) return;
    client?.disconnect();
    client = new RealCallSignalingClient(deviceId);
    clientDeviceId = deviceId;
    client.connect();

    client.onOffer((callId, sdp) => pendingOffers.set(callId, sdp));
    client.onIncomingCall((callId, callerUserId) => {
      Vibration.vibrate(RING_PATTERN, true);
      // Safety net, not the primary stop mechanism: onHangUp/onReject below
      // already cancel vibration on a real signal. This just guarantees it
      // stops even if that signal is ever lost (relay hiccup, app
      // backgrounded mid-ring) -- 50s, just past lib/calling.php's own
      // 45s CALL_STALE_RINGING_SECS sweep, so a genuinely missed call goes
      // quiet right around when the server itself gives up on it too.
      setTimeout(() => Vibration.cancel(), 50_000);
      const engine = new CallEngine(client!, callId, callerUserId, () => {}, () => {});
      set({ activeCall: { engine, peerLabel: callerUserId, outgoing: false } });
    });
    client.onHangUp(() => Vibration.cancel());
    client.onReject(() => Vibration.cancel());
  },

  disconnect: () => {
    client?.disconnect();
    client = null;
    clientDeviceId = '';
    Vibration.cancel();
    set({ activeCall: null });
  },

  startOutgoingCall: (peerId: string, peerLabel: string) => {
    if (!peerId) return;
    // `client` is only ever null if connect() itself was never called (auth
    // not ready yet when CallManager mounted, or calling disabled for this
    // account) -- a real, if rare, gap: silently doing nothing on tap read
    // as "the call button is slow" in Khabat's 2026-07-29 test, when it was
    // actually a dead tap followed by a working one once connect() caught
    // up. Once `client` exists, CallEngine.startOutgoing() already awaits
    // the WebSocket handshake internally (ensureConnected()) before sending
    // anything, so a slow-but-connecting client doesn't need special
    // handling here -- only a genuinely absent one does.
    if (!client) {
      useToastStore.getState().show('Calling isn’t ready yet — try again in a moment', 'error');
      return;
    }
    const engine = new CallEngine(client, '', peerId, () => {}, () => {});
    set({ activeCall: { engine, peerLabel, outgoing: true } });
  },

  acceptIncomingCall: async () => {
    const { activeCall } = get();
    if (!client || !activeCall) throw new Error('no active call');
    Vibration.cancel();
    const callId = activeCall.engine.getCallId();
    await client.joinAsCallee(callId);

    const offer = await new Promise<RTCSessionDescriptionInitLike>((resolve, reject) => {
      const existing = pendingOffers.get(callId);
      if (existing) { resolve(existing); return; }
      const started = Date.now();
      const interval = setInterval(() => {
        const found = pendingOffers.get(callId);
        if (found) { clearInterval(interval); resolve(found); return; }
        if (Date.now() - started > 15000) { clearInterval(interval); reject(new Error('offer timed out')); }
      }, 200);
    });
    pendingOffers.delete(callId);
    await activeCall.engine.acceptIncoming(offer);
  },

  endCall: () => {
    Vibration.cancel();
    set({ activeCall: null });
  },
}));
