import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Clipboard,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { useAuthStore }    from '../stores/authStore';
import { useSessionStore } from '../stores/sessionStore';
import { useToastStore }   from '../stores/toastStore';
import { formatBytes, formatDuration } from '../utils/formatters';
import { useT } from '../i18n';

// ── Plan meta ─────────────────────────────────────────────────────────────────

const PLAN_LIMITS: Record<string, { label: string; gbLimit: number | null }> = {
  free:    { label: 'Free Plan',    gbLimit: 10   },
  premium: { label: 'Premium Plan', gbLimit: null }, // unlimited
  team:    { label: 'Team Plan',    gbLimit: null },
};

function formatExpiry(iso: string | null): string {
  if (!iso) return 'No expiry';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── BandwidthBar ──────────────────────────────────────────────────────────────

interface BandwidthBarProps {
  usedBytes: number;
  limitGb: number | null;
  labelUnlimited: string;
  labelUsedMonth: string;
  labelGbUsed: string;
}

function BandwidthBar({ usedBytes, limitGb, labelUnlimited, labelUsedMonth, labelGbUsed }: BandwidthBarProps) {
  if (limitGb === null) {
    return (
      <View style={bwStyles.unlimitedRow}>
        <Text style={bwStyles.unlimitedText}>{labelUnlimited}</Text>
        <Text style={bwStyles.usedText}>{formatBytes(usedBytes, 2)} {labelUsedMonth}</Text>
      </View>
    );
  }

  const usedGb  = usedBytes / 1e9;
  const pct     = Math.min(usedGb / limitGb, 1);
  const color   = pct < 0.6 ? Colors.emerald[400] : pct < 0.85 ? '#FFB800' : Colors.status.disconnected;

  return (
    <View style={bwStyles.wrapper}>
      <View style={bwStyles.track}>
        <View style={[bwStyles.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
      </View>
      <View style={bwStyles.labels}>
        <Text style={bwStyles.usedText}>{usedGb.toFixed(1)} {labelGbUsed}</Text>
        <Text style={bwStyles.total}>{limitGb} GB</Text>
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
  const { user, logout }                 = useAuthStore();
  const { totalBytesThisMonth, sessionsThisMonth, totalDurationToday } = useSessionStore();
  const showToast = useToastStore((s) => s.show);

  if (!user) return null;

  const plan     = PLAN_LIMITS[user.plan] ?? PLAN_LIMITS.free;
  const initial  = user.name.charAt(0).toUpperCase();
  const monthSessions = sessionsThisMonth();
  const monthBytes    = totalBytesThisMonth();

  const handleCopyReferral = () => {
    Clipboard.setString(user.referralCode);
    showToast(t('pr.copiedCode'), 'success', 2000);
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
          <View>
            <Text style={styles.userName}>{user.name}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            <View style={styles.planRow}>
              <View style={[
                styles.planBadge,
                user.plan === 'free' && { borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated },
              ]}>
                <Text style={[
                  styles.planText,
                  user.plan === 'free' && { color: Colors.text.muted },
                ]}>
                  {plan.label}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Subscription card */}
        <GlassCard glowColor={Colors.emerald[400]} style={styles.subCard}>
          <View style={styles.subHeader}>
            <View>
              <Text style={styles.subTitle}>{plan.label}</Text>
              <Text style={styles.subExpiry}>
                {user.planExpiry ? `${t('pr.renewsOn')} ${formatExpiry(user.planExpiry)}` : t('pr.lifetime')}
              </Text>
            </View>
            <View style={styles.subStatus}>
              <View style={styles.subDot} />
              <Text style={styles.subStatusText}>{t('pr.active')}</Text>
            </View>
          </View>

          <View style={styles.subDivider} />

          <BandwidthBar
            usedBytes={monthBytes}
            limitGb={plan.gbLimit}
            labelUnlimited={t('pr.unlimited')}
            labelUsedMonth={t('pr.usedMonth')}
            labelGbUsed={t('pr.gbUsed')}
          />

          <View style={styles.subMeta}>
            {[
              { label: t('pr.sessions'), value: String(monthSessions.length) },
              { label: t('pr.servers'),  value: user.plan === 'free' ? '5' : '50+' },
              { label: t('pr.speed'),    value: user.plan === 'free' ? '10 MB/s' : t('pr.unlimited') },
            ].map((item) => (
              <View key={item.label} style={styles.subMetaItem}>
                <Text style={styles.subMetaValue}>{item.value}</Text>
                <Text style={styles.subMetaLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {user.plan === 'free' ? (
            <TouchableOpacity
              style={styles.upgradeBtn}
              activeOpacity={0.85}
              onPress={() => (onNavigate as (tab: string) => void)('upgrade')}
            >
              <Text style={styles.upgradeBtnText}>{t('pr.upgradePremium')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.manageBtn} activeOpacity={0.8}>
              <Text style={styles.manageBtnText}>{t('pr.manageSub')}</Text>
            </TouchableOpacity>
          )}
        </GlassCard>

        {/* Devices */}
        <GlassCard>
          <Text style={styles.cardLabel}>{t('pr.activeDevices')}</Text>
          {[
            { name: 'Pixel 8 Pro',   os: 'Android 15', active: true  },
            { name: 'MacBook Pro',   os: 'macOS 15.2', active: true  },
            { name: 'iPad Air (M2)', os: 'iPadOS 18',  active: false },
          ].map((device, i) => (
            <View key={i} style={[
              styles.deviceRow,
              i > 0 && { borderTopWidth: 1, borderTopColor: Colors.border.subtle },
            ]}>
              <View style={styles.deviceIcon}>
                <Text style={styles.deviceIconText}>◻</Text>
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.deviceOs}>{device.os}</Text>
              </View>
              <View style={[
                styles.deviceStatus,
                { backgroundColor: device.active ? Colors.emerald[400] + '20' : Colors.bg.elevated },
              ]}>
                <Text style={[
                  styles.deviceStatusText,
                  { color: device.active ? Colors.emerald[400] : Colors.text.muted },
                ]}>
                  {device.active ? t('pr.online') : t('pr.offline')}
                </Text>
              </View>
            </View>
          ))}
        </GlassCard>

        {/* Referral */}
        <GlassCard style={styles.referralCard} glowColor={Colors.blue[400]}>
          <View style={styles.referralHeader}>
            <Text style={styles.cardLabel}>{t('pr.referEarn')}</Text>
            <View style={styles.rewardBadge}>
              <Text style={styles.rewardBadgeText}>{t('pr.free30days')}</Text>
            </View>
          </View>
          <Text style={styles.referralDesc}>{t('pr.referDesc')}</Text>
          <View style={styles.referralCode}>
            <Text style={styles.referralCodeText}>{user.referralCode}</Text>
            <TouchableOpacity style={styles.copyBtn} activeOpacity={0.75} onPress={handleCopyReferral}>
              <Text style={styles.copyBtnText}>{t('pr.copy')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.referralStats}>
            <View style={styles.referralStat}>
              <Text style={styles.referralStatValue}>4</Text>
              <Text style={styles.referralStatLabel}>{t('pr.invited')}</Text>
            </View>
            <View style={styles.referralStat}>
              <Text style={styles.referralStatValue}>120</Text>
              <Text style={styles.referralStatLabel}>{t('pr.daysEarned')}</Text>
            </View>
          </View>
        </GlassCard>

        {/* Rewards */}
        <GlassCard>
          <View style={styles.rewardsRow}>
            <View>
              <Text style={styles.rewardsTitle}>{t('pr.rewardsHub')}</Text>
              <Text style={styles.rewardsSub}>{t('pr.rewardsSoon')}</Text>
            </View>
            <View style={styles.comingSoon}>
              <Text style={styles.comingSoonText}>{t('pr.soon')}</Text>
            </View>
          </View>
        </GlassCard>

        {/* Actions */}
        {[
          { labelKey: 'pr.changePassword', onPress: undefined },
          { labelKey: 'pr.notifSettings',  onPress: undefined },
          { labelKey: 'pr.exportConfig',   onPress: undefined },
        ].map((item) => (
          <TouchableOpacity key={item.labelKey} style={styles.actionRow} activeOpacity={0.7} onPress={item.onPress}>
            <Text style={styles.actionLabel}>{t(item.labelKey as any)}</Text>
            <Text style={styles.actionChevron}>›</Text>
          </TouchableOpacity>
        ))}

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
  subMeta:          { flexDirection: 'row', justifyContent: 'space-around' },
  subMetaItem:      { alignItems: 'center', gap: 2 },
  subMetaValue:     { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  subMetaLabel:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  manageBtn:        { borderWidth: 1, borderColor: Colors.emerald[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  manageBtnText:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.5 },
  upgradeBtn:       { backgroundColor: Colors.emerald[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  upgradeBtnText:   { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: 0.5 },
  cardLabel:        { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[3] },
  deviceRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing[3], gap: Spacing[3] },
  deviceIcon:       { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  deviceIconText:   { fontSize: 20, color: Colors.text.secondary },
  deviceInfo:       { flex: 1 },
  deviceName:       { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.primary },
  deviceOs:         { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
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
});
