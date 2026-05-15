/**
 * Servers Screen
 *
 * Layout:
 *   Search bar
 *   Category tabs: All | Recommended | Fastest | Stealth | Streaming
 *   Pinned: currently connected server
 *   Smart picks section (AI recommendations)
 *   Full server list by region
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { ServerRow, Server } from '../components/ServerRow';
import { BottomNav, NavTab } from '../components/BottomNav';

const ALL_SERVERS: Server[] = [
  { id: 'de1', country: 'Germany',       city: 'Frankfurt',   flag: '🇩🇪', ping: 24,  load: 34, protocol: 'VLESS', tags: ['Recommended', 'Fastest'], selected: true },
  { id: 'nl1', country: 'Netherlands',   city: 'Amsterdam',   flag: '🇳🇱', ping: 31,  load: 42, protocol: 'VLESS', tags: ['Streaming'] },
  { id: 'fi1', country: 'Finland',       city: 'Helsinki',    flag: '🇫🇮', ping: 38,  load: 21, protocol: 'Reality' },
  { id: 'fr1', country: 'France',        city: 'Paris',       flag: '🇫🇷', ping: 28,  load: 57, protocol: 'VLESS', tags: ['Stealth'] },
  { id: 'us1', country: 'United States', city: 'New York',    flag: '🇺🇸', ping: 88,  load: 63, protocol: 'WebSocket' },
  { id: 'us2', country: 'United States', city: 'Los Angeles', flag: '🇺🇸', ping: 112, load: 71, protocol: 'VLESS' },
  { id: 'sg1', country: 'Singapore',     city: 'Singapore',   flag: '🇸🇬', ping: 67,  load: 48, protocol: 'Reality', tags: ['Streaming'] },
  { id: 'jp1', country: 'Japan',         city: 'Tokyo',       flag: '🇯🇵', ping: 95,  load: 39, protocol: 'VLESS' },
  { id: 'uk1', country: 'United Kingdom',city: 'London',      flag: '🇬🇧', ping: 33,  load: 55, protocol: 'VLESS', tags: ['Streaming'] },
  { id: 'ch1', country: 'Switzerland',   city: 'Zurich',      flag: '🇨🇭', ping: 35,  load: 18, protocol: 'Reality', tags: ['Stealth'] },
  { id: 'tr1', country: 'Turkey',        city: 'Istanbul',    flag: '🇹🇷', ping: 52,  load: 44, protocol: 'VLESS' },
  { id: 'se1', country: 'Sweden',        city: 'Stockholm',   flag: '🇸🇪', ping: 41,  load: 29, protocol: 'Reality' },
];

type FilterTab = 'All' | 'Recommended' | 'Fastest' | 'Stealth' | 'Streaming';
const TABS: FilterTab[] = ['All', 'Recommended', 'Fastest', 'Stealth', 'Streaming'];

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab: NavTab;
}

export function ServersScreen({ onNavigate, activeTab }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterTab>('All');
  const [selected, setSelected] = useState('de1');

  const filtered = ALL_SERVERS.filter(s => {
    const matchQuery =
      s.country.toLowerCase().includes(query.toLowerCase()) ||
      s.city.toLowerCase().includes(query.toLowerCase());
    const matchFilter =
      filter === 'All' ? true :
      filter === 'Fastest' ? s.ping < 50 :
      (s.tags ?? []).includes(filter);
    return matchQuery && matchFilter;
  }).map(s => ({ ...s, selected: s.id === selected }));

  const smart = ALL_SERVERS.filter(s => s.tags && s.tags.length > 0).slice(0, 3);

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
          <Text style={styles.title}>Servers</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{ALL_SERVERS.length} locations</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchWrapper}>
          <Text style={styles.searchIcon}>◎</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search country or city..."
            placeholderTextColor={Colors.text.muted}
            value={query}
            onChangeText={setQuery}
            selectionColor={Colors.emerald[400]}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabContent}
        >
          {TABS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.filterTab, filter === t && styles.filterTabActive]}
              onPress={() => setFilter(t)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterLabel, filter === t && styles.filterLabelActive]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Smart picks */}
        {filter === 'All' && query === '' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.aiDot} />
              <Text style={styles.sectionTitle}>AI Picks</Text>
              <Text style={styles.sectionSub}>Optimized for your usage</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.smartRow}
            >
              {smart.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.smartCard, s.id === selected && styles.smartCardActive]}
                  onPress={() => setSelected(s.id)}
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
                    <Text style={styles.smartPing}>{s.ping}ms</Text>
                  </View>
                  {(s.tags ?? []).slice(0, 1).map(tag => (
                    <View key={tag} style={styles.smartTag}>
                      <Text style={styles.smartTagText}>{tag}</Text>
                    </View>
                  ))}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Server list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {filter === 'All' ? 'All Servers' : filter}
          </Text>

          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No servers found</Text>
            </View>
          ) : (
            filtered.map(s => (
              <ServerRow key={s.id} server={s} onSelect={sv => setSelected(sv.id)} />
            ))
          )}
        </View>

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>

      {/* Connect to selected */}
      <View style={styles.stickyFooter}>
        <TouchableOpacity style={styles.connectCta} activeOpacity={0.85}>
          <Text style={styles.connectCtaText}>
            Connect to {ALL_SERVERS.find(s => s.id === selected)?.country ?? ''}
          </Text>
        </TouchableOpacity>
      </View>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg.base,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: Layout.statusBarHeight + Spacing[2],
    paddingHorizontal: Layout.screenPadding,
    gap: Spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  title: {
    fontSize: Typography.size['2xl'],
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  countBadge: {
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
  },
  countText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    gap: Spacing[3],
  },
  searchIcon: {
    fontSize: 16,
    color: Colors.text.muted,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.size.base,
    fontFamily: Typography.family.body,
    color: Colors.text.primary,
  },
  clearIcon: {
    fontSize: 14,
    color: Colors.text.muted,
  },
  tabScroll: {
    marginHorizontal: -Layout.screenPadding,
  },
  tabContent: {
    paddingHorizontal: Layout.screenPadding,
    gap: Spacing[2],
  },
  filterTab: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border.default,
    backgroundColor: Colors.bg.surface,
  },
  filterTabActive: {
    backgroundColor: 'rgba(0,232,122,0.1)',
    borderColor: Colors.border.glow,
  },
  filterLabel: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
  },
  filterLabelActive: {
    color: Colors.emerald[400],
  },
  section: {
    gap: Spacing[3],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  aiDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.emerald[400],
    shadowColor: Colors.emerald[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  sectionTitle: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  sectionSub: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    marginLeft: 2,
  },
  smartRow: {
    gap: Spacing[3],
    paddingBottom: 4,
  },
  smartCard: {
    width: 130,
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: Spacing[4],
    gap: Spacing[1],
  },
  smartCardActive: {
    borderColor: Colors.border.active,
    backgroundColor: 'rgba(0,232,122,0.05)',
  },
  smartFlag: {
    fontSize: 28,
    marginBottom: 4,
  },
  smartCountry: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  smartCity: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
  },
  smartMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  smartPingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  smartPing: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.secondary,
  },
  smartTag: {
    backgroundColor: 'rgba(0,232,122,0.1)',
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  smartTagText: {
    fontSize: 9,
    fontFamily: Typography.family.label,
    color: Colors.emerald[400],
    letterSpacing: 0.3,
  },
  empty: {
    paddingVertical: Spacing[10],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
  },
  stickyFooter: {
    position: 'absolute',
    bottom: Layout.bottomNavHeight + 8,
    left: Layout.screenPadding,
    right: Layout.screenPadding,
  },
  connectCta: {
    backgroundColor: Colors.emerald[400],
    borderRadius: Radius.lg,
    paddingVertical: Spacing[4],
    alignItems: 'center',
    shadowColor: Colors.emerald[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  connectCtaText: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.inverse,
    letterSpacing: Typography.tracking.wide,
  },
});
