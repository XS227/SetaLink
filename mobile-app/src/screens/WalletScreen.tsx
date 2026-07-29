/**
 * WalletScreen — §5.10's Wallet tab. Promotes the REAL wallet (previously
 * buried inside the Profile mega-scroll) to its own top-level destination,
 * alongside the data quota and a TON row.
 *
 * Hard rule (§5.10, Khabat 2026-07-18): TON must never show a simulated
 * balance. There is no TON balance integration anywhere in the backend
 * (verified: only Tonkeeper exists, as a payment deep-link, not a wallet
 * balance source) — so this always renders "Coming soon", never a number.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { TopBar } from '../components/TopBar';
import { RealWalletCard } from '../components/RealWalletCard';
import { TonConnectCard } from '../components/TonConnectCard';
import { EmberField } from '../components/EmberField';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n';
import { getProfileSummary, ProfileEconomy } from '../services/realGramProfileService';
import { syncEntitlement } from '../services/entitlementService';
import { getActivityTimeline, ActivityEvent } from '../services/activityService';

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

const WALLET_EVENT_TYPES = new Set(['quota', 'transfer', 'redemption', 'wallet_swap']);

export function WalletScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const user  = useAuthStore((s) => s.user);
  const updateFromEntitlement = useAuthStore((s) => s.updateFromEntitlement);
  const deviceId = user?.deviceId ?? '';
  const isFocused = useIsFocused();

  const totalGb = (user?.quotaBytesTotal ?? 0) / 1073741824;
  const usedGb  = (user?.quotaBytesUsed  ?? 0) / 1073741824;
  const freeGb  = Math.max(0, totalGb - usedGb);

  // Full economy (XP/Gems/FARR) — same source Profile reads (contract §9),
  // so this stays in sync with it automatically. REAL/ZAR stay on
  // RealWalletCard below (it already owns that data + the redeem flow) —
  // this just fills in the fields Khabat asked for that nothing on this
  // screen showed yet.
  const [economy, setEconomy] = useState<ProfileEconomy | null>(null);
  const loadEconomy = useCallback(() => {
    if (!deviceId) return;
    getProfileSummary(deviceId).then((p) => setEconomy(p.economy)).catch(() => {});
  }, [deviceId]);
  useEffect(() => { loadEconomy(); }, [loadEconomy]);

  // Transaction history (Khabat, 2026-07-29: "bygg det som mangler" —
  // getActivityTimeline() already existed, built for §5.10.3's unified
  // feed, just never called from any screen). Filtered to money/quota
  // movement specifically — VPN sessions, referrals, and milestones are
  // real activity.timeline entries too, but not what "transaction
  // history" means on a wallet screen.
  const [txHistory, setTxHistory] = useState<ActivityEvent[]>([]);
  const loadHistory = useCallback(() => {
    if (!deviceId) return;
    getActivityTimeline(deviceId, 20, 0)
      .then((t) => setTxHistory(t.timeline.filter((e) => WALLET_EVENT_TYPES.has(e.type))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Khabat, 2026-07-27: this screen's own numbers (Data/quota above, Economy
  // card) never refreshed after actually doing the thing that changes them —
  // RealWalletCard already calls onRedeemed after a successful REAL->GB
  // redeem or ZAR->REAL swap specifically so its owner can refresh, but
  // nothing here was wired to it. Also refresh silently on every refocus
  // (same fix as Home/Profile) in case the balance changed while elsewhere
  // in the app (e.g. an AdMob GB reward on Home).
  const handleRedeemed = useCallback(() => {
    loadEconomy();
    loadHistory();
    if (deviceId) syncEntitlement(deviceId).then(updateFromEntitlement).catch(() => {});
  }, [loadEconomy, loadHistory, deviceId, updateFromEntitlement]);

  const walletMountedRef = useRef(false);
  useEffect(() => {
    if (!walletMountedRef.current) { walletMountedRef.current = true; return; }
    if (!isFocused) return;
    handleRedeemed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  return (
    <View style={styles.screen}>
      <EmberField count={8} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('nav.wallet')}</Text>
          <TopBar onNavigate={onNavigate as (tab: string) => void} />
        </View>

        <RealWalletCard
          deviceId={deviceId}
          onRedeemed={handleRedeemed}
          onOpenHeroes={() => onNavigate('heroes' as NavTab)}
        />

        {economy && (
          <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
            <Text style={styles.cardTitle}>{t('wallet.economyTitle')}</Text>
            <View style={styles.quotaRow}>
              <View style={styles.quotaCell}>
                <Text style={styles.quotaValue}>{economy.xp.toLocaleString()}</Text>
                <Text style={styles.quotaLabel}>{t('rghome.statXp')}</Text>
              </View>
              <View style={styles.quotaCell}>
                <Text style={styles.quotaValue}>{economy.gems.toLocaleString()}</Text>
                <Text style={styles.quotaLabel}>{t('rghome.statGems')}</Text>
              </View>
              <View style={styles.quotaCell}>
                <Text style={styles.quotaValue}>{economy.farr.toLocaleString()}</Text>
                <Text style={styles.quotaLabel}>{t('rgprofile.statFarr')}</Text>
              </View>
            </View>
          </GlassCard>
        )}

        <GlassCard style={styles.card}>
          <Text style={styles.cardTitle}>{t('pr.totalQuota')}</Text>
          <View style={styles.quotaRow}>
            <View style={styles.quotaCell}>
              <Text style={styles.quotaValue}>{totalGb.toFixed(1)}</Text>
              <Text style={styles.quotaLabel}>{t('pr.totalQuota')}</Text>
            </View>
            <View style={styles.quotaCell}>
              <Text style={styles.quotaValue}>{usedGb.toFixed(1)}</Text>
              <Text style={styles.quotaLabel}>{t('pr.usedTraffic')}</Text>
            </View>
            <View style={styles.quotaCell}>
              <Text style={[styles.quotaValue, { color: Colors.status.connected }]}>{freeGb.toFixed(1)}</Text>
              <Text style={styles.quotaLabel}>GB</Text>
            </View>
          </View>
        </GlassCard>

        {txHistory.length > 0 && (
          <GlassCard style={styles.card}>
            <Text style={styles.cardTitle}>{t('wallet.historyTitle')}</Text>
            <View style={styles.historyList}>
              {txHistory.map((e, i) => (
                <View key={`${e.ts}-${i}`} style={styles.historyRow}>
                  <Text style={styles.historyIcon}>{e.icon}</Text>
                  <View style={styles.historyTextWrap}>
                    <Text style={styles.historyLabel} numberOfLines={1}>{e.label}</Text>
                    {!!e.detail && <Text style={styles.historyDetail}>{e.detail}</Text>}
                  </View>
                  <Text style={styles.historyTs}>{e.ts.slice(5, 16)}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        )}

        <TonConnectCard />

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>
      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: Colors.bg.base },
  scroll:      { flex: 1 },
  content:     { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[4] },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:       { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  card:        { padding: Spacing[4] },
  cardTitle:   { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },
  quotaRow:    { flexDirection: 'row', marginTop: Spacing[3], gap: Spacing[3] },
  quotaCell:   { flex: 1, alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.md, paddingVertical: Spacing[3] },
  quotaValue:  { fontSize: 18, fontFamily: Typography.family.heading, color: Colors.text.primary },
  quotaLabel:  { fontSize: 11, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  historyList:    { gap: Spacing[3], marginTop: Spacing[3] },
  historyRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  historyIcon:    { fontSize: 16, width: 22, textAlign: 'center' },
  historyTextWrap:{ flex: 1 },
  historyLabel:   { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.primary },
  historyDetail:  { fontSize: 11, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 1 },
  historyTs:      { fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.muted },
});
