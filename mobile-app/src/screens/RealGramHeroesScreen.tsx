/**
 * RealGramHeroesScreen — native Heroes roster with real ownership, buy,
 * and upgrade (`docs/realgram/TASK_SPLIT.md` A→B(125) roadmap item 3).
 *
 * Was catalog-only (browse) since the public catalog itself was wrong —
 * 11 stale placeholder entries, only 1 slug ('rakhsh') existed anywhere in
 * the real game (A→B(135)/B→A(136)). Backend catalog rebuilt from the
 * real 33-hero data (heroCatalogService.ts's header has the full story);
 * now that the data is trustworthy, ownership/buy/upgrade wire to the
 * telegram_id bridge (B->A(132)) the same way Clan join/apply does.
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
import {
  getHeroCatalog, getOwnedHeroes, buyHero, upgradeHero,
  HeroCatalogEntry, OwnedHero,
} from '../services/heroCatalogService';

interface Props {
  onBack: () => void;
}

const RARITY_ALIAS: Record<string, string> = { legend: 'legendary' };

function rarityColor(rarity: string): string {
  const key = rarity.toLowerCase();
  const normalized = (RARITY_ALIAS[key] ?? key) as keyof typeof Colors.rarity;
  return Colors.rarity[normalized] ?? Colors.rarity.common;
}

const BUY_ERROR_COPY: Record<string, string> = {
  already_owned:        'You already own this.',
  prereq_not_met:        "You don't meet the requirement yet.",
  insufficient_balance:  'Not enough REAL.',
  unknown_hero:           'Something went wrong — try again.',
  not_owned:              "You don't own this yet.",
  network_error:          "Couldn't reach the server — try again.",
};

export function RealGramHeroesScreen({ onBack }: Props) {
  const insets    = useSafeAreaInsets();
  const deviceId  = useAuthStore((s) => s.user?.deviceId ?? '');
  const showToast = useToastStore((s) => s.show);

  const [heroes, setHeroes]         = useState<HeroCatalogEntry[] | null>(null);
  const [owned, setOwned]           = useState<Map<string, OwnedHero>>(new Map());
  const [telegramId, setTelegramId] = useState('');
  const [error, setError]           = useState('');
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const tid = deviceId ? (await getSsoToken(deviceId, true)).telegram_id : '';
      setTelegramId(tid);
      const [catalog, mine] = await Promise.all([getHeroCatalog(), getOwnedHeroes(tid)]);
      if (catalog.length === 0) { setError("Couldn't load the hero roster right now."); return; }
      setHeroes(catalog);
      setOwned(mine);
    } catch {
      setError("Couldn't load the hero roster right now.");
    }
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  const handleBuy = useCallback(async (hero: HeroCatalogEntry) => {
    if (!telegramId) { showToast("Couldn't identify your account — try again shortly.", 'error'); return; }
    setPendingSlug(hero.slug);
    const result = await buyHero(telegramId, hero.slug);
    setPendingSlug(null);
    if (result.ok) {
      showToast(`${hero.name} acquired!`, 'success');
      setOwned((prev) => new Map(prev).set(hero.slug, { hero_id: hero.slug, level: result.data.level, zar_per_hour: result.data.zar_per_hour }));
    } else {
      showToast(BUY_ERROR_COPY[result.error] ?? 'Could not buy. Try again.', 'error');
    }
  }, [telegramId, showToast]);

  const handleUpgrade = useCallback(async (hero: HeroCatalogEntry) => {
    if (!telegramId) return;
    setPendingSlug(hero.slug);
    const result = await upgradeHero(telegramId, hero.slug);
    setPendingSlug(null);
    if (result.ok) {
      showToast(`${hero.name} upgraded to level ${result.data.level}!`, 'success');
      setOwned((prev) => new Map(prev).set(hero.slug, { hero_id: hero.slug, level: result.data.level, zar_per_hour: result.data.zar_per_hour }));
    } else {
      showToast(BUY_ERROR_COPY[result.error] ?? 'Could not upgrade. Try again.', 'error');
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
              <Text style={styles.pageSub}>Legendary figures, artifacts, and creatures — own them for passive ZAR income.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const ownedHero = owned.get(item.slug);
            const prereqMet = !item.prereq || (() => {
              const p = owned.get(item.prereq!.hero_id);
              return !!p && p.level >= item.prereq!.level;
            })();
            return (
              <HeroCard
                hero={item}
                owned={ownedHero}
                prereqMet={prereqMet}
                pending={pendingSlug === item.slug}
                onBuy={() => handleBuy(item)}
                onUpgrade={() => handleUpgrade(item)}
              />
            );
          }}
        />
      )}
    </View>
  );
}

function HeroCard({
  hero, owned, prereqMet, pending, onBuy, onUpgrade,
}: {
  hero: HeroCatalogEntry; owned?: OwnedHero; prereqMet: boolean; pending: boolean;
  onBuy: () => void; onUpgrade: () => void;
}) {
  const color = rarityColor(hero.rarity);
  const locked = !owned && !prereqMet;
  return (
    <GlassCard style={styles.heroCard} glowColor={owned ? color : undefined}>
      <View style={styles.heroRow}>
        {hero.image_url ? (
          <Image source={{ uri: hero.image_url }} style={styles.heroImage} />
        ) : (
          <View style={[styles.rarityDot, { backgroundColor: color }]} />
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.heroHeaderRow}>
            <Text style={[styles.heroName, locked && styles.textMuted]} numberOfLines={1}>{hero.name}</Text>
            <Text style={[styles.rarityLabel, { color }]}>{hero.rarity}</Text>
          </View>
          {!!hero.description && (
            <Text style={styles.heroDescription} numberOfLines={2}>{hero.description}</Text>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.zarText}>🪙 {owned ? owned.zar_per_hour : hero.zar_per_hour} ZAR/hr</Text>
            {owned && <Text style={styles.levelText}>Lv. {owned.level}</Text>}
          </View>
          {!owned && !prereqMet && !!hero.unlock_requirement && (
            <Text style={styles.unlockText}>🔒 {hero.unlock_requirement}</Text>
          )}
        </View>
      </View>
      <TouchableOpacity
        onPress={owned ? onUpgrade : onBuy}
        disabled={pending || (!owned && !prereqMet)}
        style={[styles.actionBtn, (pending || (!owned && !prereqMet)) && styles.actionBtnDisabled]}
        activeOpacity={0.85}
      >
        {pending
          ? <ActivityIndicator size="small" color={Colors.bg.void} />
          : <Text style={styles.actionBtnText}>{owned ? `Upgrade — ${hero.cost * owned.level} REAL` : `Buy — ${hero.cost} REAL`}</Text>}
      </TouchableOpacity>
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

  heroCard: { gap: Spacing[3] },
  heroRow:  { flexDirection: 'row', gap: Spacing[3], alignItems: 'flex-start' },
  heroImage: { width: 44, height: 44, borderRadius: 10 },
  rarityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },

  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing[2] },
  heroName:      { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary, flex: 1 },
  rarityLabel:   { fontSize: 10, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  textMuted:     { color: Colors.text.muted },

  heroDescription: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 4, lineHeight: 17 },

  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginTop: Spacing[2], flexWrap: 'wrap' },
  zarText:    { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.mono },
  levelText:  { fontSize: 11, color: Colors.text.secondary, fontFamily: Typography.family.body },
  unlockText: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: Spacing[2] },

  actionBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], alignItems: 'center' },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.bg.void },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
