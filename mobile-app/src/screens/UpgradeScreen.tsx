import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, Linking,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { mobilePostPayment } from '../services/entitlementService';
import { useT } from '../i18n';

const WALLET_ADDRESS = 'UQBWUvIAvNpzjAR4BB1kjQFHXCLA1bSRPb_7B-ZMcRy65nIJ';
const USDT_CONTRACT  = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ton_keeper';

interface Package {
  gb:    number;
  usd:   number;
  days:  number;
  label: string;
  key:   string;
}

const PACKAGES: Package[] = [
  { gb: 10,  usd: 3,  days: 30,    label: '10 GB',     key: '10GB'     },
  { gb: 20,  usd: 5,  days: 30,    label: '20 GB',     key: '30days'   },
  { gb: 30,  usd: 7,  days: 30,    label: '30 GB',     key: '30days'   },
  { gb: -1,  usd: 15, days: 365,   label: 'Unlimited', key: 'unlimited'},
];

interface Props {
  onBack: () => void;
}

export function UpgradeScreen({ onBack }: Props) {
  const { t } = useT();
  const [selectedIdx, setSelectedIdx] = useState(1);
  const [submitting, setSubmitting]   = useState(false);

  const user      = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);

  const pkg         = PACKAGES[selectedIdx]!;
  const deviceId    = user?.deviceId || 'unknown';
  const userId      = user?.userId   || deviceId;
  const amountUnits = pkg.usd * 1_000_000; // USDT has 6 decimals on TON

  const tonkeeperDeepLink =
    `tonkeeper://transfer/${WALLET_ADDRESS}` +
    `?jetton=${USDT_CONTRACT}` +
    `&amount=${amountUnits}` +
    `&text=${encodeURIComponent(userId)}`;

  const tonkeeperWebLink =
    `https://app.tonkeeper.com/transfer/${WALLET_ADDRESS}` +
    `?jetton=${USDT_CONTRACT}` +
    `&amount=${amountUnits}` +
    `&text=${encodeURIComponent(userId)}`;

  const handleOpenTonkeeper = async () => {
    try {
      // Try native deep link first — throws if Tonkeeper is not installed
      await Linking.openURL(tonkeeperDeepLink);
    } catch {
      // App not installed or deep link rejected — open Play Store
      try {
        await Linking.openURL(PLAY_STORE_URL);
      } catch {
        // Last resort: Tonkeeper web
        try { await Linking.openURL(tonkeeperWebLink); } catch {}
        showToast(t('up.cannotOpenTonkeeper'), 'error', 2500);
      }
    }
  };

  const handlePaid = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await mobilePostPayment(deviceId, pkg.key, userId, userId);
      Alert.alert(
        t('up.paymentSubmitted'),
        t('up.paymentSubmittedMsg').replace('{amount}', `${pkg.usd} USDT`).replace('{label}', pkg.label),
        [{ text: 'OK', onPress: onBack }],
      );
    } catch {
      showToast(t('up.submitError'), 'error', 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const pricePerGb = pkg.gb > 0 ? `$${(pkg.usd / pkg.gb).toFixed(2)}/GB` : '';

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
            <Text style={styles.title}>{t('up.title')}</Text>
            <Text style={styles.subtitle}>{t('up.subtitle')}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* User ID display */}
        <GlassCard>
          <Text style={styles.cardLabel}>{t('pr.yourUserId')}</Text>
          <Text style={styles.userIdText} numberOfLines={1}>{userId}</Text>
          <Text style={styles.userIdHint}>{t('pr.userIdHint')}</Text>
        </GlassCard>

        {/* Package selector */}
        <GlassCard>
          <Text style={styles.cardLabel}>{t('up.selectPackage')}</Text>
          <View style={styles.pkgGrid}>
            {PACKAGES.map((p, i) => {
              const ppg = p.gb > 0 ? `$${(p.usd / p.gb).toFixed(2)}/GB` : '';
              return (
                <TouchableOpacity
                  key={p.key + i}
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
                  {ppg ? <Text style={styles.pkgPerGb}>{ppg}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </GlassCard>

        {/* How it works */}
        <GlassCard glowColor={Colors.emerald[400]}>
          <Text style={styles.cardLabel}>{t('up.howItWorks')}</Text>
          <View style={styles.stepRow}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
            <Text style={styles.stepText}>{t('up.step1')}</Text>
          </View>
          <View style={styles.stepRow}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
            <Text style={styles.stepText}>
              {t('up.step2')}{' '}
              <Text style={styles.stepHighlight}>{userId}</Text>
            </Text>
          </View>
          <View style={styles.stepRow}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
            <Text style={styles.stepText}>{t('up.step3')}</Text>
          </View>
          <View style={styles.warningRow}>
            <Text style={styles.warningText}>{t('up.memoWarning')}</Text>
          </View>
        </GlassCard>

        {/* Token info */}
        <GlassCard>
          <Text style={styles.cardLabel}>{t('up.tokenInfo')}</Text>
          <View style={styles.tokenRow}>
            <View style={styles.tokenItem}>
              <Text style={styles.tokenLabel}>{t('up.network')}</Text>
              <Text style={styles.tokenValue}>TON</Text>
            </View>
            <View style={styles.tokenItem}>
              <Text style={styles.tokenLabel}>{t('up.token')}</Text>
              <Text style={styles.tokenValue}>USDt</Text>
            </View>
            <View style={styles.tokenItem}>
              <Text style={styles.tokenLabel}>{t('up.activation')}</Text>
              <Text style={styles.tokenValue}>≤ 24h</Text>
            </View>
          </View>
        </GlassCard>

        <View style={{ height: 160 }} />
      </ScrollView>

      {/* Sticky footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.tonBtn}
          onPress={handleOpenTonkeeper}
          activeOpacity={0.85}
        >
          <Text style={styles.tonBtnText}>
            {t('up.payWithTonkeeper')} {pkg.usd} USDT{pricePerGb ? ` · ${pricePerGb}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.paidBtn, submitting && { opacity: 0.5 }]}
          onPress={handlePaid}
          activeOpacity={0.8}
          disabled={submitting}
        >
          <Text style={styles.paidBtnText}>
            {submitting ? t('up.submitting') : t('up.iHavePaid')}
          </Text>
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

  userIdText: {
    fontSize: Typography.size.base, fontFamily: Typography.family.mono,
    color: Colors.emerald[400], letterSpacing: 1,
  },
  userIdHint: {
    fontSize: Typography.size.xs, fontFamily: Typography.family.body,
    color: Colors.text.muted, marginTop: 4,
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
  pkgPerGb:       { fontSize: 9, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 2 },

  // Steps card
  stepRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3], marginBottom: Spacing[2] },
  stepNum:      { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,232,122,0.15)', borderWidth: 1, borderColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  stepNumText:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  stepText:     { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  stepHighlight:{ color: Colors.emerald[400], fontFamily: Typography.family.label },

  warningRow:  { backgroundColor: 'rgba(255,184,0,0.08)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,184,0,0.3)', padding: Spacing[3], marginTop: Spacing[2] },
  warningText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#FFB800', lineHeight: 18 },

  // Token info
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
