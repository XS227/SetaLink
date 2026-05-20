import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useSettingsStore } from '../stores/settingsStore';
import { useServerStore }   from '../stores/serverStore';
import { BiometricService } from '../services/biometricService';
import { useT } from '../i18n';
import { APP_VERSION, APP_BUILD } from '../utils/version';
const VERSION_URL     = 'https://setalink.no/download/version.json';
const DOWNLOAD_URL    = 'https://setalink.no/download/setalink-latest.apk';
const GITHUB_URL      = 'https://github.com/setaei/setalink';
const WEBSITE_URL     = 'https://setalink.no';

// ── Sub-components ────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label:        string;
  description?: string;
  value:        boolean;
  onChange:     () => void;
  comingSoon?:  boolean;
}

function ToggleRow({ label, description, value, onChange, comingSoon = false }: ToggleRowProps) {
  const handlePress = comingSoon
    ? () => Alert.alert('Coming soon', `${label} will be available in a future update.`)
    : onChange;

  return (
    <TouchableOpacity style={rowStyles.row} onPress={handlePress} activeOpacity={0.75}>
      <View style={rowStyles.left}>
        <View style={rowStyles.labelRow}>
          <Text style={[rowStyles.label, comingSoon && rowStyles.labelMuted]}>{label}</Text>
          {comingSoon && <Text style={rowStyles.badge}>Soon</Text>}
        </View>
        {description && <Text style={rowStyles.desc}>{description}</Text>}
      </View>
      <View style={[
        rowStyles.toggle,
        comingSoon ? rowStyles.toggleDisabled : (value ? rowStyles.toggleOn : rowStyles.toggleOff),
      ]}>
        <View style={[rowStyles.thumb, { transform: [{ translateX: comingSoon ? 0 : (value ? 16 : 0) }] }]} />
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3] + 2, gap: Spacing[4] },
  left:          { flex: 1, gap: 2 },
  labelRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  label:         { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  labelMuted:    { color: Colors.text.muted },
  desc:          { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  badge:         { fontSize: 9, fontFamily: Typography.family.label, color: Colors.text.muted, borderWidth: 1, borderColor: Colors.border.default, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, letterSpacing: 0.5, textTransform: 'uppercase' },
  toggle:        { width: 40, height: 24, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 3 },
  toggleOn:      { backgroundColor: Colors.emerald[400] },
  toggleOff:     { backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  toggleDisabled:{ backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.subtle, opacity: 0.4 },
  thumb:         { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
});

interface SelectRowProps {
  label:    string;
  value:    string;
  options:  string[];
  onChange: (v: string) => void;
}

function SelectRow({ label, value, options, onChange }: SelectRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity style={selStyles.row} onPress={() => setOpen(!open)} activeOpacity={0.75}>
        <Text style={selStyles.label}>{label}</Text>
        <View style={selStyles.valueRow}>
          <Text style={selStyles.value}>{value}</Text>
          <Text style={[selStyles.chevron, open && { transform: [{ rotate: '90deg' }] }]}>›</Text>
        </View>
      </TouchableOpacity>

      {open && (
        <View style={selStyles.dropdown}>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[selStyles.option, opt === value && selStyles.optionActive]}
              onPress={() => { onChange(opt); setOpen(false); }}
              activeOpacity={0.7}
            >
              <Text style={[selStyles.optionText, opt === value && selStyles.optionActiveText]}>{opt}</Text>
              {opt === value && <Text style={selStyles.check}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const selStyles = StyleSheet.create({
  row:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3] + 2 },
  label:           { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  valueRow:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value:           { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  chevron:         { fontSize: 18, color: Colors.text.muted },
  dropdown:        { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, marginBottom: Spacing[2], overflow: 'hidden' },
  option:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  optionActive:    { backgroundColor: 'rgba(0,232,122,0.07)' },
  optionText:      { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  optionActiveText:{ color: Colors.emerald[400] },
  check:           { fontSize: Typography.size.sm, color: Colors.emerald[400] },
});

// ── Screen ────────────────────────────────────────────────────────────────────

interface SettingsProps { onBack?: () => void; onProfileImport?: () => void }

export function SettingsScreen({ onBack, onProfileImport }: SettingsProps) {
  const { t } = useT();
  const {
    protocol, dnsMode, language,
    autoConnect, biometricLock,
    setProtocol, setDnsMode, setLanguage,
    toggleAutoConnect, toggleBiometricLock, setBiometricLock,
  } = useSettingsStore();
  const { clearImportedServers, loadBootstrapIfEmpty } = useServerStore();
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'uptodate' | 'available'>('idle');
  const [latestVersion, setLatestVersion] = useState('');

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(VERSION_URL, { signal: controller.signal });
      clearTimeout(tid);
      const json = await res.json() as { version: string };
      const latest = json.version ?? '';
      setLatestVersion(latest);
      setUpdateStatus(latest !== APP_VERSION ? 'available' : 'uptodate');
    } catch {
      setUpdateStatus('idle');
      Alert.alert('Update check failed', 'Could not reach setalink.no. Try again later.');
    }
  };

  const handleDownloadUpdate = () => {
    Linking.openURL(DOWNLOAD_URL);
  };

  const handleBiometricToggle = async () => {
    if (biometricLock) {
      // Turning off — always allowed
      toggleBiometricLock();
      return;
    }
    // Turning on — verify device support first
    const available = await BiometricService.isAvailable().catch(() => false);
    if (!available) {
      Alert.alert(
        'Biometric Unavailable',
        'This device does not have enrolled biometrics. Please set up fingerprint or face unlock in your device settings first.',
        [{ text: 'OK' }]
      );
      return;
    }
    setBiometricLock(true);
  };

  function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={secStyles.section}>
        <Text style={secStyles.label}>{label}</Text>
        <GlassCard noPadding>
          <View style={secStyles.card}>{children}</View>
        </GlassCard>
      </View>
    );
  }

  function Divider() {
    return <View style={{ height: 1, backgroundColor: Colors.border.subtle }} />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screenHeader}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
              <Text style={styles.backBtnText}>‹</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.title}>{t('st.title')}</Text>
        </View>

        <Section label={t('st.connection')}>
          <SelectRow
            label={t('st.protocol')}
            value={protocol}
            options={['VLESS+Reality', 'VLESS', 'Reality', 'WebSocket', 'XHTTP', 'HTTPUpgrade']}
            onChange={setProtocol}
          />
          <Divider />
          <SelectRow
            label={t('st.dns')}
            value={dnsMode}
            options={['Cloudflare (DoH)', 'Google (DoH)', 'AdGuard (DoH)', 'Custom']}
            onChange={setDnsMode}
          />
          <Divider />
          <ToggleRow
            label={t('st.autoConnect')}
            description={t('st.autoConnectD')}
            value={autoConnect}
            onChange={toggleAutoConnect}
          />
        </Section>

        <Section label={t('st.appearance')}>
          <SelectRow
            label={t('st.language')}
            value={language}
            options={['English', 'فارسی']}
            onChange={setLanguage}
          />
        </Section>

        <Section label={t('st.notifications')}>
          <ToggleRow
            label={t('st.biometric')}
            description={t('st.biometricD')}
            value={biometricLock}
            onChange={handleBiometricToggle}
          />
        </Section>

        <Section label={t('st.diagnostics')}>
          {onProfileImport && (
            <>
              <TouchableOpacity style={selStyles.row} activeOpacity={0.7} onPress={onProfileImport}>
                <View>
                  <Text style={selStyles.label}>Import / Export Profiles</Text>
                  <Text style={rowStyles.desc}>Paste vless:// links or share your config</Text>
                </View>
                <Text style={selStyles.chevron}>›</Text>
              </TouchableOpacity>
              <Divider />
            </>
          )}
          <TouchableOpacity
            style={selStyles.row}
            activeOpacity={0.7}
            onPress={() => {
              Alert.alert(
                'Reset App Data',
                'Remove all imported server profiles and reset to the default starter profile?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: async () => {
                      clearImportedServers();
                      await loadBootstrapIfEmpty();
                      Alert.alert('Done', 'Server list reset to default.');
                    },
                  },
                ],
              );
            }}
          >
            <View>
              <Text style={[selStyles.label, { color: Colors.status.disconnected }]}>
                {t('st.reset')}
              </Text>
              <Text style={rowStyles.desc}>{t('st.resetD')}</Text>
            </View>
            <Text style={selStyles.chevron}>›</Text>
          </TouchableOpacity>
        </Section>

        <Section label="About">
          <TouchableOpacity style={selStyles.row} onPress={() => Linking.openURL(GITHUB_URL)} activeOpacity={0.7}>
            <Text style={selStyles.label}>GitHub</Text>
            <Text style={selStyles.value}>github.com/setaei/setalink</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={selStyles.row} onPress={() => Linking.openURL(WEBSITE_URL)} activeOpacity={0.7}>
            <Text style={selStyles.label}>Website</Text>
            <Text style={selStyles.value}>setalink.no</Text>
          </TouchableOpacity>
        </Section>

        <Section label="Updates">
          <View style={selStyles.row}>
            <View>
              <Text style={selStyles.label}>App version</Text>
              <Text style={rowStyles.desc}>v{APP_VERSION} · Build {APP_BUILD}</Text>
            </View>
            <TouchableOpacity
              onPress={updateStatus === 'available' ? handleDownloadUpdate : handleCheckUpdate}
              style={[styles.updateBtn, updateStatus === 'available' && styles.updateBtnAvailable]}
              activeOpacity={0.75}
              disabled={updateStatus === 'checking'}
            >
              <Text style={[styles.updateBtnText, updateStatus === 'available' && styles.updateBtnTextAvailable]}>
                {updateStatus === 'checking'  ? 'Checking…'        :
                 updateStatus === 'available' ? `Update ${latestVersion}` :
                 updateStatus === 'uptodate'  ? 'Up to date ✓'    :
                 'Check update'}
              </Text>
            </TouchableOpacity>
          </View>
          {updateStatus === 'available' && (
            <View style={styles.updateBanner}>
              <Text style={styles.updateBannerText}>
                Version {latestVersion} is available. Tap "Update" to download.
              </Text>
            </View>
          )}
          <Divider />
          <View style={selStyles.row}>
            <View style={{ gap: 3 }}>
              <Text style={selStyles.label}>Version debug</Text>
              <Text style={rowStyles.desc}>Manifest version: v{APP_VERSION} (Build {APP_BUILD})</Text>
              <Text style={rowStyles.desc}>JS bundle version: v{APP_VERSION} (Build {APP_BUILD})</Text>
              <Text style={rowStyles.desc}>OTA version: {latestVersion ? `v${latestVersion}` : '(tap Check update)'}</Text>
            </View>
          </View>
        </Section>

        <View style={styles.about}>
          <Text style={styles.appName}>SetaLink</Text>
          <Text style={styles.version}>v{APP_VERSION} · Build {APP_BUILD}</Text>
          <Text style={styles.legal}>© 2026 SetaLink. {t('st.allRights')}</Text>
        </View>

        <View style={{ height: Spacing[12] }} />
      </ScrollView>
    </View>
  );
}

const secStyles = StyleSheet.create({
  section: { gap: Spacing[2] },
  label:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1.5, paddingHorizontal: Spacing[2] },
  card:    { paddingHorizontal: Spacing[4] },
});

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.base },
  scroll:  { flex: 1 },
  content: { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[5] },
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[2] },
  backBtn:      { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default },
  backBtnText:  { fontSize: 22, color: Colors.text.secondary, lineHeight: 26 },
  title:        { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  about:   { alignItems: 'center', gap: Spacing[1], paddingVertical: Spacing[4] },
  appName:    { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  version:    { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  legal:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, opacity: 0.6 },
  updateBtn:  { borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 6 },
  updateBtnAvailable: { borderColor: Colors.emerald[400], backgroundColor: 'rgba(0,232,122,0.1)' },
  updateBtnText:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted },
  updateBtnTextAvailable: { color: Colors.emerald[400] },
  updateBanner:       { backgroundColor: 'rgba(0,232,122,0.07)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(0,232,122,0.2)', padding: Spacing[3] },
  updateBannerText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400], lineHeight: 18 },
});
