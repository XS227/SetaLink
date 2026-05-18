import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Alert, Clipboard,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { ServerRow } from '../components/ServerRow';
import { BottomNav, NavTab } from '../components/BottomNav';

import { useServerStore, FILTER_TABS, FilterTab } from '../stores/serverStore';
import { useVpnStore }  from '../stores/vpnStore';
import { useAIStore }   from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { useT }         from '../i18n';

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

// ── Import input type detection ───────────────────────────────────────────────

type InputType = 'vless' | 'subscription' | 'unknown' | 'empty';

function detectInputType(val: string): InputType {
  const v = val.trim();
  if (!v) return 'empty';
  if (v.startsWith('vless://')) return 'vless';
  if (v.startsWith('http://') || v.startsWith('https://')) return 'subscription';
  return 'unknown';
}

const INPUT_HINT_COLORS: Record<InputType, string> = {
  vless:        Colors.emerald[400],
  subscription: '#3399FF',
  unknown:      Colors.status.disconnected,
  empty:        Colors.text.muted,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ServersScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const {
    selectedId, filter, query, selectServer, setFilter, setQuery,
    filteredServers, aiPicks, servers, isLoading, loadError,
    importFromVless, importFromSubscription, importedCreds, removeImportedServer,
  } = useServerStore();
  const { connectionState, connect, switchServer } = useVpnStore();
  const { activeMode }  = useAIStore();
  const userPlan        = useAuthStore((s) => s.user?.plan ?? 'free');

  // Import modal state
  const [importVisible, setImportVisible] = useState(false);
  const [importInput,   setImportInput]   = useState('');
  const [importing,     setImporting]     = useState(false);
  const [importError,   setImportError]   = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const inputType = useMemo(() => detectInputType(importInput), [importInput]);

  const openImport = useCallback(() => {
    setImportInput('');
    setImportError(null);
    setImportSuccess(null);
    setImportVisible(true);
  }, []);

  const closeImport = useCallback(() => {
    if (importing) return;
    setImportVisible(false);
  }, [importing]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await Clipboard.getString();
      if (text) {
        setImportInput(text.trim());
        setImportError(null);
        setImportSuccess(null);
      }
    } catch {}
  }, []);

  const handleImport = useCallback(async () => {
    const val = importInput.trim();
    if (!val || inputType === 'unknown' || inputType === 'empty') return;

    setImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      if (inputType === 'vless') {
        const result = importFromVless(val);
        if (result.success) {
          setImportSuccess(result.updated ? 'Config updated — credentials replaced.' : t('sv.added'));
          setTimeout(() => { setImportVisible(false); setImportInput(''); }, 1200);
        } else {
          setImportError(result.error ?? 'Invalid VLESS link.');
        }
      } else {
        const result = await importFromSubscription(val);
        const msg = `Added ${result.imported} server${result.imported !== 1 ? 's' : ''}${result.errors ? ` (${result.errors} skipped)` : ''}.`;
        setImportSuccess(msg);
        setTimeout(() => { setImportVisible(false); setImportInput(''); }, 1800);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t('sv.importFailed'));
    } finally {
      setImporting(false);
    }
  }, [importInput, inputType, importFromVless, importFromSubscription]);

  // Connection state helpers
  const isConnected     = connectionState === 'connected';
  const isTransitioning = connectionState === 'connecting'
    || connectionState === 'disconnecting'
    || false;

  const handleSelectServer = useCallback((serverId: string) => {
    if (isTransitioning) return;
    const server = servers.find((s) => s.id === serverId);
    if (server?.premium && userPlan === 'free') {
      (onNavigate as (tab: string) => void)('upgrade');
      return;
    }
    const isDifferent = serverId !== selectedId;
    selectServer(serverId);
    if (isConnected && isDifferent) switchServer();
  }, [isTransitioning, servers, userPlan, selectedId, isConnected, onNavigate, selectServer, switchServer]);

  const handleDeleteServer = useCallback((serverId: string, serverName: string) => {
    Alert.alert(
      t('sv.remove'),
      `"${serverName}" ${t('sv.removeConfirm')}`,
      [
        { text: t('sv.cancel'), style: 'cancel' },
        {
          text: t('sv.remove.btn'),
          style: 'destructive',
          onPress: () => removeImportedServer(serverId),
        },
      ],
    );
  }, [removeImportedServer, t]);

  const handleConnect = useCallback(() => {
    if (isTransitioning) return;
    if (connectionState === 'idle' || connectionState === 'failed') connect();
    onNavigate('home');
  }, [isTransitioning, connectionState, connect, onNavigate]);

  // Derived data
  const picks    = aiPicks(activeMode);
  const filtered = filteredServers(activeMode).map((s) => ({
    ...s,
    selected: s.id === selectedId,
    imported: !!importedCreds[s.id],
  }));
  const selected     = servers.find((s) => s.id === selectedId);
  const showAIPicks  = filter === 'All' && query === '';

  const ctaLabel = isTransitioning
    ? t('sv.switching')
    : isConnected
      ? `${t('sv.connected')} · ${selected?.country ?? ''}`
      : `${t('sv.connectTo')} ${selected?.country ?? ''}`;

  const canImport = !importing && inputType !== 'empty' && inputType !== 'unknown';

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
            <TouchableOpacity style={styles.importBtn} onPress={openImport} activeOpacity={0.75}>
              <Text style={styles.importBtnText}>{t('sv.import')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loadError && servers.length > 0 && (
          <View style={styles.cachedBanner}>
            <Text style={styles.cachedBannerText}>◎ {t('sv.usingSaved')}</Text>
          </View>
        )}
        {loadError && servers.length === 0 && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>◎ {loadError}</Text>
          </View>
        )}

        {/* Search */}
        <View style={styles.searchWrapper}>
          <Text style={styles.searchIcon}>◎</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('sv.search')}
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
          {FILTER_TABS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.filterTab, filter === t && styles.filterTabActive]}
              onPress={() => setFilter(t as FilterTab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterLabel, filter === t && styles.filterLabelActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* AI picks carousel */}
        {showAIPicks && (
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
              {picks.map((s) => (
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

        {/* Server list */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {filter === 'All' ? t('sv.allServers') : filter}
            </Text>
            {Object.keys(importedCreds).length > 0 && (
              <Text style={styles.sectionSub}>
                · {Object.keys(importedCreds).length} {t('sv.custom')}
              </Text>
            )}
          </View>

          {servers.length === 0 ? (
            <View style={styles.onboardingCard}>
              <Text style={styles.onboardingIcon}>◎</Text>
              <Text style={styles.onboardingTitle}>No server configured</Text>
              <Text style={styles.onboardingBody}>
                Tap <Text style={styles.onboardingHighlight}>Import</Text> above and paste your VLESS link.{'\n\n'}
                Get your link from your SetaLink account or admin.
              </Text>
              <TouchableOpacity style={styles.onboardingBtn} onPress={openImport} activeOpacity={0.8}>
                <Text style={styles.onboardingBtnText}>Import Config</Text>
              </TouchableOpacity>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('sv.noResults')}</Text>
            </View>
          ) : (
            filtered.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                onSelect={(sv) => handleSelectServer(sv.id)}
                onDelete={s.imported
                  ? (sv) => handleDeleteServer(sv.id, sv.country)
                  : undefined
                }
              />
            ))
          )}
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

      {/* Import modal */}
      <Modal
        visible={importVisible}
        transparent
        animationType="slide"
        onRequestClose={closeImport}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeImport}
          />

          <View style={styles.modalCard}>
            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('sv.importTitle')}</Text>
              <TouchableOpacity
                onPress={pasteFromClipboard}
                style={styles.pasteBtn}
                activeOpacity={0.75}
              >
                <Text style={styles.pasteBtnText}>{t('sv.importPaste')}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              {t('sv.importSub')}
            </Text>

            {/* Input */}
            <View style={[
              styles.inputWrapper,
              inputType === 'unknown' && styles.inputWrapperError,
              (inputType === 'vless' || inputType === 'subscription') && styles.inputWrapperValid,
            ]}>
              <TextInput
                style={styles.modalInput}
                placeholder={t('sv.importPH')}
                placeholderTextColor={Colors.text.muted}
                value={importInput}
                onChangeText={(t) => { setImportInput(t); setImportError(null); setImportSuccess(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                multiline
                numberOfLines={4}
                selectionColor={Colors.emerald[400]}
              />
              {importInput.length > 0 && (
                <TouchableOpacity
                  style={styles.clearInputBtn}
                  onPress={() => { setImportInput(''); setImportError(null); setImportSuccess(null); }}
                >
                  <Text style={styles.clearInputText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Inline hint / feedback */}
            {importSuccess ? (
              <View style={styles.feedbackRow}>
                <Text style={[styles.feedbackText, { color: Colors.emerald[400] }]}>
                  ✓ {importSuccess}
                </Text>
              </View>
            ) : importError ? (
              <View style={styles.feedbackRow}>
                <Text style={[styles.feedbackText, { color: Colors.status.disconnected }]}>
                  ✕ {importError}
                </Text>
              </View>
            ) : inputType !== 'empty' ? (
              <View style={styles.feedbackRow}>
                <Text style={[styles.feedbackText, { color: INPUT_HINT_COLORS[inputType] }]}>
                  {inputType === 'vless'        ? t('sv.hintVless')   :
                   inputType === 'subscription' ? t('sv.hintSub')     :
                                                  t('sv.hintUnknown')}
                </Text>
              </View>
            ) : null}

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeImport}
                disabled={importing}
                activeOpacity={0.75}
              >
                <Text style={styles.modalCancelText}>{t('sv.cancel')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalConfirm, !canImport && styles.modalConfirmDisabled]}
                onPress={handleImport}
                disabled={!canImport}
                activeOpacity={0.85}
              >
                {importing
                  ? <ActivityIndicator size="small" color={Colors.text.inverse} />
                  : <Text style={styles.modalConfirmText}>
                      {inputType === 'subscription' ? t('sv.importFetch') : t('sv.importConfirm')}
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.base },
  scroll:  { flex: 1 },
  content: { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[4] },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  title:       { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  countBadge:  { backgroundColor: Colors.bg.surface, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 4 },
  countText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  importBtn:   { backgroundColor: 'rgba(0,232,122,0.1)', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.glow, paddingHorizontal: Spacing[3], paddingVertical: 4 },
  importBtnText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },

  // Banners
  cachedBanner:     { backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.subtle, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2] },
  cachedBannerText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  errorBanner:     { backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.subtle, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2] },
  errorBannerText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  // Search
  searchWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], gap: Spacing[3] },
  searchIcon:    { fontSize: 16, color: Colors.text.muted },
  searchInput:   { flex: 1, fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  clearIcon:     { fontSize: 14, color: Colors.text.muted },

  // Filter tabs
  tabScroll:        { marginHorizontal: -Layout.screenPadding },
  tabContent:       { paddingHorizontal: Layout.screenPadding, gap: Spacing[2] },
  filterTab:        { paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface },
  filterTabActive:  { backgroundColor: 'rgba(0,232,122,0.1)', borderColor: Colors.border.glow },
  filterLabel:      { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted },
  filterLabelActive:{ color: Colors.emerald[400] },

  // Sections
  section:       { gap: Spacing[3] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  aiDot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.emerald[400], shadowColor: Colors.emerald[400], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  sectionTitle:  { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  sectionSub:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  // AI picks carousel
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

  // Empty state
  empty:            { paddingVertical: Spacing[10], alignItems: 'center' },
  emptyText:        { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.muted },

  // Onboarding card (shown when no servers at all)
  onboardingCard:      { margin: Spacing[2], padding: Spacing[6], backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', gap: Spacing[3] },
  onboardingIcon:      { fontSize: 36, color: Colors.emerald[400] },
  onboardingTitle:     { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  onboardingBody:      { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', lineHeight: 22 },
  onboardingHighlight: { color: Colors.emerald[400], fontFamily: Typography.family.label },
  onboardingBtn:       { marginTop: Spacing[2], paddingHorizontal: Spacing[6], paddingVertical: Spacing[3], backgroundColor: Colors.emerald[400] + '20', borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.emerald[400] + '60' },
  onboardingBtnText:   { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.5 },

  // Connect CTA
  stickyFooter:       { position: 'absolute', bottom: Layout.bottomNavHeight + 8, left: Layout.screenPadding, right: Layout.screenPadding },
  connectCta:         { backgroundColor: Colors.emerald[400], borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', shadowColor: Colors.emerald[400], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 10 },
  connectCtaActive:   { backgroundColor: Colors.emerald[600] ?? Colors.emerald[400], opacity: 0.85 },
  connectCtaDisabled: { opacity: 0.45 },
  connectCtaText:     { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: Typography.tracking.wide },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard:    { backgroundColor: Colors.bg.surface, borderTopLeftRadius: Radius['2xl'] ?? 24, borderTopRightRadius: Radius['2xl'] ?? 24, borderTopWidth: 1, borderColor: Colors.border.default, padding: Spacing[6], paddingBottom: Spacing[8], gap: Spacing[4] },

  modalHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle:   { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pasteBtn:     { backgroundColor: 'rgba(0,232,122,0.1)', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.glow, paddingHorizontal: Spacing[3], paddingVertical: Spacing[1] },
  pasteBtnText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },

  modalSub:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, lineHeight: 20 },
  mono:         { fontFamily: Typography.family.mono, color: Colors.emerald[400] },

  // Input wrapper with validation border
  inputWrapper:      { borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.base, overflow: 'hidden' },
  inputWrapperValid: { borderColor: Colors.border.glow },
  inputWrapperError: { borderColor: 'rgba(255,68,68,0.5)' },

  modalInput:    { padding: Spacing[3], fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.primary, minHeight: 90, textAlignVertical: 'top', paddingRight: 32 },
  clearInputBtn: { position: 'absolute', top: 10, right: 10 },
  clearInputText:{ fontSize: 12, color: Colors.text.muted },

  feedbackRow:  { minHeight: 20 },
  feedbackText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, lineHeight: 18 },

  modalActions:      { flexDirection: 'row', gap: Spacing[3] },
  modalCancel:       { flex: 1, paddingVertical: Spacing[3], alignItems: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default },
  modalCancelText:   { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted },
  modalConfirm:      { flex: 2, paddingVertical: Spacing[3], alignItems: 'center', borderRadius: Radius.md, backgroundColor: Colors.emerald[400] },
  modalConfirmDisabled: { opacity: 0.35 },
  modalConfirmText:  { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.inverse },
});
