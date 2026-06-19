import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useT } from '../i18n';
import { formatBytes } from '../utils/formatters';
import { ONE_GB, computeTransferable, validateTransferAmount, normalizeDigits, transferFormReady } from '../utils/quotaEconomy';
import {
  resolveRecipient, transferQuota, getTransfers, getQuotaSummary,
  type TransferRecipient, type TransferRecord,
} from '../services/entitlementService';

interface Props {
  onBack: () => void;
}

type Step = 'form' | 'review' | 'success';

export function TransferScreen({ onBack }: Props) {
  const { t } = useT();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { user, applyQuotaSummary } = useAuthStore();
  const showToast = useToastStore((s) => s.show);

  const [step, setStep]               = useState<Step>('form');
  const [recipientInput, setRecipient] = useState('');
  const [recipient, setResolved]      = useState<TransferRecipient | null>(null);
  const [verifying, setVerifying]     = useState(false);
  const [amountStr, setAmountStr]     = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [sentGb, setSentGb]           = useState('0');
  const [history, setHistory]         = useState<TransferRecord[]>([]);
  const [showMyCode, setShowMyCode]   = useState(false);

  const deviceId    = user?.deviceId ?? '';
  const myCode      = user?.userId || deviceId;
  const available   = computeTransferable(user);
  const maxGb       = available / ONE_GB;
  // Enable Continue on recipient TEXT + a positive amount — NOT on the separately
  // resolved recipient object. v0.9.35 still required the user to press the ✓
  // verify button first; users who just typed an ID + amount saw a disabled
  // button with no explanation (v0.9.36 #2). Resolution now happens on Continue.
  const amountNum        = parseFloat(normalizeDigits(amountStr).replace(',', '.'));
  const amountOk         = isFinite(amountNum) && amountNum > 0;
  const recipientEntered = recipientInput.trim() !== '';
  const canContinue      = transferFormReady(recipientInput, amountStr) && !verifying;
  // Visible reason when the button is disabled (debug/UX aid requested in #2).
  const disabledReason   = !recipientEntered ? t('tr.needRecipient')
    : !amountOk           ? t('tr.needAmount')
    : '';

  useEffect(() => {
    if (!deviceId) return;
    // Refresh the transferable balance + history from the server ledger.
    getQuotaSummary(deviceId).then((r) => applyQuotaSummary(r.quota)).catch(() => {});
    getTransfers(deviceId).then(setHistory).catch(() => {});
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  // Resolve a recipient ID → TransferRecipient, surfacing self/blocked/not-found
  // errors. Returns null on any failure (toast already shown). Shared by the ✓
  // button and Continue so a transfer can proceed without a separate verify tap.
  const resolveNow = async (): Promise<TransferRecipient | null> => {
    const param = recipientInput.trim();
    if (!param) { showToast(t('tr.errRecipient'), 'error', 2500); return null; }
    if (recipient && (recipient.user_id === param || recipient.device_id === param)) return recipient;
    setVerifying(true);
    setResolved(null);
    try {
      const r = await resolveRecipient(param);
      if (r.device_id === deviceId) { showToast(t('tr.errSelf'), 'error', 2500); return null; }
      if (r.blocked)                { showToast(t('tr.errBlocked'), 'error', 2500); return null; }
      setResolved(r);
      return r;
    } catch {
      showToast(t('tr.errRecipient'), 'error', 2500);
      return null;
    } finally {
      setVerifying(false);
    }
  };

  const handleVerify = () => { resolveNow(); };

  const handleScanQr = () => {
    // Live camera scanning requires a native scanner dependency that this build
    // does not bundle yet. Until then, recipients share their receive-code QR
    // and the sender types the ID. (See migration notes.)
    showToast(t('tr.scanUnavailable'), 'info', 3500);
  };

  const handleContinue = async () => {
    const v = validateTransferAmount(amountStr, available);
    if (!v.ok) {
      if (v.error === 'above_max') {
        // Make the limit explicit so the user knows exactly how much they can send.
        showToast(`${t('tr.errAboveMax')} (${t('tr.maxBtn')} ${maxGb.toFixed(2)})`, 'error', 3000);
      } else {
        showToast(t(v.error === 'below_min' ? 'tr.errBelowMin' : 'tr.errInvalidAmount'), 'error', 2500);
      }
      return;
    }
    // Resolve the recipient now if it wasn't verified via the ✓ button.
    const rcpt = await resolveNow();
    if (!rcpt) return;
    setStep('review');
  };

  const handleConfirm = async () => {
    if (!recipient) return;
    const v = validateTransferAmount(amountStr, available);
    if (!v.ok) { showToast(t('tr.errInvalidAmount'), 'error', 2500); setStep('form'); return; }
    const bytes = v.bytes;
    setSubmitting(true);
    try {
      const res = await transferQuota(deviceId, recipient.device_id, bytes);
      applyQuotaSummary(res.sender);
      setSentGb((res.bytes / ONE_GB).toFixed(res.bytes % ONE_GB === 0 ? 0 : 2));
      getTransfers(deviceId).then(setHistory).catch(() => {});
      setStep('success');
    } catch (e: any) {
      // Surface the server's client-safe message when present.
      showToast(e?.message || t('tr.errGeneric'), 'error', 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const recipientLabel = recipient ? (recipient.user_id || recipient.device_id) : '';

  // ── Success step ─────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <View style={styles.screen}>
        <View style={styles.successWrap}>
          <View style={styles.successCircle}><Text style={styles.successCheck}>✓</Text></View>
          <Text style={styles.successTitle}>{t('tr.success')}</Text>
          <Text style={styles.successMsg}>{t('tr.successMsg').replace('{gb}', sentGb)}</Text>
          <Text style={styles.successTo}>{recipientLabel}</Text>
          <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.85} onPress={onBack}>
            <Text style={styles.primaryBtnText}>{t('tr.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={step === 'review' ? () => setStep('form') : onBack} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{step === 'review' ? t('tr.review') : t('tr.title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing[8] }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'form' ? (
          <>
            <Text style={styles.subtitle}>{t('tr.subtitle')}</Text>

            {/* Available balance */}
            <GlassCard glowColor={Colors.emerald[400]} style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>{t('tr.available')}</Text>
              <Text style={styles.balanceValue}>{formatBytes(available, 2)}</Text>
              <Text style={styles.balanceHint}>{t('pr.notTransferableInfo')}</Text>
            </GlassCard>

            {/* Method selector */}
            <View style={styles.methodRow}>
              <View style={[styles.methodChip, styles.methodChipActive]}>
                <Text style={[styles.methodText, styles.methodTextActive]}>{t('tr.enterId')}</Text>
              </View>
              <TouchableOpacity style={styles.methodChip} activeOpacity={0.8} onPress={handleScanQr}>
                <Text style={styles.methodText}>📷 {t('tr.scanQr')}</Text>
              </TouchableOpacity>
            </View>

            {/* Recipient input */}
            <GlassCard style={styles.card}>
              <Text style={styles.cardLabel}>{t('tr.recipient')}</Text>
              <Text style={styles.cardHint}>{t('tr.recipientHint')}</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={recipientInput}
                  onChangeText={(v) => { setRecipient(v); setResolved(null); }}
                  placeholder={t('tr.recipientPlaceholder')}
                  placeholderTextColor={Colors.text.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onSubmitEditing={handleVerify}
                />
                <TouchableOpacity style={styles.verifyBtn} activeOpacity={0.8} onPress={handleVerify} disabled={verifying}>
                  {verifying
                    ? <ActivityIndicator size="small" color={Colors.text.inverse} />
                    : <Text style={styles.verifyBtnText}>✓</Text>}
                </TouchableOpacity>
              </View>
              {recipient && (
                <View style={styles.verifiedRow}>
                  <View style={styles.verifiedDot} />
                  <Text style={styles.verifiedText}>{t('tr.recipientFound')} · {recipientLabel}</Text>
                </View>
              )}
            </GlassCard>

            {/* Amount */}
            <GlassCard style={styles.card}>
              <Text style={styles.cardLabel}>{t('tr.amount')}</Text>
              <View style={styles.amountRow}>
                <TextInput
                  style={styles.amountInput}
                  value={amountStr}
                  onChangeText={(v) => setAmountStr(normalizeDigits(v))}
                  placeholder="0.0"
                  placeholderTextColor={Colors.text.muted}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.amountUnit}>{t('tr.amountUnit')}</Text>
                <TouchableOpacity
                  style={styles.maxBtn}
                  activeOpacity={0.8}
                  onPress={() => setAmountStr(maxGb > 0 ? maxGb.toFixed(2) : '0')}
                >
                  <Text style={styles.maxBtnText}>{t('tr.maxBtn')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.cardHint}>
                {t('tr.minHint')} · {t('tr.maxBtn')} {maxGb.toFixed(2)} {t('tr.amountUnit')}
              </Text>
            </GlassCard>

            <TouchableOpacity
              style={[styles.primaryBtn, !canContinue && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              onPress={handleContinue}
              disabled={!canContinue}
            >
              {verifying
                ? <ActivityIndicator size="small" color={Colors.text.inverse} />
                : <Text style={styles.primaryBtnText}>{t('tr.continue')}</Text>}
            </TouchableOpacity>
            {!!disabledReason && <Text style={styles.disabledHint}>{disabledReason}</Text>}

            {/* My receive code */}
            <TouchableOpacity activeOpacity={0.85} onPress={() => setShowMyCode(true)}>
              <GlassCard style={styles.myCodeCard}>
                <Text style={styles.myCodeIcon}>🔳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.myCodeTitle}>{t('tr.myCode')}</Text>
                  <Text style={styles.myCodeHint}>{t('tr.myCodeHint')}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </GlassCard>
            </TouchableOpacity>

            {/* History */}
            <GlassCard style={styles.card}>
              <Text style={styles.cardLabel}>{t('tr.history')}</Text>
              {history.length === 0 ? (
                <Text style={styles.emptyText}>{t('tr.noHistory')}</Text>
              ) : (
                history.slice(0, 10).map((h) => {
                  const other = h.direction === 'out'
                    ? (h.receiver_user_id || h.receiver_device)
                    : (h.sender_user_id || h.sender_device);
                  const label = h.direction === 'out'
                    ? t('tr.sentTo').replace('{id}', other)
                    : t('tr.receivedFrom').replace('{id}', other);
                  const statusSuffix = h.status === 'reversed' ? ` · ${t('tr.statusReversed')}`
                    : h.status === 'flagged' ? ` · ${t('tr.statusFlagged')}` : '';
                  return (
                    <View key={h.id} style={styles.histRow}>
                      <Text style={[styles.histArrow, { color: h.direction === 'out' ? Colors.status.disconnected : Colors.emerald[400] }]}>
                        {h.direction === 'out' ? '↑' : '↓'}
                      </Text>
                      <Text style={styles.histLabel} numberOfLines={1}>{label}{statusSuffix}</Text>
                      <Text style={[styles.histBytes, { color: h.direction === 'out' ? Colors.status.disconnected : Colors.emerald[400] }]}>
                        {h.direction === 'out' ? '-' : '+'}{formatBytes(h.bytes, 1)}
                      </Text>
                    </View>
                  );
                })
              )}
            </GlassCard>
          </>
        ) : (
          /* ── Review step ─────────────────────────────────────────────── */
          <>
            <Text style={styles.subtitle}>{t('tr.reviewDesc')}</Text>
            <GlassCard glowColor={Colors.emerald[400]} style={styles.reviewCard}>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{t('tr.from')}</Text>
                <Text style={styles.reviewValue} numberOfLines={1}>{myCode}</Text>
              </View>
              <View style={styles.reviewDivider} />
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{t('tr.to')}</Text>
                <Text style={styles.reviewValue} numberOfLines={1}>{recipientLabel}</Text>
              </View>
              <View style={styles.reviewDivider} />
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{t('tr.amountLabel')}</Text>
                <Text style={styles.reviewAmount}>{amountStr} {t('tr.amountUnit')}</Text>
              </View>
            </GlassCard>

            <TouchableOpacity
              style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              onPress={handleConfirm}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color={Colors.text.inverse} />
                : <Text style={styles.primaryBtnText}>{t('tr.confirmSend')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.8} onPress={() => setStep('form')} disabled={submitting}>
              <Text style={styles.secondaryBtnText}>{t('tr.back')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* My receive-code QR modal */}
      <Modal visible={showMyCode} transparent animationType="fade" onRequestClose={() => setShowMyCode(false)}>
        <TouchableOpacity style={styles.qrOverlay} activeOpacity={1} onPress={() => setShowMyCode(false)}>
          <View style={styles.qrBox}>
            <Text style={styles.qrTitle}>{t('tr.myCode')}</Text>
            <QRCode value={myCode} size={200} backgroundColor="#ffffff" color="#000000" />
            <Text style={styles.qrCodeLabel}>{myCode}</Text>
            <Text style={styles.qrHint}>{t('tr.myCodeHint')}</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: Colors.bg.base },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing[2] },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  backIcon:      { fontSize: 26, color: Colors.text.secondary, marginTop: -2 },
  title:         { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  scroll:        { flex: 1 },
  content:       { paddingHorizontal: Layout.screenPadding, gap: Spacing[4], paddingTop: Spacing[2] },
  subtitle:      { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, textAlign: 'center' },

  balanceCard:   { alignItems: 'center', gap: 4, paddingVertical: Spacing[4] },
  balanceLabel:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1 },
  balanceValue:  { fontSize: Typography.size['3xl'], fontFamily: Typography.family.heading, color: Colors.emerald[400] },
  balanceHint:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  methodRow:     { flexDirection: 'row', gap: Spacing[3] },
  methodChip:    { flex: 1, paddingVertical: Spacing[3], borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface, alignItems: 'center' },
  methodChipActive: { borderColor: Colors.emerald[400], backgroundColor: 'rgba(0,232,122,0.08)' },
  methodText:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.secondary },
  methodTextActive: { color: Colors.emerald[400] },

  card:          { gap: Spacing[2] },
  cardLabel:     { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1 },
  cardHint:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  inputRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: 2 },
  input:         { flex: 1, backgroundColor: Colors.bg.elevated, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Spacing[3], fontSize: Typography.size.base, fontFamily: Typography.family.mono, color: Colors.text.primary, letterSpacing: 1 },
  verifyBtn:     { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  verifyBtnText: { fontSize: 20, color: Colors.text.inverse, fontFamily: Typography.family.heading },
  verifiedRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  verifiedDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.emerald[400] },
  verifiedText:  { flex: 1, fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400] },

  amountRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: 2 },
  amountInput:   { flex: 1, backgroundColor: Colors.bg.elevated, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Spacing[3], fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  amountUnit:    { fontSize: Typography.size.base, fontFamily: Typography.family.label, color: Colors.text.secondary },
  maxBtn:        { backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Spacing[2] },
  maxBtnText:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400] },

  primaryBtn:    { backgroundColor: Colors.emerald[400], borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', marginTop: Spacing[2] },
  primaryBtnDisabled: { opacity: 0.5 },
  disabledHint:  { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', marginTop: -Spacing[1] },
  primaryBtnText:{ fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: 0.5 },
  secondaryBtn:  { paddingVertical: Spacing[3], alignItems: 'center' },
  secondaryBtnText: { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted },

  myCodeCard:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[3] },
  myCodeIcon:    { fontSize: 24 },
  myCodeTitle:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  myCodeHint:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  chevron:       { fontSize: 22, color: Colors.text.muted },

  emptyText:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, paddingVertical: Spacing[2] },
  histRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[2], borderTopWidth: 1, borderTopColor: Colors.border.subtle },
  histArrow:     { fontSize: 16, fontFamily: Typography.family.heading, width: 16, textAlign: 'center' },
  histLabel:     { flex: 1, fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.secondary },
  histBytes:     { fontSize: Typography.size.xs, fontFamily: Typography.family.mono },

  reviewCard:    { gap: Spacing[3], paddingVertical: Spacing[4] },
  reviewRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing[3] },
  reviewLabel:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1 },
  reviewValue:   { flex: 1, textAlign: 'right', fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.primary },
  reviewAmount:  { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.emerald[400] },
  reviewDivider: { height: 1, backgroundColor: Colors.border.subtle },

  successWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Layout.screenPadding, gap: Spacing[3] },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(0,232,122,0.12)', borderWidth: 2, borderColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  successCheck:  { fontSize: 44, color: Colors.emerald[400] },
  successTitle:  { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary },
  successMsg:    { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.secondary },
  successTo:     { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.muted },

  qrOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
  qrBox:         { backgroundColor: '#fff', borderRadius: Radius['2xl'], padding: Spacing[6], alignItems: 'center', gap: Spacing[4], marginHorizontal: Spacing[8] },
  qrTitle:       { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: '#111' },
  qrCodeLabel:   { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: '#333', letterSpacing: 1 },
  qrHint:        { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#999', textAlign: 'center' },
});
