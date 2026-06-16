/**
 * WatchAdCard — "watch a rewarded ad → earn bonus data" entry point.
 *
 * Self-contained so it can drop onto Home, Servers and Profile. The reward is
 * granted SERVER-SIDE via AdMob SSV (ssv.php); after EARNED_REWARD we poll
 * syncEntitlement until the credit lands, then update quota + toast. The client
 * never grants quota itself.
 */

import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View, Alert } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useT } from '../i18n';
import { initAds, showRewardedForData, runAdDiagnostics } from '../services/adsService';
import { syncEntitlement } from '../services/entitlementService';
import { trackEvent } from '../services/analytics';

export function WatchAdCard({ style }: { style?: object }) {
  const { t } = useT();
  const user = useAuthStore((s) => s.user);
  const updateFromEntitlement = useAuthStore((s) => s.updateFromEntitlement);
  const showToast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  useEffect(() => { initAds(); }, []);

  // Temporary diagnostics (v0.9.44): show the exact SDK/ad state on screen and POST
  // it to the backend (app_events) so we can tell no-fill apart from misconfig.
  const runDiag = async () => {
    const deviceId = user?.deviceId;
    if (!deviceId || busy) return;
    setBusy(true);
    try {
      const d = await runAdDiagnostics(deviceId);
      trackEvent('AD_DIAGNOSTICS', deviceId, d as unknown as Record<string, unknown>);
      const adapters = Object.entries(d.adapters)
        .map(([k, v]) => `${k}: state=${v.state}`).join('\n') || '(none)';
      Alert.alert(
        'Ad diagnostics',
        `SDK init: ${d.sdkInitialized}${d.initError ? ` (${d.initError})` : ''}\n` +
        `App id: ${d.appId}\n` +
        `Ad unit: ${d.adUnitId}\n` +
        `Dev/test unit: ${d.isDevUnit}\n` +
        `Load ok: ${d.loadOk}\n` +
        `Error: ${d.errorCode || '-'} ${d.errorMessage || ''}\n` +
        `Adapters:\n${adapters}`,
      );
    } catch (e) {
      Alert.alert('Ad diagnostics', 'failed: ' + ((e as Error)?.message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const onPress = async () => {
    const deviceId = user?.deviceId;
    if (!deviceId || busy) return;
    setBusy(true);
    try {
      const before = user?.quotaBytesTotal ?? 0;
      const { earned } = await showRewardedForData(deviceId);
      if (!earned) { setBusy(false); return; }
      let credited = false;
      for (let i = 0; i < 6 && !credited; i++) {
        await new Promise<void>((r) => setTimeout(() => r(), 2500));
        try {
          const ent = await syncEntitlement(deviceId);
          updateFromEntitlement(ent);
          if ((ent.quota_bytes_total ?? 0) > before) credited = true;
        } catch {}
      }
      showToast(t(credited ? 'pr.adRewarded' : 'pr.adPending'), 'success', 3500);
      setBusy(false);
    } catch (e) {
      // Surface the exact failure instead of a generic "no ad" so we can diagnose.
      setBusy(false);
      const err = e as Error & { code?: string };
      trackEvent('AD_LOAD_ERROR', deviceId, { code: err?.code || '', message: err?.message || '' });
      await runDiag();
    }
  };

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} onLongPress={runDiag} disabled={busy} style={style}>
      <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
        <Text style={styles.icon}>🎬</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('pr.watchAd')}</Text>
          <Text style={styles.desc}>{busy ? t('pr.adLoading') : t('pr.watchAdDesc')}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </GlassCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], borderRadius: Radius.xl },
  icon:    { fontSize: 26 },
  title:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  desc:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  chevron: { fontSize: 22, color: Colors.text.muted },
});
