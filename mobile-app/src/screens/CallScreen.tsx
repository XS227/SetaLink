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
import { StyleSheet, Text, TouchableOpacity, Vibration, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { RTCView } from 'react-native-webrtc';
import { IconCameraFlip, IconMic, IconMicOff, IconPhone, IconSpeaker, IconVideo, IconVideoOff } from '../components/CallIcons';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { CallEngine, CallState } from '../services/callService';
import { sendMessage } from '../services/entitlementService';
import { useAuthStore } from '../stores/authStore';

const PIP_WIDTH = 100;
const PIP_HEIGHT = 140;
const PIP_MARGIN = Spacing[4];
const PIP_TOP = 60;

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

  const baseLeft = screenWidth - PIP_MARGIN - PIP_WIDTH;
  const minX = PIP_MARGIN - baseLeft;
  const maxX = 0;
  const minY = insets.top + Spacing[2] - PIP_TOP;
  const bottomClearance = footerHeight > 0 ? footerHeight + Spacing[3] : insets.bottom + Spacing[20];
  const maxY = screenHeight - bottomClearance - PIP_HEIGHT - PIP_TOP;

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
      <Animated.View style={[styles.localVideoPip, animatedStyle]}>
        <RTCView streamURL={streamUrl} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={1} />
      </Animated.View>
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
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      unsubStream();
      unsubLocalStream();
      unsubState();
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
    engine.setVideoEnabled(next);
  };

  const showVideo = isVideo && state === 'active' && (remoteStreamUrl || localStreamUrl);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + Spacing[6] }]}>
      {showVideo ? (
        <>
          {remoteStreamUrl ? (
            <RTCView streamURL={remoteStreamUrl} style={StyleSheet.absoluteFill} objectFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.videoWaiting]}>
              <Text style={styles.status}>{statusLabel()}</Text>
            </View>
          )}
          {localStreamUrl && videoOn && <DraggableLocalPip streamUrl={localStreamUrl} footerHeight={footerHeight} />}
        </>
      ) : (
        <View style={styles.center}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>
              {peer.isRawAccountId ? '☀️' : peer.id.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.peerName}>{peer.isRawAccountId ? `﷼ ${peer.id}` : peer.id}</Text>
          <Text style={styles.status}>{statusLabel()}</Text>
        </View>
      )}

      {showVideo && (
        <View style={styles.videoHeader}>
          <Text style={styles.videoHeaderName}>{peer.isRawAccountId ? `﷼ ${peer.id}` : peer.id}</Text>
          {state === 'active' && <Text style={styles.status}>{formatDuration(durationSecs)}</Text>}
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
    position: 'absolute', top: PIP_TOP, right: PIP_MARGIN,
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
});
