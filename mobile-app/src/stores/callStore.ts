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
import InCallManager from 'react-native-incall-manager';
import { CallEngine, RTCSessionDescriptionInitLike } from '../services/callService';
import { RealCallSignalingClient } from '../services/callSignalingClient';
import { useToastStore } from './toastStore';

// Distinct from the single "tap" haptic used elsewhere in the app (coin
// forge, etc.) — a repeating long-short-short pulse so an incoming call
// reads as different from every other haptic in RealGram at a glance
// (eyes-free), closer to how a real phone's ring cadence feels than a
// single buzz. Runs alongside the real audio ringtone below now (Khabat,
// 2026-07-30, supplied the actual asset — see InCallManager.startRingtone
// calls below), not instead of it; kept as its own cue for a
// silenced/vibrate-mode phone.
const RING_PATTERN = [0, 400, 200, 400, 200, 800];

let client: RealCallSignalingClient | null = null;
let clientDeviceId = '';
const pendingOffers = new Map<string, RTCSessionDescriptionInitLike>();

interface ActiveCall {
  engine:     CallEngine;
  peerLabel:  string;
  /** The real SetaLink ID used for signaling/messaging — distinct from
   *  peerLabel, which InboxScreen sometimes passes as a friendly
   *  conversation title instead. Needed by CallScreen to log a call-log
   *  message to the right DM thread once the call ends (Khabat,
   *  2026-07-31: "det skal stå i melding chat at: ubesvart call..."). */
  peerId:     string;
  outgoing:   boolean;
}

interface CallState {
  activeCall: ActiveCall | null;
  /** Idempotent — safe to call on every render of whatever mounts
   *  CallManager; only actually (re)connects when deviceId changes. */
  connect: (deviceId: string) => void;
  disconnect: () => void;
  startOutgoingCall: (peerId: string, peerLabel: string, video?: boolean) => void;
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
    client.onIncomingCall((callId, callerUserId, kind) => {
      Vibration.vibrate(RING_PATTERN, true);
      // '_BUNDLE_' plays the real asset now bundled as ios/.../
      // incallmanager_ringtone.mp3 + android/.../res/raw/
      // incallmanager_ringtone.mp3 (Khabat, 2026-07-30, supplied the actual
      // file) — InCallManager's own documented filename convention, no
      // JS-side asset loading needed. `0` (non-array) vibrate_pattern on
      // purpose, not RING_PATTERN — the Vibration.vibrate call right above
      // already drives the haptic; the library's own source only starts a
      // second, independent (non-repeating) Vibration.vibrate of its own
      // when this argument is an array, so passing a plain number keeps
      // vibration solely driven by this file. 'default' iOS category (not
      // 'playback') so this respects the phone's silent switch like every
      // other sound in the app, rather than a hard override.
      InCallManager.startRingtone('_BUNDLE_', 0, 'default', -1);
      // Safety net, not the primary stop mechanism: onHangUp/onReject below
      // already cancel vibration on a real signal. This just guarantees it
      // stops even if that signal is ever lost (relay hiccup, app
      // backgrounded mid-ring) -- 50s, just past lib/calling.php's own
      // 45s CALL_STALE_RINGING_SECS sweep, so a genuinely missed call goes
      // quiet right around when the server itself gives up on it too.
      setTimeout(() => { Vibration.cancel(); InCallManager.stopRingtone(); }, 50_000);
      // `kind` comes from the caller's own call-initiate request (relayed
      // through the call:incoming push, see callSignalingClient.ts) — the
      // callee's CallEngine has to be constructed knowing this upfront so
      // captureLocalMedia() requests the camera (not just the mic) before
      // the user even taps Accept, same as the caller side already does.
      const engine = new CallEngine(client!, callId, callerUserId, () => {}, () => {}, kind === 'video');
      set({ activeCall: { engine, peerLabel: callerUserId, peerId: callerUserId, outgoing: false } });
    });
    client.onHangUp(() => { Vibration.cancel(); InCallManager.stopRingtone(); });
    client.onReject(() => { Vibration.cancel(); InCallManager.stopRingtone(); });
  },

  disconnect: () => {
    client?.disconnect();
    client = null;
    clientDeviceId = '';
    Vibration.cancel();
    InCallManager.stopRingtone();
    set({ activeCall: null });
  },

  startOutgoingCall: (peerId: string, peerLabel: string, video = false) => {
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
    const engine = new CallEngine(client, '', peerId, () => {}, () => {}, video);
    set({ activeCall: { engine, peerLabel, peerId, outgoing: true } });
  },

  acceptIncomingCall: async () => {
    const { activeCall } = get();
    if (!client || !activeCall) throw new Error('no active call');
    Vibration.cancel();
    InCallManager.stopRingtone();
    const callId = activeCall.engine.getCallId();
    // client.joinAsCallee() below calls call-accept, which marks the
    // call_sessions row 'accepted' server-side — from this point on the
    // server considers both devices "on a call" (call_active_for()) until
    // something explicitly ends it. Everything after this line used to be
    // able to throw (offer timeout, WebRTC/mic failure in acceptIncoming())
    // with only a local .catch(() => setState('ended')) in CallScreen —
    // that's local-only, the server never heard about it. Found live,
    // 2026-07-30: a call that failed this way left an 'accepted' row with
    // no ended_at forever (the 45s stale sweep only covers 'ringing'), so
    // every subsequent call_initiate() from either party hit "you are
    // already on a call" / "recipient is on another call" indefinitely —
    // exactly Khabat's "tap it, it flashes for a second, goes away" report.
    // Wrapping so any failure here still tells the server the call is over.
    try {
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
    } catch (err) {
      pendingOffers.delete(callId);
      await activeCall.engine.hangUp().catch(() => {});
      throw err;
    }
  },

  endCall: () => {
    Vibration.cancel();
    InCallManager.stopRingtone();
    set({ activeCall: null });
  },
}));
