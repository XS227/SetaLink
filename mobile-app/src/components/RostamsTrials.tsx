/**
 * RostamsTrials — pay-to-play memory/sequencing game, server-authoritative
 * (shahnameh-backend POST /season2/user/trials-start + /trials-submit).
 * Per docs/NEW_GAMES_SPEC.md Game 2 (Khabat, 2026-08-02). Stake a
 * currency, get the 7 real Haft Khan artifact cards (already in
 * heroes.json — Rakhsh, the mystical ram, the dragon-skin shield, the
 * enchanted lute, Awlad the captured guide, Arzhang div's trophy, Div-e
 * Sepid) in shuffled order, tap them into what you think is Rostam's
 * real trial order. Exact order = full payout, partial credit for a
 * partially-correct guess, miss loses the stake — teaches the real
 * Seven Trials sequence while playing, same "chance + real content"
 * shape as FerdowsisScroll.tsx.
 *
 * Tap-to-order rather than drag-to-reorder: a drag gesture is untestable
 * without a real device (same standing limitation as every other native
 * gesture note in this app), and tap-to-assign-next-position is just as
 * clear a "put these in order" interaction without that risk. Stake
 * toggle + balance pre-fetch pattern copied from SlotMachine.tsx.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { startTrials, submitTrials, TrialsStakeCurrency, TrialsTier } from '../services/earnService';
import { getProfileSummary } from '../services/realGramProfileService';
import { getSsoToken } from '../services/ssoService';
import { useToastStore } from '../stores/toastStore';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';

// Display metadata for the 7 real Haft Khan cards -- slugs/images MUST
// match heroes.json (season2/data/heroes.json, era: "Chapter haft-khan")
// and the server's own TRIALS_ORDER (routes/api/season2.js), though this
// list's ORDER here is irrelevant (tiles arrive pre-shuffled from the
// server) -- only the slug/name/image lookup matters.
const TRIAL_CARDS: Record<string, { name: string; image: string }> = {
  'rakhsh':         { name: 'Rakhsh', image: '/season2/uploads/heroes/rostam.png' },
  'mystical-ram':   { name: 'The Mystical Ram', image: '/season2/uploads/heroes/mount_alborz.png' },
  'azhdaha-shield': { name: 'The Dragon-Skin Shield', image: '/season2/uploads/heroes/blak_demon.png' },
  'enchanted-lute': { name: 'The Enchanted Lute', image: '/season2/uploads/heroes/festival_of_sade.png' },
  'awlad-guide':    { name: 'Awlad the Guide', image: '/season2/uploads/heroes/thirty_alphabets.png' },
  'arzhang-trophy': { name: "Arzhang Div's Trophy", image: '/season2/uploads/heroes/blak_demon.png' },
  'div-e-sepid':    { name: 'Div-e Sepid', image: '/season2/uploads/heroes/farvahar.png' },
};

const STAKES: Record<TrialsStakeCurrency, number> = { zar: 30, real: 15 };

interface Props {
  deviceId: string;
}

export function RostamsTrials({ deviceId }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [stakeCurrency, setStakeCurrency] = useState<TrialsStakeCurrency>('zar');
  const [balances, setBalances] = useState<{ zar: number; real: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [tiles, setTiles] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ tier: TrialsTier; correctOrder: string[]; amountCurrency: string | null; amount: number } | null>(null);
  const telegramIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!deviceId) return;
    getSsoToken(deviceId, true)
      .then((r) => { if (!cancelled) telegramIdRef.current = r.telegram_id || null; })
      .catch(() => {});
    getProfileSummary(deviceId)
      .then((p) => { if (!cancelled) setBalances({ zar: p.economy.zar, real: p.economy.real_balance }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deviceId]);

  const stake = STAKES[stakeCurrency];
  const balance = balances ? (stakeCurrency === 'real' ? balances.real : balances.zar) : null;
  const canAfford = balance === null || balance >= stake;

  const handleStart = useCallback(async () => {
    if (starting) return;
    const telegramId = telegramIdRef.current;
    if (!telegramId) {
      showToast(t('trials.error'), 'error');
      return;
    }
    setStarting(true);
    setResult(null);
    setOrder([]);
    const res = await startTrials(telegramId, stakeCurrency);
    setStarting(false);
    if (!res.ok) {
      showToast(res.error === 'insufficient_balance' ? t('trials.insufficientBalance') : t('trials.error'), 'error');
      return;
    }
    setSessionToken(res.sessionToken);
    setTiles(res.tiles);
    setBalances((prev) => (prev
      ? { ...prev, [stakeCurrency]: prev[stakeCurrency] - res.staked }
      : prev));
  }, [starting, stakeCurrency, showToast, t]);

  const handleTapTile = useCallback((slug: string) => {
    if (result || submitting || order.includes(slug)) return;
    setOrder((prev) => [...prev, slug]);
  }, [order, result, submitting]);

  const handleReset = useCallback(() => {
    if (result || submitting) return;
    setOrder([]);
  }, [result, submitting]);

  useEffect(() => {
    if (order.length !== tiles.length || tiles.length === 0 || result) return;
    const telegramId = telegramIdRef.current;
    if (!telegramId || !sessionToken) return;
    setSubmitting(true);
    submitTrials(telegramId, sessionToken, order).then((res) => {
      setSubmitting(false);
      if (!res.ok) {
        showToast(t('trials.error'), 'error');
        return;
      }
      setResult({ tier: res.tier, correctOrder: res.correctOrder, amountCurrency: res.amountCurrency, amount: res.amount });
      setBalances({ zar: res.newZar, real: res.newRealBalance });
      setSessionToken(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, tiles.length, result]);

  return (
    <View style={styles.wrap}>
      {tiles.length === 0 && (
        <>
          <View style={styles.stakeRow}>
            {(['zar', 'real'] as TrialsStakeCurrency[]).map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.stakeBtn, stakeCurrency === c && styles.stakeBtnActive]}
                onPress={() => setStakeCurrency(c)}
                disabled={starting}
                accessibilityRole="button"
                accessibilityState={{ selected: stakeCurrency === c }}
              >
                <Text style={styles.stakeBtnText}>
                  {c === 'real' ? '﷼' : '🪙'} {STAKES[c]} {t(c === 'real' ? 'trials.stakeReal' : 'trials.stakeZar')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.startBtn, (starting || !canAfford) && styles.startBtnDisabled]}
            activeOpacity={0.85}
            disabled={starting || !canAfford}
            onPress={handleStart}
            accessibilityRole="button"
          >
            <Text style={styles.startBtnText}>
              {starting ? t('trials.starting') : !canAfford ? t('trials.insufficientBalance') : t('trials.start')}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {tiles.length > 0 && (
        <>
          <Text style={styles.instructionText}>
            {result ? t('trials.resultInstruction') : t('trials.tapInstruction')}
          </Text>

          <View style={styles.grid}>
            {tiles.map((slug) => {
              const card = TRIAL_CARDS[slug];
              const position = order.indexOf(slug);
              const isPlaced = position !== -1;
              const isCorrectSlot = result && result.correctOrder[position] === slug;
              return (
                <TouchableOpacity
                  key={slug}
                  style={[
                    styles.tile,
                    isPlaced && styles.tilePlaced,
                    result && isPlaced && (isCorrectSlot ? styles.tileCorrect : styles.tileWrong),
                  ]}
                  activeOpacity={0.85}
                  disabled={!!result || submitting || isPlaced}
                  onPress={() => handleTapTile(slug)}
                  accessibilityRole="button"
                >
                  {card?.image ? (
                    <Image source={{ uri: `${SHAHNAMEH_ORIGIN}${card.image}` }} style={styles.tileImage} resizeMode="cover" />
                  ) : null}
                  {isPlaced && (
                    <View style={styles.positionBadge}>
                      <Text style={styles.positionBadgeText}>{position + 1}</Text>
                    </View>
                  )}
                  <Text style={styles.tileName} numberOfLines={1}>{card?.name ?? slug}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {!result && (
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset} disabled={order.length === 0 || submitting}>
              <Text style={styles.resetBtnText}>{t('trials.reset')}</Text>
            </TouchableOpacity>
          )}

          {submitting && <Text style={styles.submittingText}>{t('trials.grading')}</Text>}

          {result && (
            <View style={styles.resultWrap}>
              <Text style={result.tier === 'full' ? styles.resultTextFull : result.tier === 'partial' ? styles.resultTextPartial : styles.resultTextMiss}>
                {t(`trials.tier${result.tier}` as 'trials.tierfull')}
              </Text>
              {result.amount > 0 && (
                <Text style={styles.rewardText}>+{result.amount} {t(`trials.currency${result.amountCurrency}` as 'trials.currencyzar')}</Text>
              )}
              <TouchableOpacity
                style={styles.playAgainBtn}
                activeOpacity={0.85}
                onPress={() => { setTiles([]); setOrder([]); setResult(null); }}
                accessibilityRole="button"
              >
                <Text style={styles.playAgainBtnText}>{t('trials.playAgain')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing[4], width: '100%' },

  stakeRow: { flexDirection: 'row', gap: Spacing[3] },
  stakeBtn: {
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated,
  },
  stakeBtnActive: { borderColor: Colors.gold[400], backgroundColor: Colors.gold[400] + '22' },
  stakeBtnText: { fontSize: Typography.size.sm, color: Colors.text.primary, fontFamily: Typography.family.heading },

  startBtn: { paddingHorizontal: Spacing[8], paddingVertical: Spacing[3], borderRadius: Radius.full, backgroundColor: Colors.gold[400] },
  startBtnDisabled: { opacity: 0.4 },
  startBtnText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: '#0B0F14' },

  instructionText: { fontSize: Typography.size.xs, color: Colors.text.muted, fontFamily: Typography.family.body, textAlign: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], justifyContent: 'center' },
  tile: {
    width: 80, alignItems: 'center', gap: Spacing[1], padding: Spacing[2], borderRadius: Radius.md,
    backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default,
  },
  tilePlaced: { borderColor: Colors.gold[400] },
  tileCorrect: { borderColor: Colors.status.connected, backgroundColor: Colors.status.connected + '22' },
  tileWrong: { borderColor: Colors.red[400], backgroundColor: Colors.red[400] + '22' },
  tileImage: { width: 56, height: 56, borderRadius: Radius.sm },
  positionBadge: {
    position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.gold[400], alignItems: 'center', justifyContent: 'center',
  },
  positionBadgeText: { fontSize: 11, fontFamily: Typography.family.heading, color: '#0B0F14' },
  tileName: { fontSize: 10, color: Colors.text.secondary, fontFamily: Typography.family.body, textAlign: 'center' },

  resetBtn: { paddingVertical: Spacing[1], paddingHorizontal: Spacing[4] },
  resetBtnText: { fontSize: Typography.size.xs, color: Colors.text.muted, fontFamily: Typography.family.body, textDecorationLine: 'underline' },

  submittingText: { fontSize: Typography.size.sm, color: Colors.text.muted, fontFamily: Typography.family.body },

  resultWrap: { alignItems: 'center', gap: Spacing[2] },
  resultTextFull:    { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.status.connected },
  resultTextPartial: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  resultTextMiss:    { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.red[400] },
  rewardText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.gold[400] },

  playAgainBtn: { marginTop: Spacing[2], paddingVertical: Spacing[2], paddingHorizontal: Spacing[6], borderRadius: Radius.full, backgroundColor: Colors.gold[400] },
  playAgainBtnText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: '#0B0F14' },
});
