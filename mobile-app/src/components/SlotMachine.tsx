/**
 * SlotMachine — classic 3-reel slot machine, server-authoritative
 * (shahnameh-backend POST /season2/user/slot-spin). Khabat, 2026-08-02:
 * "en til casino type spill som lykkehjulet. men denne gangen skal det
 * være en spilleautomat som gamle gode spilleautomaten" — a real
 * pay-to-play mechanic, not a free daily bonus like DailyLuckWheel.tsx:
 * "du la inn 20 kroner så var det 3 like bilder du skulle få... her kan
 * vi bruke våre zar, gem, far, x ﷼ på rad så vinner du. spiller kan
 * spille med real token." Stake currency (zar or real) is the player's
 * own choice, confirmed via a clarifying question rather than assumed.
 *
 * Same discipline as the luck wheel: the server decides the outcome AND
 * applies the stake/payout atomically; this component only asks for a
 * spin and animates to whatever symbol comes back. It never picks
 * locally — see this session's own investigation into the luck wheel's
 * "wheel landed on ﷼ but I got ZAR" report for exactly the class of bug
 * that discipline avoids by construction, not just in this specific case.
 *
 * No daily limit (unlike the luck wheel) — repeatable as long as the
 * player can afford the stake, matching how a real slot machine works.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { spinSlotMachine, SlotStakeCurrency } from '../services/earnService';
import { getProfileSummary } from '../services/realGramProfileService';
import { getSsoToken } from '../services/ssoService';
import { useToastStore } from '../stores/toastStore';

interface SlotSymbol {
  key: string;
  labelKey: 'slots.symbolZar' | 'slots.symbolGem' | 'slots.symbolFarr' | 'slots.symbolReal' | 'slots.symbolBlank';
  icon: string;
}

// `key` MUST stay in sync with shahnameh-backend's SLOT_OUTCOMES
// (routes/api/season2.js) for the four paying symbols — the server
// draws the outcome, this list is only for rendering. 'blank' has no
// server-side counterpart (a 'miss' response never carries a symbol
// key of its own) — it's a filler used only to pad out a losing spin's
// 3 reels with something that visually can't be mistaken for a win,
// same convention real slot machines use for non-paying symbols.
const SYMBOLS: SlotSymbol[] = [
  { key: 'zar',   labelKey: 'slots.symbolZar',   icon: '🪙' },
  { key: 'gem',   labelKey: 'slots.symbolGem',   icon: '💎' },
  { key: 'farr',  labelKey: 'slots.symbolFarr',  icon: '✨' },
  { key: 'real',  labelKey: 'slots.symbolReal',  icon: '﷼' },
  { key: 'blank', labelKey: 'slots.symbolBlank', icon: '🔔' },
];
const PAYING_SYMBOLS = SYMBOLS.filter((s) => s.key !== 'blank');
const symbolByKey = (key: string) => SYMBOLS.find((s) => s.key === key) ?? SYMBOLS[SYMBOLS.length - 1];

// Stakes MUST match shahnameh-backend's SLOT_STAKES exactly — shown to
// the player before they spin, not derived from the spin response
// (they need to know the cost up front to choose a currency, not after
// the fact).
const STAKES: Record<SlotStakeCurrency, number> = { zar: 20, real: 10 };

const REEL_COUNT = 3;
const FLICKER_MS = [900, 1300, 1700]; // reel 1 stops first, then 2, then 3 -- classic stagger
const FLICKER_INTERVAL_MS = 70;

function randomSymbolIcon(): string {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)].icon;
}

/** 3 reels for a losing spin: never all identical (that would look like
 *  an unpaid win), otherwise genuinely random -- a real near-miss (two
 *  matching + one different) is fine and authentic to how slot machines
 *  actually feel. */
function missReelIcons(): [string, string, string] {
  for (let attempt = 0; attempt < 8; attempt++) {
    const icons = [randomSymbolIcon(), randomSymbolIcon(), randomSymbolIcon()] as [string, string, string];
    if (!(icons[0] === icons[1] && icons[1] === icons[2])) return icons;
  }
  // Astronomically unlikely to fall through 8 attempts, but stay correct
  // rather than trust probability alone -- force the third reel to differ.
  const a = randomSymbolIcon();
  let c = randomSymbolIcon();
  while (c === a) c = randomSymbolIcon();
  return [a, a, c];
}

interface Props {
  deviceId: string;
}

export function SlotMachine({ deviceId }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [stakeCurrency, setStakeCurrency] = useState<SlotStakeCurrency>('zar');
  const [spinning, setSpinning] = useState(false);
  const [reelIcons, setReelIcons] = useState<[string, string, string]>(['🪙', '💎', '✨']);
  const [stoppedCount, setStoppedCount] = useState(0);
  const [result, setResult] = useState<{ win: boolean; symbol: SlotSymbol; amount: number; staked: number } | null>(null);
  const [balances, setBalances] = useState<{ zar: number; real: number } | null>(null);
  const telegramIdRef = useRef<string | null>(null);
  const flickerTimers = useRef<Array<ReturnType<typeof setInterval>>>([]);

  useEffect(() => {
    let cancelled = false;
    if (!deviceId) return;
    getSsoToken(deviceId, true)
      .then((r) => { if (!cancelled) telegramIdRef.current = r.telegram_id || null; })
      .catch(() => {});
    // Pre-fetch real starting balances so the afford-check (and "not
    // enough" button state) is accurate before the player's FIRST spin,
    // not only after one -- without this, canAfford would have to
    // default to "allow" while balances is null and let the server be
    // the only thing that ever says no.
    getProfileSummary(deviceId)
      .then((p) => { if (!cancelled) setBalances({ zar: p.economy.zar, real: p.economy.real_balance }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deviceId]);

  useEffect(() => () => {
    flickerTimers.current.forEach((tm) => clearInterval(tm));
  }, []);

  const stake = STAKES[stakeCurrency];
  const balance = balances ? (stakeCurrency === 'real' ? balances.real : balances.zar) : null;
  const canAfford = balance === null || balance >= stake;

  const handleSpin = useCallback(async () => {
    if (spinning) return;
    const telegramId = telegramIdRef.current;
    if (!telegramId) {
      showToast(t('slots.spinError'), 'error');
      return;
    }
    setSpinning(true);
    setResult(null);
    setStoppedCount(0);
    flickerTimers.current.forEach((tm) => clearInterval(tm));
    flickerTimers.current = [];

    const resPromise = spinSlotMachine(telegramId, stakeCurrency);

    // Flicker all 3 reels immediately for visual feedback while the
    // network request is in flight -- purely cosmetic, the actual
    // landing symbols are set below once the server answers.
    for (let i = 0; i < REEL_COUNT; i++) {
      const tm = setInterval(() => {
        setReelIcons((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[i] = randomSymbolIcon();
          return next;
        });
      }, FLICKER_INTERVAL_MS);
      flickerTimers.current.push(tm);
    }

    const res = await resPromise;
    if (!res.ok) {
      flickerTimers.current.forEach((tm) => clearInterval(tm));
      flickerTimers.current = [];
      setSpinning(false);
      if (res.error === 'insufficient_balance') showToast(t('slots.insufficientBalance'), 'error');
      else showToast(t('slots.spinError'), 'error');
      return;
    }

    setBalances({ zar: res.newZar, real: res.newRealBalance });

    // Server decided the outcome BEFORE any of this UI code runs --
    // final icons are derived from res, never chosen client-side.
    const finalIcons: [string, string, string] = res.win
      ? [symbolByKey(res.symbol).icon, symbolByKey(res.symbol).icon, symbolByKey(res.symbol).icon]
      : missReelIcons();

    // Stop reels one at a time (classic stagger), each stop locking that
    // reel's flicker timer to its final icon.
    FLICKER_MS.forEach((delay, i) => {
      setTimeout(() => {
        clearInterval(flickerTimers.current[i]);
        setReelIcons((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[i] = finalIcons[i];
          return next;
        });
        setStoppedCount((c) => c + 1);
        if (i === REEL_COUNT - 1) {
          setSpinning(false);
          setResult({ win: res.win, symbol: symbolByKey(res.symbol), amount: res.amount, staked: res.staked });
        }
      }, delay);
    });
  }, [spinning, stakeCurrency, showToast, t]);

  return (
    <View style={styles.wrap}>
      <View style={styles.stakeRow}>
        {(['zar', 'real'] as SlotStakeCurrency[]).map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.stakeBtn, stakeCurrency === c && styles.stakeBtnActive]}
            onPress={() => setStakeCurrency(c)}
            disabled={spinning}
            accessibilityRole="button"
            accessibilityState={{ selected: stakeCurrency === c }}
          >
            <Text style={styles.stakeBtnText}>
              {c === 'real' ? '﷼' : '🪙'} {STAKES[c]} {t(c === 'real' ? 'slots.stakeReal' : 'slots.stakeZar')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.reelsRow}>
        {reelIcons.map((icon, i) => (
          <View key={i} style={styles.reelBox}>
            <Text style={styles.reelIcon}>{icon}</Text>
          </View>
        ))}
      </View>

      {result && (
        <View style={styles.resultWrap}>
          {result.win ? (
            <>
              <Text style={styles.resultIconWin}>{result.symbol.icon}</Text>
              <Text style={styles.resultTextWin}>+{result.amount} {t(result.symbol.labelKey)}</Text>
            </>
          ) : (
            <Text style={styles.resultTextMiss}>{t('slots.tryAgain')}</Text>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[styles.spinBtn, (spinning || !canAfford) && styles.spinBtnDisabled]}
        activeOpacity={0.85}
        disabled={spinning || !canAfford}
        onPress={handleSpin}
        accessibilityRole="button"
        accessibilityState={{ disabled: spinning || !canAfford }}
        accessibilityLabel={t('slots.spin')}
      >
        <Text style={styles.spinBtnText}>
          {spinning ? t('slots.spinning') : !canAfford ? t('slots.insufficientBalance') : t('slots.spin')}
        </Text>
      </TouchableOpacity>

      <View style={styles.legend}>
        {PAYING_SYMBOLS.map((s) => (
          <View key={s.key} style={styles.legendRow}>
            <Text style={styles.legendIcon}>{s.icon}{s.icon}{s.icon}</Text>
            <Text style={styles.legendText}>{t(s.labelKey)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing[4] },

  stakeRow: { flexDirection: 'row', gap: Spacing[3] },
  stakeBtn: {
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated,
  },
  stakeBtnActive: { borderColor: Colors.gold[400], backgroundColor: Colors.gold[400] + '22' },
  stakeBtnText: { fontSize: Typography.size.sm, color: Colors.text.primary, fontFamily: Typography.family.heading },

  reelsRow: {
    flexDirection: 'row', gap: Spacing[3], padding: Spacing[3],
    backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg,
    borderWidth: 2, borderColor: Colors.gold[400] + '55',
  },
  reelBox: {
    width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.bg.void,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border.default,
  },
  reelIcon: { fontSize: 32 },

  resultWrap: { alignItems: 'center', gap: Spacing[1], minHeight: 40 },
  resultIconWin: { fontSize: 28 },
  resultTextWin: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  resultTextMiss: { fontSize: 14, fontFamily: Typography.family.body, color: Colors.text.muted },

  spinBtn: {
    paddingHorizontal: Spacing[8], paddingVertical: Spacing[3], borderRadius: Radius.full,
    backgroundColor: Colors.gold[400],
  },
  spinBtnDisabled: { opacity: 0.4 },
  spinBtnText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: '#0B0F14' },

  legend: { gap: Spacing[1], alignItems: 'flex-start' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  legendIcon: { fontSize: 14 },
  legendText: { fontSize: Typography.size.xs, color: Colors.text.muted, fontFamily: Typography.family.body },
});
