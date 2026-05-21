import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Clipboard, Share, Switch, Linking,
  Modal, ActivityIndicator,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { useAuthStore }    from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useToastStore }   from '../stores/toastStore';
import { useVpnStore }     from '../stores/vpnStore';
import { BiometricService } from '../services/biometricService';
import { getRemoteConfig } from '../services/remoteConfigService';
import { formatBytes } from '../utils/formatters';
import { APP_VERSION, APP_BUILD } from '../utils/version';
import { useT } from '../i18n';
import { useReferral } from '../services/entitlementService';

// ── Plan meta ─────────────────────────────────────────────────────────────────

const PLAN_LABEL: Record<string, string> = {
  free:    'Free Invite Trial',
  premium: 'Unlimited',
  team:    'Paid Package',
};

function formatExpiry(iso: string | null): string {
  if (!iso) return 'No expiry';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDaysRemaining(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ── BandwidthBar ──────────────────────────────────────────────────────────────

interface BandwidthBarProps {
  usedBytes: number;
  limitGb: number | null;
  labelUnlimited: string;
  labelUsedMonth: string;
  labelGbUsed: string;
  labelRemaining: string;
  isExhausted?: boolean;
  noDataLabel?: string;
}

function BandwidthBar({ usedBytes, limitGb, labelUnlimited, labelUsedMonth, labelGbUsed, labelRemaining, isExhausted, noDataLabel }: BandwidthBarProps) {
  if (limitGb === null) {
    return (
      <View style={bwStyles.unlimitedRow}>
        <Text style={bwStyles.unlimitedText}>{labelUnlimited}</Text>
        <Text style={bwStyles.usedText}>{formatBytes(usedBytes, 2)} {labelUsedMonth}</Text>
      </View>
    );
  }

  const usedGb      = usedBytes / 1e9;
  const remainingGb = Math.max(0, limitGb - usedGb);
  const pct         = isExhausted ? 1 : Math.min(usedGb / limitGb, 1);
  const color       = isExhausted ? Colors.status.disconnected : (pct < 0.6 ? Colors.emerald[400] : pct < 0.85 ? '#FFB800' : Colors.status.disconnected);

  return (
    <View style={bwStyles.wrapper}>
      <View style={bwStyles.track}>
        <View style={[bwStyles.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
      </View>
      <View style={bwStyles.labels}>
        <Text style={bwStyles.usedText}>{usedGb.toFixed(1)} {labelGbUsed}</Text>
        {isExhausted
          ? <Text style={[bwStyles.total, { color: Colors.status.disconnected }]}>{noDataLabel ?? 'No data remaining'}</Text>
          : <Text style={[bwStyles.total, { color }]}>{remainingGb.toFixed(1)} GB {labelRemaining}</Text>
        }
      </View>
    </View>
  );
}

const bwStyles = StyleSheet.create({
  wrapper:       { gap: 6 },
  track:         { height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  fill:          { height: '100%', borderRadius: 3 },
  labels:        { flexDirection: 'row', justifyContent: 'space-between' },
  unlimitedRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  unlimitedText: { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  usedText:      { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  total:         { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
});

// ── Screen ────────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
  onSignOut?: () => void;
}

export function ProfileScreen({ onNavigate, activeTab, onSignOut }: Props) {
  const { t } = useT();
  const { user, logout, setBiometricSecure, addBonusBytes } = useAuthStore();
  const { pendingReferralCode, setPendingReferralCode } = useSettingsStore();
  const { sessionsThisMonth } = useSessionStore();
  const showToast = useToastStore((s) => s.show);
  const { connectionState, sessionBytes } = useVpnStore();

  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [supportUrl, setSupportUrl] = useState('https://t.me/SetaLink3');
  const [showQr, setShowQr] = useState(false);
  const [applyingPending, setApplyingPending] = useState(false);

  useEffect(() => {
    BiometricService.isAvailable().then(setBiometricAvailable).catch(() => setBiometricAvailable(false));
    getRemoteConfig().then(cfg => { if (cfg.support_url) setSupportUrl(cfg.support_url); }).catch(() => {});
  }, []);

  if (!user) return null;

  const isConnected   = connectionState === 'connected';
  // Live quota: base + current session traffic (not yet committed to backend)
  const liveQuotaUsed = user.quotaBytesUsed + (isConnected ? sessionBytes.sent + sessionBytes.received : 0);

  // Quota limits derived from the entitlement returned by backend, not hardcoded
  const isUnlimited   = user.plan !== 'free';
  const planLabel     = PLAN_LABEL[user.plan] ?? 'Free Invite Trial';
  const limitGb       = isUnlimited ? null : user.quotaBytesTotal / 1e9;

  const remainingBytes     = Math.max(0, user.quotaBytesTotal - liveQuotaUsed);
  const isQuotaExhausted   = !isUnlimited && remainingBytes === 0;

  const primaryId  = user.userId || `SL-???-${user.deviceId.slice(-8).toUpperCase()}`;
  // Referral code = unique suffix after SL-227- (matches identity system)
  const referralDisplayCode = (() => {
    const m = primaryId.match(/^SL-\d+-([A-Z0-9]+)$/i);
    return m ? m[1]!.toUpperCase() : user.referralCode;
  })();
  const initial    = primaryId.slice(0, 2).toUpperCase();
  const monthSessions = sessionsThisMonth();
  const daysLeft      = getDaysRemaining(user.planExpiry);

  const handleCopyUserId = () => {
    Clipboard.setString(primaryId);
    showToast('User ID copied', 'success', 2000);
  };

  const handleCopyReferral = () => {
    Clipboard.setString(referralDisplayCode);
    showToast(t('pr.copiedCode'), 'success', 2000);
  };

  const handleShareReferral = async () => {
    try {
      await Share.share({
        message: `Join SetaLink — invite-only VPN for Iran.\nUse my code: ${referralDisplayCode}\nhttps://setalink.no/?ref=${referralDisplayCode}\n\nWe both get +1 GB when you join.`,
      });
    } catch {
      showToast(t('pr.shareUnavailable'), 'error', 2500);
    }
  };
  const referralLink = `https://setalink.no/?ref=${referralDisplayCode}`;

  const handleApplyPending = async () => {
    if (!pendingReferralCode || !user?.deviceId) return;
    setApplyingPending(true);
    try {
      const result = await useReferral(user.deviceId, pendingReferralCode);
      addBonusBytes(result.bonus_bytes);
      setPendingReferralCode(null);
      const gb = (result.bonus_bytes / (1024 * 1024 * 1024)).toFixed(0);
      showToast(`+${gb} GB bonus credited!`, 'success', 3000);
    } catch (e: any) {
      showToast(e?.message || 'Could not apply referral code', 'error', 3000);
    } finally {
      setApplyingPending(false);
    }
  };

  const handleOpenSupport = async () => {
    try {
      await Linking.openURL(supportUrl);
    } catch {
      showToast(t('pr.supportUnavailable'), 'error', 2500);
    }
  };

  const handleOpenWebsite = async () => {
    try {
      await Linking.openURL('https://setalink.no');
    } catch {
      showToast(t('pr.websiteUnavailable'), 'error', 2500);
    }
  };

  const handleSignOut = () => {
    logout();
    onSignOut?.();
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
          <Text style={styles.title}>{t('pr.title')}</Text>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => onNavigate('settings' as NavTab)}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* Pending referral banner */}
        {!!pendingReferralCode && (
          <GlassCard style={styles.pendingBanner} glowColor={Colors.emerald[400]}>
            <View style={styles.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>Referral code waiting</Text>
                <Text style={styles.pendingDesc}>
                  Apply code <Text style={styles.pendingCode}>{pendingReferralCode}</Text> to claim +1 GB
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.pendingBtn, applyingPending && styles.pendingBtnDisabled]}
                activeOpacity={0.8}
                disabled={applyingPending}
                onPress={handleApplyPending}
              >
                {applyingPending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.pendingBtnText}>Apply</Text>
                }
              </TouchableOpacity>
            </View>
          </GlassCard>
        )}

        {/* User info */}
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{initial}</Text>
            {user.plan !== 'free' && (
              <View style={styles.premiumBadge}>
                <Text style={styles.premiumIcon}>★</Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>{primaryId}</Text>
            <View style={styles.planRow}>
              <View style={[
                styles.planBadge,
                user.plan === 'free' && { borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated },
              ]}>
                <Text style={[
                  styles.planText,
                  user.plan === 'free' && { color: Colors.text.muted },
                ]}>
                  {planLabel}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Subscription card */}
        <GlassCard glowColor={Colors.emerald[400]} style={styles.subCard}>
          <View style={styles.subHeader}>
            <View style={{ gap: 4 }}>
              <Text style={styles.subTitle}>{planLabel}</Text>
              <Text style={styles.subExpiry}>
                {user.planExpiry ? `${t('pr.renewsOn')} ${formatExpiry(user.planExpiry)}` : t('pr.lifetime')}
              </Text>
              <View style={styles.subPills}>
                {isUnlimited ? (
                  <View style={styles.unlimitedPill}>
                    <Text style={styles.unlimitedPillText}>∞ Unlimited</Text>
                  </View>
                ) : (
                  <View style={[styles.gbPill, isQuotaExhausted && styles.gbPillExhausted]}>
                    <Text style={[styles.gbPillText, isQuotaExhausted && styles.gbPillTextExhausted]}>
                      {isQuotaExhausted
                        ? t('pr.noData')
                        : `${Math.max(0, (user.quotaBytesTotal - liveQuotaUsed) / 1e9).toFixed(1)} GB ${t('pr.remaining')}`}
                    </Text>
                  </View>
                )}
                {daysLeft !== null && (
                  <View style={[styles.daysPill, daysLeft <= 7 && styles.daysPillUrgent]}>
                    <Text style={[styles.daysPillText, daysLeft <= 7 && styles.daysPillTextUrgent]}>
                      {daysLeft}d {t('pr.remaining')}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            {isQuotaExhausted ? (
              <View style={styles.quotaExhaustedPill}>
                <Text style={styles.quotaExhaustedPillText}>{t('pr.quotaExhausted')}</Text>
              </View>
            ) : (
              <View style={styles.subStatus}>
                <View style={styles.subDot} />
                <Text style={styles.subStatusText}>{t('pr.active')}</Text>
              </View>
            )}
          </View>

          <View style={styles.subDivider} />

          <BandwidthBar
            usedBytes={liveQuotaUsed}
            limitGb={limitGb}
            labelUnlimited={t('pr.unlimited')}
            labelUsedMonth={t('pr.usedMonth')}
            labelGbUsed={t('pr.gbUsed')}
            labelRemaining={t('pr.remaining')}
            isExhausted={isQuotaExhausted}
            noDataLabel={t('pr.noData')}
          />

          <View style={styles.subMeta}>
            {[
              { label: t('pr.totalQuota'), value: isUnlimited ? t('pr.unlimitedShort') : `${(user.quotaBytesTotal / 1e9).toFixed(1)} GB` },
              { label: t('pr.usedTraffic'),  value: `${(liveQuotaUsed / 1e9).toFixed(2)} GB` },
              { label: t('pr.sessions'),    value: String(monthSessions.length) },
            ].map((item) => (
              <View key={item.label} style={styles.subMetaItem}>
                <Text style={styles.subMetaValue}>{item.value}</Text>
                <Text style={styles.subMetaLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {user.plan === 'free' ? (
            <TouchableOpacity
              style={[styles.upgradeBtn, isQuotaExhausted && styles.addDataBtn]}
              activeOpacity={0.85}
              onPress={() => (onNavigate as (tab: string) => void)('upgrade')}
            >
              <Text style={[styles.upgradeBtnText, isQuotaExhausted && styles.addDataBtnText]}>
                {isQuotaExhausted ? t('pr.addData') : t('pr.upgradePremium')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.manageBtn} activeOpacity={0.8} onPress={() => showToast(t('pr.noSubscriptionManager'), 'info', 2500)}>
              <Text style={styles.manageBtnText}>{t('pr.manageSub')}</Text>
            </TouchableOpacity>
          )}
        </GlassCard>

        <GlassCard>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, marginRight: Spacing[3] }}>
              <Text style={styles.cardLabel}>{t('pr.biometricLock')}</Text>
              <Text style={styles.deviceOs}>{t('pr.biometricLockDesc')}</Text>
              {biometricAvailable === false && (
                <Text style={styles.biometricWarning}>
                  Biometric authentication is not available on this device.
                </Text>
              )}
            </View>
            <Switch
              value={biometricAvailable === true && user.securedWithBiometric}
              disabled={biometricAvailable === false}
              onValueChange={(v) => {
                if (!biometricAvailable) return;
                setBiometricSecure(v);
              }}
              trackColor={{ true: Colors.emerald[400], false: Colors.bg.elevated }}
            />
          </View>
        </GlassCard>

        {/* User ID */}
        <GlassCard>
          <Text style={styles.cardLabel}>{t('pr.yourUserId')}</Text>
          <View style={styles.referralCode}>
            <Text style={styles.referralCodeText} numberOfLines={1}>{primaryId}</Text>
            <TouchableOpacity style={styles.copyBtn} activeOpacity={0.75} onPress={handleCopyUserId}>
              <Text style={styles.copyBtnText}>{t('pr.copy')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.deviceOs, { marginTop: 6 }]}>{t('pr.userIdHint')}</Text>
        </GlassCard>

        {/* Referral */}
        <GlassCard style={styles.referralCard} glowColor={Colors.blue[400]}>
          <View style={styles.referralHeader}>
            <Text style={styles.cardLabel}>{t('pr.referralCode')}</Text>
            <View style={styles.rewardBadge}>
              <Text style={styles.rewardBadgeText}>{t('pr.free30days')}</Text>
            </View>
          </View>
          <Text style={styles.referralDesc}>{t('pr.referDesc')}</Text>
          <Text style={styles.deviceOs}>{referralLink}</Text>
          <View style={styles.referralCode}>
            <Text style={styles.referralCodeText}>{referralDisplayCode}</Text>
            <TouchableOpacity style={styles.qrBtn} activeOpacity={0.75} onPress={() => setShowQr(true)}>
              <Text style={styles.qrBtnText}>QR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.copyBtn} activeOpacity={0.75} onPress={handleCopyReferral}>
              <Text style={styles.copyBtnText}>{t('pr.copy')}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shareBtn} activeOpacity={0.8} onPress={handleShareReferral}>
            <Text style={styles.shareBtnText}>{t('pr.shareLink')}</Text>
          </TouchableOpacity>
        </GlassCard>

        {/* Viral loop progress */}
        <GlassCard style={styles.viralCard}>
          <Text style={styles.cardLabel}>Stealth Servers</Text>
          {user.stealthUnlocked ? (
            <View style={styles.viralUnlockedRow}>
              <Text style={styles.viralUnlockedIcon}>🔓</Text>
              <View>
                <Text style={styles.viralUnlockedText}>Stealth servers unlocked!</Text>
                <Text style={styles.viralUnlockedSub}>You can now connect to stealth nodes</Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.viralDesc}>
                Invite {Math.max(0, 3 - (user.activeInviteCount ?? 0))} more active friend{3 - (user.activeInviteCount ?? 0) === 1 ? '' : 's'} to unlock stealth servers
              </Text>
              <View style={styles.viralProgressRow}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.viralDot, i < (user.activeInviteCount ?? 0) && styles.viralDotFilled]} />
                ))}
                <Text style={styles.viralProgressText}>{user.activeInviteCount ?? 0}/3 active</Text>
              </View>
            </>
          )}
        </GlassCard>

        {/* QR modal */}
        <Modal visible={showQr} transparent animationType="fade" onRequestClose={() => setShowQr(false)}>
          <TouchableOpacity style={styles.qrOverlay} activeOpacity={1} onPress={() => setShowQr(false)}>
            <View style={styles.qrBox}>
              <Text style={styles.qrTitle}>Scan to invite</Text>
              <QRCode value={referralLink} size={200} backgroundColor="#ffffff" color="#000000" />
              <Text style={styles.qrCodeLabel}>{referralDisplayCode}</Text>
              <Text style={styles.qrHint}>Tap outside to close</Text>
            </View>
          </TouchableOpacity>
        </Modal>
        <TouchableOpacity style={styles.actionRow} activeOpacity={0.7} onPress={handleOpenSupport}>
          <Text style={styles.actionLabel}>{t('pr.support')}</Text>
          <Text style={styles.actionChevron}>›</Text>
        </TouchableOpacity>

        <GlassCard>
          <Text style={styles.footerBrand}>SetaLink</Text>
          <TouchableOpacity onLongPress={() => (onNavigate as (tab: string) => void)('diagnostics')} delayLongPress={1500}>
            <Text style={styles.footerMeta}>v{APP_VERSION} ({APP_BUILD})</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleOpenWebsite}>
            <Text style={styles.footerLink}>https://setalink.no</Text>
          </TouchableOpacity>
          <Text style={styles.footerCopy}>© 2026 SetaLink. {t('st.allRights')}</Text>
        </GlassCard>

        {/* Sign out */}
        <TouchableOpacity style={styles.logoutBtn} activeOpacity={0.75} onPress={handleSignOut}>
          <Text style={styles.logoutText}>{t('pr.signOut')}</Text>
        </TouchableOpacity>

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:           { flex: 1, backgroundColor: Colors.bg.base },
  scroll:           { flex: 1 },
  content:          { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[4] },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:            { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  settingsBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  settingsIcon:     { fontSize: 18, color: Colors.text.secondary },
  userCard:         { flexDirection: 'row', alignItems: 'center', gap: Spacing[4] },
  avatar:           { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.emerald[700], alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.emerald[400], position: 'relative' },
  avatarInitial:    { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary },
  premiumBadge:     { position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFB800', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.bg.base },
  premiumIcon:      { fontSize: 9, color: '#000' },
  userName:         { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  userEmail:        { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  planRow:          { marginTop: 6 },
  planBadge:        { backgroundColor: 'rgba(255,184,0,0.15)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(255,184,0,0.3)', paddingHorizontal: Spacing[3], paddingVertical: 3, alignSelf: 'flex-start' },
  planText:         { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: '#FFB800', letterSpacing: 0.5 },
  subCard:          { gap: Spacing[4] },
  subHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  subTitle:         { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  subExpiry:        { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  subStatus:        { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,232,122,0.1)', borderRadius: Radius.full, paddingHorizontal: Spacing[3], paddingVertical: 5 },
  subDot:           { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.emerald[400] },
  subStatusText:    { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  subDivider:       { height: 1, backgroundColor: Colors.border.subtle },
  subPills:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  unlimitedPill:    { backgroundColor: 'rgba(0,232,122,0.12)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(0,232,122,0.3)', paddingHorizontal: Spacing[3], paddingVertical: 2 },
  unlimitedPillText:{ fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.3 },
  gbPill:           { backgroundColor: 'rgba(0,232,122,0.08)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(0,232,122,0.2)', paddingHorizontal: Spacing[3], paddingVertical: 2 },
  gbPillText:       { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.emerald[400] },
  daysPill:         { backgroundColor: Colors.bg.elevated, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 2 },
  daysPillUrgent:   { backgroundColor: 'rgba(255,184,0,0.1)', borderColor: 'rgba(255,184,0,0.35)' },
  daysPillText:     { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  daysPillTextUrgent: { color: '#FFB800' },
  subMeta:          { flexDirection: 'row', justifyContent: 'space-around' },
  subMetaItem:      { alignItems: 'center', gap: 2 },
  subMetaValue:     { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  subMetaLabel:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  manageBtn:        { borderWidth: 1, borderColor: Colors.emerald[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  manageBtnText:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.5 },
  upgradeBtn:       { backgroundColor: Colors.emerald[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  upgradeBtnText:   { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: 0.5 },
  addDataBtn:       { backgroundColor: '#FFB800' },
  addDataBtnText:   { color: '#000' },
  gbPillExhausted:  { backgroundColor: 'rgba(255,80,80,0.1)', borderColor: 'rgba(255,80,80,0.3)' },
  gbPillTextExhausted: { color: Colors.status.disconnected },
  quotaExhaustedPill:  { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,184,0,0.12)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(255,184,0,0.35)', paddingHorizontal: Spacing[3], paddingVertical: 5 },
  quotaExhaustedPillText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: '#FFB800', letterSpacing: 0.3 },
  cardLabel:        { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[3] },
  deviceRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing[3], gap: Spacing[3] },
  deviceIcon:       { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  deviceIconText:   { fontSize: 20, color: Colors.text.secondary },
  deviceInfo:       { flex: 1 },
  deviceName:       { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.primary },
  deviceOs:         { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  biometricWarning: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#FFB800', marginTop: 4, lineHeight: 16 },
  deviceStatus:     { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  deviceStatusText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label },
  referralCard:     { gap: Spacing[3] },
  referralHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rewardBadge:      { backgroundColor: 'rgba(51,153,255,0.12)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(51,153,255,0.3)', paddingHorizontal: Spacing[3], paddingVertical: 3 },
  rewardBadgeText:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.blue[400] },
  referralDesc:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  referralCode:     { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], gap: Spacing[3] },
  referralCodeText: { flex: 1, fontSize: Typography.size.base, fontFamily: Typography.family.mono, color: Colors.text.primary, letterSpacing: 2 },
  copyBtn:          { backgroundColor: Colors.emerald[400], borderRadius: Radius.md, paddingHorizontal: Spacing[3], paddingVertical: 6 },
  copyBtnText:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.inverse },
  shareBtn:         { borderWidth: 1, borderColor: Colors.blue[400], borderRadius: Radius.md, paddingVertical: Spacing[3], alignItems: 'center' },
  shareBtnText:     { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.blue[400], letterSpacing: 0.3 },
  referralStats:    { flexDirection: 'row', gap: Spacing[6] },
  referralStat:     { gap: 2 },
  referralStatValue:{ fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  referralStatLabel:{ fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  rewardsRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rewardsTitle:     { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  rewardsSub:       { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  comingSoon:       { backgroundColor: Colors.bg.elevated, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 4 },
  comingSoonText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted },
  actionRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.bg.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.subtle, paddingHorizontal: Spacing[4], paddingVertical: Spacing[4] },
  actionLabel:      { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  actionChevron:    { fontSize: 20, color: Colors.text.muted },
  logoutBtn:        { borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)', borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', backgroundColor: 'rgba(255,68,68,0.06)' },
  logoutText:       { fontSize: Typography.size.base, fontFamily: Typography.family.label, color: Colors.status.disconnected, letterSpacing: 0.3 },
  footerBrand:      { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  footerMeta:       { marginTop: 4, fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  footerLink:       { marginTop: Spacing[2], fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.blue[400] },
  footerCopy:       { marginTop: Spacing[2], fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  // Pending referral banner
  pendingBanner:    { gap: Spacing[2] },
  pendingRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  pendingTitle:     { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400], marginBottom: 2 },
  pendingDesc:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 16 },
  pendingCode:      { fontFamily: Typography.family.mono, color: Colors.text.primary },
  pendingBtn:       { backgroundColor: Colors.emerald[400], borderRadius: Radius.md, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], minWidth: 64, alignItems: 'center' },
  pendingBtnDisabled: { opacity: 0.5 },
  pendingBtnText:   { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.inverse },

  // QR button
  qrBtn:            { backgroundColor: Colors.bg.elevated, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 6 },
  qrBtnText:        { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.secondary },

  // QR modal
  qrOverlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
  qrBox:            { backgroundColor: '#fff', borderRadius: Radius['2xl'], padding: Spacing[6], alignItems: 'center', gap: Spacing[4], marginHorizontal: Spacing[8] },
  qrTitle:          { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: '#111' },
  qrCodeLabel:      { fontSize: Typography.size.base, fontFamily: Typography.family.mono, color: '#333', letterSpacing: 2 },
  qrHint:           { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#999' },

  // Viral loop
  viralCard:        { gap: Spacing[3] },
  viralDesc:        { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  viralProgressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  viralDot:         { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated },
  viralDotFilled:   { backgroundColor: Colors.emerald[400], borderColor: Colors.emerald[400] },
  viralProgressText:{ fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted, marginLeft: Spacing[2] },
  viralUnlockedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  viralUnlockedIcon:{ fontSize: 28 },
  viralUnlockedText:{ fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.emerald[400] },
  viralUnlockedSub: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
});
