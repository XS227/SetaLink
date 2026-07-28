/**
 * RealGramHeroesScreen — native Heroes roster (`docs/realgram/TASK_SPLIT.md`
 * A→B(125) roadmap, build order item 3: Heroes).
 *
 * Catalog-only for now, by design, not by oversight: `/api/catalog/heroes`
 * is public (confirmed live, 11 heroes — heroCatalogService.ts), but which
 * heroes THIS user owns, their level, and buy/upgrade actions all live
 * behind heroes.js's `/api/season2/user/buy-hero` /`upgrade-hero`, which are
 * keyed on the telegram_id identity bridge A→B(125) is still blocked on. So
 * this reads as a browsable roster (rarity/power/bonus/unlock requirement),
 * not "my heroes" — the ownership layer slots in once that bridge lands,
 * without needing to rebuild this screen.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { getHeroCatalog, HeroCatalogEntry } from '../services/heroCatalogService';

interface Props {
  onBack: () => void;
}

function rarityColor(rarity: string): string {
  const key = rarity.toLowerCase() as keyof typeof Colors.rarity;
  return Colors.rarity[key] ?? Colors.rarity.common;
}

export function RealGramHeroesScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [heroes, setHeroes] = useState<HeroCatalogEntry[] | null>(null);
  const [error, setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    getHeroCatalog().then((list) => {
      if (cancelled) return;
      if (list.length === 0) { setError("Couldn't load the hero roster right now."); return; }
      setHeroes(list);
    }).catch(() => { if (!cancelled) setError("Couldn't load the hero roster right now."); });
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
      {!heroes ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : (
        <FlatList
          data={heroes}
          keyExtractor={(h) => h.slug}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <Text style={styles.pageTitle}>Heroes</Text>
              <Text style={styles.pageSub}>Legendary figures from the Shahnameh, ready to fight for you.</Text>
              <GlassCard style={styles.noteCard}>
                <Text style={styles.noteText}>
                  Your own collection, levels, and upgrades unlock once account linking
                  catches up — for now, here's the full roster.
                </Text>
              </GlassCard>
            </View>
          }
          renderItem={({ item }) => <HeroCard hero={item} />}
        />
      )}
    </View>
  );
}

function HeroCard({ hero }: { hero: HeroCatalogEntry }) {
  const color = rarityColor(hero.rarity);
  const locked = hero.power <= 0;
  return (
    <GlassCard style={styles.heroCard} glowColor={locked ? undefined : color}>
      <View style={styles.heroRow}>
        <View style={[styles.rarityDot, { backgroundColor: color }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.heroHeaderRow}>
            <Text style={[styles.heroName, locked && styles.textMuted]} numberOfLines={1}>{hero.name}</Text>
            <Text style={[styles.rarityLabel, { color }]}>{hero.rarity}</Text>
          </View>
          {!!hero.description && (
            <Text style={styles.heroDescription} numberOfLines={2}>{hero.description}</Text>
          )}
          <View style={styles.metaRow}>
            {!locked && (
              <Text style={styles.powerText}>⚔ {hero.power}</Text>
            )}
            {!!hero.bonus && <Text style={styles.bonusText} numberOfLines={1}>{hero.bonus}</Text>}
          </View>
          {locked && !!hero.unlock_requirement && (
            <Text style={styles.unlockText}>🔒 {hero.unlock_requirement}</Text>
          )}
        </View>
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

  heroCard: { gap: 0 },
  heroRow:  { flexDirection: 'row', gap: Spacing[3], alignItems: 'flex-start' },
  rarityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },

  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing[2] },
  heroName:      { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary, flex: 1 },
  rarityLabel:   { fontSize: 10, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  textMuted:     { color: Colors.text.muted },

  heroDescription: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 4, lineHeight: 17 },

  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginTop: Spacing[2], flexWrap: 'wrap' },
  powerText:  { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.mono },
  bonusText:  { fontSize: 11, color: Colors.text.secondary, fontFamily: Typography.family.body },
  unlockText: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: Spacing[2] },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
