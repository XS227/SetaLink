import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, Clipboard, Share, TextInput,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useReferral } from '../services/entitlementService';

const ONE_GB = 1024 * 1024 * 1024;

function formatGb(bytes: number): string {
  return (bytes / ONE_GB).toFixed(1);
}

interface Props {
  onStart: () => void;
}

export function WelcomeScreen({ onStart }: Props) {
  const user          = useAuthStore((s) => s.user);
  const addBonusBytes = useAuthStore((s) => s.addBonusBytes);
  const showToast     = useToastStore((s) => s.show);

  const [redeemCode, setRedeemCode] = useState('');
  const [applying,   setApplying]   = useState(false);
  const [redeemed,   setRedeemed]   = useState(false);

  const opacity   = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(32)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, damping: 18, stiffness: 180, useNativeDriver: true }),
    ]).start();
  }, []);

  const referralCode = user?.referralCode ?? '—';
  const quotaGb      = formatGb(user?.quotaBytesTotal ?? ONE_GB);

  const applyReferral = async () => {
    const code = redeemCode.trim().toUpperCase();
    if (!code || applying || redeemed) return;
    const deviceId = user?.deviceId;
    if (!deviceId) return;
    setApplying(true);
    try {
      const result = await useReferral(deviceId, code);
      addBonusBytes(result.bonus_bytes);
      setRedeemed(true);
      const mbBonus = Math.round(result.bonus_bytes / (1024 * 1024));
      showToast(`+${mbBonus} MB bonus added!`, 'success', 3000);
    } catch (e: any) {
      showToast(e?.message ?? 'Invalid or already used code', 'error', 3000);
    } finally {
      setApplying(false);
    }
  };

  const handleCopy = () => {
    Clipboard.setString(referralCode);
    showToast('Referral code copied', 'success', 2000);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Join SetaLink with my code: ${referralCode}\nhttps://setalink.no/?ref=${referralCode}`,
      });
    } catch { /* share dismissed */ }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.glow} pointerEvents="none" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
      <Animated.View style={[styles.content, { opacity, transform: [{ translateY }] }]}>

        {/* Hero */}
        <View style={styles.heroSection}>
          <View style={styles.logoOrb} />
          <Text style={styles.appName}>SetaLink</Text>
          <Text style={styles.heroTitle}>You're all set.</Text>
          <Text style={styles.heroSub}>
            Your free account is ready. No registration, no email required.
          </Text>
        </View>

        {/* Starter package */}
        <GlassCard glowColor={Colors.emerald[400]} style={styles.packageCard}>
          <Text style={styles.packageLabel}>STARTER PACKAGE</Text>
          <View style={styles.packageRow}>
            <View style={styles.packageItem}>
              <Text style={styles.packageValue}>{quotaGb} GB</Text>
              <Text style={styles.packageMeta}>Free traffic</Text>
            </View>
            <View style={styles.packageDivider} />
            <View style={styles.packageItem}>
              <Text style={styles.packageValue}>1</Text>
              <Text style={styles.packageMeta}>Device</Text>
            </View>
            <View style={styles.packageDivider} />
            <View style={styles.packageItem}>
              <Text style={styles.packageValue}>∞</Text>
              <Text style={styles.packageMeta}>Speed</Text>
            </View>
          </View>
          <View style={styles.freeNote}>
            <View style={styles.freeDot} />
            <Text style={styles.freeNoteText}>No credit card · No expiry</Text>
          </View>
        </GlassCard>

        {/* Referral */}
        <GlassCard glowColor={Colors.blue[400]} style={styles.referralCard}>
          <Text style={styles.referralTitle}>Invite friends — earn more traffic</Text>
          <Text style={styles.referralDesc}>
            Each friend you invite gets 1 GB free — and so do you.
          </Text>
          <View style={styles.codeRow}>
            <Text style={styles.codeText}>{referralCode}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopy} activeOpacity={0.75}>
              <Text style={styles.copyBtnText}>Copy</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.8}>
            <Text style={styles.shareBtnText}>Share invite link</Text>
          </TouchableOpacity>
        </GlassCard>

        {/* Redeem a friend's referral code */}
        {!redeemed ? (
          <GlassCard style={styles.redeemCard}>
            <Text style={styles.redeemTitle}>Have a friend's code?</Text>
            <Text style={styles.redeemDesc}>Enter their referral code — you both get 1 GB free.</Text>
            <View style={styles.redeemRow}>
              <TextInput
                style={styles.redeemInput}
                value={redeemCode}
                onChangeText={(v) => setRedeemCode(v.toUpperCase())}
                placeholder="Enter code"
                placeholderTextColor={Colors.text.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                editable={!applying}
              />
              <TouchableOpacity
                style={[styles.redeemBtn, (applying || !redeemCode.trim()) && styles.redeemBtnDisabled]}
                onPress={applyReferral}
                disabled={applying || !redeemCode.trim()}
                activeOpacity={0.75}
              >
                <Text style={styles.redeemBtnText}>{applying ? '…' : 'Apply'}</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        ) : (
          <View style={styles.redeemSuccess}>
            <Text style={styles.redeemSuccessText}>Referral applied — bonus added to your account.</Text>
          </View>
        )}

        {/* Get started */}
        <TouchableOpacity style={styles.startBtn} onPress={onStart} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>Get Started</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Your data is never logged. Traffic routes through your chosen server only.
        </Text>

      </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: Colors.bg.base },
  scroll:        { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  glow:          {
    position: 'absolute', width: 400, height: 400, borderRadius: 200,
    backgroundColor: Colors.emerald[900], opacity: 0.14, top: -80, alignSelf: 'center',
  },
  content:       {
    paddingTop: Layout.statusBarHeight + Spacing[6],
    paddingHorizontal: Layout.screenPadding,
    paddingBottom: Spacing[8],
    gap: Spacing[5],
  },
  heroSection:   { alignItems: 'center', gap: Spacing[3], paddingTop: Spacing[4] },
  logoOrb:       {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,232,122,0.12)',
    borderWidth: 2, borderColor: Colors.emerald[400],
    shadowColor: Colors.emerald[400], shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 16, elevation: 8,
  },
  appName:       { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 3, textTransform: 'uppercase' },
  heroTitle:     { fontSize: 32, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: -0.5, textAlign: 'center' },
  heroSub:       { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.secondary, textAlign: 'center', lineHeight: 24 },
  packageCard:   { gap: Spacing[4] },
  packageLabel:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 1.5 },
  packageRow:    { flexDirection: 'row', alignItems: 'center' },
  packageItem:   { flex: 1, alignItems: 'center', gap: 4 },
  packageValue:  { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary },
  packageMeta:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  packageDivider:{ width: 1, height: 40, backgroundColor: Colors.border.subtle },
  freeNote:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  freeDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.emerald[400] },
  freeNoteText:  { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400] },
  referralCard:  { gap: Spacing[3] },
  referralTitle: { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  referralDesc:  { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  codeRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], gap: Spacing[3] },
  codeText:      { flex: 1, fontSize: Typography.size.base, fontFamily: Typography.family.mono, color: Colors.text.primary, letterSpacing: 2 },
  copyBtn:       { backgroundColor: Colors.emerald[400], borderRadius: Radius.md, paddingHorizontal: Spacing[3], paddingVertical: 6 },
  copyBtnText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.inverse },
  shareBtn:      { borderWidth: 1, borderColor: Colors.blue[400], borderRadius: Radius.md, paddingVertical: Spacing[3], alignItems: 'center' },
  shareBtnText:  { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.blue[400], letterSpacing: 0.3 },
  redeemCard:    { gap: Spacing[2] },
  redeemTitle:   { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  redeemDesc:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, lineHeight: 18 },
  redeemRow:     { flexDirection: 'row', gap: Spacing[2], alignItems: 'center' },
  redeemInput:   {
    flex: 1, height: 40, backgroundColor: Colors.bg.elevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border.default,
    paddingHorizontal: Spacing[3], color: Colors.text.primary,
    fontSize: Typography.size.sm, fontFamily: Typography.family.mono, letterSpacing: 1.5,
  },
  redeemBtn:        { backgroundColor: Colors.blue[400], borderRadius: Radius.md, paddingHorizontal: Spacing[4], height: 40, justifyContent: 'center', alignItems: 'center' },
  redeemBtnDisabled:{ opacity: 0.45 },
  redeemBtnText:    { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.inverse },
  redeemSuccess:    { alignItems: 'center', paddingVertical: Spacing[2] },
  redeemSuccessText:{ fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.emerald[400], textAlign: 'center' },
  startBtn:      { backgroundColor: Colors.emerald[400], borderRadius: Radius.xl, paddingVertical: Spacing[5], alignItems: 'center' },
  startBtnText:  { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: 0.3 },
  footnote:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', lineHeight: 18 },
});
