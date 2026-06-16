/**
 * PremiumScreen — "Upgrade with REAL".
 *
 * REAL-first premium purchase. Packages/prices come from the server (never hardcoded);
 * payment is server-verified via the intent flow. REAL is the native Realink / SETAEI /
 * Shahnameh ecosystem utility token, shown first and visually highlighted with its
 * discount. USDT is shown only when the backend reports methods.USDT = true.
 *
 * Compliance: utility/payment token only — no investment language, no price/profit claims.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n';
import { trackEvent, Events } from '../services/analytics';
import {
  getPremiumPackages, createPaymentIntent, getPaymentStatus, tonkeeperLink,
  PremiumPackage, PaymentMethod, PaymentIntent,
} from '../services/paymentsApi';

const GOLD = Colors.gold[400];
const GOLD_SOFT = 'rgba(212,175,55,0.12)';
const INK = Colors.text.primary;
const DIM = Colors.text.secondary;

interface Props { onBack: () => void; }

export function PremiumScreen({ onBack }: Props) {
  const { t, isRTL } = useT();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const deviceId = useAuthStore((s) => s.user?.deviceId) || '';

  const [packages, setPackages] = useState<PremiumPackage[]>([]);
  const [methods, setMethods]   = useState<{ REAL: boolean; USDT: boolean }>({ REAL: true, USDT: false });
  const [discount, setDiscount] = useState(20);
  const [loading, setLoading]   = useState(true);
  const [method, setMethod]     = useState<PaymentMethod>('REAL');
  const [selected, setSelected] = useState('');
  const [intent, setIntent]     = useState<PaymentIntent | null>(null);
  const [busy, setBusy]         = useState(false);
  const [note, setNote]         = useState('');
  const [done, setDone]         = useState(false);

  useEffect(() => {
    trackEvent(Events.PREMIUM_SCREEN_OPENED, deviceId);
    getPremiumPackages()
      .then((r) => {
        const active = (r.packages || []).filter((p) => p.is_active);
        setPackages(active);
        if (r.methods) setMethods({ REAL: !!r.methods.REAL, USDT: !!r.methods.USDT });
        if (r.real?.discount_percent) setDiscount(Math.round(r.real.discount_percent));
        const rec = active.find((p) => p.is_recommended) || active[0];
        if (rec) setSelected(rec.package_id);
      })
      .catch(() => setNote(t('pm.loadError')))
      .finally(() => setLoading(false));
  }, []);

  const pkg = packages.find((p) => p.package_id === selected) || null;
  const priceOf = (p: PremiumPackage) => (method === 'REAL' ? p.real_price : p.usdt_price);

  const selectPkg = (id: string) => {
    setSelected(id);
    trackEvent(Events.PREMIUM_PACKAGE_SELECTED, deviceId, { package_id: id, method });
  };

  const handleContinue = async () => {
    if (!pkg || busy || !deviceId) return;
    setBusy(true); setNote('');
    try {
      const i = await createPaymentIntent(deviceId, pkg.package_id, method);
      setIntent(i); setDone(false);
      trackEvent(Events.PAYMENT_INTENT_CREATED, deviceId,
        { payment_id: i.payment_id, method: i.method, package_id: pkg.package_id, amount: i.amount });
      try {
        await Linking.openURL(tonkeeperLink(i));
        trackEvent(Events.TONKEEPER_OPENED, deviceId, { payment_id: i.payment_id, method: i.method });
      } catch { setNote(t('pm.openTkError')); }
    } catch (e) {
      setNote((e as Error).message || t('pm.startError'));
      trackEvent(Events.PAYMENT_FAILED, deviceId, { stage: 'intent', error: (e as Error).message });
    } finally { setBusy(false); }
  };

  const handleCheck = async () => {
    if (!intent || busy || !deviceId) return;
    setBusy(true); setNote('');
    try {
      const s = await getPaymentStatus(deviceId, intent.payment_id);
      if (s.status === 'confirmed') {
        setDone(true); setNote(t('pm.confirmed'));
        trackEvent(intent.method === 'REAL' ? Events.PAYMENT_CONFIRMED_REAL : Events.PAYMENT_CONFIRMED_USDT,
          deviceId, { payment_id: intent.payment_id, gb: s.gb_amount });
      } else if (s.status === 'expired') {
        setNote(t('pm.expired')); setIntent(null);
        trackEvent(Events.PAYMENT_FAILED, deviceId, { payment_id: intent.payment_id, status: 'expired' });
      } else if (s.status === 'rejected') {
        setNote(t('pm.rejected'));
        trackEvent(Events.PAYMENT_FAILED, deviceId, { payment_id: intent.payment_id, status: 'rejected', reason: s.reason });
      } else {
        setNote(t('pm.notDetected'));
      }
    } catch (e) {
      setNote((e as Error).message || t('pm.startError'));
    } finally { setBusy(false); }
  };

  const showUsdt = methods.USDT; // hide USDT entirely when backend says it's unavailable
  const ta = isRTL ? ('right' as const) : ('left' as const);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
            <Text style={styles.back}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>{t('pm.title')}</Text>
            <Text style={styles.subtitle}>{t('pm.subtitle')}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Method chooser — REAL always first + highlighted */}
        <View style={styles.methods}>
          <TouchableOpacity
            style={[styles.method, method === 'REAL' && styles.methodReal]}
            onPress={() => setMethod('REAL')} activeOpacity={0.85}
          >
            <View style={styles.methodTop}>
              <Text style={[styles.methodName, method === 'REAL' && { color: GOLD }]}>REAL</Text>
              <View style={styles.badge}><Text style={styles.badgeText}>{t('pm.bestValue')}</Text></View>
            </View>
            <Text style={styles.methodSaveBig}>{t('pm.saveWithReal').replace('{pct}', String(discount))}</Text>
            <Text style={[styles.methodHint, { textAlign: ta }]}>{t('pm.ecosystemCopy')}</Text>
          </TouchableOpacity>

          {showUsdt ? (
            <TouchableOpacity
              style={[styles.method, method === 'USDT' && styles.methodUsdt]}
              onPress={() => setMethod('USDT')} activeOpacity={0.85}
            >
              <View style={styles.methodTop}>
                <Text style={[styles.methodName, method === 'USDT' && { color: Colors.text.primary }]}>USDT</Text>
              </View>
              <Text style={styles.methodSub}>{t('pm.standard')}</Text>
              <Text style={[styles.methodHint, { textAlign: ta }]}>{t('pm.usdtCopy')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator color={GOLD} style={{ marginTop: Spacing[8] }} />
        ) : (
          <GlassCard>
            <Text style={[styles.cardLabel, { textAlign: ta }]}>{t('pm.choosePackage')}</Text>
            {packages.map((p) => {
              const isSel = p.package_id === selected;
              const pr = priceOf(p);
              const ppg = p.gb_amount > 0 ? `$${(pr / p.gb_amount).toFixed(2)}/GB` : '';
              return (
                <TouchableOpacity
                  key={p.package_id}
                  style={[styles.pkg, isSel && (method === 'REAL' ? styles.pkgSelReal : styles.pkgSel)]}
                  onPress={() => selectPkg(p.package_id)} activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pkgGb}>{t('pm.gbPremium').replace('{gb}', String(p.gb_amount))}</Text>
                    {ppg ? <Text style={styles.pkgPerGb}>{ppg}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.pkgPrice, method === 'REAL' && { color: GOLD }]}>${pr.toFixed(2)}</Text>
                    {method === 'REAL' ? (
                      <Text style={styles.pkgWas}>
                        USDT ${p.usdt_price.toFixed(2)} · {t('pm.save').replace('{pct}', String(Math.round(p.real_discount_percent)))}
                      </Text>
                    ) : (
                      <Text style={styles.pkgWas}>USDT</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </GlassCard>
        )}

        {intent ? (
          <GlassCard glowColor={GOLD}>
            <Text style={[styles.cardLabel, { textAlign: ta }]}>
              {done ? t('pm.paid') : t('pm.completePayment')}
            </Text>
            {!done ? (
              <>
                <Text style={styles.kv}>{t('pm.amount')}: <Text style={styles.kvStrong}>{intent.amount} {intent.method}</Text></Text>
                <Text style={styles.kv}>{t('pm.estGb').replace('{gb}', String(intent.gb_amount))}</Text>
                <Text style={styles.kv}>{t('pm.sendTo')}: <Text style={styles.kvMono}>{intent.destination_wallet}</Text></Text>
                <Text style={styles.kv}>{t('pm.memoRequired')}: <Text style={styles.kvMono}>{intent.memo}</Text></Text>
                <Text style={[styles.kvDim, { textAlign: ta }]}>{t('pm.payInstructions')}</Text>
              </>
            ) : (
              <Text style={styles.kvStrong}>{t('pm.confirmed')}</Text>
            )}
          </GlassCard>
        ) : null}

        {note && !intent ? <Text style={styles.note}>{note}</Text> : null}
        <View style={{ height: 180 + bottomInset }} />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(Spacing[6], bottomInset) + Spacing[2] }]}>
        {done ? (
          <TouchableOpacity style={[styles.cta, styles.ctaReal]} onPress={onBack} activeOpacity={0.9}>
            <Text style={[styles.ctaText, { color: '#1a1304' }]}>{t('pm.done')}</Text>
          </TouchableOpacity>
        ) : !intent ? (
          <TouchableOpacity
            style={[styles.cta, method === 'REAL' ? styles.ctaReal : styles.ctaUsdt, (busy || !pkg) && { opacity: 0.5 }]}
            onPress={handleContinue} disabled={busy || !pkg} activeOpacity={0.9}
          >
            <Text style={[styles.ctaText, method === 'REAL' && { color: '#1a1304' }]}>
              {busy ? t('pm.starting') : pkg ? `${t('pm.pay')} ${priceOf(pkg).toFixed(2)} ${method}` : t('pm.selectPackage')}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.cta, styles.ctaReal, busy && { opacity: 0.5 }]} onPress={handleCheck} disabled={busy} activeOpacity={0.9}>
            <Text style={[styles.ctaText, { color: '#1a1304' }]}>{busy ? t('pm.checking') : t('pm.checkPayment')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg.base },
  content: { padding: Spacing[5] },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[5] },
  back: { color: INK, fontSize: 34, width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { color: GOLD, fontSize: 22, fontWeight: '800' },
  subtitle: { color: DIM, fontSize: 13, marginTop: 2, textAlign: 'center' },

  methods: { flexDirection: 'row', gap: Spacing[3], marginBottom: Spacing[5] },
  method: { flex: 1, padding: Spacing[4], borderRadius: 16, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface },
  methodReal: { borderColor: GOLD, backgroundColor: GOLD_SOFT },
  methodUsdt: { borderColor: Colors.blue[400] },
  methodTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  methodName: { color: INK, fontSize: 18, fontWeight: '800' },
  badge: { backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#1a1304', fontSize: 10, fontWeight: '800' },
  methodSaveBig: { color: GOLD, fontSize: 13, fontWeight: '800', marginTop: 4 },
  methodSub: { color: DIM, fontSize: 12, fontWeight: '700', marginTop: 4 },
  methodHint: { color: DIM, fontSize: 11, marginTop: 4, lineHeight: 15 },

  cardLabel: { color: DIM, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[3] },
  pkg: { flexDirection: 'row', alignItems: 'center', padding: Spacing[4], borderRadius: 12, borderWidth: 1, borderColor: Colors.border.default, marginBottom: Spacing[3] },
  pkgSel: { borderColor: Colors.blue[400] },
  pkgSelReal: { borderColor: GOLD, backgroundColor: GOLD_SOFT },
  pkgGb: { color: INK, fontSize: 16, fontWeight: '700' },
  pkgPerGb: { color: DIM, fontSize: 12, marginTop: 2 },
  pkgPrice: { color: INK, fontSize: 18, fontWeight: '800' },
  pkgWas: { color: DIM, fontSize: 11, marginTop: 2 },

  kv: { color: INK, fontSize: 13, marginTop: 4 },
  kvStrong: { color: GOLD, fontWeight: '800', fontSize: 14, marginTop: 4 },
  kvMono: { color: INK, fontFamily: 'monospace', fontSize: 12 },
  kvDim: { color: DIM, fontSize: 12, marginTop: Spacing[3], lineHeight: 17 },
  note: { color: GOLD, fontSize: 13, marginTop: Spacing[4], textAlign: 'center' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing[5], paddingTop: Spacing[3], backgroundColor: Colors.bg.base, borderTopWidth: 1, borderTopColor: Colors.border.default },
  cta: { borderRadius: 14, paddingVertical: Spacing[4], alignItems: 'center' },
  ctaReal: { backgroundColor: GOLD },
  ctaUsdt: { backgroundColor: Colors.blue[400] },
  ctaText: { fontSize: 16, fontWeight: '800', color: INK },
});
