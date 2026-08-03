/**
 * DailyLuckWheel — once-a-day spin, server-authoritative
 * (shahnameh-backend POST /season2/user/luck-spin). Started as a UI-only
 * prototype (Khabat, 2026-07-30: "lag bare ui så jeg kan sjekke hvordan
 * den snurrer og farger og sånt. etterpå kan kobles til økonomi") — wired
 * to the real endpoint 2026-08-01 once PR #3 (feat/luck-wheel-spin)
 * shipped. The server draws the prize AND applies the grant atomically;
 * this component only asks for a spin and animates to whatever key comes
 * back, same shape zarSyncService's own quest_tap wiring uses for
 * telegram_id resolution.
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
 *      convention RealGramEarnScreen's own checkin gate already uses. Now
 *      device-local only as a fast initial-render hint (skips a network
 *      round-trip before showing "come back tomorrow") — the server's own
 *      `luck_spin_date` field is what actually enforces once-per-day, this
 *      just avoids flashing an enabled button before that answer is known.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { syncGet, storage } from '../storage/storage';
import { spinLuckWheel } from '../services/earnService';
import { getSsoToken } from '../services/ssoService';
import { useToastStore } from '../stores/toastStore';

export interface WheelPrize {
  key: string;
  labelKey: 'dailyluck.prizeZarSmall' | 'dailyluck.prizeZarBig' | 'dailyluck.prizeGem' | 'dailyluck.prizeFarr' | 'dailyluck.prizeReal';
  icon: string;
  color: string;
}

// Ordered common -> mythic, matching Colors.rarity's own scale. `key` MUST
// stay in sync with shahnameh-backend's LUCK_WHEEL_PRIZES
// (routes/api/season2.js) — the server draws the prize and returns one of
// these keys, this list is only for rendering the wheel and looking up
// which segment to land on. A "GB Quota" prize was in the original UI
// preview but the server deliberately doesn't grant it (VPN quota lives in
// the SetaLink panel's own DB, out of reach here) — dropped to match.
export const PRIZES: WheelPrize[] = [
  { key: 'zar_small', labelKey: 'dailyluck.prizeZarSmall', icon: '🪙', color: Colors.rarity.common },
  { key: 'zar_big',   labelKey: 'dailyluck.prizeZarBig',   icon: '🪙', color: Colors.rarity.rare },
  { key: 'gem',       labelKey: 'dailyluck.prizeGem',      icon: '💎', color: Colors.rarity.epic },
  { key: 'farr',      labelKey: 'dailyluck.prizeFarr',     icon: '✨', color: Colors.rarity.legendary },
  { key: 'real',      labelKey: 'dailyluck.prizeReal',     icon: '﷼',  color: Colors.rarity.mythic },
];

const SPIN_DATE_STORAGE_KEY = 'dailyluck_lastSpinDate';
function todayUtcStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const SIZE = 260;
const CENTER = SIZE / 2;
const R = SIZE / 2 - 6;
// A metallic rim band sits between the colored segments and the wheel's
// outer edge (Gardoon-reference detail: a real prize wheel reads as an
// object with depth, not a flat colored disc) — segments stop short of R,
// the rim ring fills the rest.
const RIM_WIDTH = 16;
const SEG_R = R - RIM_WIDTH;
const HUB_R = 22;
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
  const start = polarToXY(startDeg, SEG_R);
  const end = polarToXY(endDeg, SEG_R);
  const largeArc = SEGMENT_DEG > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${SEG_R} ${SEG_R} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

/** Lighten (positive amount) or darken (negative) a #rrggbb color toward
 * white/black — used to turn each prize's single flat rarity color into a
 * 3-stop radial gradient (hub-lit highlight -> true color -> rim shadow)
 * so a segment reads as a lathed metal wedge instead of a flat swatch. */
function shade(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const mix = (channel: number) => {
    const target = amount > 0 ? 255 : 0;
    const next = Math.round(channel + (target - channel) * Math.abs(amount));
    return Math.max(0, Math.min(255, next));
  };
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

interface Props {
  /** Needed to resolve the account's telegram_id (same getSsoToken(deviceId,
   *  true) pattern zarSyncService's quest_tap wiring and RealGramEarnScreen
   *  already use) — the server spin is per-account, not per-device. */
  deviceId: string;
  /** Called once a spin finishes, with the prize it landed on and the
   *  amount actually granted (server-decided, not derivable from the
   *  prize key alone — zar_small/zar_big/gem/farr/real amounts are a
   *  weighted table server-side, see season2.js's LUCK_WHEEL_PRIZES). */
  onResult?: (prize: WheelPrize, amount: number) => void;
}

export function DailyLuckWheel({ deviceId, onResult }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const rotation = useSharedValue(0);
  const [spinning, setSpinning] = useState(false);
  // Fast initial-render hint only, not the real gate — see this file's own
  // header (point 2). The server's `already_spun` response (handled in
  // handleSpin below) is the actual once-per-day enforcement.
  const [alreadySpunToday, setAlreadySpunToday] = useState(
    () => syncGet(SPIN_DATE_STORAGE_KEY) === todayUtcStr(),
  );
  const [result, setResult] = useState<{ prize: WheelPrize; amount: number } | null>(null);
  const totalRotation = useRef(0);
  const telegramIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!deviceId) return;
    getSsoToken(deviceId, true)
      .then((r) => { if (!cancelled) telegramIdRef.current = r.telegram_id || null; })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deviceId]);

  const finishSpin = useCallback((prizeIndex: number, amount: number) => {
    setSpinning(false);
    setAlreadySpunToday(true);
    storage.setItem(SPIN_DATE_STORAGE_KEY, todayUtcStr());
    const prize = PRIZES[prizeIndex];
    setResult({ prize, amount });
    onResult?.(prize, amount);
  }, [onResult]);

  const animateToIndex = useCallback((prizeIndex: number, amount: number) => {
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
          if (finished) runOnJS(finishSpin)(prizeIndex, amount);
        },
      );
    }).catch(() => {
      rotation.value = withTiming(next, { duration: SPIN_MS, easing: Easing.out(Easing.cubic) },
        (finished) => { if (finished) runOnJS(finishSpin)(prizeIndex, amount); });
    });
  }, [rotation, finishSpin]);

  const handleSpin = useCallback(async () => {
    if (spinning || alreadySpunToday) return;
    const telegramId = telegramIdRef.current;
    if (!telegramId) {
      showToast(t('dailyluck.spinError'), 'error');
      return;
    }
    setSpinning(true);
    setResult(null);

    const res = await spinLuckWheel(telegramId);
    if (!res.ok) {
      setSpinning(false);
      if (res.error === 'already_spun') {
        setAlreadySpunToday(true);
        storage.setItem(SPIN_DATE_STORAGE_KEY, todayUtcStr());
        showToast(t('dailyluck.alreadySpun'), 'error');
      } else {
        showToast(t('dailyluck.spinError'), 'error');
      }
      return;
    }

    // Server decides the prize. `key` MUST stay in sync with season2.js's
    // LUCK_WHEEL_PRIZES (see PRIZES' own comment above) — an unrecognized
    // key means a stale client build vs. a since-changed backend table.
    // The grant already happened server-side regardless, so still surface
    // it (amount, via toast) rather than silently dropping it — just skip
    // the wheel animation and the prize-card display, since there's no
    // matching segment/icon/label to show without guessing wrong.
    const prizeIndex = PRIZES.findIndex((p) => p.key === res.prize);
    if (prizeIndex === -1) {
      setSpinning(false);
      setAlreadySpunToday(true);
      storage.setItem(SPIN_DATE_STORAGE_KEY, todayUtcStr());
      showToast(`+${res.amount}`, 'success');
      return;
    }
    animateToIndex(prizeIndex, res.amount);
  }, [spinning, alreadySpunToday, showToast, t, animateToIndex]);

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.stage}>
        {/* Soft contact shadow, outside the rotating wheel so it never
            spins with it — a real wheel casts a shadow onto whatever it
            sits on, not onto itself. */}
        <View style={styles.wheelShadow} />

        <Animated.View style={[{ width: SIZE, height: SIZE }, wheelStyle]}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <Defs>
              {PRIZES.map((prize) => (
                <RadialGradient key={prize.key} id={`seg-${prize.key}`} cx="50%" cy="50%" r="75%">
                  <Stop offset="0%" stopColor={shade(prize.color, 0.45)} />
                  <Stop offset="60%" stopColor={prize.color} />
                  <Stop offset="100%" stopColor={shade(prize.color, -0.35)} />
                </RadialGradient>
              ))}
              {/* Rim gradient centered up-left of the wheel so the metal
                  band reads as lit from one side, same "brass caught in
                  light" cue as the Gardoon reference — RealGram's own
                  gold ramp, not literal brass. */}
              <RadialGradient id="wheelRim" cx="32%" cy="28%" r="85%">
                <Stop offset="0%" stopColor={Colors.gold[100]} />
                <Stop offset="45%" stopColor={Colors.gold[400]} />
                <Stop offset="100%" stopColor={Colors.gold[700]} />
              </RadialGradient>
              <RadialGradient id="wheelHub" cx="35%" cy="30%" r="75%">
                <Stop offset="0%" stopColor={Colors.gold[100]} />
                <Stop offset="55%" stopColor={Colors.gold[400]} />
                <Stop offset="100%" stopColor={Colors.gold[700]} />
              </RadialGradient>
            </Defs>

            {PRIZES.map((prize, i) => {
              const labelDeg = i * SEGMENT_DEG + SEGMENT_DEG / 2;
              const labelPos = polarToXY(labelDeg, SEG_R * 0.62);
              return (
                <React.Fragment key={prize.key}>
                  <Path
                    d={segmentPath(i)}
                    fill={`url(#seg-${prize.key})`}
                    stroke={Colors.bg.void}
                    strokeWidth={2}
                  />
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

            {/* Pegs — the physical-looking dividers a real prize wheel has
                between pockets (Gardoon reference: "åtte hull... jevnt
                fordelt"). Purely decorative here, same rhythm as the
                segment boundaries. */}
            {PRIZES.map((_, i) => {
              const deg = i * SEGMENT_DEG;
              const pos = polarToXY(deg, SEG_R);
              return (
                <Circle key={`peg-${i}`} cx={pos.x} cy={pos.y} r={3.5} fill={Colors.gold[100]} stroke={Colors.gold[700]} strokeWidth={1} />
              );
            })}

            {/* Metallic rim band between the segments and the wheel's edge. */}
            <Circle
              cx={CENTER} cy={CENTER} r={R - RIM_WIDTH / 2}
              fill="none" stroke="url(#wheelRim)" strokeWidth={RIM_WIDTH}
            />
            <Circle cx={CENTER} cy={CENTER} r={R - 1} fill="none" stroke={Colors.gold[700]} strokeWidth={1.5} />
            <Circle cx={CENTER} cy={CENTER} r={SEG_R + 1} fill="none" stroke={Colors.gold[700]} strokeWidth={1} opacity={0.6} />

            {/* Hub, lit like RealCoin's own gold sphere so the wheel's
                center reads as the same "forged gold" object language as
                the rest of the app. */}
            <Circle cx={CENTER} cy={CENTER} r={HUB_R} fill="url(#wheelHub)" stroke={Colors.gold[700]} strokeWidth={1.5} />
            <Circle cx={CENTER - HUB_R * 0.28} cy={CENTER - HUB_R * 0.3} r={HUB_R * 0.32} fill={Colors.gold[100]} opacity={0.55} />
          </Svg>
        </Animated.View>

        {/* Pointer — a small lit gem instead of a flat CSS triangle. */}
        <Svg width={28} height={30} viewBox="0 0 28 30" style={styles.pointerSvg}>
          <Defs>
            <LinearGradient id="pointerGem" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={Colors.gold[100]} />
              <Stop offset="100%" stopColor={Colors.gold[600]} />
            </LinearGradient>
          </Defs>
          <Path d="M14 30 L2 10 L14 0 L26 10 Z" fill="url(#pointerGem)" stroke={Colors.gold[700]} strokeWidth={1} />
        </Svg>
      </View>

      {result && (
        <View style={styles.resultWrap}>
          <Text style={styles.resultIcon}>{result.prize.icon}</Text>
          <Text style={styles.resultText}>+{result.amount} {t(result.prize.labelKey)}</Text>
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
  wheelShadow: {
    position: 'absolute',
    width: SIZE * 0.9, height: SIZE * 0.9, borderRadius: SIZE / 2,
    backgroundColor: Colors.bg.void, opacity: 0.45,
    top: SIZE * 0.07,
  },
  pointerSvg: { position: 'absolute', top: -6, zIndex: 2 },
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
