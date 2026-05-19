import React, { useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { ServerRow } from '../components/ServerRow';
import { BottomNav, NavTab } from '../components/BottomNav';
import { GlassCard } from '../components/GlassCard';

import { useServerStore, FILTER_TABS, FilterTab, COMING_SOON_SERVERS } from '../stores/serverStore';
import { useVpnStore }  from '../stores/vpnStore';
import { useAIStore }   from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { useT }         from '../i18n';

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

export function ServersScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const {
    selectedId, filter, query, selectServer, setFilter,
    filteredServers, aiPicks, servers, isLoading, loadError,
    importedCreds,
  } = useServerStore();
  const { connectionState, connect, switchServer } = useVpnStore();
  const { activeMode }  = useAIStore();
  const userPlan        = useAuthStore((s) => s.user?.plan ?? 'free');

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

  const picks   = aiPicks(activeMode);
  const filtered = filteredServers(activeMode)
    .filter((s) => !s.comingSoon)
    .map((s) => ({
      ...s,
      selected: s.id === selectedId,
      imported: !!importedCreds[s.id],
    }));
  const selected    = servers.find((s) => s.id === selectedId);
  const showAIPicks = filter === 'All' && query === '';

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
              <ActivityIndicator size="small" color={Colors.emerald[400]} style={{ marginRight: Spacing[1] }} />
            )}
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{servers.length} {t('sv.locations')}</Text>
            </View>
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
              <Text style={[styles.filterLabel, filter === tab && styles.filterLabelActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* AI picks carousel */}
        {showAIPicks && picks.filter(s => !s.comingSoon).length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.aiDot} />
              <Text style={styles.sectionTitle}>{t('sv.aiPicks')}</Text>
              <Text style={styles.sectionSub}>{t('sv.optimizedFor')} {activeMode} {t('sv.mode')}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.smartRow}
            >
              {picks.filter(s => !s.comingSoon).map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.smartCard, s.id === selectedId && styles.smartCardActive]}
                  onPress={() => handleSelectServer(s.id)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.smartFlag}>{s.flag}</Text>
                  <Text style={styles.smartCountry}>{s.country}</Text>
                  <Text style={styles.smartCity}>{s.city}</Text>
                  <View style={styles.smartMeta}>
                    <View style={[
                      styles.smartPingDot,
                      { backgroundColor: s.ping < 60 ? Colors.emerald[400] : '#FFB800' },
                    ]} />
                    <Text style={styles.smartPing}>{s.ping > 0 ? `${s.ping}ms` : '—'}</Text>
                  </View>
                  {(s.tags ?? []).slice(0, 1).map((tag) => (
                    <View key={tag} style={styles.smartTag}>
                      <Text style={styles.smartTagText}>{tag}</Text>
                    </View>
                  ))}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Active servers */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {filter === 'All' ? t('sv.allServers') : filter}
            </Text>
          </View>

          {filtered.length === 0 ? (
            <GlassCard>
              <Text style={styles.emptyText}>{t('sv.noResults')}</Text>
            </GlassCard>
          ) : (
            filtered.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                onSelect={(sv) => handleSelectServer(sv.id)}
                onDelete={undefined}
              />
            ))
          )}
        </View>

        {/* Coming soon countries */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Coming soon</Text>
          </View>
          {COMING_SOON_SERVERS.map((s) => (
            <View key={s.id} style={styles.comingSoonRow}>
              <Text style={styles.comingSoonFlag}>{s.flag}</Text>
              <View style={styles.comingSoonInfo}>
                <Text style={styles.comingSoonCountry}>{s.country}</Text>
                <Text style={styles.comingSoonCity}>{s.city}</Text>
              </View>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonBadgeText}>Soon</Text>
              </View>
            </View>
          ))}
        </View>

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
  smartFlag:     { fontSize: 28, marginBottom: 4 },
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
