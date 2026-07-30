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
 * Daily Quests — read side now built (B's follow-up after `(137)`): the
 * `/v1/profile-summary` contract this screen already calls didn't expose
 * quest_read/quest_quiz/quest_tap, but the data itself is real and
 * server-tracked (Season2User schema, already returned by
 * `/season2/user/sync`) — added the missing fields to profile-summary's
 * response instead of duplicating a call. Deliberately READ-ONLY, no claim
 * button: `home.js`'s own "+200 XP" bonus grants XP purely client-side
 * (`RealPlayer.addResource`) then calls `/user/sync-balance` to persist
 * it, but that endpoint explicitly rejects a client-supplied `xp` field
 * ("server-authoritative only" — anti-cheat guard) — the bonus is never
 * actually saved server-side. Real bug in the live game, not reproduced
 * here; worth fixing at the source (a proper server-computed grant) before
 * any client, native or web, claims to award it.
 *
 * Hero Spotlight — built now: resolves the telegram_id bridge (same
 * pattern as Clan/Earn/Heroes) and shows the lowest-level owned hero
 * ("upgrade priority", matching index.html's own framing). Empty state
 * when nothing's owned yet, pointing at the roster.
 *
 * Deliberately does NOT replace the Game tab's WebView landing page
 * (GameScreen still embeds season2 "/" as-is) — new, separate entry point
 * (Profile banner), same incremental pattern as every other roadmap screen.
 *
 * 2026-07-29 (Khabat: "din oppgave er å bygge videre shahnameh inn på
 * realgram. nå begynn med dashboard"): almost built a second, competing
 * dashboard screen from scratch before actually reading this file — it's
 * already real and index.html-grounded, not a placeholder. Added the one
 * thing genuinely missing: a Card Collection section (owned/total per
 * category — hero/place/enemy/special, heroCatalogService's new `category`
 * field), between Hero Spotlight and Live TV. Left everything else as-is.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { TopBar } from '../components/TopBar';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { useIdentityStore } from '../stores/identityStore';
import { getSsoToken } from '../services/ssoService';
import { getProfileSummary, ProfileSummary } from '../services/realGramProfileService';
import { getChapterCatalog, ChapterCatalogEntry } from '../services/chapterCatalogService';
import { getHeroCatalog, getOwnedHeroes, HeroCatalogEntry, HeroCategory, OwnedHero } from '../services/heroCatalogService';

// Mirrors home.js's own TAP_GOAL (season2/home.js) -- quest_tap is a raw
// daily tap counter server-side, "done" is reaching this threshold.
const DAILY_TAP_GOAL = 200;

// Khabat, 2026-07-29: "husk samme logikken mellom hero kortene, personer,
// steder, fiender, spesiale" — real owned/total counts per category
// (heroCatalogService's `category` field, added this session), not a
// static list. Placed after Hero Spotlight rather than replacing it —
// Spotlight is "what to upgrade next", this is "how much of the world
// you've collected so far", different questions.
const CATEGORY_ORDER: HeroCategory[] = ['hero', 'place', 'enemy', 'special'];
const CATEGORY_ICON: Record<HeroCategory, string> = {
  hero: '🛡️', place: '🏔️', enemy: '👹', special: '✨',
};
const CATEGORY_LABEL_KEY: Record<HeroCategory, 'heroes.catHero' | 'heroes.catPlace' | 'heroes.catEnemy' | 'heroes.catSpecial'> = {
  hero: 'heroes.catHero', place: 'heroes.catPlace', enemy: 'heroes.catEnemy', special: 'heroes.catSpecial',
};

// Khabat, 2026-07-29: see the matching flag/note in RealGramProfileScreen.tsx
// -- was hiding the Live TV entry point app-wide while the Profile-screen jam
// report was investigated. Cleared by (196), root cause was unrelated to
// Live TV. Re-enabled.
const LIVE_TV_ENTRY_ENABLED = true;

interface Props {
  onBack: () => void;
  onOpenChapters: () => void;
  onOpenHeroes:   () => void;
  onOpenClans:    () => void;
  onOpenSocial:   () => void;
  onOpenEarn:     () => void;
  onOpenLiveTv:   () => void;
  // Khabat, 2026-07-30: "burger meny funker kun på freedom siden" — this
  // screen (reached via TopBar's own 'dashboard' item) never got the
  // TopBar burger-menu treatment `(199)` gave every other main screen.
  // Wired the same way every TopBar consumer already is (makeOnNavigate).
  onNavigate: (tab: string) => void;
}

export function RealGramHomeScreen({ onBack, onOpenChapters, onOpenHeroes, onOpenClans, onOpenSocial, onOpenEarn, onOpenLiveTv, onNavigate }: Props) {
  const insets   = useSafeAreaInsets();
  const { t, isRTL } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const localDisplayName = useIdentityStore((s) => s.displayName);

  const [profile, setProfile]   = useState<ProfileSummary | null>(null);
  const [chapters, setChapters] = useState<ChapterCatalogEntry[]>([]);
  const [heroCatalog, setHeroCatalog] = useState<HeroCatalogEntry[]>([]);
  const [ownedHeroes, setOwnedHeroes] = useState<Map<string, OwnedHero>>(new Map());
  const [error, setError]       = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sso = deviceId ? await getSsoToken(deviceId, true) : null;
        const [p, c, h, owned] = await Promise.all([
          deviceId ? getProfileSummary(deviceId) : Promise.reject(new Error('no device id')),
          getChapterCatalog(),
          getHeroCatalog(),
          getOwnedHeroes(sso?.telegram_id ?? ''),
        ]);
        if (cancelled) return;
        setProfile(p);
        setChapters(c);
        setHeroCatalog(h);
        setOwnedHeroes(owned);
      } catch {
        if (!cancelled) setError(t('rghome.loadError'));
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId]);

  if (error) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={onBack} style={styles.backBtnFallback} activeOpacity={0.8}>
          <Text style={styles.backBtnFallbackText}>{t('common.back')}</Text>
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
  const displayName = identity.handle || identity.username || identity.first_name || localDisplayName || t('rghome.defaultName');

  // Same status-derivation as RealGramChaptersScreen: first not-done chapter
  // in order is "active" — the one Continue Journey should point at.
  const doneSlugs = new Set(profile.chapters.list.filter((c) => c.done).map((c) => c.slug));
  const activeChapter = chapters.find((c) => !doneSlugs.has(c.slug)) ?? null;
  const chapterPct = chapters.length > 0 ? profile.chapters.completed / chapters.length : 0;

  // "Upgrade priority" — the lowest-level owned hero, matching index.html's
  // own Hero Spotlight framing.
  let spotlightHero: (HeroCatalogEntry & { owned: OwnedHero }) | null = null;
  for (const h of heroCatalog) {
    const o = ownedHeroes.get(h.slug);
    if (!o) continue;
    if (!spotlightHero || o.level < spotlightHero.owned.level) spotlightHero = { ...h, owned: o };
  }

  const categoryCounts = CATEGORY_ORDER.map((category) => {
    const entries = heroCatalog.filter((h) => h.category === category);
    return { category, owned: entries.filter((h) => ownedHeroes.has(h.slug)).length, total: entries.length };
  });

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
      <View style={[styles.floatingMenu, { top: insets.top + Spacing[3] }]}>
        <TopBar onNavigate={onNavigate} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.greeting}>{t('rghome.greeting').replace('{name}', displayName)}</Text>
        <Text style={styles.pageSub}>{t('rghome.level').replace('{level}', String(economy.level))}</Text>

        {/* Treasury — mirrors index.html's resource HUD */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>{t('rghome.treasury')}</Text>
        </View>
        <View style={styles.statsRow}>
          <StatPill icon="💎" value={economy.real_balance.toLocaleString()} label={t('rghome.statReal')} />
          <StatPill icon="🪙" value={economy.zar.toLocaleString()} label={t('rghome.statZar')} />
          <StatPill icon="⭐" value={economy.xp.toLocaleString()} label={t('rghome.statXp')} />
          <StatPill icon="💠" value={String(economy.gems)} label={t('rghome.statGems')} />
        </View>

        {/* Continue Journey */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>{t('rghome.continueJourney')}</Text>
          <TouchableOpacity onPress={onOpenChapters}>
            <Text style={styles.sectionMore}>{t('rghome.allChapters')} {isRTL ? '‹' : '›'}</Text>
          </TouchableOpacity>
        </View>
        {activeChapter ? (
          <TouchableOpacity onPress={onOpenChapters} activeOpacity={0.85}>
            <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
              <Text style={styles.journeyLabel}>{t('rghome.chapterActive').replace('{order}', String(activeChapter.order))}</Text>
              <Text style={styles.journeyTitle}>{activeChapter.title}</Text>
              <Text style={styles.cardCta}>{t('rghome.continue')} {isRTL ? '‹' : '›'}</Text>
            </GlassCard>
          </TouchableOpacity>
        ) : (
          <GlassCard style={styles.card}>
            <Text style={styles.journeyTitle}>{t('rghome.chronicleComplete')}</Text>
          </GlassCard>
        )}

        {/* Chronicle progress */}
        <GlassCard style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>{t('rghome.chronicleProgress')}</Text>
            <Text style={styles.cardValue}>{Math.round(chapterPct * 100)}%</Text>
          </View>
          <Text style={styles.progressSub}>
            {t('rghome.chaptersProgress').replace('{completed}', String(profile.chapters.completed)).replace('{total}', String(chapters.length))}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${chapterPct * 100}%` as any }]} />
          </View>
        </GlassCard>

        {/* Daily Quests — read-only progress, no claim action here on
            purpose: home.js's own "+200 XP" bonus button grants XP purely
            client-side (window.RealPlayer.addResource) then calls
            /user/sync-balance to persist it, but that endpoint explicitly
            rejects a client-supplied xp field ("server-authoritative
            only") -- the bonus is never actually saved server-side, a
            real bug in the live game, not something worth reproducing
            natively. quest_read/quest_quiz/quest_tap themselves ARE real
            and now readable (this session's profile-summary fix). */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>{t('rghome.dailyQuests')}</Text>
        </View>
        <GlassCard style={styles.card}>
          <View style={styles.questRow}>
            <QuestPip label={t('rghome.questRead')} done={profile.quests.read} />
            <QuestPip label={t('rghome.questQuiz')} done={profile.quests.quiz} />
            <QuestPip label={t('rghome.questTap')} done={profile.quests.tap >= DAILY_TAP_GOAL} />
          </View>
        </GlassCard>

        {/* Hero Spotlight */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>{t('rghome.heroSpotlight')}</Text>
          <TouchableOpacity onPress={onOpenHeroes}>
            <Text style={styles.sectionMore}>{t('rghome.collection')} {isRTL ? '‹' : '›'}</Text>
          </TouchableOpacity>
        </View>
        {spotlightHero ? (
          <TouchableOpacity onPress={onOpenHeroes} activeOpacity={0.85}>
            <GlassCard style={styles.card}>
              <View style={styles.spotlightRow}>
                {spotlightHero.image_url ? (
                  <Image source={{ uri: spotlightHero.image_url }} style={styles.spotlightImage} />
                ) : (
                  <View style={[styles.spotlightImage, styles.spotlightImageFallback]}>
                    <Text style={styles.spotlightFallbackText}>{spotlightHero.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.journeyTitle}>{spotlightHero.name}</Text>
                  <Text style={styles.progressSub}>
                    {t('rghome.heroLevelRate').replace('{level}', String(spotlightHero.owned.level)).replace('{rate}', String(spotlightHero.owned.zar_per_hour))}
                  </Text>
                </View>
                <Text style={styles.cardCta}>{t('rghome.upgrade')} {isRTL ? '‹' : '›'}</Text>
              </View>
            </GlassCard>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onOpenHeroes} activeOpacity={0.85}>
            <GlassCard style={styles.card}>
              <Text style={styles.progressSub}>{t('rghome.noHeroes')}</Text>
            </GlassCard>
          </TouchableOpacity>
        )}

        {/* Card Collection — real owned/total per category. */}
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>{t('dashboard.collection')}</Text>
        </View>
        <View style={styles.collectionRow}>
          {categoryCounts.map(({ category, owned, total }) => (
            <TouchableOpacity key={category} onPress={onOpenHeroes} activeOpacity={0.85} style={styles.collectionCell}>
              <GlassCard style={styles.collectionCard} glowColor={owned > 0 ? Colors.gold[400] : undefined}>
                <Text style={styles.collectionIcon}>{CATEGORY_ICON[category]}</Text>
                <Text style={styles.collectionCount}>{owned}/{total}</Text>
                <Text style={styles.collectionLabel} numberOfLines={1}>{t(CATEGORY_LABEL_KEY[category])}</Text>
              </GlassCard>
            </TouchableOpacity>
          ))}
        </View>

        {LIVE_TV_ENTRY_ENABLED && (
          <TouchableOpacity onPress={onOpenLiveTv} activeOpacity={0.85}>
            <GlassCard style={styles.card}>
              <View style={styles.liveTvRow}>
                <Text style={styles.liveTvIcon}>📺</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>{t('rghome.liveTv')}</Text>
                  <Text style={styles.cardCta}>{t('rghome.watchLive')} {isRTL ? '‹' : '›'}</Text>
                </View>
              </View>
            </GlassCard>
          </TouchableOpacity>
        )}

        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenHeroes} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>⚔</Text>
            <Text style={styles.quickLabel}>{t('rghome.navHeroes')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenClans} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>🛡️</Text>
            <Text style={styles.quickLabel}>{t('rghome.navClans')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenSocial} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>👥</Text>
            <Text style={styles.quickLabel}>{t('rghome.navSocial')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={onOpenEarn} activeOpacity={0.85}>
            <Text style={styles.quickIcon}>💰</Text>
            <Text style={styles.quickLabel}>{t('rghome.navEarn')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function QuestPip({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={styles.questPip}>
      <View style={[styles.questDot, done && styles.questDotDone]}>
        {done && <Text style={styles.questCheck}>✓</Text>}
      </View>
      <Text style={[styles.questLabel, done && styles.questLabelDone]}>{label}</Text>
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
  floatingMenu: {
    position: 'absolute', right: Spacing[4], zIndex: 10,
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

  questRow: { flexDirection: 'row', gap: Spacing[4] },
  questPip: { flex: 1, alignItems: 'center', gap: Spacing[1] },
  questDot: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg.void, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  questDotDone: { backgroundColor: Colors.gold[400], borderColor: Colors.gold[400] },
  questCheck: { fontSize: 13, color: Colors.bg.void, fontFamily: Typography.family.heading },
  questLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body },
  questLabelDone: { color: Colors.text.primary },

  spotlightRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  spotlightImage: { width: 44, height: 44, borderRadius: 12 },
  spotlightImageFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  spotlightFallbackText: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },

  collectionRow:   { flexDirection: 'row', gap: Spacing[3] },
  collectionCell:  { flex: 1 },
  collectionCard:  { alignItems: 'center', paddingVertical: Spacing[3], gap: Spacing[1] },
  collectionIcon:  { fontSize: 20 },
  collectionCount: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  collectionLabel: { fontSize: 10, fontFamily: Typography.family.body, color: Colors.text.muted },

  liveTvRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  liveTvIcon: { fontSize: 28 },
  quickRow:   { flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[3] },
  quickCard:  { flex: 1, backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', gap: Spacing[1] },
  quickIcon:  { fontSize: 22 },
  quickLabel: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.primary },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
