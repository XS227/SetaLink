import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';

export type NavTab = 'home' | 'servers' | 'ai' | 'activity' | 'profile';

type NavItem = { key: NavTab; icon: string };

const TAB_KEYS: NavItem[] = [
  { key: 'home',     icon: '⬡' },
  { key: 'servers',  icon: '◈' },
  { key: 'ai',       icon: '◎' },
  { key: 'activity', icon: '≡' },
  { key: 'profile',  icon: '○' },
];

interface Props {
  active: NavTab;
  onPress: (tab: NavTab) => void;
}

export function BottomNav({ active, onPress }: Props) {
  const { t } = useT();

  const LABEL_KEYS: Record<NavTab, Parameters<typeof t>[0]> = {
    home:     'nav.home',
    servers:  'nav.servers',
    ai:       'nav.ai',
    activity: 'nav.activity',
    profile:  'nav.profile',
  };

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        {TAB_KEYS.map(tab => {
          const isActive = tab.key === active;
          const isAI = tab.key === 'ai';

          if (isAI) {
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.aiButton}
                onPress={() => onPress(tab.key)}
                activeOpacity={0.8}
              >
                <Text style={styles.aiIcon}>{tab.icon}</Text>
                <Text style={styles.aiLabel}>{t('nav.ai')}</Text>
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => onPress(tab.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.icon, isActive && styles.activeIcon]}>
                {tab.icon}
              </Text>
              <Text style={[styles.label, isActive && styles.activeLabel]}>
                {t(LABEL_KEYS[tab.key])}
              </Text>
              {isActive && <View style={styles.activeDot} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 28,
    paddingHorizontal: Spacing[4],
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.elevated,
    borderRadius: Radius['3xl'],
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    height: 64,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  icon: {
    fontSize: 20,
    color: Colors.text.muted,
  },
  activeIcon: {
    color: Colors.emerald[400],
  },
  label: {
    fontSize: Typography.size.xs - 1,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    letterSpacing: 0.3,
  },
  activeLabel: {
    color: Colors.emerald[400],
  },
  activeDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.emerald[400],
    position: 'absolute',
    bottom: -6,
  },
  // AI center button — elevated pill
  aiButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.emerald[400],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    shadowColor: Colors.emerald[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  aiIcon: {
    fontSize: 18,
    color: Colors.text.inverse,
  },
  aiLabel: {
    fontSize: 8,
    fontFamily: Typography.family.label,
    color: Colors.text.inverse,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
