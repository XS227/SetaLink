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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, Vibration, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useT } from '../i18n';
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

function buyErrorCopy(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'already_owned':       return t('heroes.errAlreadyOwned');
    case 'prereq_not_met':      return t('heroes.errPrereqNotMet');
    case 'insufficient_balance':return t('heroes.errInsufficientBalance');
    case 'unknown_hero':        return t('heroes.errUnknownHero');
    case 'not_owned':           return t('heroes.errNotOwned');
    case 'network_error':       return t('heroes.errNetwork');
    default:                    return '';
  }
}

export function RealGramHeroesScreen({ onBack }: Props) {
  const insets    = useSafeAreaInsets();
  const { t } = useT();
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
  // Khabat, 2026-07-29: "følelsen av å ha betalt ... får jeg ikke" on
  // upgrade — a real state change with no felt weight. Bumped on every
  // successful buy/upgrade to key <CoinBurst>, which re-triggers its
  // animation each time even if the previous run already finished.
  const [spendBurst, setSpendBurst] = useState(0);

  const load = useCallback(async () => {
    try {
      const tid = deviceId ? (await getSsoToken(deviceId, true)).telegram_id : '';
      setTelegramId(tid);
      const [catalog, mine] = await Promise.all([getHeroCatalog(), getOwnedHeroes(tid)]);
      if (catalog.length === 0) { setError(t('heroes.loadError')); return; }
      setHeroes(catalog);
      setOwned(mine);
    } catch {
      setError(t('heroes.loadError'));
    }
  }, [deviceId, t]);

  useEffect(() => { load(); }, [load]);

  const handleBuy = useCallback(async (hero: HeroCatalogEntry) => {
    if (!telegramId) { showToast(t('heroes.identifyError'), 'error'); return; }
    setPendingSlug(hero.slug);
    const result = await buyHero(telegramId, hero.slug);
    setPendingSlug(null);
    if (result.ok) {
      showToast(t('heroes.acquired').replace('{name}', hero.name), 'success');
      setOwned((prev) => new Map(prev).set(hero.slug, { hero_id: hero.slug, level: result.data.level, zar_per_hour: result.data.zar_per_hour }));
      Vibration.vibrate(SPEND_HAPTIC);
      setSpendBurst((n) => n + 1);
    } else {
      showToast(buyErrorCopy(result.error, t) || t('heroes.errBuyGeneric'), 'error');
    }
  }, [telegramId, showToast, t]);

  const handleUpgrade = useCallback(async (hero: HeroCatalogEntry) => {
    if (!telegramId) return;
    setPendingSlug(hero.slug);
    const result = await upgradeHero(telegramId, hero.slug);
    setPendingSlug(null);
    if (result.ok) {
      showToast(t('heroes.upgraded').replace('{name}', hero.name).replace('{level}', String(result.data.level)), 'success');
      setOwned((prev) => new Map(prev).set(hero.slug, { hero_id: hero.slug, level: result.data.level, zar_per_hour: result.data.zar_per_hour }));
      Vibration.vibrate(SPEND_HAPTIC);
      setSpendBurst((n) => n + 1);
    } else {
      showToast(buyErrorCopy(result.error, t) || t('heroes.errUpgradeGeneric'), 'error');
    }
  }, [telegramId, showToast, t]);

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
              <Text style={styles.pageTitle}>{t('heroes.title')}</Text>
              <Text style={styles.pageSub}>{t('heroes.subtitle')}</Text>
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
                    spendBurst={spendBurst}
                    onBuy={() => handleBuy(hero)}
                    onUpgrade={() => handleUpgrade(hero)}
                  />
                </ScrollView>
                <TouchableOpacity onPress={() => setSelectedSlug(null)} style={styles.sheetCloseBtn} activeOpacity={0.85}>
                  <Text style={styles.sheetCloseBtnText}>{t('heroes.close')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}
      </Modal>
    </View>
  );
}

// Khabat, 2026-07-29: haptic for "you just spent coins" on a successful
// buy/upgrade — distinct from every other haptic in the app (single tap
// elsewhere, the long ring pattern in callStore.ts) so a spend reads as
// its own, deliberate thing eyes-free. No audio asset/native sound
// dependency exists anywhere in this app yet (checked) — a real "cha-ching"
// SFX needs both a new native module (expo-av/react-native-sound) and an
// actual sound file supplied by design/audio, not something to improvise
// blind in this pass. Vibration + the CoinBurst animation below are the
// real, working half of that ask in the meantime.
const SPEND_HAPTIC = [0, 30, 40, 60];

// Bottom scrim so a card's name/status text stays legible over any image,
// and the card reads as a "poster" rather than a flat thumbnail — cheap
// cinematic cue reused from GlassCard's own CarvedOverlay technique
// (react-native-svg gradient, no new dependency).
function ImageScrim({ width, height }: { width: number; height: number }) {
  if (!width || !height) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Defs>
        <SvgLinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
          <Stop offset="60%" stopColor="#000000" stopOpacity={0} />
          <Stop offset="100%" stopColor="#0A0A0E" stopOpacity={0.85} />
        </SvgLinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#scrim)" />
    </Svg>
  );
}

// Khabat, 2026-07-29: "en kreativ måte hvor mye ZAR den skaper pr time" —
// a glanceable yield badge on the card itself, not just buried in the
// detail sheet. Gold pill so it reads as a value/rate indicator at a
// glance, same visual language as the rest of the gold theme.
function YieldBadge({ rate }: { rate: number }) {
  return (
    <View style={styles.yieldBadge}>
      <Text style={styles.yieldBadgeText}>🪙 {rate}/h</Text>
    </View>
  );
}

// Khabat, 2026-07-29: "følelsen av å ha betalt ... får jeg ikke" — a small
// coin that pops and rises off the action button on a successful spend,
// same spirit as the CTA-button->shop idea, simplified to something safe
// to ship unverified (no cross-screen coordinate math to get wrong).
function CoinBurst({ trigger }: { trigger: number }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity     = useRef(new Animated.Value(0)).current;
  const scale       = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (trigger === 0) return;
    translateY.setValue(0);
    opacity.setValue(1);
    scale.setValue(0.6);
    Animated.parallel([
      Animated.timing(translateY, { toValue: -56, duration: 700, useNativeDriver: true }),
      Animated.timing(scale,      { toValue: 1.15, duration: 220, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  if (trigger === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.coinBurst, { opacity, transform: [{ translateY }, { scale }] }]}
    >
      <Text style={styles.coinBurstText}>🪙</Text>
    </Animated.View>
  );
}

/** Compact 3-column grid card — image/rarity dot, name, one status line
    (locked / owned level / price). Tap opens the full HeroDetail sheet. */
function HeroGridCard({
  hero, owned, prereqMet, onPress,
}: {
  hero: HeroCatalogEntry; owned?: OwnedHero; prereqMet: boolean; onPress: () => void;
}) {
  const { t } = useT();
  const color = rarityColor(hero.rarity);
  const locked = !owned && !prereqMet;
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const statusLine = owned
    ? t('heroes.levelShort').replace('{level}', String(owned.level))
    : prereqMet
      ? t('heroes.priceReal').replace('{cost}', String(hero.cost))
      : `🔒 ${t('heroes.locked')}`;
  return (
    <TouchableOpacity style={styles.gridCardTouch} onPress={onPress} activeOpacity={0.85}>
      {/* Cinematic glassy-gold treatment (Khabat, 2026-07-29): a subtle gold
          glow on every card, not just owned ones, so the whole roster reads
          as valuable collectibles rather than only the ones already bought. */}
      <GlassCard style={styles.gridCard} glowColor={owned ? color : Colors.gold[400]} noPadding>
        <View
          style={styles.gridImageWrap}
          onLayout={(e) => setImgSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        >
          {hero.image_url ? (
            <Image source={{ uri: hero.image_url }} style={styles.gridImage} resizeMode="cover" />
          ) : (
            <View style={[styles.gridImage, styles.gridImageFallback]}>
              <View style={[styles.rarityDot, { backgroundColor: color }]} />
            </View>
          )}
          <ImageScrim width={imgSize.width} height={imgSize.height} />
          <YieldBadge rate={owned ? owned.zar_per_hour : hero.zar_per_hour} />
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
  hero, owned, prereqMet, pending, spendBurst, onBuy, onUpgrade,
}: {
  hero: HeroCatalogEntry; owned?: OwnedHero; prereqMet: boolean; pending: boolean; spendBurst: number;
  onBuy: () => void; onUpgrade: () => void;
}) {
  const { t } = useT();
  const color = rarityColor(hero.rarity);
  return (
    <View style={{ gap: Spacing[3] }}>
      {/* Khabat, 2026-07-29: "noen bilder er liggende og noen er stående...
          bilde [må] ikke bli kutta" — was a fixed-height box on
          resizeMode="cover", which crops portrait images hard. `contain`
          guarantees the full image always shows, letterboxed on whichever
          axis doesn't match; the gold-tinted backdrop below makes that
          letterboxing look like a designed mat, not empty space. */}
      <View style={styles.detailImageWrap}>
        {hero.image_url ? (
          <>
            <View style={styles.detailImageBackdrop} />
            <Image source={{ uri: hero.image_url }} style={styles.detailImage} resizeMode="contain" />
          </>
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
        <Text style={styles.zarText}>🪙 {t('heroes.zarPerHour').replace('{rate}', String(owned ? owned.zar_per_hour : hero.zar_per_hour))}</Text>
        {owned && <Text style={styles.levelText}>{t('heroes.levelShort').replace('{level}', String(owned.level))}</Text>}
      </View>
      {!owned && !prereqMet && !!hero.unlock_requirement && (
        <Text style={styles.unlockText}>🔒 {hero.unlock_requirement}</Text>
      )}
      <View style={styles.actionBtnWrap}>
        <TouchableOpacity
          onPress={owned ? onUpgrade : onBuy}
          disabled={pending || (!owned && !prereqMet)}
          style={[styles.actionBtn, (pending || (!owned && !prereqMet)) && styles.actionBtnDisabled]}
          activeOpacity={0.85}
        >
          {pending
            ? <ActivityIndicator size="small" color={Colors.bg.void} />
            : <Text style={styles.actionBtnText}>
                {owned
                  ? t('heroes.upgradeAction').replace('{cost}', String(hero.cost * owned.level))
                  : t('heroes.buyAction').replace('{cost}', String(hero.cost))}
              </Text>}
        </TouchableOpacity>
        <CoinBurst trigger={spendBurst} />
      </View>
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
  gridImageWrap: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  gridImage: { width: '100%', height: '100%' },
  gridImageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.elevated },
  gridLockOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,9,0.55)', alignItems: 'center', justifyContent: 'center' },
  gridLockIcon: { fontSize: 18 },
  gridName:   { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.text.primary, paddingHorizontal: Spacing[2], paddingTop: Spacing[2] },
  gridStatus: { fontSize: 10, fontFamily: Typography.family.mono, paddingHorizontal: Spacing[2], paddingBottom: Spacing[2], paddingTop: 2 },

  // Value/yield badge overlaid on each grid card's image, bottom-left —
  // "how much ZAR this generates per hour," visible without opening the
  // detail sheet (Khabat, 2026-07-29).
  yieldBadge: {
    position: 'absolute', left: Spacing[2], bottom: Spacing[2],
    backgroundColor: 'rgba(10,8,2,0.72)', borderRadius: Radius.md,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.5)',
    paddingHorizontal: Spacing[2], paddingVertical: 2,
  },
  yieldBadgeText: { fontSize: 10, fontFamily: Typography.family.mono, color: Colors.gold[300] },

  rarityDot: { width: 10, height: 10, borderRadius: 5 },

  detailImageWrap: {
    width: '100%', height: 240, borderRadius: Radius.xl, overflow: 'hidden',
    backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center',
  },
  // Gold-tinted mat behind a `contain`-mode image — so a portrait image
  // that doesn't fill the width still looks intentionally framed rather
  // than sitting on empty space either side (Khabat, 2026-07-29).
  detailImageBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(212,175,55,0.06)',
  },
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

  actionBtnWrap: { position: 'relative' },
  actionBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], alignItems: 'center' },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.bg.void },
  coinBurst: { position: 'absolute', alignSelf: 'center', top: -8 },
  coinBurstText: { fontSize: 22 },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
