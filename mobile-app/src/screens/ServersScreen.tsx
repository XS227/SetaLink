import React, { useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { ServerRow, Server } from '../components/ServerRow';
import { BottomNav, NavTab } from '../components/BottomNav';
import { GlassCard } from '../components/GlassCard';
import { EcosystemBanner } from '../components/EcosystemBanner';
import { WatchAdCard } from '../components/WatchAdCard';
import { StarlinkHeroCard } from '../components/StarlinkHeroCard';

import { useServerStore, FILTER_TABS, FilterTab, COMING_SOON_SERVERS } from '../stores/serverStore';
import { useVpnStore }  from '../stores/vpnStore';
import { useAIStore }   from '../stores/aiStore';
import { useAuthStore, hasStarlinkAccess, STARLINK_INVITE_THRESHOLD } from '../stores/authStore';
import { useInboxStore } from '../stores/inboxStore';
import { useT, tagLabelKey } from '../i18n';

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

export function ServersScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const {
    selectedId, filter, query, selectServer, setFilter,
    filteredServers, servers, isLoading, loadError,
    importedCreds, favoriteIds, toggleFavorite,
  } = useServerStore();
  const { connectionState, connect, switchServer } = useVpnStore();
  const { activeMode }  = useAIStore();
  const user             = useAuthStore((s) => s.user);
  const userPlan         = user?.plan ?? 'free';
  const starlinkUnlocked = hasStarlinkAccess(user);
  const unreadCount       = useInboxStore((s) => s.unreadCount());

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

  // The real backend-provided Starlink node, if the catalog has one (Phase 1
  // is test-gated, so this is null for virtually everyone right now — the
  // hero card below handles that as a "coming soon" state, not an error).
  const starlinkServer = useMemo(
    () => servers.find((s) => s.nodeType === 'STARLINK'),
    [servers],
  );
  // Regular list excludes the Starlink node — it always renders separately as
  // the hero card up top, never duplicated as a normal row.
  const filtered = filteredServers(activeMode)
    .filter((s) => !s.comingSoon && s.nodeType !== 'STARLINK')
    .map((s) => ({
      ...s,
      selected: s.id === selectedId,
      imported: !!importedCreds[s.id],
    }));
  const selected    = servers.find((s) => s.id === selectedId);

  const handleToggleFavorite = useCallback((server: Server) => {
    toggleFavorite(server.id);
  }, [toggleFavorite]);

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
        {/* Header — simplified to just brand, connection status, notifications,
            settings (ReaLink Next Build item 3). Activity + location count
            moved into the filter row below. */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Text style={styles.brandMark}>◆</Text>
            <Text style={styles.title}>{t('sv.title')}</Text>
          </View>
          <View style={styles.headerRight}>
            {isLoading && (
              <ActivityIndicator size="small" color={Colors.emerald[400]} style={{ marginRight: Spacing[1] }} />
            )}
            <View style={styles.statusPill}>
              <View style={[
                styles.statusDot,
                isConnected && styles.statusDotConnected,
                isTransitioning && styles.statusDotTransitioning,
              ]} />
              <Text style={styles.statusPillText}>
                {isConnected ? t('sv.connected') : isTransitioning ? t('sv.switching') : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => (onNavigate as (tab: string) => void)('inbox')}
              activeOpacity={0.75}
            >
              <Text style={styles.iconBtnGlyph}>🔔</Text>
              {unreadCount > 0 && <View style={styles.unreadDot} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => onNavigate('settings' as NavTab)}
              activeOpacity={0.75}
            >
              <Text style={styles.iconBtnGlyph}>⚙</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loadError && servers.length > 0 && (
          <View style={styles.cachedBanner}>
            <Text style={styles.cachedBannerText}>◎ {t('sv.usingSaved')}</Text>
          </View>
        )}

        {/* Filter tabs — Activity link + location count moved here from the
            header (item 3), as trailing entries in the same scroll row. */}
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
          <TouchableOpacity
            style={styles.filterTab}
            onPress={() => onNavigate('activity')}
            activeOpacity={0.7}
          >
            <Text style={styles.filterLabel}>≡ {t('set.activity')}</Text>
          </TouchableOpacity>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{servers.length} {t('sv.locations')}</Text>
          </View>
        </ScrollView>

        {/* AI Picks carousel removed — the list below is the single source of
            truth; users just scroll to pick an available server. */}

        {/* Starlink hero node — always first, above the filtered list, per
            ReaLink Next Build items 2/5/8. Independent of the active filter
            tab (it's a featured slot, not a regular result). */}
        <StarlinkHeroCard
          server={starlinkServer}
          hasAccess={starlinkUnlocked}
          inviteCount={user?.inviteCount ?? 0}
          inviteThreshold={STARLINK_INVITE_THRESHOLD}
          onSelect={(s) => handleSelectServer(s.id)}
          onUpgrade={() => (onNavigate as (tab: string) => void)('upgrade')}
          onInvite={() => onNavigate('profile')}
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
                  favorite={favoriteIds.includes(s.id)}
                  onToggleFavorite={handleToggleFavorite}
                />
                {/* Banners interleaved at fixed positions. Shahnameh removed
                    (item 1/6 — it's integrated into ReaLink/RealGram directly
                    now, game progress moved to Profile/Earn, no ad-card
                    replacement): after server 1 → watch-ad, after server 4 →
                    3real. No duplicates. */}
                {i === 0 && <WatchAdCard style={styles.ecoBanner} />}
                {i === 3 && <EcosystemBanner pin="threereal" style={styles.ecoBanner} />}
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
  brandRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  brandMark:   { fontSize: 14, color: Colors.emerald[400] },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  title:       { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  countBadge:  { backgroundColor: Colors.bg.surface, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 4, justifyContent: 'center' },
  countText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },

  // Compact connection-status pill — the only status surfaced in the
  // simplified header (item 3); collapses to just a dot when idle.
  statusPill:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.text.muted },
  statusDotConnected:    { backgroundColor: Colors.emerald[400] },
  statusDotTransitioning:{ backgroundColor: '#FFB800' },
  statusPillText: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },

  iconBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  iconBtnGlyph: { fontSize: 16, color: Colors.text.secondary },
  unreadDot:    { position: 'absolute', top: 6, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.status.disconnected, borderWidth: 1, borderColor: Colors.bg.surface },

  ecoBanner:        { marginHorizontal: Spacing[5], marginBottom: Spacing[3] },
  cachedBanner:     { backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.subtle, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2] },
  cachedBannerText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  tabScroll:        { marginHorizontal: -Layout.screenPadding },
  tabContent:       { paddingHorizontal: Layout.screenPadding, gap: Spacing[2] },
  filterTab:        { paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface },
  filterTabActive:  { backgroundColor: 'rgba(0,232,122,0.1)', borderColor: Colors.border.glow },
  filterLabel:      { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted },
  filterLabelActive:{ color: Colors.emerald[400] },

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
  connectCta:         { backgroundColor: Colors.emerald[400], borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', shadowColor: Colors.emerald[400], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 10 },
  connectCtaActive:   { backgroundColor: Colors.emerald[600] ?? Colors.emerald[400], opacity: 0.85 },
  connectCtaDisabled: { opacity: 0.45 },
  connectCtaText:     { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: Typography.tracking.wide },
});
