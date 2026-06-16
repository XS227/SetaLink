/**
 * WatchAdCard — "watch a rewarded ad → earn bonus data" entry point.
 *
 * Self-contained so it can drop onto Home, Servers and Profile. The reward is
 * granted SERVER-SIDE via AdMob SSV (ssv.php); after EARNED_REWARD we poll
 * syncEntitlement until the credit lands, then update quota + toast. The client
 * never grants quota itself.
 */

import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useT } from '../i18n';
import { initAds, showRewardedForData } from '../services/adsService';
import { syncEntitlement } from '../services/entitlementService';

export function WatchAdCard({ style }: { style?: object }) {
  const { t } = useT();
  const user = useAuthStore((s) => s.user);
  const updateFromEntitlement = useAuthStore((s) => s.updateFromEntitlement);
  const showToast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  useEffect(() => { initAds(); }, []);

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
    } catch {
      showToast(t('pr.adFailed'), 'error', 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} disabled={busy} style={style}>
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
