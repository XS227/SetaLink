/**
 * TopBar — the app's top-right quick actions: inbox, profile, settings.
 *
 * Always reachable from the top of the main screen, with a live unread badge
 * on the inbox (announcements + DMs). Minimalist glyphs to match the app's
 * look, not a chat-app clone.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography } from '../design/tokens';
import { useInboxStore } from '../stores/inboxStore';
import { useDMStore } from '../stores/dmStore';

function IconBtn({ glyph, onPress, badge, label }: { glyph: string; onPress: () => void; badge?: number; label: string }) {
  return (
    <TouchableOpacity style={styles.btn} onPress={onPress} activeOpacity={0.7} accessibilityLabel={label} hitSlop={8}>
      <Text style={styles.icon}>{glyph}</Text>
      {!!badge && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : String(badge)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function TopBar({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const unreadOfficial = useInboxStore((s) => s.messages.filter((m) => !m.read).length);
  const unreadDm       = useDMStore((s) => s.messages.filter((m) => m.direction === 'in' && !m.read).length);
  const unread = unreadOfficial + unreadDm;

  return (
    <View style={styles.bar}>
      <IconBtn glyph="✉" label="Inbox"    onPress={() => onNavigate('inbox')} badge={unread} />
      <IconBtn glyph="◍" label="Profile"  onPress={() => onNavigate('profile')} />
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
});
