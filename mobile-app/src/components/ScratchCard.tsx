/**
 * ScratchCard — 3x3 instant-win grid, server-authoritative (shahnameh-
 * backend POST /season2/user/scratch-play). Game 5, new 2026-08-03 --
 * confirmed via AskUserQuestion as the second of the "2-3 new games"
 * (alongside TreasuryChest.tsx), picked specifically for low build cost.
 *
 * Reuses SlotMachine.tsx's own currency-symbol vocabulary (zar/gem/farr/
 * real/blank) rather than inventing a new icon set -- different REVEAL
 * mechanic (uncover a 3x3 grid cell-by-cell), not different content.
 * Also follows SlotMachine's own reveal-timing approach (plain setTimeout
 * + setState stagger, no reanimated) rather than DailyLuckWheel's -- a
 * flat "flip nine tiles in sequence" doesn't need a physics-driven
 * animation library, and staying consistent with the simpler of this
 * game set's two existing timing patterns keeps this game's own build
 * cost low, same reasoning the user picked this concept for in the first
 * place over a more complex card-game alternative.
 *
 * Same discipline as every other game here: one call, the server draws
 * the full grid AND applies the stake/payout atomically before this
 * component does anything -- the cell-by-cell reveal is cosmetic only,
 * the win/symbol/amount are already decided by the time playScratch
 * resolves.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { playScratch, ScratchStakeCurrency } from '../services/earnService';
import { getSsoToken } from '../services/ssoService';
import { useToastStore } from '../stores/toastStore';

// Must match shahnameh-backend's SCRATCH_STAKES exactly (routes/api/
// season2.js).
const STAKES: Record<ScratchStakeCurrency, number> = { zar: 25, real: 12 };
const GRID_SIZE = 9;
const REVEAL_STAGGER_MS = 90;

const SYMBOL_ICON: Record<string, string> = { zar: '🪙', gem: '💎', farr: '✨', real: '﷼', blank: '🔔' };

interface Props {
  deviceId: string;
}

export function ScratchCard({ deviceId }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [stakeCurrency, setStakeCurrency] = useState<ScratchStakeCurrency>('zar');
  const [playing, setPlaying] = useState(false);
  const [grid, setGrid] = useState<string[] | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [result, setResult] = useState<{ win: boolean; symbol: string | null; amount: number } | null>(null);
  const telegramIdRef = useRef<string | null>(null);
  const revealTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => () => {
    revealTimers.current.forEach((tm) => clearTimeout(tm));
  }, []);

  const handleBuy = useCallback(async () => {
    if (playing) return;
    setPlaying(true);
    setResult(null);
    setGrid(null);
    setRevealedCount(0);
    revealTimers.current.forEach((tm) => clearTimeout(tm));
    revealTimers.current = [];

    if (!telegramIdRef.current && deviceId) {
      try {
        const r = await getSsoToken(deviceId, true);
        telegramIdRef.current = r.telegram_id || null;
      } catch { /* handled below via null check */ }
    }
    const telegramId = telegramIdRef.current;
    if (!telegramId) {
      setPlaying(false);
      showToast(t('scratch.error'), 'error');
      return;
    }

    const res = await playScratch(telegramId, stakeCurrency);
    if (!res.ok) {
      setPlaying(false);
      showToast(res.error === 'insufficient_balance' ? t('scratch.insufficientBalance') : t('scratch.error'), 'error');
      return;
    }

    setGrid(res.grid);
    // Server already decided win/symbol/amount -- the stagger below is
    // purely the "scratching" reveal feel, same cosmetic-only discipline
    // every other game here follows.
    for (let i = 0; i < GRID_SIZE; i++) {
      const tm = setTimeout(() => {
        setRevealedCount((c) => c + 1);
        if (i === GRID_SIZE - 1) {
          setPlaying(false);
          setResult({ win: res.win, symbol: res.symbol, amount: res.amount });
        }
      }, (i + 1) * REVEAL_STAGGER_MS);
      revealTimers.current.push(tm);
    }
  }, [playing, deviceId, stakeCurrency, showToast, t]);

  return (
    <View style={styles.wrap}>
      <View style={styles.gridWrap}>
        {Array.from({ length: GRID_SIZE }).map((_, i) => {
          const revealed = !!grid && i < revealedCount;
          const symbol = revealed ? grid![i] : null;
          const isWinningCell = !!result?.win && symbol === result.symbol;
          return (
            <View
              key={i}
              style={[styles.cell, isWinningCell && styles.cellWin]}
            >
              {revealed ? (
                <Text style={styles.cellIcon}>{SYMBOL_ICON[symbol!] || '❔'}</Text>
              ) : (
                <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
                  <Defs>
                    <LinearGradient id={`cover-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <Stop offset="0%" stopColor={Colors.gold[400]} />
                      <Stop offset="100%" stopColor={Colors.violet[400]} />
                    </LinearGradient>
                  </Defs>
                  <Rect x={0} y={0} width="100%" height="100%" rx={Radius.md} fill={`url(#cover-${i})`} />
                </Svg>
              )}
              {!revealed && <Text style={styles.cellCoverIcon}>✨</Text>}
            </View>
          );
        })}
      </View>

      {result && revealedCount >= GRID_SIZE && (
        <View style={styles.resultWrap}>
          {result.win ? (
            <Text style={styles.resultTextWin}>{t('scratch.resultWin')} +{result.amount} {t(`scratch.symbol${capitalize(result.symbol || '')}` as 'scratch.symbolZar')}</Text>
          ) : (
            <Text style={styles.resultTextMiss}>{t('scratch.resultMiss')}</Text>
          )}
        </View>
      )}

      <View style={styles.stakeRow}>
        {(['zar', 'real'] as ScratchStakeCurrency[]).map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.stakeBtn, stakeCurrency === c && styles.stakeBtnActive]}
            onPress={() => setStakeCurrency(c)}
            disabled={playing}
            accessibilityRole="button"
            accessibilityState={{ selected: stakeCurrency === c }}
          >
            <Text style={styles.stakeBtnText}>
              {c === 'real' ? '﷼' : '🪙'} {STAKES[c]} {t(c === 'real' ? 'scratch.stakeReal' : 'scratch.stakeZar')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.buyBtn, playing && styles.buyBtnDisabled]}
        activeOpacity={0.85}
        disabled={playing}
        onPress={handleBuy}
        accessibilityRole="button"
        accessibilityLabel={t('scratch.buy')}
      >
        <Text style={styles.buyBtnText}>{playing ? t('scratch.buying') : t('scratch.buy')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

const CELL_SIZE = 56;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing[4] },

  gridWrap: {
    flexDirection: 'row', flexWrap: 'wrap', width: CELL_SIZE * 3 + Spacing[2] * 2,
    gap: Spacing[2], padding: Spacing[3],
    backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg,
    borderWidth: 2, borderColor: Colors.gold[600],
  },
  cell: {
    width: CELL_SIZE, height: CELL_SIZE, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: Colors.bg.void, borderWidth: 1, borderColor: Colors.border.default,
  },
  cellWin: { borderWidth: 2, borderColor: Colors.gold[400] },
  cellIcon: { fontSize: 26 },
  cellCoverIcon: { position: 'absolute', fontSize: 18, opacity: 0.85 },

  resultWrap: { alignItems: 'center', minHeight: 24 },
  resultTextWin: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.gold[400], textAlign: 'center' },
  resultTextMiss: { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center' },

  stakeRow: { flexDirection: 'row', gap: Spacing[3] },
  stakeBtn: {
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated,
  },
  stakeBtnActive: { borderColor: Colors.gold[400], backgroundColor: Colors.gold[400] + '22' },
  stakeBtnText: { fontSize: Typography.size.sm, color: Colors.text.primary, fontFamily: Typography.family.heading },

  buyBtn: { paddingHorizontal: Spacing[8], paddingVertical: Spacing[3], borderRadius: Radius.full, backgroundColor: Colors.gold[400] },
  buyBtnDisabled: { opacity: 0.5 },
  buyBtnText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: '#0B0F14' },
});
