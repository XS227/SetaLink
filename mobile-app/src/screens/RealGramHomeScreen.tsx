/**
 * RealGramHomeScreen — native Shahnameh dashboard (`docs/realgram/
 * TASK_SPLIT.md` A→B(125) roadmap: Home/dashboard).
 *
 * Second pass — checked the real `season2/index.html`/`home.js` this time
 * (the first pass, flagged honestly in its own header, hadn't). Real
 * layout is: Treasury HUD → Continue Journey card → Chronicle progress bar
 * → Daily Quests → Hero Spotlight. Built the first three natively, all
 * server-backed (economy from contract §9, active chapter from the same
 * status-derivation RealGramChaptersScreen already uses).
 *
 * Daily Quests and Hero Spotlight deliberately NOT built: read `home.js`
 * directly — quest state (`quest_read`/`quest_quiz`/`quest_tap`) comes from
 * `RealSync.ready()`'s resolved user object, which `/api/season2/user/me`
 * does not actually populate (checked live, all three fields absent) —
 * home.js itself falls back to localStorage the same way heroes.js does for
 * ownership (A->B(135)) and chapter.js does for scene progress (B's `124`).
 * No reliable native read source exists yet for either section, so they're
 * left out rather than faked — same principle as Heroes buy.
 *
 * Deliberately does NOT replace the Game tab's WebView landing page
 * (GameScreen still embeds season2 "/" as-is) — new, separate entry point
 * (Profile banner), same incremental pattern as every other roadmap screen.
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
  const [error, setError]       = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      deviceId ? getProfileSummary(deviceId) : Promise.reject(new Error('no device id')),
      getChapterCatalog(),
    ]).then(([p, c]) => {
      if (cancelled) return;
      setProfile(p);
      setChapters(c);
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

  const { identity, economy } = profile;
  const displayName = identity.handle || identity.username || identity.first_name || localDisplayName || 'Warrior';

  // Same status-derivation as RealGramChaptersScreen: first not-done chapter
  // in order is "active" — the one Continue Journey should point at.
  const doneSlugs = new Set(profile.chapters.list.filter((c) => c.done).map((c) => c.slug));
  const activeChapter = chapters.find((c) => !doneSlugs.has(c.slug)) ?? null;
  const chapterPct = chapters.length > 0 ? profile.chapters.completed / chapters.length : 0;

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
        <Text style={styles.pageSub}>Level {economy.level}</Text>

        {/* Treasury — mirrors index.html's resource HUD */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>Treasury</Text>
        </View>
        <View style={styles.statsRow}>
          <StatPill icon="💎" value={economy.real_balance.toLocaleString()} label="REAL" />
          <StatPill icon="🪙" value={economy.zar.toLocaleString()} label="ZAR" />
          <StatPill icon="⭐" value={economy.xp.toLocaleString()} label="XP" />
          <StatPill icon="💠" value={String(economy.gems)} label="Gems" />
        </View>

        {/* Continue Journey */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>Continue journey</Text>
          <TouchableOpacity onPress={onOpenChapters}>
            <Text style={styles.sectionMore}>All chapters ›</Text>
          </TouchableOpacity>
        </View>
        {activeChapter ? (
          <TouchableOpacity onPress={onOpenChapters} activeOpacity={0.85}>
            <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
              <Text style={styles.journeyLabel}>Chapter {activeChapter.order} · Active</Text>
              <Text style={styles.journeyTitle}>{activeChapter.title}</Text>
              <Text style={styles.cardCta}>Continue ›</Text>
            </GlassCard>
          </TouchableOpacity>
        ) : (
          <GlassCard style={styles.card}>
            <Text style={styles.journeyTitle}>Chronicle complete!</Text>
          </GlassCard>
        )}

        {/* Chronicle progress */}
        <GlassCard style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>Chronicle progress</Text>
            <Text style={styles.cardValue}>{Math.round(chapterPct * 100)}%</Text>
          </View>
          <Text style={styles.progressSub}>{profile.chapters.completed} of {chapters.length} chapters</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${chapterPct * 100}%` as any }]} />
          </View>
        </GlassCard>

        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenHeroes} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>⚔</Text>
            <Text style={styles.quickLabel}>Heroes</Text>
          </TouchableOpacity>
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
  content:  { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[2] },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  greeting:  { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[2] },

  sectionHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing[3], marginBottom: Spacing[2] },
  sectionTitle:   { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },
  sectionMore:    { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.body },

  statsRow:  { flexDirection: 'row', gap: Spacing[2] },
  statPill:  { flex: 1, backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  statValue: { fontSize: 12, fontFamily: Typography.family.mono, color: Colors.text.primary },
  statLabel: { fontSize: 9, color: Colors.text.muted, fontFamily: Typography.family.label, marginTop: 2, textTransform: 'uppercase' },

  card: { gap: Spacing[1] },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  cardValue: { fontSize: 13, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  cardCta:   { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.gold[400], marginTop: Spacing[1] },

  journeyLabel: { fontSize: 10, color: Colors.gold[400], fontFamily: Typography.family.label, textTransform: 'uppercase' },
  journeyTitle: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: 2 },

  progressSub: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginBottom: Spacing[1] },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3, backgroundColor: Colors.gold[400] },

  quickRow:   { flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[3] },
  quickCard:  { flex: 1, backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', gap: Spacing[1] },
  quickIcon:  { fontSize: 22 },
  quickLabel: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.primary },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
