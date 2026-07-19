/**
 * RealWalletCard — REAL → data redemption on the Profile screen (plan A3).
 *
 * Remote-config gated (`ecosystem.wallet_enabled`, default OFF) so it can
 * roll out server-side without an app release. Three states:
 *   hidden    flag off, or wallet info hasn't loaded yet
 *   unlinked  link CTA → opens the Shahnameh bot with the device_id so the
 *             ecosystem backend can mint the signed link proof (task B-3)
 *   linked    balance (— when the service can't answer), GB stepper priced
 *             from server rates, one-tap redeem via the panel-orchestrated
 *             debit (retry-safe on client_ref — see realWalletService).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { REAL_TOKEN_IMAGE } from './EcosystemBanner';
import { useT } from '../i18n';
import { useToastStore } from '../stores/toastStore';
import { getCachedConfig, getRemoteConfig } from '../services/remoteConfigService';
import {
  getRealWallet, redeemRealSpend, RealWalletInfo,
} from '../services/realWalletService';

const ONE_GB = 1073741824;
const LINK_URL_BASE = 'https://t.me/shahnameh_bot?start=linkvpn_';

type Props = {
  deviceId: string;
  /** Called after a successful redeem so the owner refreshes the quota. */
  onRedeemed?: () => void;
  style?: object;
};

export function RealWalletCard({ deviceId, onRedeemed, style }: Props) {
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

  useEffect(() => {
    console.log('[REALDBG][wallet] mount', {
      deviceId, cachedEnabled: getCachedConfig()?.ecosystem?.wallet_enabled === true,
    });
    let cancelled = false;
    getRemoteConfig()
      .then((cfg) => {
        const live = cfg?.ecosystem?.wallet_enabled === true;
        console.log('[REALDBG][wallet] getRemoteConfig resolved', { live, ecosystem: cfg?.ecosystem });
        if (!cancelled) setEnabled(live);
      })
      .catch((e) => console.log('[REALDBG][wallet] getRemoteConfig threw', e));
    return () => { cancelled = true; };
  }, [deviceId]);

  useEffect(() => {
    console.log('[REALDBG][wallet] fetch-wallet effect', { enabled, deviceId, hasDeviceId: !!deviceId });
    if (!enabled || !deviceId) return;
    getRealWallet(deviceId)
      .then((w) => {
        console.log('[REALDBG][wallet] getRealWallet resolved', w);
        setWallet(w);
      })
      .catch((e) => console.log('[REALDBG][wallet] getRealWallet threw', e));
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

  if (!enabled || !wallet) {
    console.log('[REALDBG][wallet] render: null (hidden)', { enabled, hasWallet: !!wallet });
    return null;
  }

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

  return (
    <GlassCard glowColor={Colors.gold[400]} style={[styles.card, style]}>
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

      {linked && wallet.conversion_rate != null && (
        <Text style={styles.conversionHint}>
          {t('wallet.conversionHint').replace('{rate}', wallet.conversion_rate.toLocaleString())}
        </Text>
      )}

      {!linked ? (
        <>
          <Text style={styles.hint}>{t('wallet.notLinked')}</Text>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => Linking.openURL(LINK_URL_BASE + encodeURIComponent(deviceId)).catch(() => {})}
            accessibilityLabel={t('wallet.linkBtn')}
          >
            <Text style={styles.linkBtnText}>{t('wallet.linkBtn')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
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
          <TouchableOpacity
            style={[styles.redeemBtn, busy && styles.stepBtnDim]}
            disabled={busy}
            onPress={redeem}
            accessibilityLabel={t('wallet.redeem')}
          >
            <Text style={styles.redeemBtnText}>{busy ? '…' : t('wallet.redeem')}</Text>
          </TouchableOpacity>
        </>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card:         { padding: Spacing[4], marginBottom: Spacing[4] },
  header:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  coin:         { width: 26, height: 26, borderRadius: 13 },
  title:        { flex: 1, color: Colors.text.primary, fontSize: 15, fontFamily: Typography.family.heading },
  balances:     { alignItems: 'flex-end' },
  balance:      { color: Colors.gold[400], fontSize: 14, fontFamily: Typography.family.heading },
  zarBalance:   { color: Colors.text.secondary, fontSize: 11.5, fontFamily: Typography.family.body, marginTop: 1 },
  conversionHint:{ color: Colors.text.secondary, fontSize: 11, fontFamily: Typography.family.body,
                  marginTop: Spacing[2], opacity: 0.8 },
  hint:         { color: Colors.text.secondary, fontSize: 12.5, marginTop: Spacing[3], lineHeight: 18 },
  linkBtn:      { marginTop: Spacing[3], alignSelf: 'flex-start', paddingHorizontal: Spacing[4],
                  paddingVertical: 8, borderRadius: Radius.md, backgroundColor: Colors.gold[400] },
  linkBtnText:  { color: '#1A1405', fontSize: 13, fontFamily: Typography.family.heading },
  stepperRow:   { flexDirection: 'row', alignItems: 'center', marginTop: Spacing[4], gap: Spacing[4] },
  stepBtn:      { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: Colors.gold[400] },
  stepBtnDim:   { opacity: 0.35 },
  stepBtnText:  { color: Colors.gold[400], fontSize: 20, fontFamily: Typography.family.heading },
  stepValueWrap:{ flex: 1, alignItems: 'center' },
  stepValue:    { color: Colors.text.primary, fontSize: 18, fontFamily: Typography.family.heading },
  stepCost:     { color: Colors.text.secondary, fontSize: 12, marginTop: 2 },
  redeemBtn:    { marginTop: Spacing[4], alignItems: 'center', paddingVertical: 10,
                  borderRadius: Radius.md, backgroundColor: Colors.gold[400] },
  redeemBtnText:{ color: '#1A1405', fontSize: 14, fontFamily: Typography.family.heading },
});
