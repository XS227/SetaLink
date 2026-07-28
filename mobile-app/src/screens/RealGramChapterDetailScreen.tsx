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
import { getChapterCatalog, ChapterCatalogEntry } from '../services/chapterCatalogService';
import { getChapterLore, ChapterLore, ChapterScene } from '../services/chapterLoreService';
import { getReadSceneIds, markSceneRead, isSceneUnlocked } from '../services/chapterProgressStore';

interface Props {
  slug: string;
  onBack: () => void;
}

export function RealGramChapterDetailScreen({ slug, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [catalogEntry, setCatalogEntry] = useState<ChapterCatalogEntry | null>(null);
  const [lore, setLore]           = useState<ChapterLore | null>(null);
  const [readIds, setReadIds]     = useState<Set<string>>(() => getReadSceneIds(slug));
  const [error, setError]         = useState('');
  const [loaded, setLoaded]       = useState(false);
  const [showFullEmbed, setShowFullEmbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getChapterCatalog(), getChapterLore(slug)]).then(([catalog, loreResult]) => {
      if (cancelled) return;
      const entry = catalog.find((c) => c.slug === slug) ?? null;
      if (!entry && !loreResult) { setError("Couldn't load this chapter right now."); setLoaded(true); return; }
      setCatalogEntry(entry);
      setLore(loreResult);
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) { setError("Couldn't load this chapter right now."); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [slug]);

  const handleSceneRead = useCallback((sceneId: string) => {
    setReadIds(markSceneRead(slug, sceneId));
  }, [slug]);

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
          <Text style={styles.backBtnFallbackText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const scenes = lore?.scenes ?? [];

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
                <Image source={{ uri: catalogEntry.image_url }} style={styles.heroImage} resizeMode="cover" />
              )}
              <Text style={styles.pageTitle}>{catalogEntry?.title ?? lore?.slug}</Text>
              {!!catalogEntry?.summary && <Text style={styles.pageSub}>{catalogEntry.summary}</Text>}

              {!!lore?.lore_summary && (
                <GlassCard style={styles.loreCard}>
                  <Text style={styles.loreLabel}>The Chronicle</Text>
                  <Text style={styles.loreText}>{lore.lore_summary}</Text>
                </GlassCard>
              )}

              {scenes.length > 0 && <Text style={styles.sectionLabel}>Scenes</Text>}
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
                <Text style={styles.continueTitle}>Continue to Quiz &amp; Battle</Text>
                <Text style={styles.continueSub}>Test what you've learned and face this chapter's challenge.</Text>
              </GlassCard>
            </TouchableOpacity>
          }
        />
      )}
    </View>
  );
}

function SceneCard({ scene, unlocked, read, onRead }: {
  scene: ChapterScene; unlocked: boolean; read: boolean; onRead: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

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
            {scene.title}
          </Text>
          {read && <Text style={styles.readBadge}>✓</Text>}
          {!unlocked && <Text style={styles.lockBadge}>🔒</Text>}
        </View>
        {!!scene.atmosphere && unlocked && (
          <Text style={styles.sceneAtmosphere} numberOfLines={expanded ? undefined : 1}>{scene.atmosphere}</Text>
        )}
        {!unlocked ? (
          <Text style={styles.lockedText}>Read the previous scene to unlock.</Text>
        ) : expanded ? (
          <>
            {!!scene.image && (
              <Image source={{ uri: scene.image }} style={styles.sceneImage} resizeMode="cover" />
            )}
            <Text style={styles.sceneBody}>{scene.body}</Text>
          </>
        ) : (
          <Text style={styles.sceneBody} numberOfLines={2}>{scene.body}</Text>
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

  heroImage: { width: '100%', height: 160, borderRadius: Radius.xl, marginBottom: Spacing[3] },
  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },

  loreCard:  { marginTop: Spacing[4] },
  loreLabel: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.gold[400], textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: Spacing[2] },
  loreText:  { fontSize: 13, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 20 },

  sectionLabel: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[5], marginBottom: Spacing[1] },

  sceneCard: { gap: 0 },
  sceneHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  sceneTitle: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary, flex: 1 },
  textMuted:  { color: Colors.text.muted },
  readBadge:  { fontSize: 13, color: Colors.gold[400] },
  lockBadge:  { fontSize: 13 },

  sceneAtmosphere: { fontSize: 11, color: Colors.gold[600], fontFamily: Typography.family.body, fontStyle: 'italic', marginTop: 2 },
  lockedText: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: Spacing[2] },
  sceneBody:  { fontSize: 13, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 19, marginTop: Spacing[2] },
  sceneImage: { width: '100%', height: 140, borderRadius: Radius.lg, marginTop: Spacing[2], marginBottom: Spacing[1] },

  continueCard:  { marginTop: Spacing[3], alignItems: 'center' },
  continueTitle: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  continueSub:   { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 4, textAlign: 'center' },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
