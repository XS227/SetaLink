/**
 * RealGramClanScreen — native RealGram Clan screen, replacing the
 * ShahnamehEmbed(guild.html) WebView the Clan tab used until now (Khabat,
 * 2026-07-22: "remove the remaining Shahnameh menu and create a native
 * RealGram Clan experience"). Fed by the same contract §9
 * realgram-profile-summary call Profile/Wallet already use — no second
 * backend round-trip.
 *
 * Scope honestly: contract §9's `clan` field covers identity/headline
 * numbers (name, photo, motto, member count, role, total REAL earned) —
 * enough for a real native clan card, not a full roster/chat/leaderboard.
 * A member list, applications, and clan wars need their own backend
 * contract (the real, actively-maintained clan system lives in
 * shahnameh-backend's Clan/ClanApplication/ClanInvite models /
 * /api/season2/clan/* routes) — flagged to Agent B as the next contract to
 * build, not guessed at here with fake data.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import { getProfileSummary, ProfileClan } from '../services/realGramProfileService';

function StatCell({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function RealGramClanScreen() {
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const insets   = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [clan, setClan]       = useState<ProfileClan | null | undefined>(undefined);

  const load = useCallback(() => {
    if (!deviceId) return;
    setLoading(true);
    setError('');
    getProfileSummary(deviceId)
      .then((p) => setClan(p.clan))
      .catch(() => setError("We couldn't load your clan right now. This is usually temporary."))
      .finally(() => setLoading(false));
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.gold[400]} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top, gap: Spacing[4] }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.85}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!clan) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top, gap: Spacing[3], paddingHorizontal: Spacing[6] }]}>
        <Text style={styles.emptyIcon}>🛡️</Text>
        <Text style={styles.emptyTitle}>Not in a clan yet</Text>
        <Text style={styles.emptySub}>Join or found a clan in the Game tab to see it here.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroRow}>
          {clan.clan_photo ? (
            <Image source={{ uri: clan.clan_photo }} style={styles.clanPhoto} />
          ) : (
            <View style={[styles.clanPhoto, styles.clanPhotoFallback]}>
              <Text style={styles.clanPhotoFallbackText}>{clan.clan_name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.clanName} numberOfLines={1}>{clan.clan_name}</Text>
            {!!clan.role && (
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{clan.role === 'leader' ? '👑 Leader' : clan.role}</Text>
              </View>
            )}
          </View>
        </View>

        {!!clan.motto && (
          <GlassCard style={styles.card}>
            <Text style={styles.cardLabel}>Motto</Text>
            <Text style={styles.motto}>"{clan.motto}"</Text>
          </GlassCard>
        )}

        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <Text style={styles.cardLabel}>Clan stats</Text>
          <View style={styles.statsGrid}>
            <StatCell value={clan.member_count} label="Members" />
            <StatCell value={clan.total_real_earned.toLocaleString()} label="REAL earned" />
          </View>
        </GlassCard>

        <View style={{ height: Spacing[8] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: Colors.bg.void },
  centered:    { justifyContent: 'center', alignItems: 'center', gap: Spacing[3] },
  scroll:      { flex: 1 },
  content:     { paddingHorizontal: Spacing[4], paddingTop: Spacing[6], gap: Spacing[4] },

  errorText:    { fontSize: 13, color: '#FF6B6B', textAlign: 'center', paddingHorizontal: Spacing[6], fontFamily: Typography.family.body },
  retryBtn:     { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  retryBtnText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },

  emptyIcon:  { fontSize: 40 },
  emptyTitle: { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  emptySub:   { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center' },

  heroRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanPhoto:    { width: 64, height: 64, borderRadius: 16, borderWidth: 2, borderColor: Colors.gold[400] },
  clanPhotoFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  clanPhotoFallbackText: { fontSize: 24, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  clanName:     { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  roleBadge:    { alignSelf: 'flex-start', backgroundColor: 'rgba(212,175,55,0.15)', borderRadius: Radius.md, paddingHorizontal: Spacing[2], paddingVertical: 2, marginTop: 4 },
  roleBadgeText:{ fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.gold[400] },

  card:       { gap: Spacing[2] },
  cardLabel:  { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  motto:      { fontSize: Typography.size.md, fontFamily: Typography.family.body, color: Colors.text.primary, fontStyle: 'italic' },

  statsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[4] },
  statCell:   { minWidth: 100, alignItems: 'flex-start' },
  statValue:  { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  statLabel:  { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
});
