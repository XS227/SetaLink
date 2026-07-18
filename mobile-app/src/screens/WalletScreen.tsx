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
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { TopBar } from '../components/TopBar';
import { RealWalletCard } from '../components/RealWalletCard';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n';

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

export function WalletScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const user  = useAuthStore((s) => s.user);

  const totalGb = (user?.quotaBytesTotal ?? 0) / 1073741824;
  const usedGb  = (user?.quotaBytesUsed  ?? 0) / 1073741824;
  const freeGb  = Math.max(0, totalGb - usedGb);

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('nav.wallet')}</Text>
          <TopBar onNavigate={onNavigate as (tab: string) => void} />
        </View>

        <RealWalletCard deviceId={user?.deviceId ?? ''} />

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
              <Text style={[styles.quotaValue, { color: Colors.emerald[400] }]}>{freeGb.toFixed(1)}</Text>
              <Text style={styles.quotaLabel}>GB</Text>
            </View>
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <View style={styles.tonRow}>
            <Text style={styles.cardTitle}>{t('wallet.tonTitle')}</Text>
            <Text style={styles.tonValue}>{t('wallet.tonComingSoon')}</Text>
          </View>
        </GlassCard>

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
  tonRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tonValue:    { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.muted },
});
