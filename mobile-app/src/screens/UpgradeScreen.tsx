import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Clipboard, Linking, Alert,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { mobilePostPayment } from '../services/entitlementService';

const WALLET_ADDRESS = 'UQBWUvIAvNpzjAR4BB1kjQFHXCLA1bSRPb_7B-ZMcRy65nIJ';
const USDT_CONTRACT  = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

interface Package {
  gb:   number;
  usd:  number;
  label: string;
  key:  string;
}

const PACKAGES: Package[] = [
  { gb: 10,  usd: 3,  label: '10 GB',  key: '10GB'  },
  { gb: 20,  usd: 5,  label: '20 GB',  key: '30days' },
  { gb: 30,  usd: 7,  label: '30 GB',  key: '30days' },
  { gb: -1,  usd: 15, label: 'Unlimited', key: 'unlimited' },
];

interface Props {
  onBack: () => void;
}

export function UpgradeScreen({ onBack }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(1);
  const [copied, setCopied]           = useState<string | null>(null);
  const user      = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);

  const pkg      = PACKAGES[selectedIdx];
  const deviceId = user?.deviceId ?? 'unknown';
  const amountStr = `${pkg.usd} USDT`;
  const amountUnits = pkg.usd * 1_000_000; // USDT has 6 decimals on TON

  const tonkeeperUrl =
    `https://app.tonkeeper.com/transfer/${WALLET_ADDRESS}` +
    `?jetton=${USDT_CONTRACT}` +
    `&amount=${amountUnits}` +
    `&text=${encodeURIComponent(deviceId)}`;

  const handleCopy = (type: string, value: string) => {
    Clipboard.setString(value);
    setCopied(type);
    showToast(`${type} copied`, 'success', 1500);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleOpenTonkeeper = async () => {
    try {
      const supported = await Linking.canOpenURL(tonkeeperUrl);
      if (!supported) {
        // Fallback: open Tonkeeper in browser
        Linking.openURL('https://tonkeeper.com');
        return;
      }
      await Linking.openURL(tonkeeperUrl);
    } catch {
      showToast('Could not open Tonkeeper', 'error', 2500);
    }
  };

  const [submitting, setSubmitting] = useState(false);

  const handlePaid = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await mobilePostPayment(deviceId, pkg.key, `${pkg.usd} USDT`);
      Alert.alert(
        'Payment submitted',
        `Your payment of ${pkg.usd} USDT for ${pkg.label} has been submitted.\n\nActivation within 24 hours after verification.`,
        [{ text: 'OK', onPress: onBack }],
      );
    } catch {
      showToast('Could not submit — please contact support', 'error', 3000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>Add Data</Text>
            <Text style={styles.subtitle}>Pay with USDT on TON network</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Package selector */}
        <GlassCard>
          <Text style={styles.cardLabel}>SELECT PACKAGE</Text>
          <View style={styles.pkgGrid}>
            {PACKAGES.map((p, i) => (
              <TouchableOpacity
                key={p.gb}
                style={[styles.pkgCard, selectedIdx === i && styles.pkgCardActive]}
                onPress={() => setSelectedIdx(i)}
                activeOpacity={0.8}
              >
                <Text style={[styles.pkgGb, selectedIdx === i && styles.pkgGbActive]}>
                  {p.label}
                </Text>
                <Text style={[styles.pkgPrice, selectedIdx === i && styles.pkgPriceActive]}>
                  ${p.usd}
                </Text>
                <Text style={styles.pkgCurrency}>USDT</Text>
              </TouchableOpacity>
            ))}
          </View>
        </GlassCard>

        {/* Payment instructions */}
        <GlassCard style={styles.payCard} glowColor={Colors.emerald[400]}>
          <Text style={styles.cardLabel}>PAYMENT INSTRUCTIONS</Text>

          <View style={styles.stepRow}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
            <Text style={styles.stepText}>Send exactly <Text style={styles.stepHighlight}>{amountStr}</Text> to this wallet on TON network</Text>
          </View>

          {/* Wallet */}
          <View style={styles.copyRow}>
            <View style={styles.copyLabel}>
              <Text style={styles.copyLabelText}>Wallet</Text>
            </View>
            <Text style={styles.copyValue} numberOfLines={2}>{WALLET_ADDRESS}</Text>
            <TouchableOpacity
              style={[styles.copyBtn, copied === 'Wallet' && styles.copyBtnActive]}
              onPress={() => handleCopy('Wallet', WALLET_ADDRESS)}
              activeOpacity={0.75}
            >
              <Text style={styles.copyBtnText}>{copied === 'Wallet' ? '✓' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>

          {/* Amount */}
          <View style={styles.copyRow}>
            <View style={styles.copyLabel}>
              <Text style={styles.copyLabelText}>Amount</Text>
            </View>
            <Text style={styles.copyValue}>{amountStr}</Text>
            <TouchableOpacity
              style={[styles.copyBtn, copied === 'Amount' && styles.copyBtnActive]}
              onPress={() => handleCopy('Amount', `${pkg.usd}`)}
              activeOpacity={0.75}
            >
              <Text style={styles.copyBtnText}>{copied === 'Amount' ? '✓' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.stepRow}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
            <Text style={styles.stepText}>Include your <Text style={styles.stepHighlight}>Device ID</Text> as the payment memo/comment</Text>
          </View>

          {/* Device ID */}
          <View style={[styles.copyRow, styles.copyRowHighlight]}>
            <View style={styles.copyLabel}>
              <Text style={styles.copyLabelText}>Memo</Text>
            </View>
            <Text style={styles.copyValue} numberOfLines={1}>{deviceId}</Text>
            <TouchableOpacity
              style={[styles.copyBtn, copied === 'Memo' && styles.copyBtnActive]}
              onPress={() => handleCopy('Memo', deviceId)}
              activeOpacity={0.75}
            >
              <Text style={styles.copyBtnText}>{copied === 'Memo' ? '✓' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.warningRow}>
            <Text style={styles.warningText}>
              ⚠ The memo is required to identify your payment. Missing memo = unverifiable payment.
            </Text>
          </View>
        </GlassCard>

        {/* Token info */}
        <GlassCard style={styles.tokenCard}>
          <Text style={styles.cardLabel}>TOKEN INFO</Text>
          <View style={styles.tokenRow}>
            <View style={styles.tokenItem}>
              <Text style={styles.tokenLabel}>Network</Text>
              <Text style={styles.tokenValue}>TON</Text>
            </View>
            <View style={styles.tokenItem}>
              <Text style={styles.tokenLabel}>Token</Text>
              <Text style={styles.tokenValue}>USDt (USDT)</Text>
            </View>
            <View style={styles.tokenItem}>
              <Text style={styles.tokenLabel}>Activation</Text>
              <Text style={styles.tokenValue}>≤ 24 hours</Text>
            </View>
          </View>
        </GlassCard>

        <View style={{ height: 140 }} />
      </ScrollView>

      {/* Sticky footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.tonBtn}
          onPress={handleOpenTonkeeper}
          activeOpacity={0.85}
        >
          <Text style={styles.tonBtnText}>Open Tonkeeper to Pay {amountStr}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.paidBtn, submitting && { opacity: 0.5 }]}
          onPress={handlePaid}
          activeOpacity={0.8}
          disabled={submitting}
        >
          <Text style={styles.paidBtnText}>{submitting ? 'Submitting…' : 'I have paid — notify admin'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.base },
  scroll:  { flex: 1 },
  content: {
    paddingTop:        Layout.statusBarHeight + Spacing[2],
    paddingHorizontal: Layout.screenPadding,
    gap:               Spacing[4],
  },

  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon:    { fontSize: 24, color: Colors.text.primary, marginTop: -2 },
  headerCenter:{ alignItems: 'center', gap: 2 },
  title:       { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  subtitle:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted },

  cardLabel: {
    fontSize: Typography.size.xs, fontFamily: Typography.family.label,
    color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1.2,
    marginBottom: Spacing[3],
  },

  // Package grid
  pkgGrid: { flexDirection: 'row', gap: Spacing[2] },
  pkgCard: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing[4], paddingHorizontal: Spacing[2],
    backgroundColor: Colors.bg.elevated, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border.default, gap: 2,
  },
  pkgCardActive:  { borderColor: Colors.emerald[400], backgroundColor: 'rgba(0,232,122,0.08)' },
  pkgGb:          { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  pkgGbActive:    { color: Colors.emerald[400] },
  pkgPrice:       { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pkgPriceActive: { color: Colors.emerald[400] },
  pkgCurrency:    { fontSize: 10, fontFamily: Typography.family.label, color: Colors.text.muted },

  // Payment card
  payCard:  { gap: Spacing[3] },
  stepRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3] },
  stepNum:  { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,232,122,0.15)', borderWidth: 1, borderColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  stepNumText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  stepText: { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  stepHighlight: { color: Colors.emerald[400], fontFamily: Typography.family.label },

  copyRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[2],
    backgroundColor: Colors.bg.elevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border.default, padding: Spacing[3],
  },
  copyRowHighlight: { borderColor: 'rgba(0,232,122,0.35)', backgroundColor: 'rgba(0,232,122,0.05)' },
  copyLabel: { width: 48 },
  copyLabelText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted },
  copyValue: { flex: 1, fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.primary },
  copyBtn:       { backgroundColor: Colors.bg.elevated, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 4 },
  copyBtnActive: { backgroundColor: Colors.emerald[400], borderColor: Colors.emerald[400] },
  copyBtnText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.primary },

  warningRow:  { backgroundColor: 'rgba(255,184,0,0.08)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,184,0,0.3)', padding: Spacing[3] },
  warningText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#FFB800', lineHeight: 18 },

  // Token info
  tokenCard: { gap: Spacing[2] },
  tokenRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  tokenItem: { alignItems: 'center', gap: 4 },
  tokenLabel:{ fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  tokenValue:{ fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary },

  // Footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: Layout.screenPadding,
    paddingBottom: Layout.bottomNavHeight,
    paddingTop: Spacing[4],
    backgroundColor: Colors.bg.base,
    borderTopWidth: 1, borderTopColor: Colors.border.subtle,
    gap: Spacing[2],
  },
  tonBtn: {
    borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center',
    backgroundColor: Colors.emerald[400], ...Shadow.emerald,
  },
  tonBtnText: {
    fontSize: Typography.size.base, fontFamily: Typography.family.heading,
    color: Colors.text.inverse, letterSpacing: Typography.tracking.wide,
  },
  paidBtn: {
    borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border.default,
  },
  paidBtnText: {
    fontSize: Typography.size.sm, fontFamily: Typography.family.label,
    color: Colors.text.secondary, letterSpacing: 0.3,
  },
});
