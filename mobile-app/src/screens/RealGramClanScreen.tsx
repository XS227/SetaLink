/**
 * RealGramClanScreen — the Clan tab, redesigned around RealGram's own
 * community mechanics rather than a 1:1 Shahnameh guild migration (Khabat,
 * 2026-07-22: "designed around RealGram community features — members,
 * referrals, shared rewards, Starlink progress, data contributions,
 * rankings — rather than being a direct Shahnameh migration").
 *
 * v0.9.86 replaced the ShahnamehEmbed(guild.html) WebView with a native
 * screen that only showed contract §9's `clan` field (Shahnameh guild
 * identity) — still guild-shaped, just native. This pass reframes the
 * screen around what's actually RealGram's own: the referral network the
 * user built (ReferralEarningsDonut — already a complete, shipped
 * component, just never placed here), Starlink access progress
 * (starlinkStore — built for the Home hero card but never wired anywhere,
 * genuinely dormant until this screen), and the data quota that network
 * earns back. The Shahnameh guild (if the user has one) is kept as one
 * secondary card, honestly labeled as the in-game clan — real data, just
 * not the screen's identity anymore.
 *
 * "Rankings" — no leaderboard endpoint exists anywhere in the backend yet
 * (checked before claiming otherwise). What's real and already available:
 * ReferralEarningsDonut's own invitee list, which the panel query already
 * returns sorted by usage (`ORDER BY used DESC`) — surfaced here as "Top
 * contributors in your network," a true ranking, not a fabricated global
 * one.
 *
 * Gold/silver theme pass (2026-07-23): retinted the child components this
 * screen renders (ReferralEarningsDonut, StarlinkCard — StarlinkCard also
 * moved gold->cyan to match "Cyan = Starlink/network"). Did NOT build the
 * theme pkg's `06-clan.html` mockup (TrustAI/Treasury/Tier-quests/Clan-Wars/
 * Warriors-leaderboard) — that mockup is a Shahnameh-guild-war Clan screen,
 * which is the exact framing this screen was deliberately redesigned away
 * from one day earlier (2026-07-22, see above). Building it now would
 * partially reverse that decision, on top of having no real backing data for
 * Treasury/quests/leaderboard either. Flagged, not built.
 */

import React, { useEffect, useState } from 'react';
import {
  Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { ReferralEarningsDonut } from '../components/ReferralEarningsDonut';
import { UsageHistoryChart } from '../components/UsageHistoryChart';
import { NextInviteGoalCard } from '../components/NextInviteGoalCard';
import { InvitedFriendsList } from '../components/InvitedFriendsList';
import { StarlinkCard } from '../components/StarlinkCard';
import { BottomNav } from '../components/BottomNav';
import { EmberField } from '../components/EmberField';
import { useAuthStore } from '../stores/authStore';
import { useStarlinkStore } from '../stores/starlinkStore';
import { getProfileSummary, ProfileClan } from '../services/realGramProfileService';

const ONE_GB = 1073741824;

interface Props {
  onOpenStarlink: () => void;
  onInvite:       () => void;
}

export function RealGramClanScreen({ onOpenStarlink, onInvite }: Props) {
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const token    = useAuthStore((s) => s.token);
  const quotaTotal = useAuthStore((s) => s.user?.quotaBytesTotal ?? 0);
  const milestones = useAuthStore((s) => s.user?.milestones ?? null);
  const insets   = useSafeAreaInsets();

  const [clan, setClan] = useState<ProfileClan | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    getProfileSummary(deviceId).then((p) => setClan(p.clan)).catch(() => {});
  }, [deviceId]);

  // StarlinkCard was built for the Home hero card (b97 addendum #2) but was
  // never actually wired anywhere — its own store's `refresh()` was never
  // called from any screen, so it would render nothing forever. Calling it
  // here is what actually turns this dormant feature on.
  useEffect(() => {
    if (!token) return;
    useStarlinkStore.getState().refresh(token).catch(() => {});
  }, [token]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={8} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Community</Text>
        <Text style={styles.pageSub}>Your RealGram network, rewards, and access.</Text>

        {/* Members / referrals / shared rewards + "top contributors" ranking —
            a complete, already-shipped component, just never placed here. */}
        <ReferralEarningsDonut deviceId={deviceId} onInvite={onInvite} />

        {/* Escalating invite quest: reads the already-live qe_milestones()
            ladder (3 -> 5 -> 8 -> 13 -> 21 -> 34 -> 55) off authStore, so a
            new goal appears the moment the previous one is claimed
            server-side — Khabat's "prøv 5 venner... prøv 8..." ask. */}
        <NextInviteGoalCard milestones={milestones} />

        {/* Full invited-friends list (donut's own legend only shows 6). */}
        <InvitedFriendsList deviceId={deviceId} />

        {/* Daily usage trend — second chart, companion to the earnings
            donut above (charts backlog item, [[realink-feature-backlog-khabat]]). */}
        <UsageHistoryChart deviceId={deviceId} />

        {/* Starlink progress — dormant feature, wired live for the first time. */}
        <StarlinkCard
          onOpen={onOpenStarlink}
          onInvite={onInvite}
          onConnect={onOpenStarlink}
        />

        {/* Data contribution — the quota this network has earned back. */}
        <GlassCard style={styles.card}>
          <Text style={styles.cardLabel}>Your data plan</Text>
          <Text style={styles.dataValue}>{(quotaTotal / ONE_GB).toFixed(1)} GB</Text>
          <Text style={styles.dataSub}>Total quota, including what your network has earned you</Text>
        </GlassCard>

        {/* Shahnameh in-game clan — secondary, honestly labeled, real data
            when it exists; a light nudge when it doesn't (never a dead end). */}
        {clan ? (
          <GlassCard style={styles.card}>
            <Text style={styles.cardLabel}>Your Shahnameh clan</Text>
            <View style={styles.clanRow}>
              {clan.clan_photo ? (
                <Image source={{ uri: clan.clan_photo }} style={styles.clanPhoto} />
              ) : (
                <View style={[styles.clanPhoto, styles.clanPhotoFallback]}>
                  <Text style={styles.clanPhotoFallbackText}>{clan.clan_name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.clanName} numberOfLines={1}>{clan.clan_name}</Text>
                <Text style={styles.clanMeta}>
                  {clan.member_count} members{clan.role ? ` · ${clan.role === 'leader' ? '👑 Leader' : clan.role}` : ''}
                </Text>
              </View>
            </View>
          </GlassCard>
        ) : (
          <GlassCard style={styles.card}>
            <Text style={styles.cardLabel}>Shahnameh clan</Text>
            <Text style={styles.dataSub}>Not in a clan yet — join or found one in the Game tab.</Text>
          </GlassCard>
        )}

        {/* This screen has no self-rendered <BottomNav> — the Tab.Navigator's
            floating tabBar overlay (AppNavigator.tsx) supplies it instead, so
            without this the last card sits behind it and the page reads as
            "won't scroll all the way" (Khabat, 2026-07-23 bug report). */}
        <View style={{ height: BottomNav.CONTENT_HEIGHT + insets.bottom + Spacing[4] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.void },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: Spacing[4], paddingTop: Spacing[4], gap: Spacing[4] },

  pageTitle: { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  pageSub:   { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: -Spacing[2] },

  card:      { padding: Spacing[4], gap: Spacing[2] },
  cardLabel: { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },

  dataValue: { fontSize: Typography.size.xl, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  dataSub:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  clanRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanPhoto: { width: 48, height: 48, borderRadius: 12 },
  clanPhotoFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  clanPhotoFallbackText: { fontSize: 18, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  clanName:  { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanMeta:  { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
});
