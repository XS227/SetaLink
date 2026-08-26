/**
 * TopBar — the app's top-right quick actions: power, inbox, profile, settings.
 *
 * Always reachable from the top of the main screen, with a live unread badge
 * on the inbox (announcements + DMs). Minimalist glyphs to match the app's
 * look, not a chat-app clone.
 *
 * The power icon is the VPN's on/off switch everywhere: green when the tunnel
 * is up, red when it's down. It exists because the big REAL coin on Home is
 * tap-to-earn while connected, so disconnect needs its own always-visible
 * control.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors, Typography } from '../design/tokens';
import { useInboxStore } from '../stores/inboxStore';
import { useDMStore } from '../stores/dmStore';
import { useVpnStore } from '../stores/vpnStore';
import { useAuthStore } from '../stores/authStore';
import { useIdentityStore } from '../stores/identityStore';

function IconBtn({ glyph, onPress, badge, label, color, ring }: {
  glyph: string; onPress: () => void; badge?: number; label: string;
  color?: string; ring?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, ring ? { borderWidth: 1, borderColor: ring } : null]}
      onPress={onPress} activeOpacity={0.7} accessibilityLabel={label} hitSlop={8}
    >
      <Text style={[styles.icon, color ? { color } : null]}>{glyph}</Text>
      {!!badge && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : String(badge)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const POWER_ON  = Colors.emerald[400];
const POWER_OFF = '#FF6B6B';
const POWER_BUSY = '#E8B84B';

function PowerBtn({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const connectionState = useVpnStore((s) => s.connectionState);
  const isConnected = connectionState === 'connected';
  const isBusy = connectionState === 'connecting' || connectionState === 'disconnecting';
  const color = isBusy ? POWER_BUSY : isConnected ? POWER_ON : POWER_OFF;

  const onPress = () => {
    if (isBusy) return;
    const vpn = useVpnStore.getState();
    if (isConnected) { vpn.disconnect(); return; }
    // Same gate as the Home coin: exhausted free quota goes to upgrade.
    const user = useAuthStore.getState().user;
    if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
      onNavigate('upgrade');
      return;
    }
    vpn.connect();
  };

  return (
    <TouchableOpacity
      style={[styles.btn, { borderWidth: 1, borderColor: color + '66' },
              isConnected && { backgroundColor: POWER_ON + '14' }]}
      onPress={onPress} activeOpacity={0.7} hitSlop={8}
      accessibilityLabel={isConnected ? 'Turn VPN off' : 'Turn VPN on'}
    >
      {/* Drawn power symbol — the ⏻ text glyph is missing/ugly in many
          Android system fonts, so we render it as vectors instead. */}
      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
        <Path d="M12 2v10" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M18.4 6.6a9 9 0 1 1-12.77.04" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
    </TouchableOpacity>
  );
}

// B-21: the profile entry point now that the footer's Profile tab is gone
// (B-22 replaced it with Game) — shows the user's own avatar emoji instead of
// a generic glyph, so it reads as "you" and doubles as the primary way back
// into the profile screen from everywhere.
function AvatarChip({ onPress }: { onPress: () => void }) {
  const avatarEmoji = useIdentityStore((s) => s.avatarEmoji);
  const avatarColor = useIdentityStore((s) => s.avatarColor);

  return (
    <TouchableOpacity
      style={[styles.avatarChip, { borderColor: avatarColor, backgroundColor: avatarColor + '22' }]}
      onPress={onPress} activeOpacity={0.7} accessibilityLabel="Profile" hitSlop={8}
    >
      <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
    </TouchableOpacity>
  );
}

export function TopBar({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const unreadOfficial = useInboxStore((s) => s.messages.filter((m) => !m.read).length);
  const unreadDm       = useDMStore((s) => s.messages.filter((m) => m.direction === 'in' && !m.read).length);
  const unread = unreadOfficial + unreadDm;

  return (
    <View style={styles.bar}>
      <PowerBtn onNavigate={onNavigate} />
      <IconBtn glyph="✉" label="Inbox"    onPress={() => onNavigate('inbox')} badge={unread} />
      <AvatarChip onPress={() => onNavigate('profile')} />
      <IconBtn glyph="⚙" label="Settings" onPress={() => onNavigate('settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn:  { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  icon: { fontSize: 18, color: Colors.text.secondary },
  badge:{ position: 'absolute', top: 3, right: 3, minWidth: 15, height: 15, borderRadius: 8,
          backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: Typography.family.heading },
  avatarChip:  { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 17 },
});
