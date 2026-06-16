/**
 * PremiumScreen — "Upgrade with REAL".
 *
 * REAL-first premium purchase UI. Packages + prices are fetched from the server
 * (never hardcoded); payment is server-verified via the intent flow. REAL is the
 * native Realink / SETAEI / Shahnameh ecosystem utility token, offered at a discount.
 *
 * PREPARED, NOT WIRED: not yet referenced by the navigator — hook-up + APK build
 * happen in the dedicated mobile round. Compliance: utility/payment token only —
 * no investment language, no price/profit claims.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import {
  getPremiumPackages, createPaymentIntent, getPaymentStatus, tonkeeperLink,
  PremiumPackage, PaymentMethod, PaymentIntent,
} from '../services/paymentsApi';

// Local palette so this prepared screen is self-contained (refined in the mobile round).
const GOLD = Colors.gold[400];
const GOLD_SOFT = 'rgba(212,175,55,0.12)';
const INK = Colors.text.primary;
const DIM = Colors.text.secondary;

interface Props { onBack: () => void; }

export function PremiumScreen({ onBack }: Props) {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const deviceId = user?.deviceId || '';

  const [packages, setPackages]   = useState<PremiumPackage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [method, setMethod]       = useState<PaymentMethod>('REAL');
  const [selected, setSelected]   = useState<string>('');
  const [intent, setIntent]       = useState<PaymentIntent | null>(null);
  const [busy, setBusy]           = useState(false);
  const [note, setNote]           = useState('');

  useEffect(() => {
    getPremiumPackages()
      .then((r) => {
        const active = (r.packages || []).filter((p) => p.is_active);
        setPackages(active);
        const rec = active.find((p) => p.is_recommended) || active[0];
        if (rec) setSelected(rec.package_id);
      })
      .catch(() => setNote('Could not load packages. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  const pkg = packages.find((p) => p.package_id === selected) || null;
  const price = (p: PremiumPackage) => (method === 'REAL' ? p.real_price : p.usdt_price);

  const handleContinue = async () => {
    if (!pkg || busy || !deviceId) return;
    setBusy(true); setNote('');
    try {
      const i = await createPaymentIntent(deviceId, pkg.package_id, method);
      setIntent(i);
      try { await Linking.openURL(tonkeeperLink(i)); }
      catch { setNote('Open Tonkeeper and send the exact amount with the memo shown.'); }
    } catch (e) {
      setNote((e as Error).message || 'Could not start payment.');
    } finally { setBusy(false); }
  };

  const handleCheck = async () => {
    if (!intent || busy || !deviceId) return;
    setBusy(true); setNote('');
    try {
      const s = await getPaymentStatus(deviceId, intent.payment_id);
      if (s.status === 'confirmed') { setNote('✓ Payment confirmed — data added to your account.'); }
      else if (s.status === 'expired') { setNote('This payment expired. Start again.'); setIntent(null); }
      else if (s.status === 'rejected') { setNote('Payment could not be verified.'); }
      else { setNote('Not detected yet. After paying, wait a moment and check again.'); }
    } catch (e) {
      setNote((e as Error).message || 'Could not check payment.');
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
            <Text style={styles.back}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>Upgrade with REAL</Text>
            <Text style={styles.subtitle}>Pay with REAL and get more data for less.</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Method chooser */}
        <View style={styles.methods}>
          <TouchableOpacity
            style={[styles.method, method === 'REAL' && styles.methodReal]}
            onPress={() => setMethod('REAL')} activeOpacity={0.85}
          >
            <View style={styles.methodTop}>
              <Text style={[styles.methodName, method === 'REAL' && { color: GOLD }]}>REAL</Text>
              <View style={styles.badge}><Text style={styles.badgeText}>Best value</Text></View>
            </View>
            <Text style={styles.methodSub}>Ecosystem discount</Text>
            <Text style={styles.methodHint}>Native token of the SETAEI / Shahnameh / Realink ecosystem.</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.method, method === 'USDT' && styles.methodUsdt]}
            onPress={() => setMethod('USDT')} activeOpacity={0.85}
          >
            <View style={styles.methodTop}>
              <Text style={[styles.methodName, method === 'USDT' && { color: Colors.text.primary }]}>USDT</Text>
            </View>
            <Text style={styles.methodSub}>Standard</Text>
            <Text style={styles.methodHint}>Pay the regular price in USDT.</Text>
          </TouchableOpacity>
        </View>

        {/* Packages */}
        {loading ? (
          <ActivityIndicator color={GOLD} style={{ marginTop: Spacing[8] }} />
        ) : (
          <GlassCard>
            <Text style={styles.cardLabel}>Choose a package</Text>
            {packages.map((p) => {
              const isSel = p.package_id === selected;
              const ppg = p.gb_amount > 0 ? `$${(price(p) / p.gb_amount).toFixed(2)}/GB` : '';
              return (
                <TouchableOpacity
                  key={p.package_id}
                  style={[styles.pkg, isSel && (method === 'REAL' ? styles.pkgSelReal : styles.pkgSel)]}
                  onPress={() => setSelected(p.package_id)} activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pkgGb}>{p.gb_amount} GB Premium</Text>
                    {ppg ? <Text style={styles.pkgPerGb}>{ppg}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.pkgPrice, method === 'REAL' && { color: GOLD }]}>
                      ${price(p).toFixed(2)}
                    </Text>
                    {method === 'REAL' ? (
                      <Text style={styles.pkgWas}>USDT ${p.usdt_price.toFixed(2)} · save {Math.round(p.real_discount_percent)}%</Text>
                    ) : (
                      <Text style={styles.pkgWas}>USDT</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </GlassCard>
        )}

        {/* Pending intent */}
        {intent ? (
          <GlassCard glowColor={GOLD}>
            <Text style={styles.cardLabel}>Complete your payment</Text>
            <Text style={styles.kv}>Amount: <Text style={styles.kvStrong}>{intent.amount} {intent.method}</Text></Text>
            <Text style={styles.kv}>Send to: <Text style={styles.kvMono}>{intent.destination_wallet}</Text></Text>
            <Text style={styles.kv}>Memo (required): <Text style={styles.kvMono}>{intent.memo}</Text></Text>
            <Text style={styles.kvDim}>Open Tonkeeper, send the exact amount with the memo, then tap “Check payment”.</Text>
          </GlassCard>
        ) : null}

        {note ? <Text style={styles.note}>{note}</Text> : null}
        <View style={{ height: 180 + bottomInset }} />
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: Math.max(Spacing[6], bottomInset) + Spacing[2] }]}>
        {!intent ? (
          <TouchableOpacity
            style={[styles.cta, method === 'REAL' ? styles.ctaReal : styles.ctaUsdt, (busy || !pkg) && { opacity: 0.5 }]}
            onPress={handleContinue} disabled={busy || !pkg} activeOpacity={0.9}
          >
            <Text style={[styles.ctaText, method === 'REAL' && { color: '#1a1304' }]}>
              {busy ? 'Starting…' : pkg ? `Pay ${price(pkg).toFixed(2)} ${method}` : 'Select a package'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.cta, styles.ctaReal, busy && { opacity: 0.5 }]}
            onPress={handleCheck} disabled={busy} activeOpacity={0.9}
          >
            <Text style={[styles.ctaText, { color: '#1a1304' }]}>{busy ? 'Checking…' : 'Check payment'}</Text>
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
  methodSub: { color: GOLD, fontSize: 12, fontWeight: '700', marginTop: 4 },
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
  kvStrong: { color: GOLD, fontWeight: '800' },
  kvMono: { color: INK, fontFamily: 'monospace', fontSize: 12 },
  kvDim: { color: DIM, fontSize: 12, marginTop: Spacing[3], lineHeight: 17 },
  note: { color: GOLD, fontSize: 13, marginTop: Spacing[4], textAlign: 'center' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing[5], paddingTop: Spacing[3], backgroundColor: Colors.bg.base, borderTopWidth: 1, borderTopColor: Colors.border.default },
  cta: { borderRadius: 14, paddingVertical: Spacing[4], alignItems: 'center' },
  ctaReal: { backgroundColor: GOLD },
  ctaUsdt: { backgroundColor: Colors.blue[400] },
  ctaText: { fontSize: 16, fontWeight: '800', color: INK },
});
