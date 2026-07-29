/**
 * RealGramChapterDetailScreen — native chapter reading page
 * (`docs/realgram/TASK_SPLIT.md` A→B(124), Khabat: "prikk lik shahnameh
 * men i realgram"). Replaces the old ChapterDetailScreen's full-chapter
 * WebView embed with a native hero + lore/chronicle + scene reader —
 * the "core reading experience" slice Agent A suggested building first.
 *
 * Deliberately NOT in scope here (follow-up, per the agreed (124)/(125)
 * slicing): Ferdowsi's Desk, the boss/battle requirements list, and the
 * 3-tier quiz — all still genuinely interactive, server-tracked gameplay
 * (season2/user/quiz/*), not just reading. Those stay in the WebView for
 * now via the "Continue in Shahnameh" card at the end of the scene list,
 * so the full loop (read → quiz → reward) still works end-to-end while
 * quiz/battle get their own native pass later.
 *
 * Scene unlock state is a local reading gate (mirrors chapter.js's own
 * localStorage-only progress, not server state) — see
 * chapterProgressStore.ts.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { ShahnamehEmbed } from '../components/ShahnamehEmbed';
import { GoldenUnlockPopup } from '../components/GoldenUnlockPopup';
import { useT } from '../i18n';
import { localizedField } from '../utils/localizedField';
import { getChapterCatalog, ChapterCatalogEntry } from '../services/chapterCatalogService';
import {
  getChapterLore, ChapterLore, ChapterScene, ChapterCardRef,
  isCardUnlocked, cardsUnlockedBySceneRead,
} from '../services/chapterLoreService';
import { getReadSceneIds, markSceneRead, isSceneUnlocked } from '../services/chapterProgressStore';

interface Props {
  slug: string;
  onBack: () => void;
  // Deep-links into RealGramHeroesScreen at a specific card — used both by
  // the "Cards from this chapter" section and GoldenUnlockPopup's CTA
  // (2026-07-29, "knytt kortene til historiene").
  onOpenHeroes: (cardSlug: string) => void;
}

export function RealGramChapterDetailScreen({ slug, onBack, onOpenHeroes }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang, isRTL } = useT();
  const [catalogEntry, setCatalogEntry] = useState<ChapterCatalogEntry | null>(null);
  const [lore, setLore]           = useState<ChapterLore | null>(null);
  const [readIds, setReadIds]     = useState<Set<string>>(() => getReadSceneIds(slug));
  const [error, setError]         = useState('');
  const [loaded, setLoaded]       = useState(false);
  const [showFullEmbed, setShowFullEmbed] = useState(false);
  // Golden "card unlocked" popup queue — a single scene can gate more than
  // one card (rare in the source data, but handle it rather than drop it).
  const [unlockQueue, setUnlockQueue] = useState<ChapterCardRef[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getChapterCatalog(), getChapterLore(slug)]).then(([catalog, loreResult]) => {
      if (cancelled) return;
      const entry = catalog.find((c) => c.slug === slug) ?? null;
      if (!entry && !loreResult) { setError(t('chapterdetail.loadError')); setLoaded(true); return; }
      setCatalogEntry(entry);
      setLore(loreResult);
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) { setError(t('chapterdetail.loadError')); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [slug, t]);

  const handleSceneRead = useCallback((sceneId: string) => {
    // Khabat, 2026-07-29: "når en er ferdig med det han skal på hver
    // kapitel så kommer en golden popup opp at kort x er nå tilgjengelig
    // for mining/oppgradering" — check BEFORE updating readIds, so a card
    // already unlocked by an earlier scene doesn't re-trigger the popup.
    if (lore) {
      const newlyUnlocked = cardsUnlockedBySceneRead(lore, sceneId, readIds);
      if (newlyUnlocked.length > 0) setUnlockQueue((q) => [...q, ...newlyUnlocked]);
    }
    setReadIds(markSceneRead(slug, sceneId));
  }, [slug, lore, readIds]);

  const dismissUnlockPopup = useCallback(() => {
    setUnlockQueue((q) => q.slice(1));
  }, []);

  const handleViewUnlockedCard = useCallback((cardSlug: string) => {
    setUnlockQueue((q) => q.slice(1));
    onOpenHeroes(cardSlug);
  }, [onOpenHeroes]);

  if (showFullEmbed) {
    return (
      <ShahnamehEmbed
        path="/chapter.html"
        params={{ slug }}
        debugLabel="chapter-quiz"
        onBack={() => setShowFullEmbed(false)}
      />
    );
  }

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

              {/* Cards from this chapter — Khabat, 2026-07-29: "knytt
                  kortene til historiene." Same characters[]/places[] data
                  chapter.js's own battle-requirement gating already reads
                  (chapterLoreService.ts header has the full story); shown
                  here as a compact strip that hands off to the real
                  ownership/buy UI in Heroes rather than duplicating it. */}
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
                        unlocked={isCardUnlocked(item, readIds)}
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
              unlocked={isSceneUnlocked(item.order, readIds, scenes)}
              read={readIds.has(item.id)}
              onRead={() => handleSceneRead(item.id)}
            />
          )}
          ListFooterComponent={
            <TouchableOpacity onPress={() => setShowFullEmbed(true)} activeOpacity={0.85}>
              <GlassCard style={styles.continueCard} glowColor={Colors.gold[400]}>
                <Text style={styles.continueTitle}>{t('chapterdetail.continueQuiz')}</Text>
                <Text style={styles.continueSub}>{t('chapterdetail.continueQuizSub')}</Text>
              </GlassCard>
            </TouchableOpacity>
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

  continueCard:  { marginTop: Spacing[3], alignItems: 'center' },
  continueTitle: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  continueSub:   { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 4, textAlign: 'center' },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
