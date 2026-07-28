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
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { CallEngine, CallState } from '../services/callService';

interface Props {
  engine: CallEngine;
  peerLabel: string;
  /** True if this device placed the call (dialing), false if it's the
   *  callee (ringing until accepted). */
  outgoing: boolean;
  onEnded: () => void;
}

function formatDuration(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CallScreen({ engine, peerLabel, outgoing, onEnded }: Props) {
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

  useEffect(() => {
    if (outgoing) {
      engine.startOutgoing().catch(() => setState('ended'));
    }
    const unsub = engine.onRemoteStreamUpdate((stream) => setRemoteStreamUrl(stream.toURL()));
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      unsub();
      engine.teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Real offer/SDP arrives via the signaling client's onOffer callback
    // in a real wiring — the caller of this screen is responsible for
    // holding that offer and calling engine.acceptIncoming(offer) before
    // rendering this screen in "ringing" mode with an accept handler that
    // resolves it. Left as the integration point for whoever wires this
    // screen in, since it depends on the real signaling implementation.
    setState('connecting');
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
            <Text style={styles.avatarInitial}>{peerLabel.slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={styles.peerName}>{peerLabel}</Text>
          <Text style={styles.status}>{statusLabel()}</Text>
        </View>
      )}

      {showVideo && (
        <View style={styles.videoHeader}>
          <Text style={styles.videoHeaderName}>{peerLabel}</Text>
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
