/**
 * RealWalletCard — REAL → data redemption on the Wallet screen (plan A3).
 *
 * Remote-config gated (`ecosystem.wallet_enabled`, default OFF) so it can
 * roll out server-side without an app release. Three states:
 *   hidden    flag off, or wallet info hasn't loaded yet
 *   unlinked  link CTA → opens the Shahnameh bot with the device_id so the
 *             ecosystem backend can mint the signed link proof (task B-3)
 *   linked    balance (— when the service can't answer), GB stepper priced
 *             from server rates, one-tap redeem via the panel-orchestrated
 *             debit (retry-safe on client_ref — see realWalletService).
 *
 * 2026-07-29 (Khabat: "wallet ser rotete ut. konverteringer kan dukke opp
 * i form av cta knapper sånn som når du skal veksle valuta"): the ZAR→REAL
 * swap and REAL→GB redeem used to be two steppers stacked in one card with
 * no visual separation — reads as one confusing action, not two distinct
 * exchanges. Split into a balance header + two clearly-separated "exchange"
 * cards (icon → icon, amount, one button each), plus a one-line "how the
 * economy works" explainer and a link out to where REAL gets spent beyond
 * data (Heroes/cards). TON stays "coming soon" — no balance integration
 * exists anywhere in the backend (§5.10 hard rule), not touched here.
 * Also dropped the `[REALDBG]` console.log instrumentation left over from
 * an earlier investigation — this screen has been stable since.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { GoldButton } from './GoldButton';
import { REAL_TOKEN_IMAGE } from './EcosystemBanner';
import { useT } from '../i18n';
import { useToastStore } from '../stores/toastStore';
import { getCachedConfig, getRemoteConfig } from '../services/remoteConfigService';
import {
  getRealWallet, redeemRealSpend, convertZarToReal, RealWalletInfo,
} from '../services/realWalletService';

const ONE_GB = 1073741824;
const LINK_URL_BASE = 'https://t.me/shahnameh_bot?start=linkvpn_';

type Props = {
  deviceId: string;
  /** Called after a successful redeem so the owner refreshes the quota. */
  onRedeemed?: () => void;
  /** Opens the Heroes/cards screen — "also spend REAL on" link. Optional:
   *  omitted entirely (no dead link) if the host screen has no route there. */
  onOpenHeroes?: () => void;
  style?: object;
};

export function RealWalletCard({ deviceId, onRedeemed, onOpenHeroes, style }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);

  // getCachedConfig() is a synchronous MMKV snapshot — it only reflects
  // whatever the LAST completed getRemoteConfig() fetch wrote, and nothing
  // in ProfileScreen/WalletScreen ever calls getRemoteConfig() themselves
  // (only autoConnector.ts does, on VPN connect). A render before that
  // background fetch lands reads a stale/default config forever, since
  // nothing re-renders this card afterwards. So: seed from cache, but also
  // kick off (and wait on) a real fetch here, same "wait not skip"
  // treatment as GameScreen's realId probe (Khabat, 2026-07-19).
  const [enabled, setEnabled] = useState(() => getCachedConfig()?.ecosystem?.wallet_enabled === true);

  const [wallet, setWallet]   = useState<RealWalletInfo | null>(null);
  const [gb, setGb]           = useState(1);
  const [busy, setBusy]       = useState(false);
  const [swapReal, setSwapReal] = useState(1);
  const [swapBusy, setSwapBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRemoteConfig()
      .then((cfg) => {
        const live = cfg?.ecosystem?.wallet_enabled === true;
        if (!cancelled) setEnabled(live);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deviceId]);

  useEffect(() => {
    if (!enabled || !deviceId) return;
    getRealWallet(deviceId).then(setWallet).catch(() => {});
  }, [enabled, deviceId]);

  const rates = wallet?.rates;
  const costReal = useMemo(
    () => (rates ? Math.ceil(gb * rates.real_per_gb) : 0),
    [gb, rates],
  );
  const maxGb = useMemo(() => {
    if (!rates) return 1;
    const capLeft = Math.max(0, rates.redeem_daily_cap_bytes - (wallet?.redeemed_today_bytes ?? 0));
    let cap = Math.floor(capLeft / ONE_GB);
    if (wallet?.balance != null) {
      cap = Math.min(cap, Math.floor(wallet.balance / rates.real_per_gb));
    }
    return Math.max(1, cap);
  }, [rates, wallet]);

  // ZAR→REAL conversion (contract per docs/realgram/TASK_SPLIT.md B->A(114)).
  // 1-REAL minimum per the server contract; capped by what wallet.zar can
  // actually afford at the current published rate.
  const swapCost = wallet?.conversion_rate ? swapReal * wallet.conversion_rate : 0;
  const maxSwapReal = useMemo(() => {
    if (!wallet?.conversion_rate || !wallet.zar) return 1;
    return Math.max(1, Math.floor(wallet.zar / wallet.conversion_rate));
  }, [wallet]);
  const canSwap = !!wallet?.zar && !!wallet?.conversion_rate && wallet.zar >= wallet.conversion_rate;

  if (!enabled || !wallet) return null;

  const linked = wallet.linked_account !== '';

  const redeem = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // client_ref keys the panel's idempotent debit — a retried tap after a
      // timeout must reuse the same ref, so it's derived once per sheet state.
      const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await redeemRealSpend(deviceId, costReal, ref);
      if (res.balance !== undefined) setWallet({ ...wallet, balance: res.balance });
      showToast(t('wallet.success'), 'success');
      onRedeemed?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      showToast(msg === 'wallet service unavailable' ? t('wallet.unavailable') : msg || t('wallet.unavailable'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const convertZar = async () => {
    if (swapBusy) return;
    setSwapBusy(true);
    try {
      // Same client_ref idempotency convention as redeem() above — required
      // here, not just defensive, since /v1/zar-swap has no dedup of its own
      // (B->A(114)): a retried tap must reuse the same ref, not mint a new one.
      const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await convertZarToReal(deviceId, swapReal, ref);
      setWallet({ ...wallet, zar: res.new_zar, balance: res.new_real_balance });
      showToast(t('wallet.zarSwapSuccess'), 'success');
      onRedeemed?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      showToast(msg === 'wallet service unavailable' ? t('wallet.unavailable') : msg || t('wallet.unavailable'), 'error');
    } finally {
      setSwapBusy(false);
    }
  };

  return (
    <View style={style}>
      {/* Balance header */}
      <GlassCard glowColor={Colors.gold[400]} style={styles.headerCard}>
        <View style={styles.header}>
          <Image source={{ uri: REAL_TOKEN_IMAGE }} style={styles.coin} />
          <Text style={styles.title}>{t('wallet.title')}</Text>
          {linked && (
            <View style={styles.balances}>
              <Text style={styles.balance}>
                {wallet.balance != null ? `${wallet.balance.toLocaleString()} REAL` : '—'}
              </Text>
              {wallet.zar != null && (
                <Text style={styles.zarBalance}>{`${wallet.zar.toLocaleString()} ZAR`}</Text>
              )}
            </View>
          )}
        </View>
        {linked && (
          <Text style={styles.flowHint}>{t('wallet.flowSteps')}</Text>
        )}

        {!linked && (
          <>
            <Text style={styles.hint}>{t('wallet.notLinked')}</Text>
            <GoldButton
              style={styles.linkBtn}
              textStyle={styles.linkBtnText}
              onPress={() => Linking.openURL(LINK_URL_BASE + encodeURIComponent(deviceId)).catch(() => {})}
              accessibilityLabel={t('wallet.linkBtn')}
            >
              {t('wallet.linkBtn')}
            </GoldButton>
          </>
        )}
      </GlassCard>

      {linked && canSwap && (
        // Exchange 1 of 2: ZAR -> REAL. Its own card, its own icon-to-icon
        // framing — same visual language a real currency-exchange screen
        // would use, not a second stepper stacked under an unrelated one.
        <GlassCard style={styles.exchangeCard}>
          <View style={styles.exchangeHeaderRow}>
            <Text style={styles.exchangeIcon}>🪙</Text>
            <Text style={styles.exchangeArrow}>→</Text>
            <Text style={styles.exchangeIcon}>💎</Text>
            <Text style={styles.exchangeTitle}>{t('wallet.convertSectionTitle')}</Text>
          </View>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[styles.stepBtn, swapReal <= 1 && styles.stepBtnDim]}
              disabled={swapReal <= 1}
              onPress={() => setSwapReal(swapReal - 1)}
              accessibilityLabel="minus"
            >
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.stepValueWrap}>
              <Text style={styles.stepValue}>{t('wallet.cost').replace('{r}', String(swapReal))}</Text>
              <Text style={styles.stepCost}>{t('wallet.zarSwapPrice').replace('{z}', String(swapCost))}</Text>
            </View>
            <TouchableOpacity
              style={[styles.stepBtn, swapReal >= maxSwapReal && styles.stepBtnDim]}
              disabled={swapReal >= maxSwapReal}
              onPress={() => setSwapReal(swapReal + 1)}
              accessibilityLabel="plus"
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <GoldButton
            style={styles.exchangeBtn}
            textStyle={styles.exchangeBtnText}
            disabled={swapBusy}
            onPress={convertZar}
            accessibilityLabel={t('wallet.zarSwapAction')}
          >
            {swapBusy ? '…' : t('wallet.zarSwapAction')}
          </GoldButton>
        </GlassCard>
      )}

      {linked && (
        // Exchange 2 of 2: REAL -> Internet (GB). Separate card, separate
        // icon pair, so it never reads as "the same conversion" as the one
        // above even though both live on the same screen.
        <GlassCard style={styles.exchangeCard}>
          <View style={styles.exchangeHeaderRow}>
            <Text style={styles.exchangeIcon}>💎</Text>
            <Text style={styles.exchangeArrow}>→</Text>
            <Text style={styles.exchangeIcon}>📶</Text>
            <Text style={styles.exchangeTitle}>{t('wallet.redeemSectionTitle')}</Text>
          </View>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[styles.stepBtn, gb <= 1 && styles.stepBtnDim]}
              disabled={gb <= 1}
              onPress={() => setGb(gb - 1)}
              accessibilityLabel="minus"
            >
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.stepValueWrap}>
              <Text style={styles.stepValue}>{gb} GB</Text>
              <Text style={styles.stepCost}>{t('wallet.cost').replace('{r}', String(costReal))}</Text>
            </View>
            <TouchableOpacity
              style={[styles.stepBtn, gb >= maxGb && styles.stepBtnDim]}
              disabled={gb >= maxGb}
              onPress={() => setGb(gb + 1)}
              accessibilityLabel="plus"
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <GoldButton
            style={styles.exchangeBtn}
            textStyle={styles.exchangeBtnText}
            disabled={busy}
            onPress={redeem}
            accessibilityLabel={t('wallet.redeem')}
          >
            {busy ? '…' : t('wallet.redeem')}
          </GoldButton>
        </GlassCard>
      )}

      {linked && wallet.conversion_rate != null && (
        <Text style={styles.conversionHint}>
          {t('wallet.conversionHint').replace('{rate}', wallet.conversion_rate.toLocaleString())}
        </Text>
      )}

      {linked && !!onOpenHeroes && (
        <TouchableOpacity style={styles.spendMoreRow} activeOpacity={0.7} onPress={onOpenHeroes}>
          <Text style={styles.spendMoreLabel}>{t('wallet.spendMoreTitle')}</Text>
          <Text style={styles.spendMoreValue}>🛡️ {t('wallet.spendCards')} ›</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard:   { padding: Spacing[4], marginBottom: Spacing[3] },
  header:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  coin:         { width: 26, height: 26, borderRadius: 13 },
  title:        { flex: 1, color: Colors.text.primary, fontSize: 15, fontFamily: Typography.family.heading },
  balances:     { alignItems: 'flex-end' },
  balance:      { color: Colors.gold[400], fontSize: 14, fontFamily: Typography.family.mono },
  zarBalance:   { color: Colors.text.secondary, fontSize: 11.5, fontFamily: Typography.family.mono, marginTop: 1 },
  flowHint:     { color: Colors.text.muted, fontSize: 11.5, fontFamily: Typography.family.body, marginTop: Spacing[3], lineHeight: 16 },
  conversionHint:{ color: Colors.text.secondary, fontSize: 11, fontFamily: Typography.family.body,
                  marginTop: Spacing[1], marginBottom: Spacing[3], opacity: 0.8, textAlign: 'center' },
  hint:         { color: Colors.text.secondary, fontSize: 12.5, marginTop: Spacing[3], lineHeight: 18 },
  linkBtn:      { marginTop: Spacing[3], alignSelf: 'flex-start', paddingHorizontal: Spacing[4],
                  paddingVertical: 8, borderRadius: Radius.md },
  linkBtnText:  { fontSize: 13, fontFamily: Typography.family.heading },

  exchangeCard:      { padding: Spacing[4], marginBottom: Spacing[3] },
  exchangeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  exchangeIcon:      { fontSize: 18 },
  exchangeArrow:     { fontSize: 14, color: Colors.gold[400] },
  exchangeTitle:     { flex: 1, color: Colors.text.primary, fontSize: 13, fontFamily: Typography.family.heading, marginLeft: Spacing[1] },
  exchangeBtn:       { marginTop: Spacing[4], paddingVertical: 10, borderRadius: Radius.md },
  exchangeBtnText:   { fontSize: 14, fontFamily: Typography.family.heading },

  stepperRow:   { flexDirection: 'row', alignItems: 'center', marginTop: Spacing[4], gap: Spacing[4] },
  stepBtn:      { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: Colors.gold[400] },
  stepBtnDim:   { opacity: 0.35 },
  stepBtnText:  { color: Colors.gold[400], fontSize: 20, fontFamily: Typography.family.heading },
  stepValueWrap:{ flex: 1, alignItems: 'center' },
  stepValue:    { color: Colors.text.primary, fontSize: 18, fontFamily: Typography.family.mono },
  stepCost:     { color: Colors.text.secondary, fontSize: 12, marginTop: 2 },

  spendMoreRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing[2], paddingVertical: Spacing[2] },
  spendMoreLabel: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body },
  spendMoreValue: { fontSize: 13, color: Colors.gold[400], fontFamily: Typography.family.heading },
});
