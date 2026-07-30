/**
 * DailyLuckWheel — UI-only prototype (Khabat, 2026-07-30: "lag bare ui så
 * jeg kan sjekke hvordan den snurrer og farger og sånt. etterpå kan kobles
 * til økonomi"). A once-a-day spin that lands on one of five prize types.
 *
 * Deliberately NOT wired to any real reward/economy backend yet — the spin
 * result below is chosen with Math.random() purely so the wheel has
 * something to land on for a visual review. Real grants need a server-
 * authoritative endpoint (same requirement flagged in docs/realgram/
 * TASK_SPLIT.md A→B(241) for the existing daily-quest XP bug — this app has
 * no other place where a client-side balance mutation is trusted) — that
 * part is genuinely out of scope here, no Shahnameh backend repo is
 * reachable from this box (see TASK_SPLIT.md — that side is Agent B's).
 * See PRIZES below for where a real payout table would plug in.
 *
 * Segment colors reuse the app's existing rarity ramp (design/tokens.ts
 * Colors.rarity) rather than inventing a new palette — same system already
 * used for hero-card rarity, common → mythic reads as low → high value here
 * too, so nothing about this wheel needs its own color language.
 *
 * Khabat, 2026-07-30 (test-120): "lykkejule må vise riktig navn og bilde
 * også må den begynne å fungere 100%." Two real, fixable-without-a-backend
 * bugs found:
 *   1. Every PRIZES.label was a bare English string never run through t()
 *      — a fa/zh/ru user always saw "GB Quota"/"Zar"/"Gem"/"Farr" no matter
 *      their app language. Switched to labelKey + t(), reusing this app's
 *      existing ZAR/FARR/REAL brand-name convention (kept as Latin
 *      abbreviations in every locale — see rghome.statZar/statFarr/statReal)
 *      and its existing Gems translation (rghome.statGems) rather than
 *      inventing new wording.
 *   2. "already spun today" was pure component state — reset every time this
 *      screen remounted (navigate away and back = free extra spin, and any
 *      real once-per-day feel was accidental). Persisted the last-spin date
 *      to the app's own MMKV-backed `storage` (same module zustand's
 *      persist middleware already uses), keyed on a UTC date string, same
 *      convention RealGramEarnScreen's own checkin gate already uses. This
 *      is still device-local, not account-authoritative (a reinstall resets
 *      it) — real per-account enforcement still needs the server endpoint
 *      from point 1's backend note, not something fixable from this repo.
 */

import React, { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { syncGet, storage } from '../storage/storage';

export interface WheelPrize {
  key: string;
  labelKey: 'dailyluck.prizeGbQuota' | 'dailyluck.prizeZar' | 'dailyluck.prizeGem' | 'dailyluck.prizeFarr' | 'dailyluck.prizeReal';
  icon: string;
  color: string;
}

// Ordered common -> mythic, matching Colors.rarity's own scale. Swap
// icon copy freely; `key` is what a real backend would eventually
// return/consume, kept stable so wiring the real payout later doesn't need
// to touch this list's shape.
export const PRIZES: WheelPrize[] = [
  { key: 'gb_quota', labelKey: 'dailyluck.prizeGbQuota', icon: '📶', color: Colors.rarity.common },
  { key: 'zar',       labelKey: 'dailyluck.prizeZar',     icon: '🪙', color: Colors.rarity.rare },
  { key: 'gem',       labelKey: 'dailyluck.prizeGem',     icon: '💎', color: Colors.rarity.epic },
  { key: 'farr',      labelKey: 'dailyluck.prizeFarr',    icon: '✨', color: Colors.rarity.legendary },
  { key: 'real',      labelKey: 'dailyluck.prizeReal',    icon: '﷼',  color: Colors.rarity.mythic },
];

const SPIN_DATE_STORAGE_KEY = 'dailyluck_lastSpinDate';
function todayUtcStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const SIZE = 260;
const CENTER = SIZE / 2;
const R = SIZE / 2 - 6;
const SEGMENT_DEG = 360 / PRIZES.length;
const SPIN_MS = 3600;
// Extra full rotations before landing, purely for a satisfying spin length —
// no meaning beyond visual pacing.
const MIN_EXTRA_SPINS = 4;
const MAX_EXTRA_SPINS = 6;

function polarToXY(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

function segmentPath(index: number): string {
  const startDeg = index * SEGMENT_DEG;
  const endDeg = startDeg + SEGMENT_DEG;
  const start = polarToXY(startDeg, R);
  const end = polarToXY(endDeg, R);
  const largeArc = SEGMENT_DEG > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${R} ${R} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

interface Props {
  /** Called once a spin finishes, with the prize it landed on — the only
   *  hook a real economy wiring would need; everything else here is
   *  self-contained presentation state. */
  onResult?: (prize: WheelPrize) => void;
}

export function DailyLuckWheel({ onResult }: Props) {
  const { t } = useT();
  const rotation = useSharedValue(0);
  const [spinning, setSpinning] = useState(false);
  // Initialized from persisted state, not always false — see this file's
  // own header (point 2) for why a plain useState(false) here was a real
  // bug (remounting undid the day's spin).
  const [alreadySpunToday, setAlreadySpunToday] = useState(
    () => syncGet(SPIN_DATE_STORAGE_KEY) === todayUtcStr(),
  );
  const [result, setResult] = useState<WheelPrize | null>(null);
  const totalRotation = useRef(0);

  const finishSpin = useCallback((prizeIndex: number) => {
    setSpinning(false);
    setAlreadySpunToday(true);
    storage.setItem(SPIN_DATE_STORAGE_KEY, todayUtcStr());
    const prize = PRIZES[prizeIndex];
    setResult(prize);
    onResult?.(prize);
  }, [onResult]);

  const handleSpin = useCallback(() => {
    if (spinning || alreadySpunToday) return;
    setSpinning(true);
    setResult(null);

    // Placeholder only — see this file's own header. A real spin would
    // instead await a server call that already decided the prize, then
    // animate to whatever index it returns rather than picking one here.
    const prizeIndex = Math.floor(Math.random() * PRIZES.length);
    const extraSpins = MIN_EXTRA_SPINS + Math.random() * (MAX_EXTRA_SPINS - MIN_EXTRA_SPINS);
    // Land the *pointer* (fixed at the top, 0deg) on the middle of the
    // chosen segment: rotate the wheel so that segment's center ends up at
    // the top, plus full spins for visual effect, plus a small random
    // jitter within the segment so it doesn't always stop dead-center.
    const segmentCenterDeg = prizeIndex * SEGMENT_DEG + SEGMENT_DEG / 2;
    const jitter = (Math.random() - 0.5) * (SEGMENT_DEG * 0.6);
    const targetDeg = 360 - segmentCenterDeg - jitter;
    const next = totalRotation.current + extraSpins * 360 + targetDeg - (totalRotation.current % 360);
    totalRotation.current = next;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      rotation.value = withTiming(
        next,
        { duration: reduced ? 400 : SPIN_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishSpin)(prizeIndex);
        },
      );
    }).catch(() => {
      rotation.value = withTiming(next, { duration: SPIN_MS, easing: Easing.out(Easing.cubic) },
        (finished) => { if (finished) runOnJS(finishSpin)(prizeIndex); });
    });
  }, [spinning, alreadySpunToday, rotation, finishSpin]);

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.stage}>
        <View style={styles.pointer} />
        <Animated.View style={[{ width: SIZE, height: SIZE }, wheelStyle]}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            {PRIZES.map((prize, i) => {
              const labelDeg = i * SEGMENT_DEG + SEGMENT_DEG / 2;
              const labelPos = polarToXY(labelDeg, R * 0.66);
              return (
                <React.Fragment key={prize.key}>
                  <Path d={segmentPath(i)} fill={prize.color} stroke={Colors.bg.void} strokeWidth={2} />
                  <SvgText
                    x={labelPos.x} y={labelPos.y}
                    fontSize={22}
                    textAnchor="middle"
                    alignmentBaseline="middle"
                  >
                    {prize.icon}
                  </SvgText>
                </React.Fragment>
              );
            })}
            <Circle cx={CENTER} cy={CENTER} r={R} fill="none" stroke={Colors.gold[400]} strokeWidth={3} />
            <Circle cx={CENTER} cy={CENTER} r={10} fill={Colors.gold[400]} />
          </Svg>
        </Animated.View>
      </View>

      {result && (
        <View style={styles.resultWrap}>
          <Text style={styles.resultIcon}>{result.icon}</Text>
          <Text style={styles.resultText}>{t(result.labelKey)}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.spinBtn, (spinning || alreadySpunToday) && styles.spinBtnDisabled]}
        activeOpacity={0.85}
        disabled={spinning || alreadySpunToday}
        onPress={handleSpin}
        accessibilityRole="button"
        accessibilityState={{ disabled: spinning || alreadySpunToday }}
        accessibilityLabel={t('dailyluck.spin')}
      >
        <Text style={styles.spinBtnText}>
          {alreadySpunToday ? t('dailyluck.comeBackTomorrow') : spinning ? t('dailyluck.spinning') : t('dailyluck.spin')}
        </Text>
      </TouchableOpacity>

      <View style={styles.legend}>
        {PRIZES.map((prize) => (
          <View key={prize.key} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: prize.color }]} />
            <Text style={styles.legendText}>{prize.icon} {t(prize.labelKey)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing[4] },
  stage: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  pointer: {
    position: 'absolute', top: -4, zIndex: 2,
    width: 0, height: 0,
    borderLeftWidth: 12, borderRightWidth: 12, borderTopWidth: 20,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: Colors.gold[400],
  },
  resultWrap: { alignItems: 'center', gap: Spacing[1] },
  resultIcon: { fontSize: 36 },
  resultText: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.gold[400] },

  spinBtn: {
    backgroundColor: Colors.gold[400], borderRadius: Radius.full,
    paddingVertical: Spacing[3], paddingHorizontal: Spacing[8],
  },
  spinBtnDisabled: { backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  spinBtnText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void, textTransform: 'uppercase', letterSpacing: 0.5 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing[3] },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[1] },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.secondary },
});
