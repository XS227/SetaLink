/**
 * Settings Screen
 *
 * Organized sections:
 *   - Connection (protocol, port, mux)
 *   - Privacy (DNS, stealth, kill switch)
 *   - Appearance (dark mode, language)
 *   - Notifications
 *   - Diagnostics shortcut
 *   - About + version
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  return (
    <TouchableOpacity
      style={rowStyles.row}
      onPress={() => onChange(!value)}
      activeOpacity={0.75}
    >
      <View style={rowStyles.left}>
        <Text style={rowStyles.label}>{label}</Text>
        {description && <Text style={rowStyles.desc}>{description}</Text>}
      </View>
      <View style={[rowStyles.toggle, value ? rowStyles.toggleOn : rowStyles.toggleOff]}>
        <View style={[
          rowStyles.thumb,
          { transform: [{ translateX: value ? 16 : 0 }] },
        ]} />
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing[3] + 2,
    gap: Spacing[4],
  },
  left: { flex: 1, gap: 2 },
  label: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.body,
    color: Colors.text.primary,
  },
  desc: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
  },
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleOn:  { backgroundColor: Colors.emerald[400] },
  toggleOff: { backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
  },
});

interface SelectRowProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}

function SelectRow({ label, value, options, onChange }: SelectRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <TouchableOpacity
        style={selStyles.row}
        onPress={() => setOpen(!open)}
        activeOpacity={0.75}
      >
        <Text style={selStyles.label}>{label}</Text>
        <View style={selStyles.valueRow}>
          <Text style={selStyles.value}>{value}</Text>
          <Text style={[selStyles.chevron, open && { transform: [{ rotate: '90deg' }] }]}>
            ›
          </Text>
        </View>
      </TouchableOpacity>

      {open && (
        <View style={selStyles.dropdown}>
          {options.map(opt => (
            <TouchableOpacity
              key={opt}
              style={[selStyles.option, opt === value && selStyles.optionActive]}
              onPress={() => { onChange(opt); setOpen(false); }}
              activeOpacity={0.7}
            >
              <Text style={[selStyles.optionText, opt === value && selStyles.optionActiveText]}>
                {opt}
              </Text>
              {opt === value && <Text style={selStyles.check}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const selStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing[3] + 2,
  },
  label: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.body,
    color: Colors.text.primary,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  value: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.mono,
    color: Colors.text.secondary,
  },
  chevron: {
    fontSize: 18,
    color: Colors.text.muted,
  },
  dropdown: {
    backgroundColor: Colors.bg.elevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.default,
    marginBottom: Spacing[2],
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
  },
  optionActive: {
    backgroundColor: 'rgba(0,232,122,0.07)',
  },
  optionText: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.mono,
    color: Colors.text.secondary,
  },
  optionActiveText: {
    color: Colors.emerald[400],
  },
  check: {
    fontSize: Typography.size.sm,
    color: Colors.emerald[400],
  },
});

export function SettingsScreen() {
  const [killSwitch,  setKillSwitch]  = useState(true);
  const [stealth,     setStealth]     = useState(true);
  const [autoConnect, setAutoConnect] = useState(false);
  const [splitTunnel, setSplitTunnel] = useState(false);
  const [ipv6,        setIPv6]        = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [biometric,   setBiometric]   = useState(true);
  const [protocol, setProtocol] = useState('VLESS');
  const [dns,      setDns]      = useState('Cloudflare (DoH)');
  const [language, setLanguage] = useState('English');

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
        <Text style={styles.title}>Settings</Text>

        {/* Connection */}
        <Section label="Connection">
          <View style={secStyles.card}>
            <SelectRow
              label="Protocol"
              value={protocol}
              options={['VLESS', 'Reality', 'WebSocket', 'XHTTP', 'HTTPUpgrade']}
              onChange={setProtocol}
            />
            <Divider />
            <SelectRow
              label="DNS Mode"
              value={dns}
              options={['Cloudflare (DoH)', 'Google (DoH)', 'AdGuard (DoH)', 'Custom']}
              onChange={setDns}
            />
            <Divider />
            <ToggleRow
              label="Auto Connect"
              description="Connect on app launch"
              value={autoConnect}
              onChange={setAutoConnect}
            />
          </View>
        </Section>

        {/* Privacy */}
        <Section label="Privacy & Security">
          <View style={secStyles.card}>
            <ToggleRow
              label="Kill Switch"
              description="Block internet if VPN drops"
              value={killSwitch}
              onChange={setKillSwitch}
            />
            <Divider />
            <ToggleRow
              label="Stealth Mode"
              description="Disguise traffic as HTTPS"
              value={stealth}
              onChange={setStealth}
            />
            <Divider />
            <ToggleRow
              label="Split Tunnel"
              description="Route only selected apps through VPN"
              value={splitTunnel}
              onChange={setSplitTunnel}
            />
            <Divider />
            <ToggleRow
              label="IPv6 Support"
              description="Enable IPv6 tunneling"
              value={ipv6}
              onChange={setIPv6}
            />
          </View>
        </Section>

        {/* Appearance */}
        <Section label="Appearance">
          <View style={secStyles.card}>
            <SelectRow
              label="Language"
              value={language}
              options={['English', 'فارسی (Persian)', 'Deutsch', 'Français', '中文']}
              onChange={setLanguage}
            />
          </View>
        </Section>

        {/* Notifications */}
        <Section label="Notifications">
          <View style={secStyles.card}>
            <ToggleRow
              label="Push Notifications"
              description="Connection status & alerts"
              value={notifications}
              onChange={setNotifications}
            />
            <Divider />
            <ToggleRow
              label="Biometric Lock"
              description="Require fingerprint to open app"
              value={biometric}
              onChange={setBiometric}
            />
          </View>
        </Section>

        {/* Diagnostic tools */}
        <Section label="Diagnostics">
          <View style={secStyles.card}>
            {[
              { label: 'Run Diagnostics', sub: 'Check connection health' },
              { label: 'Connection Logs',  sub: 'View raw log output' },
              { label: 'Export Config',    sub: 'Share Xray config file' },
              { label: 'Reset Settings',   sub: 'Restore defaults', danger: true },
            ].map((item, i) => (
              <View key={i}>
                {i > 0 && <Divider />}
                <TouchableOpacity style={selStyles.row} activeOpacity={0.7}>
                  <View>
                    <Text style={[selStyles.label, item.danger && { color: Colors.status.disconnected }]}>
                      {item.label}
                    </Text>
                    <Text style={rowStyles.desc}>{item.sub}</Text>
                  </View>
                  <Text style={selStyles.chevron}>›</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </Section>

        {/* About */}
        <View style={styles.about}>
          <Text style={styles.appName}>SetaLink</Text>
          <Text style={styles.version}>Version 1.0.0 · Build 2026.05.15</Text>
          <Text style={styles.legal}>© 2026 SetaLink. All rights reserved.</Text>
        </View>

        <View style={{ height: Spacing[12] }} />
      </ScrollView>
    </View>
  );
}

const secStyles = StyleSheet.create({
  section: {
    gap: Spacing[2],
  },
  label: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    paddingHorizontal: Spacing[2],
  },
  card: {
    paddingHorizontal: Spacing[4],
  },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg.base,
  },
  scroll: { flex: 1 },
  content: {
    paddingTop: Layout.statusBarHeight + Spacing[2],
    paddingHorizontal: Layout.screenPadding,
    gap: Spacing[5],
  },
  title: {
    fontSize: Typography.size['2xl'],
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
    marginBottom: Spacing[2],
  },
  about: {
    alignItems: 'center',
    gap: Spacing[1],
    paddingVertical: Spacing[4],
  },
  appName: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  version: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  legal: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    opacity: 0.6,
  },
});
