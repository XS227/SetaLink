/**
 * LiveTvPlayerScreen — native stream playback (Khabat's Live TV spec §5).
 *
 * react-native-video wraps ExoPlayer (Android) / AVPlayer (iOS) natively —
 * the exact platforms the spec names as its own suggested options. This is
 * a NEW native dependency for this app (confirmed zero video/media libs
 * existed before this task — package.json audit, docs/realgram/
 * TASK_SPLIT.md B->A(140)); it and its two small companions
 * (react-native-orientation-locker for the landscape-fullscreen
 * requirement, react-native-keep-awake for "beholde skjermen aktiv") need
 * native linking, which needs a real CI build to verify — flagged
 * explicitly, not claimed working end-to-end by me alone.
 *
 * Footer-overlay regression check (spec §5's explicit callback to a past
 * bug): this screen is a full-bleed Stack.Screen like every other one in
 * this app (Chapters/Heroes/Clan/etc.), never rendered inside the
 * MainTabParamList bottom-tab navigator, so BottomNav can't overlay it —
 * same reason those screens don't have the footer problem either.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Video, { OnLoadData, OnBufferData, VideoRef } from 'react-native-video';
import Orientation from 'react-native-orientation-locker';
import KeepAwake from 'react-native-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { useLiveTvLocalStore } from '../stores/liveTvLocalStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { getSsoToken } from '../services/ssoService';
import {
  getChannel, reportChannel, addAccountFavorite, removeAccountFavorite,
  LiveTvChannel,
} from '../services/liveTvService';

interface Props {
  channelId: string;
  channelIds: string[]; // the ordered list the browse screen was showing, for next/prev
  onBack: () => void;
}

type PlayerError = 'timeout' | 'unsupported' | 'unavailable' | 'geo_blocked' | 'unknown';

const CONTROLS_HIDE_DELAY_MS = 3500;
const LOAD_TIMEOUT_MS = 15_000;

export function LiveTvPlayerScreen({ channelId: initialId, channelIds, onBack }: Props) {
  const { t, isRTL } = useT();
  const insets = useSafeAreaInsets();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const showToast = useToastStore((s) => s.show);
  const { isFavorite, toggleFavorite, recordWatched } = useLiveTvLocalStore();

  const [channelId, setChannelId] = useState(initialId);
  const [channel, setChannel] = useState<LiveTvChannel | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PlayerError | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [telegramId, setTelegramId] = useState('');

  const videoRef = useRef<VideoRef>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Landscape + keep-awake for the lifetime of this screen only.
  useEffect(() => {
    Orientation.lockToLandscape();
    KeepAwake.activate();
    StatusBar.setHidden(true);
    return () => {
      Orientation.lockToPortrait();
      KeepAwake.deactivate();
      StatusBar.setHidden(false);
    };
  }, []);

  useEffect(() => {
    if (deviceId) getSsoToken(deviceId, true).then((s) => setTelegramId(s.telegram_id)).catch(() => {});
  }, [deviceId]);

  const loadChannel = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => setError((e) => e ?? 'timeout'), LOAD_TIMEOUT_MS);

    const c = await getChannel(id);
    if (!c) {
      setError('unavailable');
      setLoading(false);
      return;
    }
    setChannel(c);
    recordWatched(id);
  }, [recordWatched]);

  useEffect(() => { loadChannel(channelId); }, [channelId, loadChannel]);

  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [resetHideTimer]);

  const handleLoad = useCallback((_data: OnLoadData) => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    setLoading(false);
    setError(null);
  }, []);

  const handleBuffer = useCallback((data: OnBufferData) => {
    setLoading(data.isBuffering);
  }, []);

  const handleError = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    setLoading(false);
    // react-native-video's error payload shape varies a lot by platform/
    // ExoPlayer-version — mapping to one of the spec's own friendly
    // messages rather than surfacing whatever raw code/domain comes back
    // (spec §10: "Ikke vis rå stack traces, serverfeil eller tekniske
    // unntak til brukeren").
    setError('unsupported');
  }, []);

  const goToOffset = useCallback((offset: number) => {
    const idx = channelIds.indexOf(channelId);
    if (idx === -1) return;
    const nextIdx = (idx + offset + channelIds.length) % channelIds.length;
    setChannelId(channelIds[nextIdx]);
  }, [channelId, channelIds]);

  const handleRetry = useCallback(() => { loadChannel(channelId); }, [channelId, loadChannel]);

  const handleFavorite = useCallback(async () => {
    toggleFavorite(channelId);
    if (telegramId) {
      if (isFavorite(channelId)) await removeAccountFavorite(telegramId, channelId);
      else await addAccountFavorite(telegramId, channelId);
    }
  }, [channelId, telegramId, toggleFavorite, isFavorite]);

  const handleReport = useCallback(async () => {
    const ok = await reportChannel(channelId);
    showToast(ok ? t('livetv.report_sent') : t('livetv.report_failed'), ok ? 'success' : 'error');
  }, [channelId, showToast, t]);

  const errorCopy: Record<PlayerError, string> = {
    timeout:      t('livetv.err_timeout'),
    unsupported:  t('livetv.err_unsupported'),
    unavailable:  t('livetv.err_unavailable'),
    geo_blocked:  t('livetv.err_geoblocked'),
    unknown:      t('livetv.err_unknown'),
  };

  const favorited = isFavorite(channelId);
  const screenW = Dimensions.get('window').width;

  return (
    <View style={styles.screen}>
      {channel && !error && (
        <Video
          ref={videoRef}
          source={{ uri: channel.stream_url }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="contain"
          paused={paused}
          muted={muted}
          onLoad={handleLoad}
          onBuffer={handleBuffer}
          onError={handleError}
          playInBackground={false}
          playWhenInactive={false}
          // Never attach RealGram identity/auth to a third-party stream
          // server (spec §12: "Ikke send RealGram-token, cookies eller
          // brukeridentitet til stream-serverne") -- no custom headers,
          // no cookies, plain source URI only.
        />
      )}

      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={resetHideTimer}
      >
        {loading && !error && (
          <View style={styles.centerOverlay}>
            <ActivityIndicator size="large" color={Colors.gold[400]} />
          </View>
        )}

        {error && (
          <View style={[styles.centerOverlay, styles.errorOverlay]}>
            <Text style={styles.errorText}>{errorCopy[error]}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} activeOpacity={0.85}>
                <Text style={styles.retryBtnText}>{t('livetv.retry')}</Text>
              </TouchableOpacity>
              {channelIds.length > 1 && (
                <TouchableOpacity style={styles.retryBtnGhost} onPress={() => goToOffset(1)} activeOpacity={0.85}>
                  <Text style={styles.retryBtnGhostText}>{t('livetv.pick_another')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {controlsVisible && (
          <>
            <View style={[styles.topBar, { paddingTop: insets.top + Spacing[2], paddingLeft: insets.left + Spacing[3], paddingRight: insets.right + Spacing[3] }]}>
              <TouchableOpacity onPress={onBack} hitSlop={16} style={styles.topBtn}>
                <Text style={styles.topBtnIcon}>{isRTL ? '›' : '‹'}</Text>
              </TouchableOpacity>
              <View style={styles.channelInfo}>
                <Text style={styles.channelName} numberOfLines={1}>{channel?.name ?? ''}</Text>
                {!!channel && <Text style={styles.channelMeta} numberOfLines={1}>{channel.country_name} · {channel.language_name}</Text>}
              </View>
              <TouchableOpacity onPress={handleFavorite} hitSlop={16} style={styles.topBtn}>
                <Text style={styles.topBtnIcon}>{favorited ? '★' : '☆'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleReport} hitSlop={16} style={styles.topBtn}>
                <Text style={styles.reportIcon}>⚑</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing[3], width: screenW }]}>
              {channelIds.length > 1 && (
                <TouchableOpacity onPress={() => goToOffset(-1)} style={styles.ctrlBtn} hitSlop={12}>
                  <Text style={styles.ctrlIcon}>⏮</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setPaused((p) => !p)} style={styles.playBtn} hitSlop={12}>
                <Text style={styles.playIcon}>{paused ? '▶' : '❚❚'}</Text>
              </TouchableOpacity>
              {channelIds.length > 1 && (
                <TouchableOpacity onPress={() => goToOffset(1)} style={styles.ctrlBtn} hitSlop={12}>
                  <Text style={styles.ctrlIcon}>⏭</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setMuted((m) => !m)} style={styles.ctrlBtn} hitSlop={12}>
                <Text style={styles.ctrlIcon}>{muted ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  centerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  errorOverlay: { backgroundColor: 'rgba(0,0,0,0.75)', gap: Spacing[4] },
  errorText: { fontSize: 15, color: Colors.text.primary, fontFamily: Typography.family.body, textAlign: 'center', paddingHorizontal: Spacing[8] },
  errorActions: { flexDirection: 'row', gap: Spacing[3] },
  retryBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[5] },
  retryBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },
  retryBtnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[5] },
  retryBtnGhostText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.text.primary },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    backgroundColor: 'rgba(0,0,0,0.55)', paddingBottom: Spacing[2],
  },
  topBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  topBtnIcon: { fontSize: 22, color: Colors.text.primary },
  reportIcon: { fontSize: 16, color: Colors.text.muted },
  channelInfo: { flex: 1 },
  channelName: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary },
  channelMeta: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 1 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing[6],
    backgroundColor: 'rgba(0,0,0,0.55)', paddingTop: Spacing[3],
  },
  ctrlBtn: { alignItems: 'center', justifyContent: 'center' },
  ctrlIcon: { fontSize: 22, color: Colors.text.primary },
  playBtn: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.gold[400],
  },
  playIcon: { fontSize: 20, color: Colors.bg.void },
});
