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
  ActivityIndicator, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View,
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
  // 2026-07-28 (Khabat: "3 ved siden av hverandre... trykk for å få opp
  // info og valg, slik vi hadde det på Shahnameh"): matches season2/
  // heroes.js's own coll-card grid + certificate-modal pattern — a compact
  // grid card that opens a detail sheet on tap, instead of every card
  // showing its full description/buy button inline in a single column.
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

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
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
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
              <HeroGridCard
                hero={item}
                owned={ownedHero}
                prereqMet={prereqMet}
                onPress={() => setSelectedSlug(item.slug)}
              />
            );
          }}
        />
      )}

      {/* Detail sheet (Khabat, 2026-07-28: "nok info og valg, slik vi hadde
          det på Shahnameh") — same purpose as season2/heroes.js's
          certificate-of-discovery modal: full description, rate, unlock
          state, and the buy/upgrade action, without cluttering the grid. */}
      <Modal
        visible={selectedSlug !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedSlug(null)}
      >
        {(() => {
          const hero = heroes?.find((h) => h.slug === selectedSlug);
          if (!hero) return null;
          const ownedHero = owned.get(hero.slug);
          const prereqMet = !hero.prereq || (() => {
            const p = owned.get(hero.prereq!.hero_id);
            return !!p && p.level >= hero.prereq!.level;
          })();
          return (
            <View style={styles.sheetOverlay}>
              <TouchableOpacity style={styles.sheetBackdrop} onPress={() => setSelectedSlug(null)} activeOpacity={1} />
              <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing[5] }]}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <HeroDetail
                    hero={hero}
                    owned={ownedHero}
                    prereqMet={prereqMet}
                    pending={pendingSlug === hero.slug}
                    onBuy={() => handleBuy(hero)}
                    onUpgrade={() => handleUpgrade(hero)}
                  />
                </ScrollView>
                <TouchableOpacity onPress={() => setSelectedSlug(null)} style={styles.sheetCloseBtn} activeOpacity={0.85}>
                  <Text style={styles.sheetCloseBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}
      </Modal>
    </View>
  );
}

/** Compact 3-column grid card — image/rarity dot, name, one status line
    (locked / owned level / price). Tap opens the full HeroDetail sheet. */
function HeroGridCard({
  hero, owned, prereqMet, onPress,
}: {
  hero: HeroCatalogEntry; owned?: OwnedHero; prereqMet: boolean; onPress: () => void;
}) {
  const color = rarityColor(hero.rarity);
  const locked = !owned && !prereqMet;
  const statusLine = owned
    ? `Lv. ${owned.level}`
    : prereqMet
      ? `${hero.cost} REAL`
      : '🔒 Locked';
  return (
    <TouchableOpacity style={styles.gridCardTouch} onPress={onPress} activeOpacity={0.85}>
      <GlassCard style={styles.gridCard} glowColor={owned ? color : undefined} noPadding>
        <View style={styles.gridImageWrap}>
          {hero.image_url ? (
            <Image source={{ uri: hero.image_url }} style={styles.gridImage} resizeMode="cover" />
          ) : (
            <View style={[styles.gridImage, styles.gridImageFallback]}>
              <View style={[styles.rarityDot, { backgroundColor: color }]} />
            </View>
          )}
          {locked && <View style={styles.gridLockOverlay}><Text style={styles.gridLockIcon}>🔒</Text></View>}
        </View>
        <Text style={[styles.gridName, locked && styles.textMuted]} numberOfLines={1}>{hero.name}</Text>
        <Text style={[styles.gridStatus, { color: owned ? color : Colors.text.muted }]} numberOfLines={1}>{statusLine}</Text>
      </GlassCard>
    </TouchableOpacity>
  );
}

/** Full detail content shown inside the modal sheet — same information the
    old single-column card used to show inline, just moved into the tap
    target instead of always-visible. */
function HeroDetail({
  hero, owned, prereqMet, pending, onBuy, onUpgrade,
}: {
  hero: HeroCatalogEntry; owned?: OwnedHero; prereqMet: boolean; pending: boolean;
  onBuy: () => void; onUpgrade: () => void;
}) {
  const color = rarityColor(hero.rarity);
  return (
    <View style={{ gap: Spacing[3] }}>
      <View style={styles.detailImageWrap}>
        {hero.image_url ? (
          <Image source={{ uri: hero.image_url }} style={styles.detailImage} resizeMode="cover" />
        ) : (
          <View style={[styles.detailImage, styles.gridImageFallback]}>
            <View style={[styles.rarityDot, { backgroundColor: color, width: 20, height: 20, borderRadius: 10 }]} />
          </View>
        )}
      </View>
      <View style={styles.heroHeaderRow}>
        <Text style={styles.detailName}>{hero.name}</Text>
        <Text style={[styles.rarityLabel, { color }]}>{hero.rarity}</Text>
      </View>
      {!!hero.description && <Text style={styles.heroDescription}>{hero.description}</Text>}
      <View style={styles.metaRow}>
        <Text style={styles.zarText}>🪙 {owned ? owned.zar_per_hour : hero.zar_per_hour} ZAR/hr</Text>
        {owned && <Text style={styles.levelText}>Lv. {owned.level}</Text>}
      </View>
      {!owned && !prereqMet && !!hero.unlock_requirement && (
        <Text style={styles.unlockText}>🔒 {hero.unlock_requirement}</Text>
      )}
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

  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[3] },

  gridRow:  { gap: Spacing[3] },
  gridCardTouch: { flex: 1 / 3 },
  gridCard: { gap: 0, overflow: 'hidden' },
  gridImageWrap: { width: '100%', aspectRatio: 1 },
  gridImage: { width: '100%', height: '100%' },
  gridImageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.elevated },
  gridLockOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,9,0.55)', alignItems: 'center', justifyContent: 'center' },
  gridLockIcon: { fontSize: 18 },
  gridName:   { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.text.primary, paddingHorizontal: Spacing[2], paddingTop: Spacing[2] },
  gridStatus: { fontSize: 10, fontFamily: Typography.family.mono, paddingHorizontal: Spacing[2], paddingBottom: Spacing[2], paddingTop: 2 },

  rarityDot: { width: 10, height: 10, borderRadius: 5 },

  detailImageWrap: { width: '100%', height: 220, borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.bg.elevated },
  detailImage: { width: '100%', height: '100%' },
  detailName:  { fontSize: 20, fontFamily: Typography.family.heading, color: Colors.text.primary, flex: 1 },

  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing[2] },
  rarityLabel:   { fontSize: 10, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  textMuted:     { color: Colors.text.muted },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,9,0.65)' },
  sheet: { maxHeight: '82%', backgroundColor: Colors.bg.base, borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'], padding: Spacing[5] },
  sheetCloseBtn: { marginTop: Spacing[3], alignItems: 'center', paddingVertical: Spacing[2] },
  sheetCloseBtnText: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.muted },

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
