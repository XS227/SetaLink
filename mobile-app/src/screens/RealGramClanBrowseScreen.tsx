/**
 * RealGramClanBrowseScreen — native Shahnameh guild directory (`docs/
 * realgram/TASK_SPLIT.md` A→B(125) roadmap: Clan/Guild). Distinct from
 * RealGramClanScreen (the Clan TAB, deliberately redesigned 2026-07-22
 * around RealGram's own community features, not a guild reskin) — this is
 * the actual `guild.html`-equivalent directory of Shahnameh clans.
 *
 * Now interactive (B->A(132)'s telegram_id bridge, wired through A->B(133)):
 * shows the caller's own clan if they have one, and lets them apply to
 * others otherwise — request shape matches `clan/apply` exactly as
 * `social.js` itself calls it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { getSsoToken } from '../services/ssoService';
import { getClanDirectory, getMyClan, applyToClan, ClanListing, MyClan } from '../services/clanBrowseService';

interface Props {
  onBack: () => void;
}

const APPLY_ERROR_COPY: Record<string, string> = {
  already_in_clan:       'You are already in a clan.',
  cannot_apply_own_clan: 'That is your own clan.',
  clan_full:              'That clan is full.',
  clan_not_found:         'Clan not found.',
  network_error:          "Couldn't reach the server — try again.",
};

export function RealGramClanBrowseScreen({ onBack }: Props) {
  const insets   = useSafeAreaInsets();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const showToast = useToastStore((s) => s.show);

  const [clans, setClans]       = useState<ClanListing[] | null>(null);
  const [myClan, setMyClan]     = useState<MyClan | null>(null);
  const [telegramId, setTelegramId] = useState('');
  const [pendingId, setPendingId]   = useState<string | null>(null); // clan_id currently applying
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    try {
      const tid = deviceId ? (await getSsoToken(deviceId, true)).telegram_id : '';
      setTelegramId(tid);
      const [directory, mine] = await Promise.all([getClanDirectory(tid), getMyClan(tid)]);
      if (directory.length === 0) { setError("Couldn't load the clan directory right now."); return; }
      setClans(directory);
      setMyClan(mine);
    } catch {
      setError("Couldn't load the clan directory right now.");
    }
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  const handleApply = useCallback(async (clan: ClanListing) => {
    if (!telegramId) { showToast("Couldn't identify your account — try again shortly.", 'error'); return; }
    setPendingId(clan.clan_id);
    const result = await applyToClan(telegramId, clan.clan_id);
    setPendingId(null);
    if (result.ok) {
      showToast(`Application sent to ${clan.clan_name}!`, 'success');
      setClans((prev) => prev?.map((c) => (c.clan_id === clan.clan_id ? { ...c, user_status: 'pending' } : c)) ?? prev);
    } else {
      showToast(APPLY_ERROR_COPY[result.error] ?? 'Could not apply. Try again.', 'error');
    }
  }, [telegramId, showToast]);

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
              {myClan ? (
                <GlassCard style={styles.myClanCard} glowColor={Colors.gold[400]}>
                  <Text style={styles.cardLabel}>Your clan</Text>
                  <View style={styles.clanRow}>
                    {myClan.clan_photo ? (
                      <Image source={{ uri: myClan.clan_photo }} style={styles.clanPhoto} />
                    ) : (
                      <View style={[styles.clanPhoto, styles.avatarFallback]}>
                        <Text style={styles.avatarFallbackText}>{myClan.clan_name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clanName} numberOfLines={1}>{myClan.clan_name}</Text>
                      <Text style={styles.clanMeta}>{myClan.member_count} members · {myClan.treasury.toLocaleString()} REAL treasury</Text>
                    </View>
                  </View>
                </GlassCard>
              ) : (
                <GlassCard style={styles.noteCard}>
                  <Text style={styles.noteText}>You're not in a clan yet — apply to one below.</Text>
                </GlassCard>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <ClanCard
              clan={item}
              hasClan={!!myClan}
              pending={pendingId === item.clan_id}
              onApply={() => handleApply(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function ClanCard({
  clan, hasClan, pending, onApply,
}: { clan: ClanListing; hasClan: boolean; pending: boolean; onApply: () => void }) {
  const canApply = !hasClan && clan.user_status === 'none';
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
        {canApply ? (
          <TouchableOpacity
            onPress={onApply}
            disabled={pending}
            style={[styles.applyBtn, pending && styles.applyBtnDisabled]}
            activeOpacity={0.85}
          >
            {pending
              ? <ActivityIndicator size="small" color={Colors.bg.void} />
              : <Text style={styles.applyBtnText}>Apply</Text>}
          </TouchableOpacity>
        ) : clan.user_status !== 'none' ? (
          <Text style={styles.statusTag}>{clan.user_status}</Text>
        ) : null}
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

  cardLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: Spacing[2] },
  myClanCard: { marginBottom: Spacing[4] },
  noteCard:   { marginBottom: Spacing[4] },
  noteText:   { fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 18 },

  clanCard: { gap: 0 },
  clanRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanPhoto: { width: 44, height: 44, borderRadius: 12 },
  avatarFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanName: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanMotto: { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.body, marginTop: 2, fontStyle: 'italic' },
  clanMeta: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },

  applyBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[3] },
  applyBtnDisabled: { opacity: 0.6 },
  applyBtnText: { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.bg.void },
  statusTag: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase' },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
