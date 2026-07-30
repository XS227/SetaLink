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
import { StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { CallEngine, CallState } from '../services/callService';

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
// incoming RING_PATTERN (vibration-only there too, same reason: no audio
// asset + native sound module linked in this codebase yet, see that file's
// comment). A softer, steadier pulse than the incoming pattern on purpose —
// this is "still trying," not "answer me." Khabat, 2026-07-30: dialing felt
// completely dead with zero feedback (unlike incoming, which already had
// the vibration ring); this closes that gap. Real audio ringback is tracked
// separately (needs react-native-incall-manager or similar + on-device
// verification neither of which this box can do — see TASK_SPLIT.md).
const DIALING_PATTERN = [0, 250, 1750];

interface Props {
  engine: CallEngine;
  peerLabel: string;
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

export function CallScreen({ engine, peerLabel, outgoing, onEnded, onAccept }: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<CallState>(outgoing ? 'dialing' : 'ringing');
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [videoOn, setVideoOn] = useState(engine.isVideoCall());
  const [remoteStreamUrl, setRemoteStreamUrl] = useState<string | null>(null);
  const [durationSecs, setDurationSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVideo = engine.isVideoCall();
  const localStreamUrl = isVideo ? engine.getLocalStream()?.toURL() ?? null : null;
  const peer = peerDisplay(peerLabel);

  useEffect(() => {
    if (outgoing) {
      engine.startOutgoing().catch(() => setState('ended'));
    }
    const unsubStream = engine.onRemoteStreamUpdate((stream) => setRemoteStreamUrl(stream.toURL()));
    // Real connection-state transitions the engine itself drives (ICE
    // reaching 'connected', or failing/closing unexpectedly) — separate
    // from this screen's own explicit accept/reject/hangUp calls, which
    // already setState directly.
    const unsubState = engine.onStateChangeUpdate((s) => setState(s));
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      unsubStream();
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
      onEnded();
    }
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
    <View style={[styles.screen, { paddingTop: insets.top + Spacing[6], paddingBottom: insets.bottom + Spacing[6] }]}>
      {showVideo ? (
        <>
          {remoteStreamUrl ? (
            <RTCView streamURL={remoteStreamUrl} style={StyleSheet.absoluteFill} objectFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.videoWaiting]}>
              <Text style={styles.status}>{statusLabel()}</Text>
            </View>
          )}
          {localStreamUrl && videoOn && (
            <RTCView streamURL={localStreamUrl} style={styles.localVideoPip} objectFit="cover" mirror zOrder={1} />
          )}
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

      {state === 'ringing' ? (
        <View style={styles.incomingRow}>
          <TouchableOpacity style={[styles.circleBtn, styles.rejectBtn]} onPress={handleReject} accessibilityLabel={t('call.reject')}>
            <Text style={styles.circleBtnIcon}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.circleBtn, styles.acceptBtn]} onPress={handleAccept} accessibilityLabel={t('call.accept')}>
            <Text style={styles.circleBtnIcon}>✓</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.activeRow}>
          <TouchableOpacity
            style={[styles.smallBtn, muted && styles.smallBtnActive]}
            onPress={toggleMute}
            accessibilityLabel={muted ? t('call.unmute') : t('call.mute')}
          >
            <Text style={styles.smallBtnIcon}>{muted ? '🔇' : '🎤'}</Text>
          </TouchableOpacity>
          {isVideo && (
            <TouchableOpacity
              style={[styles.smallBtn, !videoOn && styles.smallBtnActive]}
              onPress={toggleVideo}
              accessibilityLabel={videoOn ? t('call.videoOff') : t('call.videoOn')}
            >
              <Text style={styles.smallBtnIcon}>{videoOn ? '📹' : '📷'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.circleBtn, styles.rejectBtn]} onPress={handleHangUp} accessibilityLabel={t('call.hangUp')}>
            <Text style={styles.circleBtnIcon}>✕</Text>
          </TouchableOpacity>
          {isVideo ? (
            <TouchableOpacity style={styles.smallBtn} onPress={() => engine.switchCamera()} accessibilityLabel={t('call.switchCamera')}>
              <Text style={styles.smallBtnIcon}>🔄</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.smallBtn, speakerOn && styles.smallBtnActive]}
              onPress={toggleSpeaker}
              accessibilityLabel={t('call.speaker')}
            >
              <Text style={styles.smallBtnIcon}>🔊</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
  incomingRow: { flexDirection: 'row', gap: Spacing[8] },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[6] },
  circleBtn: {
    width: 68, height: 68, borderRadius: 34,
    alignItems: 'center', justifyContent: 'center',
  },
  acceptBtn: { backgroundColor: Colors.status.connected },
  rejectBtn: { backgroundColor: Colors.red[400] },
  circleBtnIcon: { fontSize: 28, color: '#0B0F14' },
  smallBtn: {
    width: 52, height: 52, borderRadius: Radius.full,
    backgroundColor: Colors.bg.elevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border.default,
  },
  smallBtnActive: { backgroundColor: Colors.gold[400] + '22', borderColor: Colors.gold[400] },
  smallBtnIcon: { fontSize: 22 },
  videoWaiting: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.void },
  localVideoPip: {
    position: 'absolute', top: 60, right: Spacing[4],
    width: 100, height: 140, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.gold[400] + '55', overflow: 'hidden',
  },
  videoHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    alignItems: 'center', paddingTop: Spacing[6], gap: 2,
  },
  videoHeaderName: { fontSize: Typography.size.lg, color: '#FFFFFF', fontFamily: Typography.family.heading },
});
