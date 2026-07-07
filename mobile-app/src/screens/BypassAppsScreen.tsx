/**
 * Smart Mode — "Bypass selected apps".
 *
 * ANDROID: lists launchable apps; checked apps are excluded from the VPN
 * entirely via VpnService.addDisallowedApplication. Selection is persisted
 * both in the settings store (JS source of truth) and in native
 * SharedPreferences (read by XrayVpnService when it builds the TUN), so it
 * survives even if JS is not running when the service starts.
 *
 * iOS: consumer VPNs cannot do app-level split tunneling (no NetworkExtension
 * equivalent of addDisallowedApplication), so the picker shows the curated
 * IOS_APP_BYPASS_CATALOG instead — selecting an app routes its DOMAINS direct
 * via Xray routing (getSelectedAppBypassDomains → extraBypassDomains). Same
 * store field (bypassApps), but it holds catalog ids, not package names.
 *
 * Both platforms: changes apply on the NEXT connect.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Platform,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useSettingsStore } from '../stores/settingsStore';
import { IOS_APP_BYPASS_CATALOG } from '../services/iranBypassRules';
import { useT } from '../i18n';

interface InstalledApp { packageName: string; appName: string; }

const IS_IOS = Platform.OS === 'ios';

function getNativeModule(): any {
  // Same two-step resolution vpnBridge uses: TurboModule first, then old-arch.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../specs/NativeXrayModule').default;
    if (mod) return mod;
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    return NativeModules?.XrayModule ?? null;
  } catch {
    return null;
  }
}

export function BypassAppsScreen({ onBack }: { onBack?: () => void }) {
  const { t } = useT();
  const { bypassApps, setBypassApps } = useSettingsStore();
  const [apps, setApps]       = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');

  useEffect(() => {
    if (IS_IOS) {
      // Curated catalog — no installed-app listing exists on iOS. packageName
      // carries the catalog id; the row subtitle shows the bypassed domains.
      setApps(IOS_APP_BYPASS_CATALOG.map((a) => ({
        packageName: a.id,
        appName:     `${a.icon} ${a.name}`,
      })));
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const raw = await getNativeModule()?.getInstalledApps?.();
        const parsed: InstalledApp[] = JSON.parse(raw || '[]');
        parsed.sort((a, b) => a.appName.localeCompare(b.appName));
        setApps(parsed);
      } catch {
        setApps([]); // malformed/unavailable list must never crash the screen
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (pkg: string) => {
    const next = bypassApps.includes(pkg)
      ? bypassApps.filter((p) => p !== pkg)
      : [...bypassApps, pkg];
    setBypassApps(next);
    // Android: mirror to native SharedPreferences — the VPN service reads it at
    // TUN build. iOS reads the store at config build; nothing native to mirror.
    if (!IS_IOS) {
      getNativeModule()?.setBypassApps?.(JSON.stringify(next))?.catch?.(() => {});
    }
  };

  // iOS row subtitle: the domains that go direct for this catalog entry.
  const iosDomains = (id: string): string =>
    IOS_APP_BYPASS_CATALOG.find((a) => a.id === id)?.domains.join(' · ') ?? '';

  const shown = useMemo(
    () => apps.filter((a) =>
      !filter ||
      a.appName.toLowerCase().includes(filter.toLowerCase()) ||
      a.packageName.toLowerCase().includes(filter.toLowerCase())),
    [apps, filter],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>{t('st.bypassApps')}</Text>
      </View>

      <Text style={styles.note}>{t(IS_IOS ? 'st.bypassAppsDIos' : 'st.bypassAppsD')}</Text>
      {/* SSH / developer apps are user-selected only — never auto-classified as
          Iranian. Their target server may be Iranian OR foreign. Android-only:
          the iOS catalog has no SSH/developer entries. */}
      {!IS_IOS && (
        <View style={styles.sshInfo}>
          <Text style={styles.sshInfoText}>{t('st.bypassSshInfo')}</Text>
        </View>
      )}
      {bypassApps.length > 0 && (
        <Text style={styles.count}>{bypassApps.length} selected</Text>
      )}

      <TextInput
        style={styles.search}
        placeholder="Search apps…"
        placeholderTextColor={Colors.text.muted}
        value={filter}
        onChangeText={setFilter}
      />

      {loading ? (
        <Text style={styles.note}>Loading app list…</Text>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(a) => a.packageName}
          ListEmptyComponent={<Text style={styles.note}>No apps found.</Text>}
          renderItem={({ item }) => {
            const on = bypassApps.includes(item.packageName);
            return (
              <TouchableOpacity style={styles.row} onPress={() => toggle(item.packageName)} activeOpacity={0.75}>
                <View style={styles.rowLeft}>
                  <Text style={styles.appName}>{item.appName}</Text>
                  <Text style={styles.pkg}>{IS_IOS ? iosDomains(item.packageName) : item.packageName}</Text>
                </View>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Text style={styles.checkMark}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg.base, paddingHorizontal: Spacing[5], paddingTop: Spacing[12] },
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[3] },
  backBtn:     { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 28, color: Colors.text.primary, marginTop: -4 },
  title:       { fontSize: Typography.size['2xl'], fontFamily: Typography.family.display, color: Colors.text.primary },
  note:        { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginBottom: Spacing[3] },
  count:       { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.emerald[400], marginBottom: Spacing[2] },
  sshInfo:     { borderWidth: 1, borderColor: '#c9a84c55', backgroundColor: '#c9a84c14', borderRadius: Radius.lg, padding: Spacing[3], marginBottom: Spacing[3] },
  sshInfoText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#e3c877', lineHeight: 16 },
  search:      { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, color: Colors.text.primary, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], marginBottom: Spacing[3], fontSize: Typography.size.sm },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  rowLeft:     { flex: 1, gap: 2 },
  appName:     { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  pkg:         { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  check:       { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  checkOn:     { backgroundColor: Colors.emerald[400], borderColor: Colors.emerald[400] },
  checkMark:   { color: '#04110a', fontSize: 15, fontWeight: '700' },
});
