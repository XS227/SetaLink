/**
 * RealGramLiveTvScreen — Live TV browse/search/filter (Khabat's spec §2/§3).
 * Real screen in the Stack.Navigator, not a WebView -- backed entirely by
 * shahnameh-backend's paginated /api/live-tv/* (liveTvService.ts), which
 * itself reads from a local registry synced from iptv-org once daily. The
 * app never fetches iptv-org directly and never receives the full catalog
 * in one response (spec §7).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useT } from '../i18n';
import { useLiveTvLocalStore } from '../stores/liveTvLocalStore';
import { useAuthStore } from '../stores/authStore';
import { getSsoToken } from '../services/ssoService';
import {
  getChannels, getCountries, getLanguages, getCategories, getFeatured, getChannel,
  getAccountFavorites, getServiceStatus,
  LiveTvChannel, LiveTvCountry, LiveTvLanguage, LiveTvCategory,
} from '../services/liveTvService';

interface Props {
  onBack: () => void;
  onOpenPlayer: (channelId: string, channelIds: string[]) => void;
}

// Spec §4 -- shown pinned to the top of their respective pickers, above the
// rest which stays fully searchable/scrollable below.
const PRIORITY_LANGUAGE_CODES = ['fas', 'eng', 'rus', 'zho'];
const PRIORITY_COUNTRY_CODES = ['IR', 'NO', 'GB', 'UK', 'US', 'RU', 'CN', 'TJ', 'AF', 'TR', 'DE', 'FR'];

const PAGE_SIZE = 24;

type PickerKind = 'country' | 'language' | 'category' | null;

export function RealGramLiveTvScreen({ onBack, onOpenPlayer }: Props) {
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const { favoriteIds, recentIds, setFavorites } = useLiveTvLocalStore();

  const [search, setSearch]     = useState('');
  const [country, setCountry]   = useState('');
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [picker, setPicker]     = useState<PickerKind>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [channels, setChannels] = useState<LiveTvChannel[]>([]);
  const [page, setPage]         = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]       = useState('');
  const [failedLoad, setFailedLoad] = useState(false); // distinct from a genuine zero-match filter result — drives the retry button

  const [countries, setCountries]   = useState<LiveTvCountry[]>([]);
  const [languages, setLanguages]   = useState<LiveTvLanguage[]>([]);
  const [categories, setCategories] = useState<LiveTvCategory[]>([]);
  const [featured, setFeatured]     = useState<LiveTvChannel[]>([]);
  const [favoriteChannels, setFavoriteChannels] = useState<LiveTvChannel[]>([]);
  const [recentChannels, setRecentChannels]     = useState<LiveTvChannel[]>([]);

  const hasActiveQuery = !!(search || country || language || category);

  // Feature flag (spec §16): the API itself fails closed (503) when
  // LIVE_TV_ENABLED=false, /status is a cheap explicit check so the app can
  // show a controlled "coming soon" state instead of a raw error screen.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => { getServiceStatus().then((s) => setEnabled(s?.enabled ?? false)); }, []);

  // Filter option lists — fetched once enabled is confirmed, cheap (small
  // aggregate responses).
  useEffect(() => {
    if (!enabled) return;
    getCountries().then(setCountries);
    getLanguages().then(setLanguages);
    getCategories().then(setCategories);
    getFeatured(12).then(setFeatured);
  }, [enabled]);

  // Account favorites (logged-in) merge into the local store so the star
  // state is consistent everywhere; guests just keep whatever's local.
  useEffect(() => {
    if (!enabled || !deviceId) return;
    getSsoToken(deviceId, true).then((s) => {
      if (!s.telegram_id) return;
      getAccountFavorites(s.telegram_id).then((chans) => {
        setFavorites(chans.map((c) => c.id));
      });
    }).catch(() => {});
  }, [enabled, deviceId, setFavorites]);

  useEffect(() => {
    if (favoriteIds.length === 0) { setFavoriteChannels([]); return; }
    Promise.all(favoriteIds.slice(0, 20).map((id) => getChannel(id))).then((list) => {
      setFavoriteChannels(list.filter((c): c is LiveTvChannel => !!c));
    });
  }, [favoriteIds]);

  useEffect(() => {
    if (recentIds.length === 0) { setRecentChannels([]); return; }
    Promise.all(recentIds.slice(0, 10).map((id) => getChannel(id))).then((list) => {
      setRecentChannels(list.filter((c): c is LiveTvChannel => !!c));
    });
  }, [recentIds]);

  const loadPage = useCallback(async (pageNum: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    setFailedLoad(false);
    // try/catch here matters: getChannels() is expected to swallow its own
    // request errors and resolve with `failed: true`, but a synchronous
    // throw building the request (e.g. 2026-07-30's URLSearchParams.set()
    // crash, thrown before any fetch/telemetry call) becomes an unhandled
    // rejection instead — silently swallowed on RN, leaving this spinner
    // stuck forever with no trace anywhere. Catching it here guarantees the
    // screen always reaches the error+retry state no matter where a future
    // bug like that one lands.
    let result;
    try {
      result = await getChannels({ search, country, language, category, page: pageNum, limit: PAGE_SIZE });
    } catch {
      result = { channels: [], page: pageNum, limit: PAGE_SIZE, total: 0, total_pages: 1, failed: true };
    }
    if (result.channels.length === 0 && pageNum === 1) {
      setChannels([]);
      // 2026-07-28: distinguish "request failed" (network/parse/HTTP error,
      // already reported to app_events by liveTvService.ts) from a real
      // zero-match filter result — same empty list either way before this,
      // which read as "no channels exist" even when the request itself
      // never actually succeeded.
      if (result.failed) { setError(t('livetv.load_failed')); setFailedLoad(true); }
      else if (result.total === 0) setError(t('livetv.no_results'));
    } else {
      setChannels((prev) => (append ? [...prev, ...result.channels] : result.channels));
    }
    setPage(result.page);
    setTotalPages(result.total_pages);
    setLoading(false);
    setLoadingMore(false);
  }, [search, country, language, category, t]);

  useEffect(() => { if (enabled) loadPage(1, false); }, [enabled, loadPage]);

  const handleLoadMore = useCallback(() => {
    if (loadingMore || loading || page >= totalPages) return;
    loadPage(page + 1, true);
  }, [loadingMore, loading, page, totalPages, loadPage]);

  const orderedIds = useMemo(() => channels.map((c) => c.id), [channels]);

  const openChannel = useCallback((id: string, idsOverride?: string[]) => {
    onOpenPlayer(id, idsOverride ?? orderedIds);
  }, [onOpenPlayer, orderedIds]);

  const clearFilters = () => { setSearch(''); setCountry(''); setLanguage(''); setCategory(''); };

  const countryLabel = country ? (countries.find((c) => c.code === country)?.name ?? country) : t('livetv.filter_country');
  const languageLabel = language ? (languages.find((l) => l.code === language)?.name ?? language) : t('livetv.filter_language');
  const categoryLabel = category ? (categories.find((c) => c.id === category)?.name ?? category) : t('livetv.filter_category');

  if (enabled === null) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.gold[400]} />
      </View>
    );
  }

  if (enabled === false) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top, paddingHorizontal: Spacing[6] }]}>
        <TouchableOpacity onPress={onBack} style={[styles.floatingBack, { top: insets.top + Spacing[3] }]} hitSlop={12} activeOpacity={0.75}>
          <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
        </TouchableOpacity>
        <Text style={styles.comingSoonIcon}>📺</Text>
        <Text style={styles.pageTitle}>{t('livetv.title')}</Text>
        <Text style={styles.comingSoonText}>{t('livetv.coming_soon')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={6} />
      <TouchableOpacity onPress={onBack} style={[styles.floatingBack, { top: insets.top + Spacing[3] }]} hitSlop={12} activeOpacity={0.75}>
        <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.pageTitle}>{t('livetv.title')}</Text>
          <TouchableOpacity onPress={() => setInfoOpen(true)} hitSlop={12} style={styles.infoBtn}>
            <Text style={styles.infoBtnIcon}>ⓘ</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={t('livetv.search_placeholder')}
            placeholderTextColor={Colors.text.muted}
            autoCorrect={false}
          />
        </View>
        <View style={styles.filterRow}>
          <FilterChip label={countryLabel}  active={!!country}  onPress={() => setPicker('country')} />
          <FilterChip label={languageLabel} active={!!language} onPress={() => setPicker('language')} />
          <FilterChip label={categoryLabel} active={!!category} onPress={() => setPicker('category')} />
          {hasActiveQuery && (
            <TouchableOpacity onPress={clearFilters} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>{t('livetv.clear')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading && channels.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          {failedLoad && (
            <TouchableOpacity style={[styles.retryBtnLike, { marginTop: Spacing[4], paddingHorizontal: Spacing[6] }]} onPress={() => loadPage(1, false)} activeOpacity={0.85}>
              <Text style={styles.retryBtnLikeText}>{t('livetv.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={channels}
          keyExtractor={(c) => c.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.5}
          onEndReached={handleLoadMore}
          ListHeaderComponent={
            !hasActiveQuery ? (
              <View>
                {favoriteChannels.length > 0 && (
                  <ChannelRail title={t('livetv.section_favorites')} channels={favoriteChannels} onPress={(id) => openChannel(id, favoriteChannels.map((c) => c.id))} />
                )}
                {recentChannels.length > 0 && (
                  <ChannelRail title={t('livetv.section_recent')} channels={recentChannels} onPress={(id) => openChannel(id, recentChannels.map((c) => c.id))} />
                )}
                {featured.length > 0 && (
                  <ChannelRail title={t('livetv.section_featured')} channels={featured} onPress={(id) => openChannel(id, featured.map((c) => c.id))} />
                )}
                <Text style={styles.sectionLabel}>{t('livetv.section_all')}</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => <ChannelCard channel={item} onPress={() => openChannel(item.id)} />}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: Spacing[4] }} color={Colors.gold[400]} /> : null}
        />
      )}

      <Modal visible={picker !== null} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
        {picker === 'country' && (
          <PickerSheet
            title={t('livetv.filter_country')}
            options={sortedWithPriority(countries.map((c) => ({ id: c.code, label: `${c.name} (${c.count})` })), PRIORITY_COUNTRY_CODES)}
            selected={country}
            onSelect={(v) => { setCountry(v); setPicker(null); }}
            onClose={() => setPicker(null)}
            allLabel={t('livetv.filter_all_countries')}
          />
        )}
        {picker === 'language' && (
          <PickerSheet
            title={t('livetv.filter_language')}
            options={sortedWithPriority(languages.map((l) => ({ id: l.code, label: `${l.name} (${l.count})` })), PRIORITY_LANGUAGE_CODES)}
            selected={language}
            onSelect={(v) => { setLanguage(v); setPicker(null); }}
            onClose={() => setPicker(null)}
            allLabel={t('livetv.filter_all_languages')}
          />
        )}
        {picker === 'category' && (
          <PickerSheet
            title={t('livetv.filter_category')}
            options={categories.map((c) => ({ id: c.id, label: `${c.name} (${c.count})` }))}
            selected={category}
            onSelect={(v) => { setCategory(v); setPicker(null); }}
            onClose={() => setPicker(null)}
            allLabel={t('livetv.filter_all_categories')}
          />
        )}
      </Modal>

      {/* Legal notice (spec §13) — RealGram must not present these channels
          as its own content. */}
      <Modal visible={infoOpen} animationType="slide" transparent onRequestClose={() => setInfoOpen(false)}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} onPress={() => setInfoOpen(false)} activeOpacity={1} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('livetv.about_title')}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <Text style={styles.legalText}>{t('livetv.legal_notice')}</Text>
              <TouchableOpacity onPress={() => Linking.openURL('https://github.com/iptv-org/iptv')} style={{ marginTop: Spacing[3] }}>
                <Text style={styles.legalLink}>{t('livetv.legal_iptvorg_link')}</Text>
              </TouchableOpacity>
              <Text style={[styles.legalText, { marginTop: Spacing[3] }]}>{t('livetv.legal_availability')}</Text>
              <Text style={[styles.legalText, { marginTop: Spacing[3] }]}>{t('livetv.legal_no_recording')}</Text>
            </ScrollView>
            <TouchableOpacity onPress={() => setInfoOpen(false)} style={styles.retryBtnLike}>
              <Text style={styles.retryBtnLikeText}>{t('livetv.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function sortedWithPriority(options: { id: string; label: string }[], priorityIds: string[]) {
  const priority = priorityIds.map((id) => options.find((o) => o.id === id)).filter((o): o is { id: string; label: string } => !!o);
  const rest = options.filter((o) => !priorityIds.includes(o.id)).sort((a, b) => a.label.localeCompare(b.label));
  return [...priority, ...rest];
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]} activeOpacity={0.85}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function ChannelRail({ title, channels, onPress }: { title: string; channels: LiveTvChannel[]; onPress: (id: string) => void }) {
  return (
    <View style={styles.railWrap}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <FlatList
        horizontal
        data={channels}
        keyExtractor={(c) => c.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: Spacing[3] }}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => onPress(item.id)} activeOpacity={0.85} style={styles.railCard}>
            <ChannelLogo channel={item} size={64} />
            <Text style={styles.railCardName} numberOfLines={2}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function ChannelLogo({ channel, size }: { channel: LiveTvChannel; size: number }) {
  if (channel.logo_url) {
    return <Image source={{ uri: channel.logo_url }} style={{ width: size, height: size, borderRadius: Radius.lg }} resizeMode="contain" />;
  }
  return (
    <View style={[styles.logoFallback, { width: size, height: size, borderRadius: Radius.lg }]}>
      <Text style={styles.logoFallbackText}>{channel.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function ChannelCard({ channel, onPress }: { channel: LiveTvChannel; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.cardTouchable}>
      <GlassCard style={styles.card}>
        <ChannelLogo channel={channel} size={48} />
        <Text style={styles.cardName} numberOfLines={2}>{channel.name}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{channel.country_name || channel.country_code}</Text>
        {channel.status === 'unavailable' && <Text style={styles.cardStatusBad}>●</Text>}
      </GlassCard>
    </TouchableOpacity>
  );
}

function PickerSheet({
  title, options, selected, onSelect, onClose, allLabel,
}: {
  title: string; options: { id: string; label: string }[]; selected: string;
  onSelect: (id: string) => void; onClose: () => void; allLabel: string;
}) {
  const [query, setQuery] = useState('');
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <View style={styles.sheetOverlay}>
      <TouchableOpacity style={styles.sheetBackdrop} onPress={onClose} activeOpacity={1} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <TextInput
          style={styles.sheetSearch}
          value={query}
          onChangeText={setQuery}
          placeholder="…"
          placeholderTextColor={Colors.text.muted}
        />
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id}
          ListHeaderComponent={
            <TouchableOpacity onPress={() => onSelect('')} style={styles.sheetRow}>
              <Text style={[styles.sheetRowText, !selected && styles.sheetRowTextActive]}>{allLabel}</Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => onSelect(item.id)} style={styles.sheetRow}>
              <Text style={[styles.sheetRowText, selected === item.id && styles.sheetRowTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          )}
          style={{ maxHeight: 380 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, textAlign: 'center', paddingHorizontal: Spacing[6] },
  comingSoonIcon: { fontSize: 40, marginBottom: Spacing[3] },
  comingSoonText: { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, textAlign: 'center', marginTop: Spacing[2] },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  header: { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[3] },
  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  infoBtnIcon: { fontSize: 18, color: Colors.text.muted },
  legalText: { fontSize: 13, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 19 },
  legalLink: { fontSize: 13, color: Colors.gold[400], fontFamily: Typography.family.body, textDecorationLine: 'underline' },
  retryBtnLike: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center', marginTop: Spacing[3] },
  retryBtnLikeText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },

  searchWrap: { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(212,175,55,0.15)' },
  searchInput: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[4], fontSize: 14, color: Colors.text.primary, fontFamily: Typography.family.body },

  filterRow: { flexDirection: 'row', gap: Spacing[2], flexWrap: 'wrap' },
  filterChip: {
    paddingVertical: Spacing[1], paddingHorizontal: Spacing[3], borderRadius: 999,
    backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: 'rgba(212,175,55,0.15)', maxWidth: 150,
  },
  filterChipActive: { backgroundColor: Colors.gold[400], borderColor: Colors.gold[400] },
  filterChipText: { fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body },
  filterChipTextActive: { color: Colors.bg.void, fontFamily: Typography.family.heading },
  clearBtn: { paddingVertical: Spacing[1], paddingHorizontal: Spacing[2] },
  clearBtnText: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, textDecorationLine: 'underline' },

  content: { paddingHorizontal: Spacing[4], paddingTop: Spacing[4] },
  gridRow: { gap: Spacing[3] },

  sectionLabel: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[4], marginBottom: Spacing[2] },
  railWrap: { marginBottom: Spacing[2] },
  railCard: { width: 84, alignItems: 'center', gap: Spacing[1] },
  railCardName: { fontSize: 11, color: Colors.text.secondary, fontFamily: Typography.family.body, textAlign: 'center' },

  logoFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },

  cardTouchable: { flex: 1 },
  card: { alignItems: 'center', gap: Spacing[1], position: 'relative' },
  cardName: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.primary, textAlign: 'center', marginTop: Spacing[1] },
  cardMeta: { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.label },
  cardStatusBad: { position: 'absolute', top: Spacing[2], right: Spacing[2], color: '#FF6B6B', fontSize: 10 },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: Colors.bg.void, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing[4], gap: Spacing[3] },
  sheetTitle: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  sheetSearch: { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[3], color: Colors.text.primary, fontFamily: Typography.family.body },
  sheetRow: { paddingVertical: Spacing[3], borderBottomWidth: 1, borderBottomColor: 'rgba(212,175,55,0.08)' },
  sheetRowText: { fontSize: 14, color: Colors.text.secondary, fontFamily: Typography.family.body },
  sheetRowTextActive: { color: Colors.gold[400], fontFamily: Typography.family.heading },
});
