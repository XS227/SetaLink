/**
 * TreasuryChest (Skattkammer) — Game 4, new 2026-08-03, server-authoritative
 * (shahnameh-backend POST /season2/user/treasury-open). Khabat: "legg til
 * flere casino spill og sy det sammen med shahnameh historie og items. for
 * eksempel gorze rostam, hesten hans, kamane arash etc.. de skal bli til
 * et casino reward type spill som er fin visualisert som gardoon
 * prosjektet" — confirmed via AskUserQuestion as its own dedicated relic
 * game (not folded into SimorghsFeather's chapter-card pool), spanning the
 * whole Shahnameh rather than just Haft Khan, in RealGram's own gold/
 * violet visual language rather than a literal copy of the Gardoon
 * reference's brass roulette wheel.
 *
 * Ten hand-authored relics (lib/treasuryCatalog.js on the backend) --
 * neither chapters.json nor heroes.json has an entry for Rostam's mace or
 * Arash's bow, confirmed by direct search 2026-08-03 -- so this catalog is
 * genuinely new content, grounded in this repo's own
 * docs/shahnameh-knowledge/ scholarship rather than invented. Presentation
 * is icon+gradient, not a photo, same visual language DailyLuckWheel/
 * SlotMachine already use -- these relics have no hosted art the way the
 * haft-khan/chapter-card photos do.
 *
 * Same discipline as every other game here: single call, the server draws
 * the relic AND applies the stake/duplicate-payout atomically before this
 * component does anything -- the chest-opening animation is cosmetic only.
 */

import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { openTreasury, TreasuryStakeCurrency } from '../services/earnService';
import { getSsoToken } from '../services/ssoService';
import { useToastStore } from '../stores/toastStore';

// Must match shahnameh-backend's TREASURY_STAKES exactly (routes/api/
// season2.js) -- shown up front so the player knows the cost before
// choosing a currency, same convention SlotMachine.tsx's own STAKES uses.
const STAKES: Record<TreasuryStakeCurrency, number> = { zar: 60, real: 25 };
const COLLECTION_TOTAL = 10; // lib/treasuryCatalog.js's ITEMS.length

// Same rarity ramp DailyLuckWheel/SimorghsFeather already borrow from
// Colors.rarity -- one system for "how special is this," reused again.
const RARITY_COLOR: Record<string, string> = {
  common: Colors.rarity.common,
  rare: Colors.rarity.rare,
  epic: Colors.rarity.epic,
  legendary: Colors.rarity.legendary,
  mythic: Colors.rarity.mythic,
};
// From epic upward, the medal's outer glow shifts toward violet -- RealGram's
// own "gold = value, violet = rarity magic" grammar (the user's confirmed
// choice: RealGram's own gold/purple language, not a literal brass-wheel
// copy of the Gardoon reference).
const VIOLET_GLOW: Record<string, boolean> = { epic: true, legendary: true, mythic: true };

const ERA_LABEL_KEY: Record<string, 'treasury.eraMythical' | 'treasury.eraRostam' | 'treasury.eraBridge' | 'treasury.eraLegend'> = {
  mythical_era: 'treasury.eraMythical',
  rostam_era: 'treasury.eraRostam',
  bridge_era: 'treasury.eraBridge',
  national_legend: 'treasury.eraLegend',
};

interface Relic {
  slug: string;
  name: string;
  flavorText: string;
  icon: string;
  era: string;
  rarity: string;
  duplicate: boolean;
  amountCurrency: string | null;
  amount: number;
  collectionTotal: number;
}

interface Props {
  deviceId: string;
}

export function TreasuryChest({ deviceId }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [stakeCurrency, setStakeCurrency] = useState<TreasuryStakeCurrency>('zar');
  const [opening, setOpening] = useState(false);
  const [relic, setRelic] = useState<Relic | null>(null);
  const telegramIdRef = useRef<string | null>(null);

  const chestRotate = useSharedValue(0);
  const chestOpacity = useSharedValue(1);
  const medalScale = useSharedValue(0.7);
  const medalOpacity = useSharedValue(0);

  const chestStyle = useAnimatedStyle(() => ({
    opacity: chestOpacity.value,
    transform: [{ rotate: `${chestRotate.value}deg` }],
  }));
  const medalStyle = useAnimatedStyle(() => ({
    opacity: medalOpacity.value,
    transform: [{ scale: medalScale.value }],
  }));

  const handleOpen = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    setRelic(null);
    // Reset any previous reveal state before the next shake+reveal cycle.
    chestOpacity.value = 1;
    medalOpacity.value = 0;
    medalScale.value = 0.7;
    chestRotate.value = withRepeat(
      withSequence(withTiming(-5, { duration: 70 }), withTiming(5, { duration: 70 })),
      -1, true,
    );

    if (!telegramIdRef.current && deviceId) {
      try {
        const r = await getSsoToken(deviceId, true);
        telegramIdRef.current = r.telegram_id || null;
      } catch { /* handled below via null check */ }
    }
    const telegramId = telegramIdRef.current;
    if (!telegramId) {
      cancelAnimation(chestRotate);
      chestRotate.value = withTiming(0, { duration: 150 });
      setOpening(false);
      showToast(t('treasury.error'), 'error');
      return;
    }

    const res = await openTreasury(telegramId, stakeCurrency);
    cancelAnimation(chestRotate);
    setOpening(false);

    if (!res.ok) {
      chestRotate.value = withTiming(0, { duration: 150 });
      showToast(res.error === 'insufficient_balance' ? t('treasury.insufficientBalance') : t('treasury.error'), 'error');
      return;
    }

    setRelic({
      slug: res.slug, name: res.name, flavorText: res.flavorText, icon: res.icon, era: res.era,
      rarity: res.rarity, duplicate: res.duplicate, amountCurrency: res.amountCurrency, amount: res.amount,
      collectionTotal: res.collectionTotal,
    });
    chestRotate.value = withTiming(0, { duration: 100 });
    chestOpacity.value = withTiming(0, { duration: 220 });
    medalOpacity.value = withTiming(1, { duration: 320 });
    medalScale.value = withTiming(1, { duration: 320 });
  }, [opening, deviceId, stakeCurrency, showToast, t, chestOpacity, chestRotate, medalOpacity, medalScale]);

  const rarityColor = relic ? (RARITY_COLOR[relic.rarity] || Colors.rarity.common) : Colors.gold[400];
  const showViolet = relic ? !!VIOLET_GLOW[relic.rarity] : false;

  return (
    <View style={styles.wrap}>
      <View style={styles.stage}>
        <Animated.View style={[styles.stageLayer, chestStyle]}>
          <Svg width={140} height={112} viewBox="0 0 140 112">
            <Defs>
              <LinearGradient id="chestBase" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={Colors.gold[300]} />
                <Stop offset="50%" stopColor={Colors.gold[500]} />
                <Stop offset="100%" stopColor={Colors.gold[700]} />
              </LinearGradient>
              <LinearGradient id="chestLid" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={Colors.gold[100]} />
                <Stop offset="60%" stopColor={Colors.gold[400]} />
                <Stop offset="100%" stopColor={Colors.gold[600]} />
              </LinearGradient>
              <RadialGradient id="chestGem" cx="35%" cy="30%" r="75%">
                <Stop offset="0%" stopColor="#E4D9FF" />
                <Stop offset="55%" stopColor={Colors.violet[400]} />
                <Stop offset="100%" stopColor={Colors.violet[600]} />
              </RadialGradient>
            </Defs>
            <Rect x={15} y={55} width={110} height={45} rx={10} fill="url(#chestBase)" stroke={Colors.gold[700]} strokeWidth={1.5} />
            <Rect x={15} y={68} width={110} height={4} fill={Colors.gold[700]} opacity={0.4} />
            <Path d="M15 55 Q15 18 70 18 Q125 18 125 55 Z" fill="url(#chestLid)" stroke={Colors.gold[700]} strokeWidth={1.5} />
            <Rect x={62} y={40} width={16} height={30} rx={3} fill={Colors.gold[700]} opacity={0.35} />
            <Circle cx={70} cy={55} r={12} fill="url(#chestGem)" stroke={Colors.gold[700]} strokeWidth={1.5} />
            <Circle cx={66} cy={51} r={3.5} fill="#F4EEFF" opacity={0.6} />
            {[[22, 58], [118, 58], [22, 96], [118, 96]].map(([cx, cy], i) => (
              <Circle key={i} cx={cx} cy={cy} r={2.5} fill={Colors.gold[100]} stroke={Colors.gold[700]} strokeWidth={0.75} />
            ))}
          </Svg>
        </Animated.View>

        {relic && (
          <Animated.View style={[styles.stageLayer, medalStyle]}>
            <View style={styles.medalOuter}>
              <Svg width={128} height={128} viewBox="0 0 128 128" style={StyleSheet.absoluteFill}>
                <Defs>
                  <RadialGradient id="medalGlow" cx="50%" cy="50%" r="55%">
                    <Stop offset="0%" stopColor={showViolet ? Colors.violet[400] : rarityColor} stopOpacity={0.55} />
                    <Stop offset="100%" stopColor={showViolet ? Colors.violet[400] : rarityColor} stopOpacity={0} />
                  </RadialGradient>
                  <RadialGradient id="medalFace" cx="35%" cy="30%" r="75%">
                    <Stop offset="0%" stopColor={Colors.gold[100]} />
                    <Stop offset="55%" stopColor={Colors.gold[400]} />
                    <Stop offset="100%" stopColor={Colors.gold[700]} />
                  </RadialGradient>
                </Defs>
                <Circle cx={64} cy={64} r={62} fill="url(#medalGlow)" />
                <Circle cx={64} cy={64} r={44} fill="url(#medalFace)" stroke={rarityColor} strokeWidth={3} />
                <Circle cx={64} cy={64} r={38} fill="none" stroke={Colors.gold[700]} strokeWidth={1} opacity={0.5} />
              </Svg>
              <Text style={styles.medalIcon}>{relic.icon}</Text>
            </View>
          </Animated.View>
        )}
      </View>

      {relic && (
        <View style={styles.revealWrap}>
          <Text style={[styles.rarityLabel, { color: rarityColor }]}>
            {t(`treasury.rarity${relic.rarity}` as 'treasury.raritycommon')}
          </Text>
          <Text style={styles.relicName}>{relic.name}</Text>
          {ERA_LABEL_KEY[relic.era] && <Text style={styles.eraLabel}>{t(ERA_LABEL_KEY[relic.era])}</Text>}
          <Text style={styles.flavorText} numberOfLines={3}>{relic.flavorText}</Text>
          {relic.duplicate ? (
            <Text style={styles.duplicateText}>
              {t('treasury.duplicate')} +{relic.amount} {t(`treasury.currency${relic.amountCurrency}` as 'treasury.currencyzar')}
            </Text>
          ) : (
            <Text style={styles.newRelicText}>{t('treasury.newRelic')}</Text>
          )}
          <Text style={styles.collectionText}>
            {t('treasury.collectionProgress').replace('{n}', String(relic.collectionTotal)).replace('{total}', String(COLLECTION_TOTAL))}
          </Text>
        </View>
      )}

      <View style={styles.stakeRow}>
        {(['zar', 'real'] as TreasuryStakeCurrency[]).map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.stakeBtn, stakeCurrency === c && styles.stakeBtnActive]}
            onPress={() => setStakeCurrency(c)}
            disabled={opening}
            accessibilityRole="button"
            accessibilityState={{ selected: stakeCurrency === c }}
          >
            <Text style={styles.stakeBtnText}>
              {c === 'real' ? '﷼' : '🪙'} {STAKES[c]} {t(c === 'real' ? 'treasury.stakeReal' : 'treasury.stakeZar')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.openBtn, opening && styles.openBtnDisabled]}
        activeOpacity={0.85}
        disabled={opening}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={t('treasury.open')}
      >
        <Text style={styles.openBtnText}>{opening ? t('treasury.opening') : t('treasury.open')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing[4], width: '100%' },

  stage: { width: 140, height: 128, alignItems: 'center', justifyContent: 'center' },
  stageLayer: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },

  medalOuter: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  medalIcon: { fontSize: 40 },

  revealWrap: { alignItems: 'center', gap: Spacing[1], width: '100%', paddingHorizontal: Spacing[4] },
  rarityLabel: { fontSize: Typography.size.xs, fontFamily: Typography.family.heading, textTransform: 'uppercase', letterSpacing: 1 },
  relicName: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.text.primary, textAlign: 'center' },
  eraLabel: { fontSize: 10, fontFamily: Typography.family.body, color: Colors.violet[400], textTransform: 'uppercase', letterSpacing: 0.5 },
  flavorText: { fontSize: Typography.size.xs, color: Colors.text.muted, fontFamily: Typography.family.body, textAlign: 'center' },

  duplicateText: { fontSize: Typography.size.sm, color: Colors.text.secondary, fontFamily: Typography.family.body, marginTop: Spacing[1] },
  newRelicText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.gold[400], marginTop: Spacing[1] },
  collectionText: { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: Spacing[1] },

  stakeRow: { flexDirection: 'row', gap: Spacing[3] },
  stakeBtn: {
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated,
  },
  stakeBtnActive: { borderColor: Colors.gold[400], backgroundColor: Colors.gold[400] + '22' },
  stakeBtnText: { fontSize: Typography.size.sm, color: Colors.text.primary, fontFamily: Typography.family.heading },

  openBtn: { paddingHorizontal: Spacing[8], paddingVertical: Spacing[3], borderRadius: Radius.full, backgroundColor: Colors.gold[400] },
  openBtnDisabled: { opacity: 0.5 },
  openBtnText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: '#0B0F14' },
});
