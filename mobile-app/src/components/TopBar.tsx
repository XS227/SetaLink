/**
 * TopBar — messages + avatar only.
 * Power button moved into the VPN card on HomeScreen (B-16 declutter intent,
 * finally completed). Settings accessible via Profile tab.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography } from '../design/tokens';
import { useInboxStore }     from '../stores/inboxStore';
import { useDMStore }        from '../stores/dmStore';
import { useIdentityStore }  from '../stores/identityStore';

export function TopBar({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const unreadOfficial = useInboxStore((s) => s.messages.filter((m) => !m.read).length);
  const unreadDm       = useDMStore((s) => s.messages.filter((m) => m.direction === 'in' && !m.read).length);
  const unread         = unreadOfficial + unreadDm;
  const avatarEmoji    = useIdentityStore((s) => s.avatarEmoji);
  const avatarColor    = useIdentityStore((s) => s.avatarColor);

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => onNavigate('inbox')}
        hitSlop={10}
        accessibilityLabel="Inbox"
      >
        <Text style={styles.icon}>✉</Text>
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.avatarChip, { borderColor: avatarColor, backgroundColor: avatarColor + '22' }]}
        onPress={() => onNavigate('profile')}
        hitSlop={10}
        accessibilityLabel="Profile"
      >
        <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn:        { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  icon:       { fontSize: 17, color: Colors.text.secondary },
  badge:      { position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14, borderRadius: 7,
                backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  badgeText:  { color: '#fff', fontSize: 8, fontFamily: Typography.family.heading },
  avatarChip: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji:{ fontSize: 16 },
});
