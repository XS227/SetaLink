/**
 * RealGramProfileScreen — native profile screen for RealGram, built against
 * contract §9 (shahnameh-backend main@6b725e1, posted back in
 * docs/realgram/TASK_SPLIT.md B→A(42)). Replaces the WebView-embedded
 * profile.html/guild.html with one native screen fed by a single
 * server call (getProfileSummary), styled to match ShahnamehEmbed's
 * "10% RealGram / 90% Shahnameh" cinematic gold accent rather than the
 * VPN ProfileScreen's emerald one — this is Shahnameh's data, not the VPN's.
 *
 * Wired into the Profile tab (AppNavigator.tsx's ProfileAdapter) 2026-07-21,
 * replacing the old VPN-flavored ProfileScreen there per Khabat's ask —
 * "de skal bli ett i appen" (ShahnamehEmbed.tsx, 2026-07-19). Also carries
 * a Data (VPN quota) card and a Recent activity feed sourced from
 * sessionStore, neither of which contract §9 covers — those are the
 * VPN-side halves of "one unified profile," pulled from the same stores
 * HomeScreen/ActivityScreen already read rather than a second backend call.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore } from '../stores/authStore';
import { useIdentityStore } from '../stores/identityStore';
import { useSessionStore, SessionRecord } from '../stores/sessionStore';
import { formatBytes, formatDuration } from '../utils/formatters';
import {
  getProfileSummary, ProfileSummary,
} from '../services/realGramProfileService';

// Never surface a raw backend error code — Khabat, 2026-07-21: Profile
// showed the literal string "profile_unavailable". Map known codes to
// something a user can actually act on; anything unrecognized still gets
// a plain, non-technical message rather than the raw string.
function friendlyProfileError(code: string): string {
  switch (code) {
    case 'profile_unavailable':
    case 'account_not_found':
      return "We couldn't load your profile right now. This is usually temporary.";
    case 'missing_device_id':
      return 'Something went wrong identifying this device.';
    default:
      return "We couldn't load your profile right now. This is usually temporary.";
  }
}

interface Props {
  onBack?: () => void;
  // Only real, reachable sign-out path in the app (the old VPN ProfileScreen
  // this replaces in the Profile tab owned it exclusively) — kept here so
  // swapping the tab's screen doesn't silently strand users signed in with
  // no way out.
  onSignOut?: () => void;
  // Settings became unreachable app-wide once this screen replaced the old
  // ProfileScreen (which owned the only gear-icon entry point) — restored
  // here, same corner it lived in before (Khabat, 2026-07-21).
  onSettings?: () => void;
}

// Same relative-time convention as ActivityScreen's own session list.
function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ActivityRow({ session }: { session: SessionRecord }) {
  return (
    <View style={styles.activityRow}>
      <Text style={styles.activityFlag}>{session.serverFlag || '🌐'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.activityServer} numberOfLines={1}>{session.serverName}</Text>
        <Text style={styles.activityMeta}>
          {formatDuration(session.duration)} · {formatBytes(session.sentBytes + session.recvBytes)}
        </Text>
      </View>
      <Text style={styles.activityTime}>{timeAgo(session.endedAt || session.startedAt)}</Text>
    </View>
  );
}

function StatCell({ value, label, icon }: { value: string | number; label: string; icon?: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{icon ? `${icon} ` : ''}{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function RealGramProfileScreen({ onBack, onSignOut, onSettings }: Props) {
  const deviceId       = useAuthStore((s) => s.user?.deviceId ?? '');
  // Data balance lives on the VPN side (entitlement/quota), not the Shahnameh
  // backend contract §9 covers — pulled straight from the same authStore
  // fields HomeScreen already reads, so this stays in sync with Connect/
  // Disconnect without a second network call.
  const quotaTotal      = useAuthStore((s) => s.user?.quotaBytesTotal ?? 0);
  const quotaUsed       = useAuthStore((s) => s.user?.quotaBytesUsed ?? 0);
  const plan            = useAuthStore((s) => s.user?.plan ?? 'free');
  // Local-first identity layer (A-11/B-20) — RealGram's own @handle/avatar/
  // persona pick, separate from the server-driven ProfileSummary below.
  // "Avatar/persona" was explicitly asked for in the unified-profile spec;
  // shown here rather than duplicated server-side since it's already the
  // single source of truth the rest of the app (RealGramLinkWebView, etc.)
  // reads from.
  const avatarEmoji     = useIdentityStore((s) => s.avatarEmoji);
  const avatarColor     = useIdentityStore((s) => s.avatarColor);
  const persona         = useIdentityStore((s) => s.persona);
  const localHandle     = useIdentityStore((s) => s.handle);
  const localDisplayName = useIdentityStore((s) => s.displayName);
  const recentSessions  = useSessionStore((s) => s.sessions)
    .slice()
    .sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))
    .slice(0, 5);
  const insets   = useSafeAreaInsets();

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [profile, setProfile]   = useState<ProfileSummary | null>(null);
  // Auto-retry twice (short backoff) before showing an error state at all —
  // the backend call this screen depends on has been known to fail
  // transiently (e.g. mid-migration on the server side); most users should
  // never see a failure screen for something that resolves a second later.
  // Manual "Try again" below still works after auto-retry gives up.
  const autoRetriesRef = useRef(0);

  const load = useCallback(() => {
    if (!deviceId) return;
    setLoading(true);
    setError('');
    getProfileSummary(deviceId)
      .then((p) => {
        autoRetriesRef.current = 0;
        setProfile(p);
        setLoading(false);
      })
      .catch((e: unknown) => {
        const code = e instanceof Error ? e.message : 'unknown_error';
        if (autoRetriesRef.current < 2) {
          autoRetriesRef.current += 1;
          setTimeout(load, autoRetriesRef.current * 1200);
          return; // stay in loading state through the retry
        }
        setError(friendlyProfileError(code));
        setLoading(false);
      });
  }, [deviceId]);

  const handleManualRetry = useCallback(() => {
    autoRetriesRef.current = 0;
    load();
  }, [load]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.gold[400]} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top, gap: Spacing[4] }]}>
        <Text style={styles.errorText}>{error || 'Profile unavailable'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={handleManualRetry} activeOpacity={0.85}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { identity, economy, streaks, achievements, chapters, clan } = profile;
  // A brand-new/device-only account (no Telegram link yet) has no server-side
  // identity fields — Shahnameh's contract §9 response is empty, not wrong.
  // The user picked a real identity locally during onboarding (identityStore,
  // A-11/B-20) well before this screen existed; prefer that over falling back
  // to `profile.account` ("device:sl-xxxx…"), which is an internal account
  // key, never meant to be shown as a name (Khabat, 2026-07-21).
  const displayName =
    identity.handle || identity.username || identity.first_name
    || (localHandle ? `@${localHandle}` : '') || localDisplayName
    || 'RealGram Player';
  const chapterPct  = chapters.total > 0 ? chapters.completed / chapters.total : 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {!!onBack && (
        <TouchableOpacity onPress={onBack} style={styles.floatingBack} hitSlop={12} activeOpacity={0.75}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
      )}
      {!!onSettings && (
        <TouchableOpacity onPress={onSettings} style={styles.floatingSettings} hitSlop={12} activeOpacity={0.75}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity */}
        <View style={styles.heroRow}>
          {identity.profile_pic ? (
            <Image source={{ uri: identity.profile_pic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: avatarColor || Colors.bg.elevated }]}>
              <Text style={styles.avatarFallbackText}>{avatarEmoji || displayName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.levelText}>
              Level {economy.level} · {profile.id_type === 'real' ? 'RealGram' : 'Telegram'}
              {persona ? ` · ${persona === 'king' ? 'King' : 'Queen'}` : ''}
            </Text>
          </View>
        </View>

        {/* Economy */}
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <Text style={styles.cardLabel}>Economy</Text>
          <View style={styles.statsGrid}>
            <StatCell value={economy.real_balance.toLocaleString()} label="REAL" icon="💎" />
            <StatCell value={economy.zar.toLocaleString()}          label="ZAR"  icon="🪙" />
            <StatCell value={economy.gems}                          label="Gems" icon="💠" />
            <StatCell value={economy.farr}                          label="FARR" icon="🔥" />
            <StatCell value={economy.xp.toLocaleString()}           label="XP"   icon="⭐" />
            <StatCell value={economy.real_earned_this_season.toLocaleString()} label="Earned (season)" icon="📈" />
          </View>
        </GlassCard>

        {/* Data balance (VPN quota — separate domain from Shahnameh's economy above) */}
        <GlassCard style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>Data</Text>
            <Text style={styles.chapterCount}>{plan === 'free' ? 'Free plan' : plan}</Text>
          </View>
          {quotaTotal > 0 ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (quotaUsed / quotaTotal) * 100)}%` as any }]} />
              </View>
              <Text style={styles.emptyText}>{formatBytes(quotaUsed)} of {formatBytes(quotaTotal)} used</Text>
            </>
          ) : (
            <Text style={styles.emptyText}>Unlimited</Text>
          )}
        </GlassCard>

        {/* Streaks */}
        <GlassCard style={styles.card}>
          <Text style={styles.cardLabel}>Streaks</Text>
          <View style={styles.statsGrid}>
            <StatCell value={streaks.daily_streak}   label="Daily streak" />
            <StatCell value={streaks.checkin_streak} label="Check-in streak" />
          </View>
        </GlassCard>

        {/* Achievements */}
        <GlassCard style={styles.card}>
          <Text style={styles.cardLabel}>Achievements</Text>
          <View style={styles.statsGrid}>
            <StatCell value={achievements.verified_referral_count} label="Verified invites" />
            <StatCell value={achievements.milestones_claimed.length} label="Milestones" />
            <StatCell value={achievements.completed_tasks.length}    label="Tasks done" />
          </View>
        </GlassCard>

        {/* Chapters */}
        <GlassCard style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>Chapters</Text>
            <Text style={styles.chapterCount}>{chapters.completed}/{chapters.total}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${chapterPct * 100}%` as any }]} />
          </View>
          {chapters.list.length > 0 && (
            <View style={styles.chapterList}>
              {chapters.list.map((c) => (
                <View key={c.slug} style={styles.chapterRow}>
                  <Text style={[styles.chapterDot, c.done && styles.chapterDotDone]}>
                    {c.done ? '✓' : '·'}
                  </Text>
                  <Text style={[styles.chapterSlug, c.done && styles.chapterSlugDone]}>{c.slug}</Text>
                  {c.done && !c.rewards_done && <Text style={styles.chapterPendingTag}>reward pending</Text>}
                </View>
              ))}
            </View>
          )}
        </GlassCard>

        {/* Clan */}
        <GlassCard style={styles.card}>
          <Text style={styles.cardLabel}>Clan</Text>
          {clan ? (
            <View style={styles.clanRow}>
              {clan.clan_photo ? (
                <Image source={{ uri: clan.clan_photo }} style={styles.clanPhoto} />
              ) : (
                <View style={[styles.clanPhoto, styles.avatarFallback]}>
                  <Text style={styles.avatarFallbackText}>{clan.clan_name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.clanName} numberOfLines={1}>{clan.clan_name}</Text>
                <Text style={styles.clanMeta}>{clan.member_count} members · {clan.role}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.emptyText}>Not in a clan yet</Text>
          )}
        </GlassCard>

        {/* Recent activity — reuses ActivityScreen's own local session log,
            no extra network call. */}
        <GlassCard style={styles.card}>
          <Text style={styles.cardLabel}>Recent activity</Text>
          {recentSessions.length > 0 ? (
            <View style={styles.activityList}>
              {recentSessions.map((s) => <ActivityRow key={s.id} session={s} />)}
            </View>
          ) : (
            <Text style={styles.emptyText}>No sessions yet</Text>
          )}
        </GlassCard>

        {!!onSignOut && (
          <TouchableOpacity style={styles.logoutBtn} activeOpacity={0.75} onPress={onSignOut}>
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: Spacing[8] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: Colors.bg.void },
  centered:    { justifyContent: 'center', alignItems: 'center', gap: Spacing[3] },
  scroll:      { flex: 1 },
  content:     { paddingHorizontal: Spacing[4], paddingTop: Spacing[4], gap: Spacing[4] },

  floatingBack: {
    position: 'absolute', top: Spacing[3], left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon:     { fontSize: 22, color: Colors.text.secondary, marginTop: -2 },
  floatingSettings: {
    position: 'absolute', top: Spacing[3], right: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  settingsIcon: { fontSize: 18, color: Colors.text.secondary },

  errorText:    { fontSize: 13, color: '#FF6B6B', textAlign: 'center', paddingHorizontal: Spacing[6], fontFamily: Typography.family.body },
  retryBtn:     { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  retryBtnText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },

  heroRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingTop: Spacing[6] },
  avatar:       { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: Colors.gold[400] },
  avatarFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontSize: 24, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  displayName:  { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  levelText:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },

  card:         { gap: Spacing[3] },
  cardLabel:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardHeaderRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  statsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[4] },
  statCell:     { minWidth: 84, alignItems: 'flex-start' },
  statValue:    { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  statLabel:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },

  chapterCount: { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  progressTrack:{ height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: Colors.gold[400] },
  chapterList:  { gap: Spacing[2] },
  chapterRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  chapterDot:   { fontSize: 14, color: Colors.text.muted, width: 16, textAlign: 'center' },
  chapterDotDone: { color: Colors.gold[400] },
  chapterSlug:  { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textTransform: 'capitalize' },
  chapterSlugDone: { color: Colors.text.primary },
  chapterPendingTag: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: '#FFB800' },

  clanRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanPhoto:    { width: 48, height: 48, borderRadius: 24 },
  clanName:     { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanMeta:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  emptyText:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted },

  activityList: { gap: Spacing[3] },
  activityRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  activityFlag: { fontSize: 20 },
  activityServer: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary },
  activityMeta: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  activityTime: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  logoutBtn:    { borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)', borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', backgroundColor: 'rgba(255,68,68,0.06)' },
  logoutText:   { fontSize: Typography.size.base, fontFamily: Typography.family.label, color: '#FF4444', letterSpacing: 0.3 },
});
