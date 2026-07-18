/**
 * ClanScreen — §5.10's Clan tab. Promotes CommunityRankCard (rank ladder +
 * clan chip, already computed client-side from the user id, zero backend)
 * from a buried Profile section to its own top-level destination.
 *
 * §6.4 "Shahnameh Community" (a real clan backend — membership, shared
 * traffic, clan chat) is explicitly Not started in the roadmap, so this
 * stays a rank/community view on data the app already has, not a full
 * clan system.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Share } from 'react-native';
import { Colors, Typography, Spacing, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { TopBar } from '../components/TopBar';
import { CommunityRankCard } from '../components/CommunityRankCard';
import { ReferralEarningsDonut } from '../components/ReferralEarningsDonut';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useT } from '../i18n';

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

export function ClanScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const user  = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);

  const referralDisplayCode = (user?.referralCode || '').toUpperCase();

  const handleInvite = async () => {
    try {
      await Share.share({ message: t('pr.shareMessage').replace(/\{code\}/g, referralDisplayCode) });
    } catch {
      showToast(t('pr.shareUnavailable'), 'error', 2500);
    }
  };

  if (!user) return null;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('nav.clan')}</Text>
          <TopBar onNavigate={onNavigate as (tab: string) => void} />
        </View>

        <GlassCard style={styles.hubCard} glowColor={Colors.gold[400]}>
          <CommunityRankCard
            userId={user.userId || user.deviceId}
            inviteCount={user.inviteCount}
            activeInviteCount={user.activeInviteCount}
            onInvite={handleInvite}
            bare
          />
          <View style={styles.divider} />
          <ReferralEarningsDonut deviceId={user.deviceId} onInvite={handleInvite} bare hideInviteBtn />
        </GlassCard>

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>
      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.base },
  scroll:  { flex: 1 },
  content: { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[4] },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:   { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  hubCard: { padding: Spacing[4], gap: Spacing[3] },
  divider: { height: 1, backgroundColor: Colors.border.subtle },
});
