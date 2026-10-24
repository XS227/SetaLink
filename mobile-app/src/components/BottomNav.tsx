import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';

export type NavTab = 'home' | 'servers' | 'ai' | 'activity' | 'profile' | 'game' | 'chats' | 'wallet' | 'clan' | 'calls';

type NavItem = { key: NavTab; icon: string };

// Gold After Dark (Khabat, 2026-10-24: "do the layout changes too, 5 tabs"):
// Chats · Calls · Connect · Clan · Profile, the approved design's order.
// Supersedes the 2026-07-30 Home·Freedom·Shahnameh·Wallet footer — those
// destinations stay fully reachable through TopBar's burger menu (Connect's
// header), the same pattern 'ai'/'activity' already used.
const TABS: NavItem[] = [
  { key: 'chats',   icon: '💬' },
  { key: 'calls',   icon: '📞' },
  { key: 'home',    icon: '⬡' },
  { key: 'clan',    icon: '👥' },
  { key: 'profile', icon: '👤' },
];

interface Props {
  active:   NavTab;
  onPress:  (tab: NavTab) => void;
}

export function BottomNav({ active, onPress }: Props) {
  const { t }  = useT();
  const insets = useSafeAreaInsets();
  // Unfolded / tablet widths: keep the five tabs a thumb-sized group, centered.
  const { width } = useWindowDimensions();
  const wideBar = width >= 600 ? { width: 560, alignSelf: 'center' as const } : null;

  const LABELS: Record<NavTab, Parameters<typeof t>[0]> = {
    home:     'nav.connect',
    servers:  'nav.freedom',
    ai:       'nav.ai',
    activity: 'nav.activity',
    profile:  'nav.profile',
    game:     'nav.game',
    chats:    'nav.chats',
    wallet:   'nav.wallet',
    clan:     'nav.clan',
    calls:    'nav.calls',
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + Spacing[2] }]}>
      <View style={[styles.bar, wideBar]}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onPress(tab.key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t(LABELS[tab.key])}
            >
              <Text style={[styles.icon, isActive && styles.iconActive]}>{tab.icon}</Text>
              <Text style={[styles.label, isActive && styles.labelActive]}>{t(LABELS[tab.key])}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Static height used by screens to add bottom padding
BottomNav.BAR_HEIGHT = 56;
// Single source of truth for the nav's total on-screen height, excluding the
// safe-area inset (callers add insets.bottom themselves, since it varies by
// device/orientation). Derived from the same Spacing[2]/BAR_HEIGHT/Spacing[2]
// (paddingTop + bar + paddingBottom's non-inset part) that `container`/`bar`
// below actually render with, so it can't drift the way the old, separately
// hand-maintained `Layout.bottomNavHeight` constant did.
BottomNav.CONTENT_HEIGHT = Spacing[2] + BottomNav.BAR_HEIGHT + Spacing[2];

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
    backgroundColor: Colors.bg.base,
    borderTopWidth: 1,
    borderTopColor: Colors.border.subtle,
  },
  // Gold After Dark: calm charcoal bar, the active tab is the one gold thing.
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius['2xl'],
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: Spacing[2],
    height: BottomNav.BAR_HEIGHT,
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    height: BottomNav.BAR_HEIGHT - Spacing[2] * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: Radius.xl,
  },
  tabActive:   { backgroundColor: Colors.border.goldGlow },
  // Active-tab color: gold. This is the app's single active-nav choke point,
  // on purpose (see A->B(74)).
  icon:        { fontSize: 19, color: Colors.text.secondary },
  iconActive:  { color: Colors.gold[400] },
  label:       { fontSize: 10, fontFamily: Typography.family.label, color: Colors.text.secondary, letterSpacing: 0.3 },
  labelActive: { color: Colors.gold[400], fontWeight: '700' },
});
