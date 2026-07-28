/**
 * RealGramClanBrowseScreen — native Shahnameh guild directory (`docs/
 * realgram/TASK_SPLIT.md` A→B(125) roadmap: Clan/Guild). Distinct from
 * RealGramClanScreen (the Clan TAB, deliberately redesigned 2026-07-22
 * around RealGram's own community features, not a guild reskin) — this is
 * the actual `guild.html`-equivalent directory of Shahnameh clans, browse-
 * only for now. Joining/creating/applying all need the telegram_id identity
 * bridge A->B(125) is still blocked on; the directory itself doesn't
 * (confirmed live public).
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { getClanDirectory, ClanListing } from '../services/clanBrowseService';

interface Props {
  onBack: () => void;
}

export function RealGramClanBrowseScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [clans, setClans] = useState<ClanListing[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getClanDirectory().then((list) => {
      if (cancelled) return;
      if (list.length === 0) { setError("Couldn't load the clan directory right now."); return; }
      setClans(list);
    }).catch(() => { if (!cancelled) setError("Couldn't load the clan directory right now."); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={onBack} style={styles.backBtnFallback} activeOpacity={0.8}>
          <Text style={styles.backBtnFallbackText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={6} />
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBack, { top: insets.top + Spacing[3] }]}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={styles.backIcon}>‹</Text>
      </TouchableOpacity>
      {!clans ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : (
        <FlatList
          data={clans}
          keyExtractor={(c) => c.clan_id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <Text style={styles.pageTitle}>Clans</Text>
              <Text style={styles.pageSub}>Warrior guilds from across the chronicle.</Text>
              <GlassCard style={styles.noteCard}>
                <Text style={styles.noteText}>
                  Joining and creating a clan unlocks once account linking catches
                  up — for now, here's who's already out there.
                </Text>
              </GlassCard>
            </View>
          }
          renderItem={({ item }) => <ClanCard clan={item} />}
        />
      )}
    </View>
  );
}

function ClanCard({ clan }: { clan: ClanListing }) {
  return (
    <GlassCard style={styles.clanCard}>
      <View style={styles.clanRow}>
        {clan.clan_photo ? (
          <Image source={{ uri: clan.clan_photo }} style={styles.clanPhoto} />
        ) : (
          <View style={[styles.clanPhoto, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>{clan.clan_name.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.clanName} numberOfLines={1}>{clan.clan_name}</Text>
          {!!clan.motto && <Text style={styles.clanMotto} numberOfLines={1}>"{clan.motto}"</Text>}
          <Text style={styles.clanMeta}>{clan.member_count} members · led by {clan.leader_name || 'unknown'}</Text>
        </View>
        {clan.total_real_earned > 0 && (
          <Text style={styles.clanTreasury}>{clan.total_real_earned.toLocaleString()} REAL</Text>
        )}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[4] },
  content:  { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[3] },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[3] },

  noteCard: { marginBottom: Spacing[4] },
  noteText: { fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 18 },

  clanCard: { gap: 0 },
  clanRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanPhoto: { width: 44, height: 44, borderRadius: 12 },
  avatarFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanName: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanMotto: { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.body, marginTop: 2, fontStyle: 'italic' },
  clanMeta: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },
  clanTreasury: { fontSize: 12, fontFamily: Typography.family.mono, color: Colors.gold[400] },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
