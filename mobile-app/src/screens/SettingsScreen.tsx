import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useSettingsStore } from '../stores/settingsStore';
import { useT } from '../i18n';

// ── Sub-components ────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label:        string;
  description?: string;
  value:        boolean;
  onChange:     () => void;
}

function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  return (
    <TouchableOpacity style={rowStyles.row} onPress={onChange} activeOpacity={0.75}>
      <View style={rowStyles.left}>
        <Text style={rowStyles.label}>{label}</Text>
        {description && <Text style={rowStyles.desc}>{description}</Text>}
      </View>
      <View style={[rowStyles.toggle, value ? rowStyles.toggleOn : rowStyles.toggleOff]}>
        <View style={[rowStyles.thumb, { transform: [{ translateX: value ? 16 : 0 }] }]} />
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3] + 2, gap: Spacing[4] },
  left:      { flex: 1, gap: 2 },
  label:     { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  desc:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  toggle:    { width: 40, height: 24, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 3 },
  toggleOn:  { backgroundColor: Colors.emerald[400] },
  toggleOff: { backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  thumb:     { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
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

interface SettingsProps { onBack?: () => void }

export function SettingsScreen({ onBack }: SettingsProps) {
  const { t } = useT();
  const {
    protocol, dnsMode, language,
    autoConnect, killSwitch, stealthMode, splitTunnel, ipv6,
    pushNotifications, biometricLock,
    setProtocol, setDnsMode, setLanguage,
    toggleAutoConnect, toggleKillSwitch, toggleStealthMode,
    toggleSplitTunnel, toggleIpv6, togglePushNotifications, toggleBiometricLock,
  } = useSettingsStore();

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

        <Section label={t('st.privacy')}>
          <ToggleRow
            label={t('st.killSwitch')}
            description={t('st.killSwitchD')}
            value={killSwitch}
            onChange={toggleKillSwitch}
          />
          <Divider />
          <ToggleRow
            label={t('st.stealth')}
            description={t('st.stealthD')}
            value={stealthMode}
            onChange={toggleStealthMode}
          />
          <Divider />
          <ToggleRow
            label={t('st.split')}
            description={t('st.splitD')}
            value={splitTunnel}
            onChange={toggleSplitTunnel}
          />
          <Divider />
          <ToggleRow
            label={t('st.ipv6')}
            description={t('st.ipv6D')}
            value={ipv6}
            onChange={toggleIpv6}
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
            label={t('st.pushNotif')}
            description={t('st.pushNotifD')}
            value={pushNotifications}
            onChange={togglePushNotifications}
          />
          <Divider />
          <ToggleRow
            label={t('st.biometric')}
            description={t('st.biometricD')}
            value={biometricLock}
            onChange={toggleBiometricLock}
          />
        </Section>

        <Section label={t('st.diagnostics')}>
          {([
            { labelKey: 'st.runDiag',   subKey: 'st.runDiagD',   danger: false },
            { labelKey: 'st.connLogs',  subKey: 'st.connLogsD',  danger: false },
            { labelKey: 'st.exportCfg', subKey: 'st.exportCfgD', danger: false },
            { labelKey: 'st.reset',     subKey: 'st.resetD',     danger: true  },
          ] as const).map((item, i) => (
            <View key={item.labelKey}>
              {i > 0 && <Divider />}
              <TouchableOpacity style={selStyles.row} activeOpacity={0.7}>
                <View>
                  <Text style={[selStyles.label, item.danger && { color: Colors.status.disconnected }]}>
                    {t(item.labelKey)}
                  </Text>
                  <Text style={rowStyles.desc}>{t(item.subKey)}</Text>
                </View>
                <Text style={selStyles.chevron}>›</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Section>

        <View style={styles.about}>
          <Text style={styles.appName}>SetaLink</Text>
          <Text style={styles.version}>{t('st.version')} 1.0.0 · Build 2026.05.16</Text>
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
  appName: { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  version: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  legal:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, opacity: 0.6 },
});
