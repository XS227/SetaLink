/**
 * callService — audio calling (react-native-webrtc), Khabat's Earn/Inbox
 * ask (2026-07-28): friend-to-friend calls from the Inbox, audio first,
 * premium-gated, video as a later phase.
 *
 * This file owns the actual WebRTC peer connection (mic capture, SDP
 * offer/answer, ICE candidates, mute/speaker). It talks to the outside
 * world only through `CallSignalingClient` below — a small interface, not
 * a concrete implementation, because the signaling backend itself is
 * still being designed server-side (docs/realgram/TASK_SPLIT.md
 * A→B(166)/(167)/(168)) and TURN (`fi-hel`, coturn) isn't live yet either.
 * `CallSignalingClient` is this session's PROPOSED shape for that
 * exchange — treat it as a starting point to reconcile against whatever
 * the real backend ends up being, not a finished contract.
 *
 * Deliberately NOT wired into InboxScreen.tsx yet: there's nothing for it
 * to actually call (no signaling server, no TURN running), and wiring a
 * dead "Call" button in would mean adding a jest mock to a currently-
 * passing test (inboxScreen.test.tsx) for a feature that can't do
 * anything yet. Wire it in once there's a real signaling implementation
 * to test against.
 *
 * Khabat, 2026-07-30: "vi har lyst til å teste ut video call også, bare
 * mellom meg og test brukeren, så senere kan vi bare slå den på" — video
 * turned on for real. This class already fully supported it (the `video`
 * constructor flag below has captured camera + sent a video track since
 * this file was first written); what was actually missing was `kind`
 * ('audio'/'video') traveling through `CallSignalingClient` at all —
 * `placeCall` had no way to ask for video, and an incoming call had no way
 * to tell the callee which kind it was. Both now take/carry `kind`. The
 * real gate stays server-side (`lib/calling.php`'s `call_initiate` —
 * video only proceeds when both ends are on the same testing allowlist
 * audio itself is still restricted to), not a client-side flag, so this
 * can't be worked around by anyone who isn't Khabat + the test account.
 */

import { Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {
  MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices,
} from 'react-native-webrtc';
import { trackEvent } from './analytics';
import { useAuthStore } from '../stores/authStore';

/**
 * Proposed signaling contract. One call = one `callId`. Each side posts
 * its own SDP/ICE through this interface; a real implementation forwards
 * them to the other party (WebSocket push, matching the existing
 * `/api/season2/*` Node backend's ability to hold live connections — this
 * VPS's PHP backend can't do that cheaply, per B's own (167) note about
 * building this against their stack, not this one).
 */
export interface CallSignalingClient {
  /** Ask the callee's device to ring. The backend generates and returns
   *  the callId (it's the DB primary key and the relay's room id — see
   *  docs/realgram/TASK_SPLIT.md B→A(171), the reason this isn't a
   *  caller-supplied value). Resolves once the request is sent, not once
   *  they answer — answer/reject arrive via onAnswer/onReject. */
  placeCall(calleeDeviceId: string, kind: 'audio' | 'video'): Promise<{ callId: string }>;
  sendOffer(callId: string, sdp: RTCSessionDescriptionInitLike): Promise<void>;
  sendAnswer(callId: string, sdp: RTCSessionDescriptionInitLike): Promise<void>;
  sendIceCandidate(callId: string, candidate: RTCIceCandidateInitLike): Promise<void>;
  /** Out-of-band alongside a renegotiation offer/answer -- WebRTC itself
   *  has no semantic "this track is a shared screen, not a camera" tag,
   *  so the receiver needs this to know which incoming video track/stream
   *  (matched by `trackId`, react-native-webrtc's own MediaStreamTrack.id)
   *  to treat as the shared screen vs. the camera once both are present.
   *  Routed through the exact same generic call:signal relay as offer/
   *  answer/ice (server.js forwards any payload verbatim) -- no relay
   *  changes needed for this. */
  sendScreenShareState(callId: string, active: boolean, trackId?: string): Promise<void>;
  reject(callId: string): Promise<void>;
  /** `reason` — server accepts 'caller_hangup'/'callee_hangup'/'failed',
   *  anything else defaults to 'caller_hangup' (lib/calling.php's own
   *  call_mark_ended). Optional so existing explicit-hangup callers don't
   *  need to change. */
  hangUp(callId: string, reason?: string): Promise<void>;
  /** Short-lived TURN REST API credentials for this call (username,
   *  credential, ttl) — minted server-side against fi-hel's coturn
   *  static-auth-secret, never sent from the client. */
  getIceServers(callId: string): Promise<RTCIceServerLike[]>;

  onIncomingCall(cb: (callId: string, callerDeviceId: string, kind: 'audio' | 'video') => void): () => void;
  onOffer(cb: (callId: string, sdp: RTCSessionDescriptionInitLike) => void): () => void;
  onAnswer(cb: (callId: string, sdp: RTCSessionDescriptionInitLike) => void): () => void;
  onIceCandidate(cb: (callId: string, candidate: RTCIceCandidateInitLike) => void): () => void;
  onScreenShareState(cb: (callId: string, active: boolean, trackId?: string) => void): () => void;
  onReject(cb: (callId: string) => void): () => void;
  onHangUp(cb: (callId: string) => void): () => void;
}

// Avoid a hard dependency on react-native-webrtc's own type names in the
// interface above, so this file compiles/typechecks even before the real
// native module is linked (npm install only, no native rebuild yet) and
// so a future signaling client implementation isn't forced to import
// react-native-webrtc just to talk to this interface.
export interface RTCSessionDescriptionInitLike { type: 'offer' | 'answer'; sdp: string }
export interface RTCIceCandidateInitLike { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
export interface RTCIceServerLike { urls: string | string[]; username?: string; credential?: string }

export type CallState =
  | 'idle'
  | 'dialing'        // we called, waiting for them to answer
  | 'ringing'         // they called, waiting for us to answer/reject
  | 'connecting'      // answered, ICE/SDP still negotiating
  | 'active'
  | 'ended';

export interface CallHandle {
  callId: string;
  peerDeviceId: string;
  state: CallState;
  muted: boolean;
  speakerOn: boolean;
}

const PC_CONFIG_BASE: Partial<RTCConfigurationLike> = {
  iceCandidatePoolSize: 4,
};
interface RTCConfigurationLike { iceServers: RTCIceServerLike[]; iceCandidatePoolSize?: number }

/**
 * One CallEngine per in-flight call. Not a singleton store on purpose —
 * the UI layer (CallScreen) owns exactly one CallEngine for the call it's
 * displaying, and throws it away when the call ends. Simpler than a
 * global "current call" store for a v1 that only supports one call at a
 * time (no call-waiting).
 */
export class CallEngine {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private unsubs: Array<() => void> = [];
  private remoteStreamListeners: Array<(stream: MediaStream) => void> = [];
  private localStreamListeners: Array<(stream: MediaStream) => void> = [];
  private stateListeners: Array<(state: CallState) => void> = [];

  // ── Screen sharing (Khabat, 2026-08-01 spec) ──────────────────────────
  // Kept as its own MediaStream/sender, never merged into localStream --
  // "kamera + skjerm" mode needs both sent as genuinely separate tracks
  // (the receiver renders one as main view, the other as PiP), and "bare
  // skjerm" needs the camera track fully stoppable/resumable without
  // touching this one.
  private screenStream: MediaStream | null = null;
  private screenSender: any | null = null;
  private cameraSender: any | null = null;
  private audioSender: any | null = null;
  private screenShareListeners: Array<(active: boolean, stream: MediaStream | null) => void> = [];
  private remoteScreenStream: MediaStream | null = null;
  private remoteScreenStreamListeners: Array<(stream: MediaStream | null) => void> = [];
  /** Set by the explicit screen-share-state signal (not inferred from the
   *  'track' event alone -- WebRTC has no built-in "this track is a
   *  screen" tag). See ensurePeerConnection's 'track' handler for how this
   *  is used to route an incoming video track to remoteStream (camera) vs.
   *  remoteScreenStream once both can be present simultaneously. */
  private remoteScreenTrackId: string | null = null;
  /** True once the FIRST offer/answer (real call setup, not a screen-share
   *  renegotiation) has completed -- guards the mid-call renegotiation
   *  listener below from ever mistaking the initial offer for a
   *  renegotiation, regardless of message-arrival timing. */
  private callEstablished = false;

  constructor(
    private readonly signaling: CallSignalingClient,
    /** Known upfront for an incoming call (arrives with the push); empty
     *  for an outgoing call until startOutgoing()'s placeCall() resolves
     *  with the server-generated id — see CallSignalingClient.placeCall's
     *  own doc comment for why the server, not the client, owns this. */
    private callId: string,
    private readonly peerDeviceId: string,
    private readonly onRemoteStream: (stream: MediaStream) => void,
    private readonly onStateChange: (state: CallState) => void,
    /** Built in Phase 1 (Khabat, 2026-07-28) so it'd be ready once there was
     *  real relay volume/cost data to decide on turning it on (see
     *  docs/realgram/TASK_SPLIT.md B→A(164)). Turned on 2026-07-30, scoped
     *  server-side to Khabat + the test account (see this file's header) —
     *  `callStore.ts` passes this through from whatever the caller/callee
     *  actually requested, not a hardcoded default. */
    private readonly video: boolean = false,
  ) {}

  /** Every internal state transition (both the constructor callback and
   *  CallScreen's own subscription, see onStateChangeUpdate) goes through
   *  here — one path, not two independently-maintained ones. */
  private emitStateChange(state: CallState): void {
    this.onStateChange(state);
    this.stateListeners.forEach((cb) => cb(state));
  }

  /** 2026-07-31: server-side (call_sessions, nginx /ws/call byte counts) can
   *  show a call reached 'accepted' with real signaling traffic and still
   *  never actually connect for either side — REST/relay layer has no
   *  visibility into the WebRTC layer above it (ICE/DTLS state, getUserMedia
   *  failures). Nothing anywhere logged that layer at all before this.
   *  Routes through the same trackEvent()/app_events pipe every other
   *  screen's diagnostics already use — best-effort, never blocks a call. */
  private logCallEvent(event: string, extra?: Record<string, unknown>): void {
    trackEvent(event, useAuthStore.getState().user?.deviceId, {
      call_id: this.callId,
      peer_device_id: this.peerDeviceId,
      kind: this.video ? 'video' : 'audio',
      ...extra,
    });
  }

  /** Lets CallScreen (which receives an already-constructed CallEngine)
   *  react to state transitions the engine itself drives — e.g. the
   *  underlying RTCPeerConnection reaching 'connected'/'failed' — the same
   *  problem onRemoteStreamUpdate solves for the remote stream, and for
   *  the same reason: the constructor's own onStateChange callback is
   *  whoever built the engine's business, not necessarily CallScreen's. */
  onStateChangeUpdate(cb: (state: CallState) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== cb);
    };
  }

  private async ensurePeerConnection(iceServers: RTCIceServerLike[]): Promise<RTCPeerConnection> {
    if (this.pc) return this.pc;

    const pc = new RTCPeerConnection({ ...PC_CONFIG_BASE, iceServers } as any);
    // react-native-webrtc's published lib/typescript/*.d.ts doesn't ship
    // its internal vendor/event-target-shim types, so RTCPeerConnection's
    // inherited EventTarget methods (addEventListener etc.) don't resolve
    // through the package's own declarations -- a gap in their published
    // types, not something to work around by disabling checks elsewhere.
    // `any` here only, everything else in this file stays properly typed.
    const pcAny = pc as any;
    pcAny.addEventListener('icecandidate', (event: any) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(this.callId, {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }).catch(() => {});
      }
    });
    pcAny.addEventListener('track', (event: any) => {
      const [stream] = event.streams;
      if (!stream) return;
      // Route to remoteScreenStream vs. remoteStream (camera). WebRTC has
      // no built-in "this is a screen, not a camera" tag on a track --
      // primary signal is the explicit screen-share-state message
      // (matched by track id, set via onScreenShareState below); the
      // heuristic fallback (a second incoming video track once the first
      // is already established) covers the case where that signal hasn't
      // arrived yet due to ordinary message-arrival race, since this app
      // only ever adds a second video track for a screen-share
      // renegotiation -- never for any other reason.
      const isVideo = event.track?.kind === 'video';
      const isKnownScreenTrack = isVideo && event.track?.id === this.remoteScreenTrackId;
      const hasExistingCameraVideo = isVideo && !!this.remoteStream?.getVideoTracks().length && stream.id !== this.remoteStream.id;
      if (isKnownScreenTrack || hasExistingCameraVideo) {
        this.remoteScreenStream = stream;
        this.remoteScreenStreamListeners.forEach((cb) => cb(stream));
        this.logCallEvent('CALL_REMOTE_TRACK', { track_kind: 'screen' });
        return;
      }
      this.remoteStream = stream;
      this.onRemoteStream(stream);
      this.remoteStreamListeners.forEach((cb) => cb(stream));
      this.logCallEvent('CALL_REMOTE_TRACK', { track_kind: event.track?.kind || '' });
    });
    pcAny.addEventListener('connectionstatechange', () => {
      const s = pcAny.connectionState;
      this.logCallEvent('CALL_CONNECTION_STATE', { connection_state: s });
      if (s === 'connected') {
        this.callEstablished = true;
        this.emitStateChange('active');
      }
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        // Khabat, 2026-07-31: this used to only update local UI state —
        // never told the server the call was over, so call_sessions kept
        // it 'accepted' forever (the 3h stale sweep is the only other
        // thing that clears it) and every next call attempt from either
        // side hit call_initiate()'s "you are already on a call" guard —
        // reproduced live twice this session as "dial screen pops up for
        // a second then disappears." call_mark_ended is idempotent for an
        // already-terminal call, so this is safe even if the user's own
        // explicit hangUp() already reported it.
        if (this.callId) this.signaling.hangUp(this.callId, 'failed').catch(() => {});
        this.emitStateChange('ended');
      }
    });
    // Historically the more reliable of the two on react-native-webrtc
    // (connectionstatechange support/timing has been inconsistent across
    // Android/iOS versions) — 'failed' here specifically is what
    // distinguishes "signaling worked, ICE itself never found a path"
    // (STUN-only behind carrier-grade NAT, dead/unreachable TURN, etc.)
    // from every other failure mode, which is exactly the gap this file's
    // header describes: server-side data can't tell that case apart from
    // "connected fine, then the app/network dropped."
    pcAny.addEventListener('iceconnectionstatechange', () => {
      this.logCallEvent('CALL_ICE_STATE', { ice_connection_state: pcAny.iceConnectionState });
    });

    this.pc = pc;
    return pc;
  }

  /** Requests mic (+ camera, when `video` is on) and keeps whatever it
   *  gets as the one local stream for the lifetime of this call.
   *  `ringback` — Khabat, 2026-07-30 (sent the real audio assets): only the
   *  caller should hear a ringback tone while the callee's phone is
   *  ringing; acceptIncoming() never passes this. */
  private async captureLocalMedia(ringback = false): Promise<MediaStream> {
    if (this.localStream) return this.localStream;
    // B->A(269), 2026-07-30: the "very faint audio" report on a connected
    // call — a real react-native-webrtc gotcha, not this app's bug alone.
    // WebRTC's audio track plays through whatever audio session is already
    // active; without explicitly starting one, Android/iOS route it as a
    // regular media stream (default/low-ish volume) instead of the boosted
    // in-call voice routing a phone call gets. InCallManager.start() is
    // what actually switches the audio session into call mode (also grabs
    // audio focus + the proximity sensor) — setSpeakerphoneOn alone
    // (below) can't fix this since there was never a call-mode session for
    // it to route in the first place. Called once here, both call
    // directions (startOutgoing/acceptIncoming) go through this single
    // chokepoint via the localStream guard just above.
    // `ringback: '_BUNDLE_'` plays the real asset now bundled as
    // ios/.../incallmanager_ringback.mp3 + android/.../res/raw/
    // incallmanager_ringback.mp3 (InCallManager's own documented filename
    // convention — no JS-side asset loading needed).
    InCallManager.start({
      media: this.video ? 'video' : 'audio',
      ...(ringback ? { ringback: '_BUNDLE_' } : {}),
    });
    let stream;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: true,
        video: this.video ? { facingMode: 'user' } : false,
      } as any);
    } catch (err: any) {
      // Denied/unavailable camera or mic (first-ever video test on a real
      // device is exactly when a permission prompt can go unanswered or a
      // camera can be busy/absent) throws here and would otherwise vanish
      // into whatever local .catch() the caller happens to have — logging
      // before rethrowing so it's visible without needing device access.
      this.logCallEvent('CALL_MEDIA_ERROR', { message: err?.message || '', name: err?.name || '' });
      throw err;
    }
    this.localStream = stream as unknown as MediaStream;
    this.localStreamListeners.forEach((cb) => cb(this.localStream!));
    return this.localStream;
  }

  /** Adds localStream's tracks to `pc`, keeping the per-kind sender
   *  references (cameraSender/audioSender) that startScreenShare/
   *  stopCameraTrack/resumeCameraTrack below need -- addTrack() returns
   *  the sender but the original call sites just discarded it. */
  private addLocalTracks(pc: RTCPeerConnection, stream: MediaStream): void {
    (stream.getTracks() as any[]).forEach((track) => {
      const sender = (pc as any).addTrack(track, stream as any);
      if (track.kind === 'video') this.cameraSender = sender;
      else if (track.kind === 'audio') this.audioSender = sender;
    });
  }

  // ── Screen sharing ─────────────────────────────────────────────────────
  // Khabat, 2026-08-01 spec. Four modes fall out of two independent
  // booleans this class already exposes distinctly: screen track present
  // (screenStream != null) x camera track present (cameraSender != null).
  // "Bare lyd" is neither; "kamera + skjerm" is both.

  /** Starts capture (triggers the OS's own MediaProjection permission
   *  dialog via react-native-webrtc's getDisplayMedia -- this class never
   *  shows its own permission UI, only the caller-side warning text is
   *  this app's own, per spec §2), adds it as a genuinely separate video
   *  track (not a replacement of the camera track -- "kamera + skjerm"
   *  needs both simultaneously), and renegotiates. Camera track is left
   *  exactly as it was; call stopCameraTrack() separately for "bare
   *  skjerm" mode. Throws on permission denial/cancellation -- the caller
   *  (CallScreen) is expected to catch and show the spec's own error
   *  copy, not this class's job to pick UI strings. */
  async startScreenShare(): Promise<MediaStream> {
    if (!this.pc) throw new Error('no active call');
    if (this.screenStream) return this.screenStream; // already sharing -- idempotent
    let stream: MediaStream;
    try {
      stream = await (mediaDevices as any).getDisplayMedia({});
    } catch (err: any) {
      this.logCallEvent('CALL_SCREEN_SHARE_ERROR', { message: err?.message || '', name: err?.name || '' });
      throw err;
    }
    this.screenStream = stream;
    const track = (stream as any).getVideoTracks()[0];
    this.screenSender = (this.pc as any).addTrack(track, stream as any);
    // Stopping the track from the OS's own screen-record indicator/quick-
    // settings tile (spec §6/§7) fires 'ended' on the track itself, same
    // as any other MediaStreamTrack -- this is the ONE place that needs
    // to be true regardless of who/what triggered the stop, so
    // stopScreenShare() itself doesn't duplicate this teardown.
    track.onended = () => { this.stopScreenShare().catch(() => {}); };
    await this.signaling.sendScreenShareState(this.callId, true, track.id).catch(() => {});
    await this.renegotiate();
    this.screenShareListeners.forEach((cb) => cb(true, this.screenStream));
    this.logCallEvent('CALL_SCREEN_SHARE_START', {});
    return stream;
  }

  /** Idempotent -- safe to call when not currently sharing (also reached
   *  from track.onended above when the OS itself stops the capture). */
  async stopScreenShare(): Promise<void> {
    if (!this.screenStream) return;
    const stream = this.screenStream;
    this.screenStream = null;
    if (this.pc && this.screenSender) {
      try { (this.pc as any).removeTrack(this.screenSender); } catch { /* pc already closed */ }
    }
    this.screenSender = null;
    (stream.getTracks() as any[]).forEach((t) => t.stop());
    await this.signaling.sendScreenShareState(this.callId, false).catch(() => {});
    if (this.pc) await this.renegotiate().catch(() => {});
    this.screenShareListeners.forEach((cb) => cb(false, null));
    this.logCallEvent('CALL_SCREEN_SHARE_STOP', {});
  }

  isScreenSharing(): boolean {
    return !!this.screenStream;
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  onScreenShareUpdate(cb: (active: boolean, stream: MediaStream | null) => void): () => void {
    this.screenShareListeners.push(cb);
    return () => { this.screenShareListeners = this.screenShareListeners.filter((l) => l !== cb); };
  }

  /** The PEER's shared screen, when they're sharing -- distinct from
   *  getRemoteStream() (their camera/mic), see the 'track' handler in
   *  ensurePeerConnection for how the two are told apart. */
  getRemoteScreenStream(): MediaStream | null {
    return this.remoteScreenStream;
  }

  onRemoteScreenStreamUpdate(cb: (stream: MediaStream | null) => void): () => void {
    this.remoteScreenStreamListeners.push(cb);
    return () => { this.remoteScreenStreamListeners = this.remoteScreenStreamListeners.filter((l) => l !== cb); };
  }

  /** "Bare skjerm" mode (spec §3): fully stops and releases the camera --
   *  not the soft track.enabled=false mute setVideoEnabled(false) does
   *  elsewhere in this class -- so the hardware/encoder is actually freed
   *  and no camera bitrate is spent, per the spec's own "stoppes helt for
   *  å redusere dataforbruk". Mic keeps running (still an audio call).
   *  Screen share, if active, is untouched. */
  async stopCameraTrack(): Promise<void> {
    if (!this.pc || !this.cameraSender) return;
    const track = this.localStream?.getVideoTracks()[0];
    try { (this.pc as any).removeTrack(this.cameraSender); } catch { /* pc already closed */ }
    this.cameraSender = null;
    track?.stop();
    if (this.localStream && track) {
      (this.localStream as any).removeTrack(track);
    }
    await this.renegotiate().catch(() => {});
    this.logCallEvent('CALL_CAMERA_STOPPED', {});
  }

  /** Re-acquires the camera and adds it back as a fresh track WITHOUT
   *  touching screen share -- spec §3's "kameraknappen må fortsatt være
   *  tilgjengelig, slik at kameraet kan slås på igjen uten å stoppe
   *  skjermdelingen." Safe to call whether or not stopCameraTrack() was
   *  ever called (e.g. camera was never on for this call -- "bare
   *  skjerm" chosen from the very start). */
  async resumeCameraTrack(): Promise<void> {
    if (!this.pc || this.cameraSender) return; // already have a live camera track
    let stream: any;
    try {
      stream = await mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } } as any);
    } catch (err: any) {
      this.logCallEvent('CALL_MEDIA_ERROR', { message: err?.message || '', name: err?.name || '', context: 'resumeCameraTrack' });
      throw err;
    }
    const track = stream.getVideoTracks()[0];
    if (this.localStream) {
      (this.localStream as any).addTrack(track);
    } else {
      this.localStream = stream;
    }
    this.cameraSender = (this.pc as any).addTrack(track, (this.localStream as any));
    this.localStreamListeners.forEach((cb) => cb(this.localStream!));
    await this.renegotiate().catch(() => {});
    this.logCallEvent('CALL_CAMERA_RESUMED', {});
  }

  /** Caller/screen-sharer's own RTCRtpSender for the shared-screen track --
   *  what Task 5's adaptive-quality logic calls setParameters() on
   *  (maxBitrate/maxFramerate/scaleResolutionDownBy), not exposed as its
   *  own getter until that's actually wired up here. */
  getScreenSender(): any | null {
    return this.screenSender;
  }

  getCameraSender(): any | null {
    return this.cameraSender;
  }

  /** Caller side: capture mic(+camera), create+send an SDP offer. */
  async startOutgoing(): Promise<void> {
    this.emitStateChange('dialing');
    const { callId } = await this.signaling.placeCall(this.peerDeviceId, this.video ? 'video' : 'audio');
    this.callId = callId;

    const iceServers = await this.signaling.getIceServers(this.callId);
    const pc = await this.ensurePeerConnection(iceServers);
    const stream = await this.captureLocalMedia(true);
    this.addLocalTracks(pc, stream);

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    await this.signaling.sendOffer(this.callId, { type: 'offer', sdp: offer.sdp! });

    this.listenForAnswerAndCandidates();
  }

  /** Callee side: capture mic(+camera), wait for the offer already known
   *  to the caller, answer it. Call this once the user taps "Accept". */
  async acceptIncoming(offer: RTCSessionDescriptionInitLike): Promise<void> {
    this.emitStateChange('connecting');
    const iceServers = await this.signaling.getIceServers(this.callId);
    const pc = await this.ensurePeerConnection(iceServers);
    const stream = await this.captureLocalMedia();
    this.addLocalTracks(pc, stream);

    await pc.setRemoteDescription(new RTCSessionDescription(offer as any));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.signaling.sendAnswer(this.callId, { type: 'answer', sdp: answer.sdp! });

    this.listenForCandidates();
  }

  async rejectIncoming(): Promise<void> {
    await this.signaling.reject(this.callId);
    this.emitStateChange('ended');
  }

  private listenForAnswerAndCandidates(): void {
    this.unsubs.push(
      this.signaling.onAnswer(async (callId, sdp) => {
        if (callId !== this.callId || !this.pc) return;
        // Screen-share (and any other mid-call) renegotiation reuses this
        // exact same onAnswer path -- only touch ringback/call-state for
        // the FIRST answer (the real call handshake). Without this guard
        // a renegotiation answer mid-active-call would incorrectly bounce
        // the UI back to 'connecting'.
        if (!this.callEstablished) {
          // Ringback is only ever started on this (caller) path — stopping
          // it unconditionally here is safe/idempotent either way
          // (InCallManager treats stopRingback() like its own stop(): a
          // no-op when nothing's playing), same convention teardown()'s
          // InCallManager.stop() below already relies on.
          InCallManager.stopRingback();
          this.emitStateChange('connecting');
        }
        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp as any));
      }),
      this.signaling.onReject((callId) => {
        if (callId !== this.callId) return;
        InCallManager.stopRingback();
        this.emitStateChange('ended');
      }),
    );
    this.listenForCandidates();
  }

  private listenForCandidates(): void {
    this.unsubs.push(
      this.signaling.onIceCandidate(async (callId, candidate) => {
        if (callId !== this.callId || !this.pc) return;
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate as any));
      }),
      this.signaling.onHangUp((callId) => {
        if (callId !== this.callId) return;
        InCallManager.stopRingback();
        this.emitStateChange('ended');
      }),
      // Mid-call renegotiation (screen-share start/stop, camera resume
      // after "screen only" mode). Registered on BOTH caller and callee
      // (this method is shared by both paths) since either side can
      // trigger a renegotiation at any point once the call is active --
      // whoever DIDN'T initiate the track change is the one who needs to
      // answer it here. `callEstablished` is what stops this from ever
      // mistaking the very first offer (handled by callStore.ts's
      // pendingOffers/acceptIncoming flow, not here) for a renegotiation.
      this.signaling.onOffer(async (callId, sdp) => {
        if (callId !== this.callId || !this.pc || !this.callEstablished) return;
        if (this.pc.signalingState !== 'stable') return; // glare -- drop, the other offer wins this round
        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp as any));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.signaling.sendAnswer(this.callId, { type: 'answer', sdp: answer.sdp! });
      }),
      this.signaling.onScreenShareState((callId, active, trackId) => {
        if (callId !== this.callId) return;
        this.remoteScreenTrackId = active ? (trackId || null) : null;
        if (!active) {
          this.remoteScreenStream = null;
          this.remoteScreenStreamListeners.forEach((cb) => cb(null));
        }
        this.logCallEvent('CALL_REMOTE_SCREEN_SHARE', { active });
      }),
    );
  }

  /** Mid-call track-set change (screen-share start/stop, camera stop/
   *  resume) -- creates a fresh offer and sends it; the peer's own
   *  listenForCandidates() onOffer handler above answers it. Not used for
   *  the initial call setup (startOutgoing/acceptIncoming do that
   *  directly) -- only for anything that changes tracks after the call is
   *  already active. */
  private async renegotiate(): Promise<void> {
    if (!this.pc) return;
    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(offer);
    await this.signaling.sendOffer(this.callId, { type: 'offer', sdp: offer.sdp! });
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t: any) => { t.enabled = !muted; });
  }

  /** Video only — see the `video` constructor flag's own comment for why
   *  this whole section is unused today. `getLocalStream`/`isVideoCall`
   *  are what CallScreen would read to decide whether to render RTCView
   *  previews at all. */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /** Empty until startOutgoing()'s placeCall() resolves, for an outgoing
   *  call that hasn't reached the server yet. Always set for an incoming
   *  call (passed to the constructor). */
  getCallId(): string {
    return this.callId;
  }

  /** Lets CallScreen (which receives an already-constructed CallEngine,
   *  not one it built itself) find out when the remote video/audio
   *  stream arrives, independent of whatever the constructor's own
   *  onRemoteStream callback is used for by the integration that wires
   *  this screen in. */
  onRemoteStreamUpdate(cb: (stream: MediaStream) => void): () => void {
    this.remoteStreamListeners.push(cb);
    return () => {
      this.remoteStreamListeners = this.remoteStreamListeners.filter((l) => l !== cb);
    };
  }

  /** Khabat, 2026-07-31: "jeg kunne se andre personens video og ikke mitt
   *  eget som liten vindu nederst" — CallScreen used to read
   *  getLocalStream() once as a plain const at render time, before
   *  captureLocalMedia()'s getUserMedia() (called from startOutgoing()/
   *  acceptIncoming(), after mount) had actually populated it — it only
   *  ever appeared by accident, on whichever later re-render happened to
   *  land after the local stream became ready. Same event-listener shape
   *  as onRemoteStreamUpdate above, just for the local stream. */
  onLocalStreamUpdate(cb: (stream: MediaStream) => void): () => void {
    if (this.localStream) cb(this.localStream);
    this.localStreamListeners.push(cb);
    return () => {
      this.localStreamListeners = this.localStreamListeners.filter((l) => l !== cb);
    };
  }

  /** Khabat, 2026-07-31: used to read `localVideoEnabled`, a copy of
   *  `this.video` only set once captureLocalMedia() actually ran (after
   *  mount, since startOutgoing()/acceptIncoming() are async) — so
   *  CallScreen's `useState(engine.isVideoCall())` for its video-toggle
   *  button captured `false` at mount and never updated (useState's
   *  initial value only runs once), same class of bug the local-preview
   *  fix above just fixed for the stream itself. `this.video` is the
   *  constructor param this was always meant to mirror — correct from
   *  construction, no timing gap, so read it directly instead. */
  isVideoCall(): boolean {
    return this.video;
  }

  setVideoEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((t: any) => { t.enabled = enabled; });
  }

  /** Front/back camera toggle. `_switchCamera()` is react-native-webrtc's
   *  own (underscore-prefixed, so not in its public .d.ts) method on a
   *  video MediaStreamTrack — cast to `any` for the same reason as the
   *  RTCPeerConnection event methods above. */
  switchCamera(): void {
    const videoTrack = this.localStream?.getVideoTracks()[0] as any;
    videoTrack?._switchCamera?.();
  }

  /** Speaker vs. earpiece routing. B->A(269), 2026-07-30: was a no-op
   *  stub — the button flipped CallScreen's own UI state but never
   *  touched actual audio routing. setForceSpeakerphoneOn (rather than
   *  setSpeakerphoneOn) is InCallManager's recommended call once an
   *  in-call audio session is already running (captureLocalMedia's
   *  InCallManager.start() above) — it overrides the session's routing
   *  directly instead of just hinting a preference to it. */
  setSpeakerphoneOn(on: boolean): void {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      InCallManager.setForceSpeakerphoneOn(on);
    }
  }

  async hangUp(): Promise<void> {
    await this.signaling.hangUp(this.callId).catch(() => {});
    this.teardown();
  }

  teardown(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.remoteStreamListeners = [];
    this.localStreamListeners = [];
    this.stateListeners = [];
    this.localStream?.getTracks().forEach((t: any) => t.stop());
    this.localStream = null;
    this.remoteStream = null;
    // Screen share must stop the instant the call ends, no exceptions --
    // spec §6. Not routed through stopScreenShare() (which renegotiates
    // and posts a signal) since the call/peer connection is already going
    // away here -- just release the capture itself.
    this.screenStream?.getTracks().forEach((t: any) => t.stop());
    this.screenStream = null;
    this.screenSender = null;
    this.cameraSender = null;
    this.audioSender = null;
    this.remoteScreenStream = null;
    this.remoteScreenTrackId = null;
    this.screenShareListeners = [];
    this.remoteScreenStreamListeners = [];
    this.callEstablished = false;
    this.pc?.close();
    this.pc = null;
    // Matches captureLocalMedia's start() — only meaningful to call if a
    // session was actually started, but InCallManager.stop() is a safe
    // no-op otherwise (mirrors how the rest of this method tears down
    // possibly-never-initialized state without guards). stopRingback() is
    // the same kind of safety net for a call that never got as far as
    // onAnswer/onReject above (e.g. this screen unmounting mid-dial).
    InCallManager.stopRingback();
    InCallManager.stop();
  }
}
