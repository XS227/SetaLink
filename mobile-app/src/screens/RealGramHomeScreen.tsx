/**
 * RealGramHomeScreen — native Shahnameh dashboard (`docs/realgram/
 * TASK_SPLIT.md` A→B(125) roadmap: Home/dashboard, lowest priority, biggest
 * scope — built as a first pass, not a pixel-verified port like Chapters
 * was against learn.html. Unlike that screen, I didn't fetch and read
 * season2/index.html + home.js's DOM/CSS directly this round (ran out of
 * turn budget) — this reuses the SAME data already available from other
 * screens (contract §9 profile summary, chapter/hero catalogs) laid out as
 * a dashboard, rather than a verified 1:1 layout match. Worth a real pass
 * against index.html's actual markup before calling this "done."
 *
 * Deliberately does NOT replace the Game tab's WebView landing page
 * (GameScreen still embeds season2 "/" as-is) — this is a new, separate
 * entry point (Profile banner), same incremental pattern as Chapters/
 * Heroes/Social/Clan. Whether this should eventually REPLACE the Game
 * tab's root is a product decision for Khabat, not assumed here.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useAuthStore } from '../stores/authStore';
import { useIdentityStore } from '../stores/identityStore';
import { getProfileSummary, ProfileSummary } from '../services/realGramProfileService';
import { getChapterCatalog, ChapterCatalogEntry } from '../services/chapterCatalogService';
import { getHeroCatalog, HeroCatalogEntry } from '../services/heroCatalogService';

interface Props {
  onBack: () => void;
  onOpenChapters: () => void;
  onOpenHeroes:   () => void;
  onOpenClans:    () => void;
  onOpenSocial:   () => void;
  onOpenEarn:     () => void;
}

export function RealGramHomeScreen({ onBack, onOpenChapters, onOpenHeroes, onOpenClans, onOpenSocial, onOpenEarn }: Props) {
  const insets   = useSafeAreaInsets();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const localDisplayName = useIdentityStore((s) => s.displayName);

  const [profile, setProfile]   = useState<ProfileSummary | null>(null);
  const [chapters, setChapters] = useState<ChapterCatalogEntry[]>([]);
  const [heroes, setHeroes]     = useState<HeroCatalogEntry[]>([]);
  const [error, setError]       = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      deviceId ? getProfileSummary(deviceId) : Promise.reject(new Error('no device id')),
      getChapterCatalog(),
      getHeroCatalog(),
    ]).then(([p, c, h]) => {
      if (cancelled) return;
      setProfile(p);
      setChapters(c);
      setHeroes(h);
    }).catch(() => { if (!cancelled) setError("Couldn't load your dashboard right now."); });
    return () => { cancelled = true; };
  }, [deviceId]);

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

  if (!profile) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.gold[400]} />
      </View>
    );
  }

  const { identity, economy, streaks } = profile;
  const displayName = identity.handle || identity.username || identity.first_name || localDisplayName || 'Warrior';
  const chapterPct  = chapters.length > 0 ? profile.chapters.completed / chapters.length : 0;
  const topHero     = [...heroes].sort((a, b) => b.power - a.power)[0] ?? null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={8} />
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBack, { top: insets.top + Spacing[3] }]}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={styles.backIcon}>‹</Text>
      </TouchableOpacity>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.greeting}>Welcome back, {displayName}</Text>
        <Text style={styles.pageSub}>Level {economy.level} · {streaks.daily_streak} day streak</Text>

        <View style={styles.statsRow}>
          <StatPill icon="💎" value={economy.real_balance.toLocaleString()} label="REAL" />
          <StatPill icon="🪙" value={economy.zar.toLocaleString()} label="ZAR" />
          <StatPill icon="⭐" value={economy.xp.toLocaleString()} label="XP" />
        </View>

        <TouchableOpacity onPress={onOpenChapters} activeOpacity={0.85}>
          <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardLabel}>Chronicle progress</Text>
              <Text style={styles.cardValue}>{profile.chapters.completed} / {chapters.length}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${chapterPct * 100}%` as any }]} />
            </View>
            <Text style={styles.cardCta}>Continue your journey ›</Text>
          </GlassCard>
        </TouchableOpacity>

        {!!topHero && (
          <TouchableOpacity onPress={onOpenHeroes} activeOpacity={0.85}>
            <GlassCard style={styles.card}>
              <Text style={styles.cardLabel}>Strongest hero</Text>
              <Text style={styles.heroName}>{topHero.name}</Text>
              <Text style={styles.heroMeta}>{topHero.rarity} · ⚔ {topHero.power}</Text>
              <Text style={styles.cardCta}>Browse the roster ›</Text>
            </GlassCard>
          </TouchableOpacity>
        )}

        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenClans} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>🛡️</Text>
            <Text style={styles.quickLabel}>Clans</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenSocial} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>👥</Text>
            <Text style={styles.quickLabel}>Social</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenEarn} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>💰</Text>
            <Text style={styles.quickLabel}>Earn</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function StatPill({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{icon} {value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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

  greeting:  { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[3] },

  statsRow:  { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[2] },
  statPill:  { flex: 1, backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  statValue: { fontSize: 13, fontFamily: Typography.family.mono, color: Colors.text.primary },
  statLabel: { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.label, marginTop: 2, textTransform: 'uppercase' },

  card: { gap: Spacing[2] },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  cardValue: { fontSize: 13, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  cardCta:   { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.gold[400], marginTop: Spacing[1] },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3, backgroundColor: Colors.gold[400] },

  heroName: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  heroMeta: { fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body, marginTop: 2 },

  quickRow:   { flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[2] },
  quickCard:  { flex: 1, backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', gap: Spacing[1] },
  quickIcon:  { fontSize: 22 },
  quickLabel: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.primary },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
