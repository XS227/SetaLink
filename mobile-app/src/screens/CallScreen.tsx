/**
 * CallScreen — full-screen call UI (incoming/outgoing/active), audio and
 * video both.
 *
 * Khabat's Earn/Inbox ask (2026-07-28): audio calling between friends
 * first, premium-gated; video built alongside it so it's ready to switch
 * on later rather than built from scratch a second time (video stays
 * unused everywhere in this codebase today — see CallEngine's `video`
 * constructor flag). Talks to `CallEngine` (`services/callService.ts`)
 * for the actual WebRTC plumbing — this file is presentation + call-state
 * only.
 *
 * NOT wired into AppNavigator.tsx or InboxScreen.tsx yet: there's no
 * live signaling backend or TURN relay for it to actually connect through
 * yet (docs/realgram/TASK_SPLIT.md A→B(166)-(168)). Exists as a reviewable,
 * typechecked screen ready to wire in once there's something real on the
 * other end.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, Vibration, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';
import { RTCView } from 'react-native-webrtc';
import {
  IconCameraFlip, IconMic, IconMicOff, IconPhone, IconScreenShare, IconSpeaker, IconVideo, IconVideoOff,
} from '../components/CallIcons';
import { OrbitField, OrbitBodyProps } from '../components/OrbitField';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { isScreenShareEnabled } from '../config/featureFlags';
import { useT } from '../i18n';
import { CallEngine, CallState } from '../services/callService';
import { sendMessage } from '../services/entitlementService';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

const PIP_WIDTH = 100;
const PIP_HEIGHT = 140;
const PIP_MARGIN = Spacing[4];
// Clearance below insets.top, not an absolute screen position -- see
// DraggableLocalPip's own comment on why this replaced a flat constant.
const PIP_TOP_CLEARANCE = 80;

// Raw account IDs are admin/api.php's generate_user_id(): "SL-<rowid>-<8
// random chars>", e.g. "SL-227-62DAC5F0" — meant for support lookups, not
// for a peer to read off a call screen. Khabat, 2026-07-30: showing her
// own full ID to whoever she calls felt wrong; wants just the numeric
// rowid + a logo instead — avatar circle shows ☀️, the id itself gets a
// "﷼" prefix (brand mark, REAL/Rial). Only unwraps IDs actually in that
// shape — InboxScreen also passes a friendly conversation title as
// peerLabel for named contacts, which should pass through untouched.
const RAW_ACCOUNT_ID_RE = /^SL-(\d+)-[A-Z0-9]+$/i;

function peerDisplay(rawLabel: string): { id: string; isRawAccountId: boolean } {
  const m = RAW_ACCOUNT_ID_RE.exec(rawLabel);
  return m ? { id: m[1], isRawAccountId: true } : { id: rawLabel, isRawAccountId: false };
}

// Ringback cue for the caller's own 'dialing' wait — mirrors callStore.ts's
// incoming RING_PATTERN. A softer, steadier pulse than the incoming pattern
// on purpose — this is "still trying," not "answer me." Khabat, 2026-07-30:
// dialing felt completely dead with zero feedback (unlike incoming, which
// already had the vibration ring); this closed that gap. Real audio
// ringback now plays too (callService.ts's captureLocalMedia(ringback=true),
// via InCallManager.start({ringback: '_BUNDLE_'}) — Khabat supplied the
// actual asset the same day) — kept alongside this vibration, not instead
// of it, same as incoming's ringtone.
const DIALING_PATTERN = [0, 250, 1750];

// Khabat, 2026-08-01: "et eller anna musical fra persia... fin
// visualisering... sola, universen... persisk kultur inspirert
// visualisering." Reuses HomeScreen's own "﷼ becomes the sun, particles
// orbit it in a faked-3D ring" language (OrbitField, extracted from that
// screen's RealCoin treatment) rather than inventing a new motif — the
// peer's avatar becomes the sun here instead of the coin. Warm gold/ember
// tones (vs. Home's cooler gold/violet/silver mix) since this is meant to
// read as "someone is reaching out," not the Home screen's forge/energy
// framing. Shown only pre-connect (dialing/ringing/connecting) — see
// showRing below — so it doesn't run for a call's full duration.
// Radii all clear 60 (the avatar circle's own radius, opaque) — the
// avatar renders on top of this whole stage as a single flattened
// stacking group (see avatarStack below), so anything with a smaller
// orbit radius than the avatar itself would just sit invisibly behind
// it for its entire loop, defeating the point of the "moon" dot.
const RING_ORBIT_DOTS: OrbitBodyProps[] = [
  { duration: 5200,  radius: 78,  tilt: 0.5, size: 6, color: Colors.gold[100],   phase: 0.6 },
  { duration: 7400,  radius: 88,  tilt: 0.5, size: 8, color: Colors.gold[400],   reverse: true, phase: 2.8 },
  { duration: 9600,  radius: 98,  tilt: 0.5, size: 6, color: Colors.ember[400],  phase: 4.5 },
  { duration: 12000, radius: 108, tilt: 0.5, size: 7, color: Colors.gold[600],   reverse: true, phase: 1.2 },
  { duration: 4000,  radius: 68,  tilt: 0.6, size: 4, color: Colors.gold[100],   reverse: true, phase: 3.4, isMoon: true },
];

/** Pulsing corona behind the avatar — cheap (single Reanimated loop),
 *  reinforces the "sun" reading the orbiting particles set up. */
function RingGlow() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.18 }],
    opacity: 0.5 - pulse.value * 0.3,
  }));
  return <Animated.View style={[styles.ringGlow, style]} />;
}

function RingVisualizer() {
  return (
    <View style={styles.ringStage} pointerEvents="none">
      <RingGlow />
      <OrbitField bodies={RING_ORBIT_DOTS} />
    </View>
  );
}

interface Props {
  engine: CallEngine;
  peerLabel: string;
  /** Real SetaLink ID (signaling/messaging address) — see callStore.ts's
   *  ActiveCall.peerId for why this is separate from the display-only
   *  peerLabel. */
  peerId: string;
  /** True if this device placed the call (dialing), false if it's the
   *  callee (ringing until accepted). */
  outgoing: boolean;
  onEnded: () => void;
  /** Incoming calls only: called when the user taps Accept. Answering
   *  needs more than this screen can do alone -- joining the relay room
   *  as callee (which mints a voucher over HTTP) and waiting for the
   *  caller's SDP offer to arrive before engine.acceptIncoming(offer) can
   *  even be called. Left to whoever wires this screen in (has the
   *  signaling client + the pending offer), not duplicated here. Reject
   *  the returned promise to fall back to the ended state. */
  onAccept?: () => Promise<void>;
}

function formatDuration(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Khabat, 2026-07-31: her own video preview sat fixed top-right, right where
// the call-control row could end up sliding under it on smaller screens —
// "mitt eget bilde/video går under de ikonene". Rather than guess a fixed
// spot that dodges every button layout permutation (portrait/landscape,
// audio vs video controls, notch height), let her drag it wherever it's out
// of the way herself. Base anchor stays top-right (unchanged default); a pan
// gesture adds a translate offset on top, clamped to the screen bounds so it
// can't be dragged off-screen or under the safe-area edges, then springs
// back inside those bounds on release.
// B, 2026-08-01 (Khabat: "knappene ligger over mitt eget video vindu" —
// not a crash, confirmed directly): the bottom clamp used a guessed
// `Spacing[20]` margin that predates the real footer bar `(295)` added,
// so a drag toward the bottom could still land the PIP under/behind the
// control row. `footerHeight` is the footer's own measured height (passed
// from CallScreen's onLayout) — once known, it replaces the guess so the
// PIP physically cannot be dragged past the footer's real top edge,
// active-row and incoming-row heights included.
function DraggableLocalPip({ streamUrl, footerHeight }: { streamUrl: string; footerHeight: number }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // videoHeader (peer name + duration) is its own position:'absolute'
  // top:0 element that -- like this PiP -- ignores the screen's own
  // insets.top padding. Its own paddingTop (Spacing[6]=24) plus two text
  // lines + gap lands its bottom edge around insets.top+68 on a typical
  // device; the old flat PIP_TOP=60 (no insets.top at all) sat the PiP's
  // rest position *inside* that span on any device with a real notch/
  // status bar -- Khabat, 2026-08-01: "mitt bilde/video havner under
  // knappene" (third report of a top-of-screen overlap on this file).
  // Anchoring the PiP's rest position to insets.top the same way
  // videoHeader now does, with real clearance below it, is the fix that
  // survives orientation/device differences instead of another guessed
  // constant.
  const restTop = insets.top + PIP_TOP_CLEARANCE;

  const baseLeft = screenWidth - PIP_MARGIN - PIP_WIDTH;
  const minX = PIP_MARGIN - baseLeft;
  const maxX = 0;
  const minY = insets.top + Spacing[2] - restTop;
  const bottomClearance = footerHeight > 0 ? footerHeight + Spacing[3] : insets.bottom + Spacing[20];
  const maxY = screenHeight - bottomClearance - PIP_HEIGHT - restTop;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = Math.min(maxX, Math.max(minX, startX.value + e.translationX));
      translateY.value = Math.min(maxY, Math.max(minY, startY.value + e.translationY));
    })
    .onEnd(() => {
      translateX.value = withSpring(Math.min(maxX, Math.max(minX, translateX.value)), { damping: 20, stiffness: 220 });
      translateY.value = withSpring(Math.min(maxY, Math.max(minY, translateY.value)), { damping: 20, stiffness: 220 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.localVideoPip, { top: restTop }, animatedStyle]}>
        <RTCView streamURL={streamUrl} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={1} />
      </Animated.View>
    </GestureDetector>
  );
}

/** The PEER's own camera, shown alongside their shared screen (spec §5:
 *  "kamera + skjerm" mode on their side). Deliberately separate from
 *  DraggableLocalPip (that one is always YOUR OWN camera) -- both can be
 *  on screen at once, so this anchors top-LEFT instead of top-right to
 *  avoid colliding with it. Same drag mechanics, simpler clamp (no
 *  footer-height dependency -- this PiP doesn't need to duck under your
 *  own call controls the way your own camera preview does, it just needs
 *  to stay on screen). */
function RemoteCameraPip({ streamUrl }: { streamUrl: string }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const restTop = insets.top + PIP_TOP_CLEARANCE;

  const minX = 0;
  const maxX = screenWidth - PIP_MARGIN * 2 - PIP_WIDTH;
  const minY = insets.top + Spacing[2] - restTop;
  const maxY = screenHeight - insets.bottom - Spacing[20] - PIP_HEIGHT - restTop;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => { startX.value = translateX.value; startY.value = translateY.value; })
    .onUpdate((e) => {
      translateX.value = Math.min(maxX, Math.max(minX, startX.value + e.translationX));
      translateY.value = Math.min(maxY, Math.max(minY, startY.value + e.translationY));
    })
    .onEnd(() => {
      translateX.value = withSpring(Math.min(maxX, Math.max(minX, translateX.value)), { damping: 20, stiffness: 220 });
      translateY.value = withSpring(Math.min(maxY, Math.max(minY, translateY.value)), { damping: 20, stiffness: 220 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.localVideoPip, { top: restTop, left: PIP_MARGIN, right: undefined }, animatedStyle]}>
        <RTCView streamURL={streamUrl} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={1} />
      </Animated.View>
    </GestureDetector>
  );
}

/** Spec §5, "mottakerens visning" -- the peer's shared screen becomes the
 *  main view (called from CallScreen's render in place of the normal
 *  video/avatar branch, works for a call that started as audio-only
 *  too). Pinch-to-zoom (1x-4x, spring-back handled by clamping in
 *  onUpdate rather than a separate onEnd reset -- deliberately does NOT
 *  snap back to 1x on release, matches how a real "zoom into the shared
 *  screen to read something" gesture is expected to behave, i.e. stays
 *  zoomed until pinched back out) and a fit/fill toggle both live here.
 *  Tapping the content toggles the label/fit-toggle chrome -- the call's
 *  own footer controls (hang up etc.) are NOT part of this toggle, they
 *  always stay reachable. */
function RemoteScreenShareView({
  streamUrl, peerName, cameraStreamUrl,
}: { streamUrl: string; peerName: string; cameraStreamUrl: string | null }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [fillMode, setFillMode] = useState(false); // false = "Tilpass skjerm" (contain), true = "Fyll skjerm" (cover)
  const [showChrome, setShowChrome] = useState(true);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale)); })
    .onEnd(() => { savedScale.value = scale.value; });

  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <GestureDetector gesture={pinch}>
      <View style={StyleSheet.absoluteFill}>
        <TouchableOpacity
          activeOpacity={1}
          style={StyleSheet.absoluteFill}
          onPress={() => setShowChrome((s) => !s)}
        >
          <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
            <RTCView streamURL={streamUrl} style={StyleSheet.absoluteFill} objectFit={fillMode ? 'cover' : 'contain'} />
          </Animated.View>
        </TouchableOpacity>

        {cameraStreamUrl && <RemoteCameraPip streamUrl={cameraStreamUrl} />}

        {/* Spec §6: "vise en permanent indikator mens delingen er aktiv"
            -- deliberately NOT part of the showChrome tap-to-hide toggle
            below (unlike the fit/fill button). A privacy indicator that
            can be tapped away isn't a permanent one. */}
        <View style={[styles.screenShareLabel, { top: insets.top + Spacing[3] }]} pointerEvents="none">
          <Text style={styles.screenShareLabelText}>
            {t('call.sharingScreen').replace('{name}', peerName)}
          </Text>
        </View>

        {showChrome && (
          <TouchableOpacity
            style={[styles.fitToggle, { top: insets.top + Spacing[3] }]}
            onPress={() => setFillMode((f) => !f)}
            accessibilityLabel={fillMode ? t('call.fitScreen') : t('call.fillScreen')}
          >
            <Text style={styles.fitToggleText}>{fillMode ? t('call.fitScreen') : t('call.fillScreen')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </GestureDetector>
  );
}

export function CallScreen({ engine, peerLabel, peerId, outgoing, onEnded, onAccept }: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const [state, setState] = useState<CallState>(outgoing ? 'dialing' : 'ringing');
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [videoOn, setVideoOn] = useState(engine.isVideoCall());
  const [remoteStreamUrl, setRemoteStreamUrl] = useState<string | null>(null);
  const [localStreamUrl, setLocalStreamUrl] = useState<string | null>(null);
  const [durationSecs, setDurationSecs] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const [remoteScreenUrl, setRemoteScreenUrl] = useState<string | null>(null);
  const [remoteSharing, setRemoteSharing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVideo = engine.isVideoCall();
  const peer = peerDisplay(peerLabel);

  useEffect(() => {
    if (outgoing) {
      engine.startOutgoing().catch(() => setState('ended'));
    }
    const unsubStream = engine.onRemoteStreamUpdate((stream) => setRemoteStreamUrl(stream.toURL()));
    const unsubLocalStream = isVideo
      ? engine.onLocalStreamUpdate((stream) => setLocalStreamUrl(stream.toURL()))
      : () => {};
    // Real connection-state transitions the engine itself drives (ICE
    // reaching 'connected', or failing/closing unexpectedly) — separate
    // from this screen's own explicit accept/reject/hangUp calls, which
    // already setState directly.
    const unsubState = engine.onStateChangeUpdate((s) => setState(s));
    // Keeps this screen's own screenSharing flag true even if the OS
    // itself stopped the capture (system indicator, revoked permission,
    // sensitive screen block) -- CallEngine's track.onended already calls
    // stopScreenShare() itself in that case, this just mirrors the result
    // into local UI state rather than this screen finding out from a
    // button tap that never happened.
    const unsubScreenShare = engine.onScreenShareUpdate((active) => setScreenSharing(active));
    const unsubRemoteScreen = engine.onRemoteScreenStreamUpdate((stream) => {
      setRemoteScreenUrl(stream ? stream.toURL() : null);
      setRemoteSharing(!!stream);
    });
    // Spec §4's consent prompt -- only ever fired by the engine on a real
    // transition into 'poor' (not every poll tick), so this Alert can't
    // stack/re-show itself while the connection just sits in a bad state.
    const unsubQuality = engine.onNetworkQualityChange(() => {
      Alert.alert(
        t('call.weakConnectionTitle'),
        t('call.weakConnectionBody'),
        [
          { text: t('call.weakConnectionContinue'), style: 'cancel' },
          { text: t('call.weakConnectionTurnOff'), onPress: () => {
            setVideoOn(false);
            engine.stopCameraTrack().catch(() => setVideoOn(true));
          } },
        ],
      );
    });
    // The emergency case -- engine already acted (stopped the camera
    // itself, no consent asked, spec's own carve-out for genuine
    // disconnect risk). This screen's job is only to make that visible,
    // per spec's "må vises tydelig" -- a toast, not a blocking Alert,
    // since there's no decision left for the user to make here.
    const unsubEmergency = engine.onEmergencyAction(() => {
      setVideoOn(false);
      // bypass=true -- this toast IS the screen-share status the
      // suppression in toastStore.ts exists to protect, not the kind of
      // incidental content it's meant to hide.
      useToastStore.getState().show(t('call.emergencyCameraStopped'), 'info', 3000, true);
    });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      unsubStream();
      unsubLocalStream();
      unsubState();
      unsubScreenShare();
      unsubRemoteScreen();
      unsubQuality();
      unsubEmergency();
      engine.teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== 'dialing') return;
    Vibration.vibrate(DIALING_PATTERN, true);
    return () => Vibration.cancel();
  }, [state]);

  useEffect(() => {
    if (state === 'active' && !timerRef.current) {
      timerRef.current = setInterval(() => setDurationSecs((d) => d + 1), 1000);
    }
    if (state === 'ended') {
      if (timerRef.current) clearInterval(timerRef.current);
      // Khabat, 2026-07-31: "npr jeg ringer noen og dem ikke svarer så skal
      // det stå i melding chat at: ubesvart call, video call, eller call
      // varighet x minutter, med dato" — a call-log entry in the DM thread.
      // Only the caller writes it (outgoing-only): both sides reaching
      // 'ended' on the same call would otherwise post two duplicate rows
      // into one shared thread — the callee just sees this message arrive
      // like any other DM, no need to also write it themselves. Missed vs.
      // completed reads off durationSecs itself: the interval above only
      // ever starts once state reaches 'active', so it's still 0 here for
      // any call that rang out, was rejected, or failed before connecting.
      // Date/time comes for free from the message's own created_at, same
      // as every other DM in the thread.
      if (outgoing && deviceId && peerId) {
        const body = durationSecs > 0
          ? t(isVideo ? 'call.logVideo' : 'call.logAudio').replace('{duration}', formatDuration(durationSecs))
          : t('call.logMissed');
        sendMessage(deviceId, peerId, body).catch(() => {});
      }
      onEnded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onEnded]);

  const statusLabel = (): string => {
    switch (state) {
      case 'dialing':    return t('call.dialing');
      case 'ringing':    return t('call.ringing');
      case 'connecting': return t('call.connecting');
      case 'active':     return formatDuration(durationSecs);
      default:           return t('call.ended');
    }
  };

  const handleAccept = () => {
    setState('connecting');
    onAccept?.().catch(() => setState('ended'));
  };

  const handleReject = () => {
    engine.rejectIncoming().catch(() => {});
    setState('ended');
  };

  const handleHangUp = () => {
    engine.hangUp().catch(() => {});
    setState('ended');
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    engine.setMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    engine.setSpeakerphoneOn(next);
  };

  const toggleVideo = () => {
    const next = !videoOn;
    setVideoOn(next);
    // While screen-sharing, "camera off" means spec §3's "bare skjerm"
    // mode -- the camera track must actually stop (hardware + encoder
    // released, no bandwidth spent), not just mute in place. Outside
    // screen-share this stays the existing soft toggle (unrelated
    // behavior, not touched).
    if (screenSharing) {
      (next ? engine.resumeCameraTrack() : engine.stopCameraTrack()).catch(() => {
        setVideoOn(!next); // revert the optimistic UI flip on failure
      });
    } else {
      engine.setVideoEnabled(next);
    }
  };

  const toggleScreenShare = () => {
    if (screenSharing) {
      setScreenShareBusy(true);
      engine.stopScreenShare()
        .catch(() => {})
        .finally(() => setScreenShareBusy(false));
      return;
    }
    Alert.alert(
      t('call.screenShareWarningTitle'),
      t('call.screenShareWarningBody'),
      [
        { text: t('call.screenShareWarningCancel'), style: 'cancel' },
        {
          text: t('call.screenShareWarningConfirm'),
          onPress: () => {
            setScreenShareBusy(true);
            // engine.startScreenShare() itself triggers the OS's own
            // MediaProjection permission dialog (spec §2's "vis
            // operativsystemets offisielle tillatelsesdialog") -- this
            // Alert is only RealGram's own warning, shown first and
            // separately, never a replacement for the system one.
            engine.startScreenShare()
              .then(() => setScreenSharing(true))
              .catch(() => useToastStore.getState().show(t('call.screenShareError'), 'error', 3000, true))
              .finally(() => setScreenShareBusy(false));
          },
        },
      ],
    );
  };

  const showVideo = isVideo && state === 'active' && (remoteStreamUrl || localStreamUrl);
  const showRing = state === 'dialing' || state === 'ringing' || state === 'connecting';
  // Audio or video call, doesn't matter (spec §1: "under en aktiv lyd-
  // eller videosamtale") -- only gated on the call actually being
  // connected (nothing to renegotiate against before that) and the
  // remote-config flag, same rollout mechanism as every other staged
  // feature in this app.
  const screenShareAvailable = state === 'active' && isScreenShareEnabled();

  const peerLabelText = peer.isRawAccountId ? `﷼ ${peer.id}` : peer.id;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + Spacing[6] }]}>
      {remoteSharing && remoteScreenUrl ? (
        <RemoteScreenShareView streamUrl={remoteScreenUrl} peerName={peerLabelText} cameraStreamUrl={remoteStreamUrl} />
      ) : showVideo ? (
        <>
          {remoteStreamUrl ? (
            <RTCView streamURL={remoteStreamUrl} style={StyleSheet.absoluteFill} objectFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.videoWaiting]}>
              <Text style={styles.status}>{statusLabel()}</Text>
            </View>
          )}
        </>
      ) : (
        <View style={styles.center}>
          <View style={styles.avatarStack}>
            {showRing && <RingVisualizer />}
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>
                {peer.isRawAccountId ? '☀️' : peer.id.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.peerName}>{peerLabelText}</Text>
          <Text style={styles.status}>{statusLabel()}</Text>
        </View>
      )}

      {/* Your own camera preview -- independent of whether the PEER is
          sharing their screen, so it stays visible layered on top of
          RemoteScreenShareView too (spec doesn't say to hide it, and
          hiding your own video feedback while screen-sharing is active
          would be a regression from the plain video-call case). */}
      {(showVideo || remoteSharing) && localStreamUrl && videoOn && (
        <DraggableLocalPip streamUrl={localStreamUrl} footerHeight={footerHeight} />
      )}

      {showVideo && !remoteSharing && (
        <View style={[styles.videoHeader, { paddingTop: insets.top + Spacing[3] }]}>
          <Text style={styles.videoHeaderName}>{peerLabelText}</Text>
          {state === 'active' && <Text style={styles.status}>{formatDuration(durationSecs)}</Text>}
        </View>
      )}

      {/* Spec §6's permanent indicator, sharer's own side -- Android's
          MediaProjection foreground-service notification already
          satisfies this at the OS level, but that notification isn't
          necessarily visible while looking straight at the call UI
          itself. Belt-and-braces, not a replacement for it. Not part of
          RemoteScreenShareView's own chrome toggle -- always on while
          screenSharing is true, same reasoning as the receiver's label. */}
      {screenSharing && (
        <View style={[styles.screenShareLabel, { top: insets.top + Spacing[3] }]} pointerEvents="none">
          <Text style={styles.screenShareLabelText}>{t('call.youAreSharing')}</Text>
        </View>
      )}

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing[3] }]}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
      >
        {state === 'ringing' ? (
          <View style={styles.incomingRow}>
            <TouchableOpacity style={[styles.circleBtn, styles.rejectBtn]} onPress={handleReject} accessibilityLabel={t('call.reject')}>
              <View style={styles.hangupIconRotate}>
                <IconPhone size={22} color="#0B0F14" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circleBtn, styles.acceptBtn]} onPress={handleAccept} accessibilityLabel={t('call.accept')}>
              <IconPhone size={22} color="#0B0F14" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.activeRow}>
            <TouchableOpacity
              style={[styles.smallBtn, muted && styles.smallBtnActive]}
              onPress={toggleMute}
              accessibilityLabel={muted ? t('call.unmute') : t('call.mute')}
            >
              {muted
                ? <IconMicOff size={19} color={Colors.gold[400]} />
                : <IconMic size={19} color={Colors.text.primary} />}
            </TouchableOpacity>
            {isVideo && (
              <TouchableOpacity
                style={[styles.smallBtn, !videoOn && styles.smallBtnActive]}
                onPress={toggleVideo}
                accessibilityLabel={videoOn ? t('call.videoOff') : t('call.videoOn')}
              >
                {videoOn
                  ? <IconVideo size={19} color={Colors.text.primary} />
                  : <IconVideoOff size={19} color={Colors.gold[400]} />}
              </TouchableOpacity>
            )}
            {screenShareAvailable && (
              <TouchableOpacity
                style={[styles.smallBtn, screenSharing && styles.smallBtnActive]}
                onPress={toggleScreenShare}
                disabled={screenShareBusy}
                accessibilityLabel={screenSharing ? t('call.screenShareStop') : t('call.screenShareStart')}
              >
                <IconScreenShare size={19} color={screenSharing ? Colors.gold[400] : Colors.text.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.circleBtn, styles.rejectBtn]} onPress={handleHangUp} accessibilityLabel={t('call.hangUp')}>
              <View style={styles.hangupIconRotate}>
                <IconPhone size={22} color="#0B0F14" />
              </View>
            </TouchableOpacity>
            {isVideo ? (
              <TouchableOpacity style={styles.smallBtn} onPress={() => engine.switchCamera()} accessibilityLabel={t('call.switchCamera')}>
                <IconCameraFlip size={19} color={Colors.text.primary} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.smallBtn, speakerOn && styles.smallBtnActive]}
                onPress={toggleSpeaker}
                accessibilityLabel={t('call.speaker')}
              >
                <IconSpeaker size={19} color={speakerOn ? Colors.gold[400] : Colors.text.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg.void,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  center: { alignItems: 'center', gap: Spacing[3] },
  avatarStack: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  ringStage: {
    position: 'absolute', width: 240, height: 240,
    alignItems: 'center', justifyContent: 'center',
  },
  ringGlow: {
    position: 'absolute', width: 168, height: 168, borderRadius: 84,
    backgroundColor: Colors.gold[400] + '33',
  },
  avatarCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: Colors.bg.elevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.gold[400] + '55',
  },
  avatarInitial: { fontSize: 48, color: Colors.gold[400], fontFamily: Typography.family.heading },
  peerName: { fontSize: Typography.size.xl, color: Colors.text.primary, fontFamily: Typography.family.heading },
  status: { fontSize: Typography.size.sm, color: Colors.text.secondary, fontFamily: Typography.family.mono },
  // Khabat, 2026-08-01: "knappene kan plasseres i booter heller" — the
  // control row already sat at the screen's bottom edge (space-between),
  // but with no background it floated directly over the remote video with
  // nothing to set it apart. Wrapped in an actual footer bar instead.
  footer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: Spacing[4],
    backgroundColor: Colors.bg.void + 'CC',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border.default,
  },
  incomingRow: { flexDirection: 'row', gap: Spacing[7] },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[5] },
  circleBtn: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  acceptBtn: { backgroundColor: Colors.status.connected },
  rejectBtn: { backgroundColor: Colors.red[400] },
  // The accept button uses IconPhone as-is; hang up/decline reuse the same
  // glyph rotated 135° for the familiar "hang up" silhouette instead of a
  // second icon asset.
  hangupIconRotate: { transform: [{ rotate: '135deg' }] },
  smallBtn: {
    width: 46, height: 46, borderRadius: Radius.full,
    backgroundColor: Colors.bg.elevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border.default,
  },
  smallBtnActive: { backgroundColor: Colors.gold[400] + '22', borderColor: Colors.gold[400] },
  videoWaiting: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.void },
  localVideoPip: {
    // `top` is set inline per-instance (DraggableLocalPip's restTop,
    // insets-aware) -- not fixed here since it depends on the device's
    // safe-area insets, not just a static layout constant.
    position: 'absolute', right: PIP_MARGIN,
    width: PIP_WIDTH, height: PIP_HEIGHT, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.gold[400] + '55', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  videoHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    alignItems: 'center', paddingTop: Spacing[6], gap: 2,
  },
  videoHeaderName: { fontSize: Typography.size.lg, color: '#FFFFFF', fontFamily: Typography.family.heading },
  // Spec §5: "vis navn og teksten 'deler skjermen' uten å dekke
  // innholdet" -- a slim top banner, not a full-width opaque header like
  // videoHeader, so it reads as a label over the content rather than
  // pushing/covering it.
  screenShareLabel: {
    position: 'absolute', left: 0, right: 0, alignItems: 'center',
  },
  screenShareLabelText: {
    fontSize: Typography.size.sm, color: '#FFFFFF', fontFamily: Typography.family.heading,
    backgroundColor: Colors.bg.void + 'AA', paddingHorizontal: Spacing[3], paddingVertical: Spacing[1],
    borderRadius: Radius.full, overflow: 'hidden',
  },
  fitToggle: {
    position: 'absolute', right: Spacing[4],
    backgroundColor: Colors.bg.void + 'AA', paddingHorizontal: Spacing[3], paddingVertical: Spacing[1],
    borderRadius: Radius.full,
  },
  fitToggleText: { fontSize: Typography.size.xs, color: '#FFFFFF', fontFamily: Typography.family.heading },
});
