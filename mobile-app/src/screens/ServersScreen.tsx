import React, { useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { ServerRow } from '../components/ServerRow';
import { BottomNav, NavTab } from '../components/BottomNav';
import { GlassCard } from '../components/GlassCard';
import { AdBanner } from '../components/AdBanner';
import { TopBar } from '../components/TopBar';
import { StarlinkBanner } from '../components/StarlinkBanner';

import { useServerStore, FILTER_TABS, FilterTab, COMING_SOON_SERVERS } from '../stores/serverStore';
import { useVpnStore }  from '../stores/vpnStore';
import { useAIStore }   from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { useT, tagLabelKey } from '../i18n';

const STARLINK_INVITE_TARGET = 11; // mirrors HomeScreen's constant (not shared — same value, two screens)

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
  onInvite:   () => void;
}

export function ServersScreen({ onNavigate, activeTab, onInvite }: Props) {
  const { t } = useT();
  const {
    selectedId, filter, query, selectServer, setFilter,
    filteredServers, servers, isLoading, loadError,
    importedCreds,
  } = useServerStore();
  const { connectionState, connect, switchServer } = useVpnStore();
  const { activeMode }  = useAIStore();
  const userPlan        = useAuthStore((s) => s.user?.plan ?? 'free');
  const inviteCount     = useAuthStore((s) => s.user?.inviteCount ?? 0);
  const hasStarlink     = inviteCount >= STARLINK_INVITE_TARGET
    || servers.some((s) => s.nodeType === 'STARLINK');
  // Per-device ad-testing override (devices.test_mode) — same rule as HomeScreen's
  // userShowsAds: a premium tester can be flagged server-side to see ads without
  // touching her actual plan/quota.
  const userTestMode    = useAuthStore((s) => !!s.user?.testMode);

  const isConnected     = connectionState === 'connected';
  const isTransitioning = connectionState === 'connecting'
    || connectionState === 'disconnecting';

  const handleSelectServer = useCallback((serverId: string) => {
    if (isTransitioning) return;
    const server = servers.find((s) => s.id === serverId);
    if (!server || server.comingSoon) return;
    if (server.premium && userPlan === 'free') {
      (onNavigate as (tab: string) => void)('upgrade');
      return;
    }
    const isDifferent = serverId !== selectedId;
    selectServer(serverId);
    if (isConnected && isDifferent) switchServer();
  }, [isTransitioning, servers, userPlan, selectedId, isConnected, onNavigate, selectServer, switchServer]);

  const handleConnect = useCallback(() => {
    if (isTransitioning) return;
    // Check quota before connecting
    const user = useAuthStore.getState().user;
    if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
      (onNavigate as (tab: string) => void)('upgrade');
      return;
    }
    if (connectionState === 'idle' || connectionState === 'failed') connect();
    onNavigate('home');
  }, [isTransitioning, connectionState, connect, onNavigate]);

  // Hide a "Coming soon" placeholder once a live server for that country exists
  // (e.g. Finland appears as an active node from /v1 for enabled devices) — v0.9.35 #4.
  const liveCountries = useMemo(
    () => new Set(servers.filter((s) => !s.comingSoon).map((s) => s.country.toLowerCase())),
    [servers],
  );
  const comingSoon = COMING_SOON_SERVERS.filter((s) => !liveCountries.has(s.country.toLowerCase()));

  const filtered = filteredServers(activeMode)
    .filter((s) => !s.comingSoon)
    .map((s) => ({
      ...s,
      selected: s.id === selectedId,
      imported: !!importedCreds[s.id],
    }));
  const selected    = servers.find((s) => s.id === selectedId);

  const ctaLabel = isTransitioning
    ? t('sv.switching')
    : isConnected
      ? `${t('sv.connected')} · ${selected?.country ?? ''}`
      : `${t('sv.connectTo')} ${selected?.country ?? ''}`;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('sv.title')}</Text>
          <View style={styles.headerRight}>
            {isLoading && (
              <ActivityIndicator size="small" color={Colors.gold[400]} style={{ marginRight: Spacing[1] }} />
            )}
            <TouchableOpacity
              style={styles.activityBtn}
              onPress={() => onNavigate('activity')}
              activeOpacity={0.75}
            >
              <Text style={styles.activityBtnText}>≡ {t('set.activity')}</Text>
            </TouchableOpacity>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{servers.length} {t('sv.locations')}</Text>
            </View>
            <TopBar onNavigate={onNavigate as (tab: string) => void} />
          </View>
        </View>

        {loadError && servers.length > 0 && (
          <View style={styles.cachedBanner}>
            <Text style={styles.cachedBannerText}>◎ {t('sv.usingSaved')}</Text>
          </View>
        )}

        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabContent}
        >
          {FILTER_TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.filterTab, filter === tab && styles.filterTabActive]}
              onPress={() => setFilter(tab as FilterTab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterLabel, filter === tab && styles.filterLabelActive]}>{t(tagLabelKey(tab)) || tab}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* AI Picks carousel removed — the list below is the single source of
            truth; users just scroll to pick an available server. */}

        {/* Starlink VIP reward — order matters per the theme pkg: this sits
            above the server list, ad card stays interleaved in the list
            below (B-19's existing placement). */}
        <StarlinkBanner
          unlocked={hasStarlink}
          inviteCount={inviteCount}
          inviteTarget={STARLINK_INVITE_TARGET}
          onInvite={onInvite}
        />

        {/* Active servers */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {filter === 'All' ? t('sv.allServers') : (t(tagLabelKey(filter)) || filter)}
            </Text>
          </View>

          {filtered.length === 0 ? (
            <GlassCard>
              <Text style={styles.emptyText}>{t('sv.noResults')}</Text>
            </GlassCard>
          ) : (
            filtered.map((s, i) => (
              <React.Fragment key={s.id}>
                <ServerRow
                  server={s}
                  onSelect={(sv) => handleSelectServer(sv.id)}
                  onDelete={undefined}
                />
                {/* B-19: Servers gets exactly one AdMob banner (after the
                    first row) — the rewarded-video card and the ecosystem
                    cross-promos that used to interleave here were "internal
                    banners"; that surface now belongs to Home only. */}
                {i === 0 && <AdBanner show={userPlan === 'free' || userTestMode} style={styles.ecoBanner} />}
              </React.Fragment>
            ))
          )}
        </View>

        {/* Coming soon countries — only those without a live server yet */}
        {comingSoon.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('sv.comingSoon')}</Text>
            </View>
            {comingSoon.map((s) => (
              <View key={s.id} style={styles.comingSoonRow}>
                <Text style={styles.comingSoonFlag}>{s.flag}</Text>
                <View style={styles.comingSoonInfo}>
                  <Text style={styles.comingSoonCountry}>{s.country}</Text>
                  <Text style={styles.comingSoonCity}>{s.city}</Text>
                </View>
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonBadgeText}>{t('sv.soon')}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: Layout.bottomNavHeight + 64 }} />
      </ScrollView>

      {/* Connect CTA */}
      <View style={styles.stickyFooter}>
        <TouchableOpacity
          style={[
            styles.connectCta,
            isConnected && styles.connectCtaActive,
            isTransitioning && styles.connectCtaDisabled,
          ]}
          activeOpacity={isTransitioning ? 1 : 0.85}
          onPress={handleConnect}
          disabled={isTransitioning}
        >
          <Text style={styles.connectCtaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      </View>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.base },
  scroll:  { flex: 1 },
  content: { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[4] },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  title:       { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  countBadge:  { backgroundColor: Colors.bg.surface, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 4 },
  countText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },

  activityBtn:      { backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.subtle, paddingHorizontal: Spacing[3], paddingVertical: Spacing[1] + 2 },
  activityBtnText:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.secondary },
  ecoBanner:        { marginHorizontal: Spacing[5], marginBottom: Spacing[3] },
  cachedBanner:     { backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.subtle, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2] },
  cachedBannerText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  tabScroll:        { marginHorizontal: -Layout.screenPadding },
  tabContent:       { paddingHorizontal: Layout.screenPadding, gap: Spacing[2] },
  filterTab:        { paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface },
  // Gold — matches theme pkg's `.tab.active` (04-freedom.html), the app's
  // general "selected/interactive" accent (BottomNav's active tab, same rule).
  filterTabActive:  { backgroundColor: 'rgba(255,182,39,0.12)', borderColor: Colors.border.goldGlow },
  filterLabel:      { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted },
  filterLabelActive:{ color: Colors.gold[400] },

  section:       { gap: Spacing[3] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  aiDot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.emerald[400], shadowColor: Colors.emerald[400], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  sectionTitle:  { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  sectionSub:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  smartRow:      { gap: Spacing[3], paddingBottom: 4 },
  smartCard:     { width: 130, backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, padding: Spacing[4], gap: Spacing[1] },
  smartCardActive: { borderColor: Colors.border.active, backgroundColor: 'rgba(0,232,122,0.05)' },
  smartFlag:     { marginBottom: 4, alignItems: 'center' },
  smartCountry:  { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary },
  smartCity:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  smartMeta:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  smartPingDot:  { width: 5, height: 5, borderRadius: 3 },
  smartPing:     { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  smartTag:      { backgroundColor: 'rgba(0,232,122,0.1)', borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4 },
  smartTagText:  { fontSize: 9, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.3 },

  empty:            { paddingVertical: Spacing[10], alignItems: 'center' },
  emptyText:        { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.muted },

  // Coming soon
  comingSoonRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.subtle, padding: Spacing[4], gap: Spacing[3], opacity: 0.45 },
  comingSoonFlag:      { fontSize: 26 },
  comingSoonInfo:      { flex: 1 },
  comingSoonCountry:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.muted },
  comingSoonCity:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  comingSoonBadge:     { backgroundColor: Colors.bg.elevated, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 3 },
  comingSoonBadgeText: { fontSize: 9, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.8 },

  stickyFooter:       { position: 'absolute', bottom: Layout.bottomNavHeight + 8, left: Layout.screenPadding, right: Layout.screenPadding },
  // Green, not gold — per theme pkg's `.connect-bar` (04-freedom.html):
  // this is a status/success action (connecting), the same semantic as
  // Colors.status.connected elsewhere, distinct from gold's currency role.
  connectCta:         { backgroundColor: Colors.green[400], borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', shadowColor: Colors.green[400], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 10 },
  connectCtaActive:   { opacity: 0.85 },
  connectCtaDisabled: { opacity: 0.45 },
  connectCtaText:     { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: Typography.tracking.wide },
});
