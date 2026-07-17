import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';

export type NavTab = 'home' | 'servers' | 'ai' | 'activity' | 'profile' | 'game';

type NavItem = { key: NavTab; icon: string };

const TABS: NavItem[] = [
  { key: 'home',    icon: '⬡' },
  { key: 'servers', icon: '◈' },
  { key: 'game',    icon: '⚔' },
];

interface Props {
  active:   NavTab;
  onPress:  (tab: NavTab) => void;
}

export function BottomNav({ active, onPress }: Props) {
  const { t }  = useT();
  const insets = useSafeAreaInsets();

  const LABELS: Record<NavTab, Parameters<typeof t>[0]> = {
    home:     'nav.home',
    servers:  'nav.servers',
    ai:       'nav.ai',
    activity: 'nav.activity',
    profile:  'nav.profile',
    game:     'nav.game',
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + Spacing[2] }]}>
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => onPress(tab.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.icon, isActive && styles.iconActive]}>{tab.icon}</Text>
              <Text style={[styles.label, isActive && styles.labelActive]}>{t(LABELS[tab.key])}</Text>
              {isActive && <View style={styles.dot} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Static height used by screens to add bottom padding
BottomNav.BAR_HEIGHT = 56;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
    backgroundColor: Colors.bg.void,
    borderTopWidth: 1,
    borderTopColor: Colors.border.subtle,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.bg.elevated,
    borderRadius: Radius['2xl'],
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: Spacing[4],
    height: BottomNav.BAR_HEIGHT,
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  icon:        { fontSize: 19, color: Colors.text.muted },
  iconActive:  { color: Colors.emerald[400] },
  label:       { fontSize: 9, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  labelActive: { color: Colors.emerald[400] },
  dot:         { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.emerald[400], position: 'absolute', bottom: -4 },
});
