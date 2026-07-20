import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Clipboard, Share, Linking,
  Modal, ActivityIndicator,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { useAuthStore }    from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore, SessionRecord } from '../stores/sessionStore';
import { useToastStore }   from '../stores/toastStore';
import { useVpnStore }     from '../stores/vpnStore';
import { formatBytes, prettyPackageName } from '../utils/formatters';
import { APP_VERSION, APP_BUILD } from '../utils/version';
import { useT, TKey } from '../i18n';
import { useReferral, syncEntitlement } from '../services/entitlementService';
import { getRealWallet, RealWalletInfo } from '../services/realWalletService';
import { getActivityTimeline, ActivityEvent } from '../services/activityService';
import { WatchAdCard } from '../components/WatchAdCard';
import { TopBar } from '../components/TopBar';
import { getCommunityRank, getClanId } from '../components/CommunityRankCard';
import { EcosystemFooter } from '../components/EcosystemFooter';
import { RealWalletCard } from '../components/RealWalletCard';
import { IdentityHeader } from '../components/IdentityHeader';
import { getCachedConfig } from '../services/remoteConfigService';
import { useInboxStore } from '../stores/inboxStore';
import { isVipUser } from '../utils/vip';

// ── §5.10 Freedom Stats — five raw values, no composite score (2026-07-18
// decision: "don't invent a score yet — when we have enough real user data we
// can introduce one later"). Derived entirely from the local session log, so
// it renders instantly with no network round-trip.
function computeFreedomStats(sessions: SessionRecord[]) {
  const countries = new Set(sessions.map(s => s.serverFlag).filter(Boolean));
  const nodes      = new Set(sessions.map(s => s.serverId).filter(Boolean));
  const withSpeed   = sessions.filter(s => s.duration > 0);
  const avgMbps     = withSpeed.length > 0
    ? withSpeed.reduce((sum, s) => sum + ((s.sentBytes + s.recvBytes) * 8) / s.duration / 1e6, 0) / withSpeed.length
    : 0;
  const successRate = sessions.length > 0
    ? sessions.filter(s => s.status === 'success').length / sessions.length
    : 0;
  const totalGb = sessions.reduce((sum, s) => sum + s.sentBytes + s.recvBytes, 0) / 1e9;
  return {
    countries: countries.size,
    nodes: nodes.size,
    avgMbps: Math.round(avgMbps * 10) / 10,
    successPct: Math.round(successRate * 100),
    totalGb: Math.round(totalGb * 10) / 10,
  };
}

// ── §5.10 Achievements — checklist, all derivable from data already on
// AuthUser/sessionStore. Best-effort mapping (no approved copy/mockup was
// available) — flagged for Khabat to adjust criteria if these aren't quite
// what he meant by each title.
function computeAchievements(sessions: SessionRecord[], user: {
  plan: string; inviteCount: number; stealthUnlocked: boolean;
}) {
  const totalGb = sessions.reduce((sum, s) => sum + s.sentBytes + s.recvBytes, 0) / 1e9;
  const usedStarlink = sessions.some(s => /starlink/i.test(s.serverName) || /starlink/i.test(s.route ?? ''));
  return [
    { key: 'firstConnect',  icon: '🌐', done: sessions.length > 0 },
    { key: 'firstGb',       icon: '📦', done: totalGb >= 1 },
    { key: 'tenInvites',    icon: '👥', done: user.inviteCount >= 10 },
    { key: 'premium',       icon: '⭐', done: user.plan !== 'free' },
    { key: 'starlink',      icon: '🛰️', done: usedStarlink },
    { key: 'founder',       icon: '🏛️', done: user.stealthUnlocked },
  ];
}

// ── Plan meta ─────────────────────────────────────────────────────────────────

// Plan → localized label key. Resolved through t() in the component.
const PLAN_LABEL_KEY: Record<string, TKey> = {
  free:    'pr.planFree',
  premium: 'pr.planPremium',
  team:    'pr.planTeam',
};

const ONE_GB_BYTES = 1024 * 1024 * 1024;

// Maps the server milestone reward keys (lib/quota_economy.php qe_milestones)
// to localized i18n keys so both languages stay in sync.
const REWARD_KEY_TO_TKEY: Record<string, TKey> = {
  first_stealth: 'pr.msStealth',
  bonus2:        'pr.msBonus2',
  priority:      'pr.msPriority',
  bonus5:        'pr.msBonus5',
  vip:           'pr.msVip',
  bonus13:       'pr.msBonus13',
  elite:         'pr.msElite',
};

// Fallback ladder used only when the server has not yet returned milestone data.
const FALLBACK_MILESTONES: Array<{ count: number; rewardKey: TKey }> = [
  { count: 3,  rewardKey: 'pr.msStealth'  },
  { count: 5,  rewardKey: 'pr.msBonus2'   },
  { count: 8,  rewardKey: 'pr.msPriority' },
  { count: 13, rewardKey: 'pr.msBonus5'   },
  { count: 21, rewardKey: 'pr.msVip'      },
  { count: 34, rewardKey: 'pr.msBonus13'  },
  { count: 55, rewardKey: 'pr.msElite'    },
];

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

const gb = (bytes: number) => `${(Math.max(0, bytes) / 1e9).toFixed(1)} GB`;

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

// ── Package card ────────────────────────────────────────────────────────────--

function PackageCard({ title, desc, bytes, accent, tag, dimmed, gift }: {
  title: string; desc: string; bytes: number; accent: string; tag?: string; dimmed?: boolean;
  /** Wrap the card as a present: ribbon bands in the accent colour + this bow
   *  emoji in the corner. Used for granted packs (welcome gift, invite reward). */
  gift?: string;
}) {
  return (
    <View style={[pkgStyles.card, { borderColor: accent + '40' }, dimmed && pkgStyles.cardDimmed]}>
      {gift && (
        <>
          <View pointerEvents="none" style={[pkgStyles.ribbonV, { backgroundColor: accent + '1F' }]} />
          <View pointerEvents="none" style={[pkgStyles.ribbonH, { backgroundColor: accent + '1F' }]} />
          <Text style={pkgStyles.bow}>{gift}</Text>
        </>
      )}
      <View style={[pkgStyles.accentDot, { backgroundColor: accent }]} />
      <Text style={pkgStyles.cardTitle} numberOfLines={1}>{title}</Text>
      <Text style={[pkgStyles.cardValue, { color: accent }]}>{gb(bytes)}</Text>
      <Text style={pkgStyles.cardDesc} numberOfLines={2}>{desc}</Text>
      {tag && (
        <View style={pkgStyles.cardTag}>
          <Text style={pkgStyles.cardTagText}>{tag}</Text>
        </View>
      )}
    </View>
  );
}

const pkgStyles = StyleSheet.create({
  card:        { width: 150, backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing[3], gap: 4, overflow: 'hidden' },
  // Gift wrapping: two translucent ribbon bands crossing the card + a bow.
  ribbonV:     { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 14, marginLeft: -7 },
  ribbonH:     { position: 'absolute', left: 0, right: 0, top: '50%', height: 14, marginTop: -7 },
  bow:         { position: 'absolute', top: 4, right: 6, fontSize: 15 },
  cardDimmed:  { opacity: 0.55 },
  accentDot:   { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  cardTitle:   { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary },
  cardValue:   { fontSize: Typography.size.xl, fontFamily: Typography.family.heading },
  cardDesc:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, lineHeight: 15 },
  cardTag:     { alignSelf: 'flex-start', marginTop: 2, backgroundColor: Colors.bg.surface, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: 8, paddingVertical: 2 },
  cardTagText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.secondary },
});

// ── Screen ────────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
  onSignOut?: () => void;
}

export function ProfileScreen({ onNavigate, activeTab, onSignOut }: Props) {
  const { t } = useT();
  const { user, logout, addBonusBytes, updateFromEntitlement } = useAuthStore();
  const { pendingReferralCode, setPendingReferralCode } = useSettingsStore();
  const { sessionsThisMonth } = useSessionStore();
  const showToast = useToastStore((s) => s.show);
  const { connectionState, sessionBytes } = useVpnStore();

  const [showQr, setShowQr] = useState(false);
  const [applyingPending, setApplyingPending] = useState(false);
  // Kept fresh here (not read directly — TopBar/Chats tab render the unread
  // badge) so it's already warm by the time the user opens Chats.
  const refreshInbox  = useInboxStore((s) => s.refresh);

  // §5.10 cards
  const { sessions } = useSessionStore();
  const [wallet, setWallet]     = useState<RealWalletInfo | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const freedomStats  = useMemo(() => computeFreedomStats(sessions), [sessions]);
  // Guarded field access (not `user.plan`) — this runs before the `if (!user)
  // return null` guard below, so hook order stays identical across the
  // null→loaded transition (see rules-of-hooks).
  const achievements  = useMemo(() => computeAchievements(sessions, {
    plan: user?.plan ?? 'free',
    inviteCount: user?.inviteCount ?? 0,
    stealthUnlocked: user?.stealthUnlocked ?? false,
  }), [sessions, user?.plan, user?.inviteCount, user?.stealthUnlocked]);

  const navTo = onNavigate as (tab: string) => void;

  useEffect(() => {
    if (user?.deviceId) {
      refreshInbox(user.deviceId).catch(() => {});
      // Pull the server-side quota ledger (breakdown + milestones + packages)
      // so all profile cards render from authoritative server data.
      syncEntitlement(user.deviceId).then(updateFromEntitlement).catch(() => {});
      getRealWallet(user.deviceId).then(setWallet).catch(() => {});
      getActivityTimeline(user.deviceId, 5).then((r) => setActivity(r.timeline)).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  const isConnected   = connectionState === 'connected';
  // Live quota: base + current session traffic (not yet committed to backend)
  const liveQuotaUsed = user.quotaBytesUsed + (isConnected ? sessionBytes.sent + sessionBytes.received : 0);

  // Quota limits derived from the entitlement returned by backend, not hardcoded
  const isUnlimited   = user.plan !== 'free';
  const planLabel     = t(PLAN_LABEL_KEY[user.plan] ?? 'pr.planFree');
  const limitGb       = isUnlimited ? null : user.quotaBytesTotal / 1e9;

  const remainingBytes     = Math.max(0, user.quotaBytesTotal - liveQuotaUsed);
  const isQuotaExhausted   = !isUnlimited && remainingBytes === 0;

  // Package breakdown — read from the server-side quota ledger (v0.9.31). The
  // client no longer derives buckets; it falls back to a local estimate only
  // when an older entitlement carries no ledger yet.
  const q              = user.quota;
  const starterBytes   = q ? q.starter_quota   : Math.min(ONE_GB_BYTES, user.quotaBytesTotal);
  const referralBytes  = q ? q.referral_quota  : Math.max(0, user.quotaBytesTotal - starterBytes);
  const purchasedBytes = q ? q.purchased_quota : 0;
  const transferableBytes = q
    ? q.transferable_quota
    : Math.max(0, Math.min(user.quotaBytesTotal - user.quotaBytesUsed, user.quotaBytesTotal - starterBytes));
  const purchasedPackages = user.packages ?? [];

  const primaryId  = user.userId || `SL-???-${user.deviceId.slice(-8).toUpperCase()}`;
  // Referral code MUST be the backend `referral_code` — that is what use-referral
  // looks up. The old code derived it from the user_id suffix, which never matched
  // the stored referral_code, so every shared invite was rejected.
  const referralDisplayCode = (user.referralCode || '').toUpperCase();
  const monthSessions = sessionsThisMonth();
  const daysLeft      = getDaysRemaining(user.planExpiry);

  const clanRank = getCommunityRank(user.activeInviteCount);
  const clanId   = getClanId(user.userId || primaryId);

  // Milestone progression — server-driven (only approved referrals count).
  const msData  = user.milestones;
  const invites = msData ? msData.invite_count : (user.inviteCount ?? 0);
  const ladder: Array<{ count: number; rewardKey: TKey; reached: boolean }> = msData
    ? msData.milestones.map(m => ({
        count: m.count,
        rewardKey: REWARD_KEY_TO_TKEY[m.rewardKey] ?? 'pr.msStealth',
        reached: m.reached,
      }))
    : FALLBACK_MILESTONES.map(m => ({ ...m, reached: invites >= m.count }));
  const isVip = isVipUser(invites, msData);
  const nextCount = msData
    ? msData.next_milestone
    : (FALLBACK_MILESTONES.find(m => invites < m.count)?.count ?? null);
  const nextMs = nextCount != null ? (ladder.find(m => m.count === nextCount) ?? null) : null;
  const nextProgress = msData ? msData.progress : (nextCount ? Math.min(1, invites / nextCount) : 1);

  const handleCopyReferral = () => {
    Clipboard.setString(referralDisplayCode);
    showToast(t('pr.copiedCode'), 'success', 2000);
  };

  const handleShareReferral = async () => {
    try {
      await Share.share({
        message: t('pr.shareMessage').replace(/\{code\}/g, referralDisplayCode),
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
      setPendingReferralCode(null);
      if (result.status === 'pending_review') {
        // Anti-fraud hold — bonus is granted only after admin approval.
        showToast(t('pr.pendingReview'), 'info', 4000);
      } else {
        addBonusBytes(result.bonus_bytes);
        const earned = (result.bonus_bytes / (1024 * 1024 * 1024)).toFixed(0);
        showToast(t('pr.bonusCredited').replace('{gb}', earned), 'success', 3000);
      }
    } catch (e: any) {
      showToast(e?.message || t('pr.refError'), 'error', 3000);
    } finally {
      setApplyingPending(false);
    }
  };

  // Contact support now opens the in-app Support thread (deep-links straight to
  // it) instead of an external Telegram link.
  const handleOpenSupport = () => {
    navTo('support');
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
          <View style={styles.headerActions}>
            <TopBar onNavigate={onNavigate as (tab: string) => void} />
            {/* Settings — TopBar dropped its gear icon in the b97 declutter on
                the understanding it would live here instead (see TopBar.tsx
                header comment); the button never actually got re-added, so
                Settings became unreachable from anywhere in the app. */}
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={() => (onNavigate as (tab: string) => void)('settings')}
              activeOpacity={0.75}
            >
              <Text style={styles.settingsIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Pending referral banner */}
        {!!pendingReferralCode && (
          <GlassCard style={styles.pendingBanner} glowColor={Colors.emerald[400]}>
            <View style={styles.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>{t('pr.pendingRefTitle')}</Text>
                <Text style={styles.pendingDesc}>
                  {t('pr.pendingRefDesc').replace('{code}', pendingReferralCode)}
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
                  : <Text style={styles.pendingBtnText}>{t('pr.apply')}</Text>
                }
              </TouchableOpacity>
            </View>
          </GlassCard>
        )}

        {/* ── §5.10 Hero ── avatar + @handle + nickname (tap to edit), plus a
            couple of earned chips. Skips §5.10.4's "dynamic status line" — no
            classification rule has been decided yet (Khabat's own doc: "needs
            a concrete rule before building, not just nice titles"). */}
        <IdentityHeader seedId={user.deviceId} fallbackId={primaryId} planLabel={planLabel} isVip={isVip} />
        {(isUnlimited || user.stealthUnlocked) && (
          <View style={styles.heroChipRow}>
            {isUnlimited && (
              <View style={styles.heroChip}><Text style={styles.heroChipText}>⭐ {t('pr.planPremium')}</Text></View>
            )}
            {user.stealthUnlocked && (
              <View style={styles.heroChip}><Text style={styles.heroChipText}>🛡 {t('ach.founder')}</Text></View>
            )}
          </View>
        )}

        {/* ── §5.10 Wallet summary ── REAL wallet promoted to its own tab;
            this is just the headline numbers + a link there. */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => navTo('wallet')}>
          <GlassCard style={styles.summaryCard} glowColor={Colors.gold[400]}>
            <View style={styles.summaryHeader}>
              <Text style={styles.cardLabel}>{t('wallet.title')}</Text>
              <Text style={styles.actionChevron}>›</Text>
            </View>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>{wallet?.balance != null ? wallet.balance.toLocaleString() : '—'}</Text>
                <Text style={styles.summaryLabel}>REAL</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>{(user.quotaBytesTotal / 1e9).toFixed(0)}</Text>
                <Text style={styles.summaryLabel}>GB</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>{t('wallet.tonComingSoon')}</Text>
                <Text style={styles.summaryLabel}>TON</Text>
              </View>
            </View>
          </GlassCard>
        </TouchableOpacity>

        {/* ── §5.10.2 Freedom Stats ── five raw values, no composite score
            (decided 2026-07-18 — see computeFreedomStats above). */}
        <GlassCard style={styles.card}>
          <Text style={styles.cardLabel}>{t('fs.title')}</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCell}><Text style={styles.statValue}>{freedomStats.countries}</Text><Text style={styles.statLabel}>{t('fs.countries')}</Text></View>
            <View style={styles.statCell}><Text style={styles.statValue}>{freedomStats.nodes}</Text><Text style={styles.statLabel}>{t('fs.nodes')}</Text></View>
            <View style={styles.statCell}><Text style={styles.statValue}>{freedomStats.avgMbps}</Text><Text style={styles.statLabel}>{t('fs.speed')}</Text></View>
            <View style={styles.statCell}><Text style={styles.statValue}>{freedomStats.successPct}%</Text><Text style={styles.statLabel}>{t('fs.uptime')}</Text></View>
            <View style={styles.statCell}><Text style={styles.statValue}>{freedomStats.totalGb}</Text><Text style={styles.statLabel}>{t('fs.dataShared')}</Text></View>
          </View>
        </GlassCard>

        {/* ── §5.10.3 Activity Timeline ── merged RealGram/VPN/Wallet/Shahnameh
            feed (activity-timeline endpoint), preview of the 5 most recent. */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => navTo('activity')}>
          <GlassCard style={styles.card}>
            <View style={styles.summaryHeader}>
              <Text style={styles.cardLabel}>{t('ac.title')}</Text>
              <Text style={styles.actionChevron}>›</Text>
            </View>
            {activity.length === 0 ? (
              <Text style={styles.activityEmpty}>{t('ac.empty')}</Text>
            ) : (
              activity.map((e, i) => (
                <View key={i} style={styles.activityRow}>
                  <Text style={styles.activityIcon}>{e.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activityLabel} numberOfLines={1}>{e.label}</Text>
                    {!!e.detail && <Text style={styles.activityDetail} numberOfLines={1}>{e.detail}</Text>}
                  </View>
                </View>
              ))
            )}
          </GlassCard>
        </TouchableOpacity>

        {/* ── §5.10 Achievements ── checklist derived from data already on
            AuthUser/sessionStore (see computeAchievements above). */}
        <GlassCard style={styles.card}>
          <Text style={styles.cardLabel}>{t('ach.title')}</Text>
          <View style={styles.achList}>
            {achievements.map((a) => (
              <View key={a.key} style={styles.achRow}>
                <Text style={[styles.achIcon, !a.done && styles.achIconDim]}>{a.icon}</Text>
                <Text style={[styles.achLabel, a.done && styles.achLabelDone]}>{t(`ach.${a.key}` as TKey)}</Text>
                {a.done && <Text style={styles.achCheck}>✓</Text>}
              </View>
            ))}
          </View>
        </GlassCard>

        {/* ── §5.10 Clan summary ── CommunityRankCard promoted to its own tab;
            this is just the rank + clan chip + a link there. */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => navTo('clan')}>
          <GlassCard style={styles.summaryCard} glowColor={Colors.gold[400]}>
            <View style={styles.summaryHeader}>
              <Text style={styles.cardLabel}>{t('nav.clan')}</Text>
              <Text style={styles.actionChevron}>›</Text>
            </View>
            <View style={styles.clanSummaryRow}>
              <Text style={styles.clanSummaryIcon}>{clanRank.icon}</Text>
              <Text style={styles.clanSummaryText}>{t(`pr.rank_${clanRank.key}` as TKey)}</Text>
              {!!clanId && (
                <View style={styles.clanChip}><Text style={styles.clanChipText}>{t('pr.clanLabel')} {clanId}</Text></View>
              )}
            </View>
          </GlassCard>
        </TouchableOpacity>

        {/* ── Manage — everything else from the old Profile that doesn't have
            a home in the six §5.10 cards above; not deleted, just folded
            in here so nothing is silently dropped. */}
        <Text style={styles.manageHeading}>{t('pr.manage')}</Text>

        {/* Referral code sharing — the rank/earnings summary now lives in the
            Clan summary card above, so this block is just the code itself. */}
        <GlassCard style={styles.referralHubCard} glowColor={Colors.gold[400]}>
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
                    <Text style={styles.unlimitedPillText}>∞ {t('pr.unlimitedShort')}</Text>
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
              // Cap displayed used at total so it never shows "used > total" visually
              { label: t('pr.usedTraffic'), value: `${(Math.min(liveQuotaUsed, user.quotaBytesTotal) / 1e9).toFixed(2)} GB` },
              { label: t('pr.sessions'),    value: String(monthSessions.length) },
            ].map((item) => (
              <View key={item.label} style={styles.subMetaItem}>
                <Text style={[styles.subMetaValue, item.label === t('pr.usedTraffic') && isQuotaExhausted && { color: Colors.status.disconnected }]}>{item.value}</Text>
                <Text style={styles.subMetaLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {user.plan === 'free' ? (
            <TouchableOpacity
              style={[styles.upgradeBtn, isQuotaExhausted && styles.addDataBtn]}
              activeOpacity={0.85}
              onPress={() => navTo('upgrade')}
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

        {/* REAL wallet — remote-config gated (ecosystem.wallet_enabled), so it
            stays hidden until the Shahnameh-side backend is live (plan A3). */}
        <RealWalletCard
          deviceId={user.deviceId}
          onRedeemed={() => syncEntitlement(user.deviceId).then(updateFromEntitlement).catch(() => {})}
        />

        {/* TrustAI account link — remote-config gated (ecosystem.trustai_link_enabled),
            same rollout pattern as the wallet card (plan B-9). */}
        {getCachedConfig()?.ecosystem?.trustai_link_enabled === true && (
          <GlassCard style={styles.trustaiCard}>
            <View style={styles.trustaiRow}>
              <Text style={styles.cardLabel}>{t('trustai.profileTitle')}</Text>
              <TouchableOpacity
                style={styles.trustaiBtn}
                onPress={() => (onNavigate as (tab: string) => void)('trustai-link')}
                accessibilityLabel={t('trustai.profileBtn')}
              >
                <Text style={styles.trustaiBtnText}>{t('trustai.profileBtn')}</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        )}

        {/* Package / quota overview */}
        <GlassCard style={styles.packagesCard}>
          <Text style={styles.cardLabel}>{t('pr.packages')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pkgRow}
          >
            <PackageCard
              title={t('pr.starterPack')}
              desc={t('pr.starterPackDesc')}
              bytes={starterBytes}
              accent={Colors.emerald[400]}
              tag={t('pr.notTransferable')}
              gift="🎁"
            />
            <PackageCard
              title={t('pr.referralPack')}
              desc={t('pr.referralPackDesc')}
              bytes={referralBytes}
              accent={Colors.blue[400]}
              gift="🎀"
            />
            <PackageCard
              title={t('pr.purchasedPack')}
              desc={t('pr.purchasedPackDesc')}
              bytes={purchasedBytes}
              accent="#FFB800"
              dimmed={purchasedBytes === 0}
            />
          </ScrollView>
          {/* Purchased packages — listed separately when present */}
          {purchasedPackages.length > 0 && (
            <View style={styles.pkgList}>
              {purchasedPackages.map((p) => (
                <View key={p.id} style={styles.pkgListRow}>
                  <Text style={styles.pkgListName} numberOfLines={1}>{prettyPackageName(p.package_name)}</Text>
                  <Text style={styles.pkgListBytes}>{gb(p.bytes)}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('pr.transferable')}</Text>
            <Text style={styles.totalValueSub}>{gb(transferableBytes)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('pr.totalLabel')}</Text>
            <Text style={styles.totalValue}>{gb(user.quotaBytesTotal)}</Text>
          </View>
        </GlassCard>

        {/* Watch a rewarded ad → earn bonus data (credited via AdMob SSV) */}
        <WatchAdCard />

        {/* Send GB to a friend */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => navTo('transfer')}>
          <GlassCard style={styles.sendGbCard} glowColor={Colors.emerald[400]}>
            <Text style={styles.sendGbIcon}>🎁</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.sendGbTitle}>{t('pr.sendGb')}</Text>
              <Text style={styles.sendGbDesc}>{t('pr.sendGbDesc')}</Text>
            </View>
            <Text style={styles.actionChevron}>›</Text>
          </GlassCard>
        </TouchableOpacity>

        {/* Invite reward milestones */}
        <GlassCard style={styles.msCard}>
          <View style={styles.referralHeader}>
            <Text style={styles.cardLabel}>{t('pr.inviteRewards')}</Text>
            <View style={styles.msInviteBadge}>
              <Text style={styles.msInviteBadgeText}>{invites} {t('pr.activeInvites')}</Text>
            </View>
          </View>

          {user.stealthUnlocked && (
            <View style={styles.stealthRow}>
              <Text style={styles.stealthIcon}>🔓</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stealthTitle}>{t('pr.stealthUnlockedMsg')}</Text>
                <Text style={styles.stealthSub}>{t('pr.stealthUnlockedSub')}</Text>
              </View>
            </View>
          )}

          {nextMs ? (
            <>
              <Text style={styles.msNextLabel}>{t('pr.nextMilestone')}</Text>
              <Text style={styles.msNextText}>
                {t('pr.inviteMore').replace('{n}', String(nextMs.count - invites))}{' '}
                <Text style={styles.msReward}>{t(nextMs.rewardKey)}</Text>
              </Text>
              <View style={styles.msTrack}>
                <View style={[styles.msFill, { width: `${nextProgress * 100}%` as any }]} />
              </View>
              <Text style={styles.msCount}>{invites}/{nextMs.count}</Text>
            </>
          ) : (
            <Text style={styles.msAllDone}>✓ {t('pr.allMilestones')}</Text>
          )}

          {/* Milestone ladder */}
          <View style={styles.msList}>
            {ladder.map((m) => (
              <View key={m.count} style={styles.msItem}>
                <View style={[styles.msDot, m.reached && styles.msDotReached]}>
                  <Text style={[styles.msDotText, m.reached && styles.msDotTextReached]}>
                    {m.reached ? '✓' : m.count}
                  </Text>
                </View>
                <Text style={[styles.msItemLabel, m.reached && styles.msItemLabelReached]}>
                  {t(m.rewardKey)}
                </Text>
                {m.reached && (
                  <View style={styles.msUnlockedTag}>
                    <Text style={styles.msUnlockedText}>{t('pr.unlockedTag')}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </GlassCard>

        {/* QR modal */}
        <Modal visible={showQr} transparent animationType="fade" onRequestClose={() => setShowQr(false)}>
          <TouchableOpacity style={styles.qrOverlay} activeOpacity={1} onPress={() => setShowQr(false)}>
            <View style={styles.qrBox}>
              <Text style={styles.qrTitle}>{t('pr.scanToInvite')}</Text>
              <QRCode value={referralLink} size={200} backgroundColor="#ffffff" color="#000000" />
              <Text style={styles.qrCodeLabel}>{referralDisplayCode}</Text>
              <Text style={styles.qrHint}>{t('pr.tapToClose')}</Text>
            </View>
          </TouchableOpacity>
        </Modal>

        <TouchableOpacity style={styles.actionRow} activeOpacity={0.7} onPress={handleOpenSupport}>
          <Text style={styles.actionLabel}>{t('pr.support')}</Text>
          <Text style={styles.actionChevron}>›</Text>
        </TouchableOpacity>

        <GlassCard>
          <Text style={styles.footerBrand}>RealGram</Text>
          <TouchableOpacity onLongPress={() => navTo('diagnostics')} delayLongPress={1500}>
            <Text style={styles.footerMeta}>v{APP_VERSION} ({APP_BUILD})</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleOpenWebsite}>
            <Text style={styles.footerLink}>https://setalink.no</Text>
          </TouchableOpacity>
          <Text style={styles.footerCopy}>© 2026 RealGram. {t('st.allRights')}</Text>
          <EcosystemFooter />
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
  headerActions:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  title:            { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  settingsBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  settingsIcon:     { fontSize: 18, color: Colors.text.secondary },

  // Brand header (logo)
  brandHeader:      { alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[2] },
  brandLogoRing:    { width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(0,232,122,0.08)', borderWidth: 1, borderColor: Colors.border.glow, alignItems: 'center', justifyContent: 'center' },
  brandLogo:        { width: 52, height: 52, tintColor: Colors.emerald[400] },
  brandId:          { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  planBadge:        { backgroundColor: 'rgba(255,184,0,0.15)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(255,184,0,0.3)', paddingHorizontal: Spacing[3], paddingVertical: 3, alignSelf: 'center' },
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
  deviceOs:         { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },

  // TrustAI link
  trustaiCard:      { marginBottom: Spacing[4] },
  trustaiRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trustaiBtn:       { paddingHorizontal: Spacing[4], paddingVertical: 8, borderRadius: Radius.md, backgroundColor: Colors.gold[400] },
  trustaiBtnText:   { color: '#1A1405', fontSize: 13, fontFamily: Typography.family.heading },

  // Packages
  packagesCard:     { gap: Spacing[3] },
  pkgRow:           { gap: Spacing[3], paddingRight: Spacing[2] },
  totalRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: Colors.border.subtle, paddingTop: Spacing[3] },
  totalLabel:       { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  totalValue:       { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  totalValueSub:    { fontSize: Typography.size.base, fontFamily: Typography.family.mono, color: Colors.emerald[400] },
  pkgList:          { gap: Spacing[2] },
  pkgListRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.bg.elevated, borderRadius: Radius.md, paddingHorizontal: Spacing[3], paddingVertical: Spacing[2] },
  pkgListName:      { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary },
  pkgListBytes:     { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: '#FFB800' },

  // Send GB entry
  sendGbCard:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[3] },
  sendGbIcon:       { fontSize: 24 },
  sendGbTitle:      { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  sendGbDesc:       { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },

  // §5.10 Hero chips
  heroChipRow:      { flexDirection: 'row', gap: Spacing[2], justifyContent: 'center' },
  heroChip:         { backgroundColor: Colors.bg.surface, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 4 },
  heroChipText:     { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.secondary },

  // §5.10 generic card + Wallet/Clan summary cards
  card:             { padding: Spacing[4], gap: Spacing[3] },
  summaryCard:      { padding: Spacing[4], gap: Spacing[3] },
  summaryHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryRow:       { flexDirection: 'row', gap: Spacing[3] },
  summaryCell:      { flex: 1, alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.md, paddingVertical: Spacing[3] },
  summaryValue:     { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  summaryLabel:     { fontSize: 11, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },

  // §5.10.2 Freedom Stats
  statsGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[3] },
  statCell:         { width: '30%', alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.md, paddingVertical: Spacing[3] },
  statValue:        { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.emerald[400] },
  statLabel:        { fontSize: 10, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2, textAlign: 'center' },

  // §5.10.3 Activity Timeline
  activityEmpty:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted },
  activityRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: 6 },
  activityIcon:     { fontSize: 18 },
  activityLabel:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.primary },
  activityDetail:   { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 1 },

  // §5.10 Achievements
  achList:          { gap: Spacing[2] },
  achRow:           { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  achIcon:          { fontSize: 18 },
  achIconDim:       { opacity: 0.3 },
  achLabel:         { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted },
  achLabelDone:     { color: Colors.text.primary },
  achCheck:         { fontSize: 14, color: Colors.emerald[400], fontFamily: Typography.family.heading },

  // §5.10 Clan summary
  clanSummaryRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanSummaryIcon:  { fontSize: 28 },
  clanSummaryText:  { flex: 1, fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanChip:         { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.gold[400] + '55', backgroundColor: Colors.gold[400] + '14', paddingHorizontal: 10, paddingVertical: 3 },
  clanChipText:     { fontSize: Typography.size.xs, color: Colors.gold[400], fontFamily: Typography.family.heading },

  manageHeading:    { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1, marginTop: Spacing[2] },

  // B-21: one merged referral/community card (rank + earnings donut + code)
  referralHubCard:    { gap: Spacing[3] },
  referralHubDivider: { height: 1, backgroundColor: Colors.border.subtle },
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

  // Milestones
  msCard:           { gap: Spacing[3] },
  msInviteBadge:    { backgroundColor: 'rgba(0,232,122,0.1)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(0,232,122,0.3)', paddingHorizontal: Spacing[3], paddingVertical: 3 },
  msInviteBadgeText:{ fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  stealthRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], backgroundColor: 'rgba(0,232,122,0.06)', borderRadius: Radius.lg, padding: Spacing[3] },
  stealthIcon:      { fontSize: 24 },
  stealthTitle:     { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.emerald[400] },
  stealthSub:       { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  msNextLabel:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  msNextText:       { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  msReward:         { fontFamily: Typography.family.heading, color: Colors.text.primary },
  msTrack:          { height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden', marginTop: 2 },
  msFill:           { height: '100%', borderRadius: 3, backgroundColor: Colors.emerald[400] },
  msCount:          { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, alignSelf: 'flex-end' },
  msAllDone:        { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.emerald[400] },
  msList:           { gap: Spacing[2], marginTop: Spacing[2] },
  msItem:           { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  msDot:            { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  msDotReached:     { backgroundColor: Colors.emerald[400], borderColor: Colors.emerald[400] },
  msDotText:        { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  msDotTextReached: { color: Colors.text.inverse, fontFamily: Typography.family.heading },
  msItemLabel:      { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary },
  msItemLabelReached: { color: Colors.text.primary },
  msUnlockedTag:    { backgroundColor: 'rgba(0,232,122,0.1)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(0,232,122,0.3)', paddingHorizontal: Spacing[2], paddingVertical: 2 },
  msUnlockedText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },

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
});
