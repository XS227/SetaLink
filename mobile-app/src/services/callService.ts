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
 */

import { Platform } from 'react-native';
import {
  MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices,
} from 'react-native-webrtc';

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
  placeCall(calleeDeviceId: string): Promise<{ callId: string }>;
  sendOffer(callId: string, sdp: RTCSessionDescriptionInitLike): Promise<void>;
  sendAnswer(callId: string, sdp: RTCSessionDescriptionInitLike): Promise<void>;
  sendIceCandidate(callId: string, candidate: RTCIceCandidateInitLike): Promise<void>;
  reject(callId: string): Promise<void>;
  hangUp(callId: string): Promise<void>;
  /** Short-lived TURN REST API credentials for this call (username,
   *  credential, ttl) — minted server-side against fi-hel's coturn
   *  static-auth-secret, never sent from the client. */
  getIceServers(callId: string): Promise<RTCIceServerLike[]>;

  onIncomingCall(cb: (callId: string, callerDeviceId: string) => void): () => void;
  onOffer(cb: (callId: string, sdp: RTCSessionDescriptionInitLike) => void): () => void;
  onAnswer(cb: (callId: string, sdp: RTCSessionDescriptionInitLike) => void): () => void;
  onIceCandidate(cb: (callId: string, candidate: RTCIceCandidateInitLike) => void): () => void;
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
  private stateListeners: Array<(state: CallState) => void> = [];

  private localVideoEnabled = false;

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
    /** Phase 2, not enabled anywhere yet — Khabat, 2026-07-28: build video
     *  now so it's ready once audio has shipped and there's real relay
     *  volume/cost data to decide on turning it on (see
     *  docs/realgram/TASK_SPLIT.md B→A(164)'s recommendation to revisit
     *  video with real phase-1 data rather than guess twice). Every
     *  caller in this codebase passes `video: false` today. */
    private readonly video: boolean = false,
  ) {}

  /** Every internal state transition (both the constructor callback and
   *  CallScreen's own subscription, see onStateChangeUpdate) goes through
   *  here — one path, not two independently-maintained ones. */
  private emitStateChange(state: CallState): void {
    this.onStateChange(state);
    this.stateListeners.forEach((cb) => cb(state));
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
      if (stream) {
        this.remoteStream = stream;
        this.onRemoteStream(stream);
        this.remoteStreamListeners.forEach((cb) => cb(stream));
      }
    });
    pcAny.addEventListener('connectionstatechange', () => {
      const s = pcAny.connectionState;
      if (s === 'connected') this.emitStateChange('active');
      if (s === 'failed' || s === 'closed' || s === 'disconnected') this.emitStateChange('ended');
    });

    this.pc = pc;
    return pc;
  }

  /** Requests mic (+ camera, when `video` is on) and keeps whatever it
   *  gets as the one local stream for the lifetime of this call. */
  private async captureLocalMedia(): Promise<MediaStream> {
    if (this.localStream) return this.localStream;
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: this.video ? { facingMode: 'user' } : false,
    } as any);
    this.localStream = stream as unknown as MediaStream;
    this.localVideoEnabled = this.video;
    return this.localStream;
  }

  /** Caller side: capture mic(+camera), create+send an SDP offer. */
  async startOutgoing(): Promise<void> {
    this.emitStateChange('dialing');
    const { callId } = await this.signaling.placeCall(this.peerDeviceId);
    this.callId = callId;

    const iceServers = await this.signaling.getIceServers(this.callId);
    const pc = await this.ensurePeerConnection(iceServers);
    const stream = await this.captureLocalMedia();
    stream.getTracks().forEach((track: any) => pc.addTrack(track, stream as any));

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
    stream.getTracks().forEach((track: any) => pc.addTrack(track, stream as any));

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
        this.emitStateChange('connecting');
        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp as any));
      }),
      this.signaling.onReject((callId) => {
        if (callId === this.callId) this.emitStateChange('ended');
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
        if (callId === this.callId) this.emitStateChange('ended');
      }),
    );
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

  isVideoCall(): boolean {
    return this.localVideoEnabled;
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

  /** Speaker vs. earpiece routing. iOS/Android both expose this through
   *  RTCAudioSession-adjacent native APIs that react-native-webrtc wraps
   *  differently per platform — kept as a no-op stub here since the exact
   *  call needs an on-device check to get right, not something to guess
   *  from this box. Flag for whoever wires the CallScreen controls. */
  setSpeakerphoneOn(_on: boolean): void {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      // TODO: wire real speaker routing once on-device testing is possible.
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
    this.stateListeners = [];
    this.localStream?.getTracks().forEach((t: any) => t.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.pc?.close();
    this.pc = null;
  }
}
