/**
 * RealGramChapterDetailScreen — native chapter reading page
 * (`docs/realgram/TASK_SPLIT.md` A→B(124), Khabat: "prikk lik shahnameh
 * men i realgram"). Native hero + lore/chronicle + scene reader.
 *
 * 2026-07-29 (Khabat: "når jeg er ferdig med en kapitel historie og skal
 * videre så blir jeg sendt tilbake ekstern shahnameh. bygg videre der så
 * quiz og videre prosess på kapitelen skjer i realgram"): this is the
 * follow-up A→B(124) explicitly deferred — Ferdowsi's Desk, the boss/
 * battle requirements, and the 3-tier quiz are now all native
 * (FerdowsiDeskCard/ChapterQuizPanel/ChapterBattlePanel). The WebView
 * handoff ("Continue in Shahnameh") is gone entirely — completing a
 * chapter never leaves this screen anymore.
 *
 * Root cause of the "disjointed" feeling this fixes: scene-read progress
 * used to live ONLY in this app's own MMKV storage — invisible to the
 * WebView, which has its own, completely separate sandboxed localStorage.
 * Progress now syncs through the same `ChapterProgress` server record
 * chapter.js itself reads/writes (chapterProgressSyncService.ts), with the
 * same union/OR/max merge contract as season2/sync.js's own
 * `_mergeChapter` — native and WebView (if ever opened) now genuinely
 * share one source of truth.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { GoldenUnlockPopup } from '../components/GoldenUnlockPopup';
import { FerdowsiDeskCard } from '../components/FerdowsiDeskCard';
import { ChapterQuizPanel } from '../components/ChapterQuizPanel';
import { ChapterBattlePanel } from '../components/ChapterBattlePanel';
import { useT } from '../i18n';
import { localizedField } from '../utils/localizedField';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { getSsoToken } from '../services/ssoService';
import { getProfileSummary } from '../services/realGramProfileService';
import { getChapterCatalog, ChapterCatalogEntry } from '../services/chapterCatalogService';
import {
  getChapterLore, ChapterLore, ChapterScene, ChapterCardRef,
  isCardUnlocked, cardsUnlockedBySceneRead,
} from '../services/chapterLoreService';
import {
  getLocalSnapshot, saveLocalSnapshot, mergeSnapshot, markSceneRead, markDeskRead, markChapterDone,
  isSceneUnlocked, emptySnapshot, ChapterProgressSnapshot,
} from '../services/chapterProgressStore';
import { fetchServerChapterProgress, pushChapterProgress } from '../services/chapterProgressSyncService';
import { getChapterQuiz, QuizQuestion } from '../services/chapterQuizService';
import { getHeroCatalog, getOwnedHeroes, HeroCatalogEntry, OwnedHero, reconcileChapterRewards } from '../services/heroCatalogService';

interface Props {
  slug: string;
  onBack: () => void;
  // Deep-links into RealGramHeroesScreen at a specific card — used by the
  // "Cards from this chapter" section and GoldenUnlockPopup's CTA
  // (2026-07-29, "knytt kortene til historiene").
  onOpenHeroes: (cardSlug: string) => void;
}

export function RealGramChapterDetailScreen({ slug, onBack, onOpenHeroes }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang, isRTL } = useT();
  const deviceId  = useAuthStore((s) => s.user?.deviceId ?? '');
  const showToast = useToastStore((s) => s.show);

  const [catalogEntry, setCatalogEntry] = useState<ChapterCatalogEntry | null>(null);
  const [lore, setLore]           = useState<ChapterLore | null>(null);
  const [progress, setProgress]   = useState<ChapterProgressSnapshot>(emptySnapshot());
  const [telegramId, setTelegramId] = useState('');
  const [heroCatalog, setHeroCatalog] = useState<HeroCatalogEntry[]>([]);
  const [ownedHeroes, setOwnedHeroes] = useState<Map<string, OwnedHero>>(new Map());
  const [farr, setFarr]           = useState(0);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [error, setError]         = useState('');
  const [loaded, setLoaded]       = useState(false);
  const [completing, setCompleting] = useState(false);
  // Golden "card unlocked" / chapter-complete-reward popup queue.
  const [unlockQueue, setUnlockQueue] = useState<ChapterCardRef[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tid = deviceId ? (await getSsoToken(deviceId, true)).telegram_id : '';
        if (cancelled) return;
        setTelegramId(tid);

        const [catalog, loreResult, serverProgress, profile, catalogHeroes, owned, quiz] = await Promise.all([
          getChapterCatalog(),
          getChapterLore(slug),
          tid ? fetchServerChapterProgress(tid) : Promise.resolve(null),
          deviceId ? getProfileSummary(deviceId).catch(() => null) : Promise.resolve(null),
          getHeroCatalog(),
          tid ? getOwnedHeroes(tid) : Promise.resolve(new Map<string, OwnedHero>()),
          getChapterQuiz(slug),
        ]);
        if (cancelled) return;

        const entry = catalog.find((c) => c.slug === slug) ?? null;
        if (!entry && !loreResult) { setError(t('chapterdetail.loadError')); setLoaded(true); return; }
        setCatalogEntry(entry);
        setLore(loreResult);
        setHeroCatalog(catalogHeroes);
        setOwnedHeroes(owned);
        setFarr(profile?.economy.farr ?? 0);
        setQuizQuestions(quiz);

        // Merge local + server progress — same union/OR/max contract as
        // sync.js's own _mergeChapter, so neither side can lose progress.
        const local  = getLocalSnapshot(slug);
        const server = serverProgress?.[slug] ?? null;
        const merged = server ? mergeSnapshot(local, server) : local;
        saveLocalSnapshot(slug, merged);
        setProgress(merged);
        if (tid && JSON.stringify(server) !== JSON.stringify(merged)) {
          pushChapterProgress(tid, slug, merged).catch(() => {});
        }

        setLoaded(true);
      } catch {
        if (!cancelled) { setError(t('chapterdetail.loadError')); setLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [slug, deviceId, t]);

  const handleSceneRead = useCallback((sceneId: string) => {
    // Khabat, 2026-07-29: check BEFORE updating progress, so a card already
    // unlocked by an earlier scene doesn't re-trigger the golden popup.
    if (lore) {
      const newlyUnlocked = cardsUnlockedBySceneRead(lore, sceneId, new Set(progress.scenes));
      if (newlyUnlocked.length > 0) setUnlockQueue((q) => [...q, ...newlyUnlocked]);
    }
    const next = markSceneRead(slug, sceneId);
    setProgress(next);
    if (telegramId) pushChapterProgress(telegramId, slug, next).catch(() => {});
  }, [slug, lore, progress.scenes, telegramId]);

  const handleDeskRead = useCallback(() => {
    const next = markDeskRead(slug);
    setProgress(next);
    if (telegramId) pushChapterProgress(telegramId, slug, next).catch(() => {});
  }, [slug, telegramId]);

  const handleQuizProgressChange = useCallback((next: ChapterProgressSnapshot) => {
    setProgress(next);
    if (telegramId) pushChapterProgress(telegramId, slug, next).catch(() => {});
  }, [slug, telegramId]);

  const handleBattleComplete = useCallback(async () => {
    if (completing || !telegramId) return;
    setCompleting(true);
    const next = markChapterDone(slug);
    setProgress(next);
    await pushChapterProgress(telegramId, slug, next);
    // Server independently re-validates the chapter is actually done via
    // the same ChapterProgress record — this isn't a client-trusted grant.
    const granted = await reconcileChapterRewards(telegramId);
    setCompleting(false);
    const heroId = granted[0];
    const hero = heroId ? heroCatalog.find((h) => h.slug === heroId) : null;
    if (hero) {
      setUnlockQueue((q) => [...q, {
        slug: hero.slug, name: hero.name, image: hero.image_url,
        unlocked: true, unlock_via: null,
      }]);
    } else {
      showToast(t('chapterdetail.battleComplete'), 'success');
    }
  }, [completing, telegramId, slug, heroCatalog, t, showToast]);

  const dismissUnlockPopup = useCallback(() => {
    setUnlockQueue((q) => q.slice(1));
  }, []);

  const handleViewUnlockedCard = useCallback((cardSlug: string) => {
    setUnlockQueue((q) => q.slice(1));
    onOpenHeroes(cardSlug);
  }, [onOpenHeroes]);

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

  const scenes = lore?.scenes ?? [];
  const title   = catalogEntry ? localizedField(catalogEntry.title, catalogEntry.title_fa, catalogEntry.title_ru, lang) : lore?.slug;
  const summary = catalogEntry ? localizedField(catalogEntry.summary, catalogEntry.summary_fa, catalogEntry.summary_ru, lang) : '';
  const loreSummary = lore ? localizedField(lore.lore_summary, lore.lore_summary_fa, lore.lore_summary_ru, lang) : '';
  const chapterCards = lore ? [...lore.characters, ...lore.places] : [];
  const readSceneIds = new Set(progress.scenes);
  const unlockedCharacterSlugs = new Set(chapterCards.filter((c) => isCardUnlocked(c, readSceneIds)).map((c) => c.slug));
  const quizTiersPublished = {
    easy:   quizQuestions.some((q) => q.tier === 'easy'),
    medium: quizQuestions.some((q) => q.tier === 'medium'),
    hard:   quizQuestions.some((q) => q.tier === 'hard'),
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={6} />
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBack, { top: insets.top + Spacing[3] }]}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
      </TouchableOpacity>

      {!loaded ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : (
        <FlatList
          data={scenes}
          keyExtractor={(s) => s.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {!!catalogEntry?.image_url && (
                <View style={styles.heroImageWrap}>
                  <Image source={{ uri: catalogEntry.image_url }} style={styles.heroImage} resizeMode="contain" />
                </View>
              )}
              <Text style={styles.pageTitle}>{title}</Text>
              {!!summary && <Text style={styles.pageSub}>{summary}</Text>}

              {!!loreSummary && (
                <GlassCard style={styles.loreCard}>
                  <Text style={styles.loreLabel}>{t('chapterdetail.chronicleLabel')}</Text>
                  <Text style={styles.loreText}>{loreSummary}</Text>
                </GlassCard>
              )}

              {!!catalogEntry?.ferdowsi_chronicle && (
                <View style={styles.deskWrap}>
                  <FerdowsiDeskCard
                    chronicle={catalogEntry.ferdowsi_chronicle}
                    read={progress.desk_read}
                    onMarkRead={handleDeskRead}
                  />
                </View>
              )}

              {/* Cards from this chapter — Khabat, 2026-07-29: "knytt
                  kortene til historiene." */}
              {chapterCards.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>{t('chapterdetail.cardsFromChapter')}</Text>
                  <FlatList
                    data={chapterCards}
                    keyExtractor={(c) => c.slug}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.cardStrip}
                    renderItem={({ item }) => (
                      <ChapterCardChip
                        card={item}
                        unlocked={isCardUnlocked(item, readSceneIds)}
                        onPress={() => onOpenHeroes(item.slug)}
                      />
                    )}
                  />
                </>
              )}

              {scenes.length > 0 && <Text style={styles.sectionLabel}>{t('chapterdetail.scenes')}</Text>}
            </View>
          }
          renderItem={({ item }) => (
            <SceneCard
              scene={item}
              unlocked={isSceneUnlocked(item.order, progress, scenes)}
              read={readSceneIds.has(item.id)}
              onRead={() => handleSceneRead(item.id)}
            />
          )}
          ListFooterComponent={
            <View style={styles.footerWrap}>
              <ChapterQuizPanel
                slug={slug}
                telegramId={telegramId}
                progress={progress}
                onProgressChange={handleQuizProgressChange}
              />
              {!!lore?.battle && (
                <ChapterBattlePanel
                  battle={lore.battle}
                  progress={progress}
                  scenes={scenes}
                  hasDesk={!!catalogEntry?.ferdowsi_chronicle}
                  quizTiersPublished={quizTiersPublished}
                  ownedHeroes={ownedHeroes}
                  farr={farr}
                  unlockedCharacterSlugs={unlockedCharacterSlugs}
                  completing={completing}
                  onComplete={handleBattleComplete}
                />
              )}
            </View>
          }
        />
      )}

      <GoldenUnlockPopup
        card={unlockQueue[0] ?? null}
        onViewCard={handleViewUnlockedCard}
        onDismiss={dismissUnlockPopup}
      />
    </View>
  );
}

/** Compact horizontal chip for the "cards from this chapter" strip — image,
    name, lock state. Taps hand off to the real Heroes screen (own ownership/
    buy/upgrade UI) rather than duplicating it here. */
function ChapterCardChip({ card, unlocked, onPress }: {
  card: ChapterCardRef; unlocked: boolean; onPress: () => void;
}) {
  const { lang } = useT();
  const name = localizedField(card.name, card.name_fa, card.name_ru, lang);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.cardChipTouch}>
      <GlassCard style={styles.cardChip} noPadding glowColor={unlocked ? Colors.gold[400] : undefined}>
        <View style={styles.cardChipImageWrap}>
          {card.image ? (
            <Image source={{ uri: card.image }} style={styles.cardChipImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardChipImage, styles.cardChipImageFallback]} />
          )}
          {!unlocked && <View style={styles.cardChipLockOverlay}><Text style={styles.cardChipLockIcon}>🔒</Text></View>}
        </View>
        <Text style={[styles.cardChipName, !unlocked && styles.textMuted]} numberOfLines={1}>{name}</Text>
      </GlassCard>
    </TouchableOpacity>
  );
}

function SceneCard({ scene, unlocked, read, onRead }: {
  scene: ChapterScene; unlocked: boolean; read: boolean; onRead: () => void;
}) {
  const { t, lang } = useT();
  const [expanded, setExpanded] = useState(false);
  const title = localizedField(scene.title, scene.title_fa, scene.title_ru, lang);
  const body  = localizedField(scene.body, scene.body_fa, scene.body_ru, lang);

  const handlePress = () => {
    if (!unlocked) return;
    setExpanded((e) => !e);
    if (!read) onRead();
  };

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={unlocked ? 0.85 : 1} disabled={!unlocked}>
      <GlassCard style={styles.sceneCard} glowColor={read ? Colors.gold[600] : undefined}>
        <View style={styles.sceneHeaderRow}>
          <Text style={[styles.sceneTitle, !unlocked && styles.textMuted]} numberOfLines={expanded ? undefined : 1}>
            {title}
          </Text>
          {read && <Text style={styles.readBadge}>✓</Text>}
          {!unlocked && <Text style={styles.lockBadge}>🔒</Text>}
        </View>
        {!!scene.atmosphere && unlocked && (
          <Text style={styles.sceneAtmosphere} numberOfLines={expanded ? undefined : 1}>{scene.atmosphere}</Text>
        )}
        {!unlocked ? (
          <Text style={styles.lockedText}>{t('chapterdetail.readPreviousToUnlock')}</Text>
        ) : expanded ? (
          <>
            {!!scene.image && (
              <View style={styles.sceneImageWrap}>
                <Image source={{ uri: scene.image }} style={styles.sceneImage} resizeMode="contain" />
              </View>
            )}
            <Text style={styles.sceneBody}>{body}</Text>
          </>
        ) : (
          <Text style={styles.sceneBody} numberOfLines={2}>{body}</Text>
        )}
      </GlassCard>
    </TouchableOpacity>
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

  // 2026-07-28 (Khabat: "bildene ser ikke fint ut og man ser ikke hele" —
  // images don't look good, you don't see the whole thing): was
  // resizeMode="cover" in a short fixed-height box, which crops portrait
  // chapter artwork hard. "contain" inside a taller, tinted box shows the
  // full image with letterboxing that blends into the card instead of
  // hard-cropping content out.
  heroImageWrap: { width: '100%', height: 220, borderRadius: Radius.xl, marginBottom: Spacing[3], backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  heroImage: { width: '100%', height: '100%' },
  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },

  loreCard:  { marginTop: Spacing[4] },
  loreLabel: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.gold[400], textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: Spacing[2] },
  loreText:  { fontSize: 13, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 20 },

  deskWrap: { marginTop: Spacing[4] },

  sectionLabel: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[5], marginBottom: Spacing[1] },

  cardStrip:     { gap: Spacing[3], paddingVertical: Spacing[2] },
  cardChipTouch: { width: 92 },
  cardChip:      { gap: 0, overflow: 'hidden' },
  cardChipImageWrap: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  cardChipImage: { width: '100%', height: '100%' },
  cardChipImageFallback: { backgroundColor: Colors.bg.elevated },
  cardChipLockOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,9,0.55)', alignItems: 'center', justifyContent: 'center' },
  cardChipLockIcon: { fontSize: 16 },
  cardChipName: { fontSize: 11, fontFamily: Typography.family.heading, color: Colors.text.primary, paddingHorizontal: Spacing[2], paddingVertical: Spacing[2] },

  sceneCard: { gap: 0 },
  sceneHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  sceneTitle: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary, flex: 1 },
  textMuted:  { color: Colors.text.muted },
  readBadge:  { fontSize: 13, color: Colors.gold[400] },
  lockBadge:  { fontSize: 13 },

  sceneAtmosphere: { fontSize: 11, color: Colors.gold[600], fontFamily: Typography.family.body, fontStyle: 'italic', marginTop: 2 },
  lockedText: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: Spacing[2] },
  sceneBody:  { fontSize: 13, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 19, marginTop: Spacing[2] },
  sceneImageWrap: { width: '100%', height: 200, borderRadius: Radius.lg, marginTop: Spacing[2], marginBottom: Spacing[1], backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  sceneImage: { width: '100%', height: '100%' },

  footerWrap: { gap: Spacing[3], marginTop: Spacing[3] },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
