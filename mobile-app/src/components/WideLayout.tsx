import React, { useRef } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { useVpnStore } from '../stores/vpnStore';
import { useAuthStore } from '../stores/authStore';
import { useIdentityStore, displayLabel } from '../stores/identityStore';
import { gateActionWithAd } from '../services/adsService';
import MyAvatar from './MyAvatar';
import { BottomNav } from './BottomNav';

// Android's "medium" window class starts at 600dp: an unfolded Fold, a Duo
// spanned across both screens, a tablet. Below that the phone layout is unchanged.
export const WIDE_MIN_DP = 600;

export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_MIN_DP;
}

/** Keeps single-column screens readable on wide displays (spec: ~700dp column). */
export function WideColumn({ children }: { children: React.ReactNode }) {
  const wide = useIsWide();
  if (!wide) return <>{children}</>;
  return (
    <View style={styles.columnOuter}>
      <View style={styles.columnInner}>{children}</View>
    </View>
  );
}

type Nav = (tab: string) => void;

/**
 * Left pane of the wide Chats layout: who you are, Freedom (VPN) control,
 * shortcuts to the rest of RealGram. The right pane is the Inbox.
 */
export function ControlPanel({ onNavigate }: { onNavigate: Nav }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { connectionState, selectedServer, connect, disconnect } = useVpnStore();
  const user = useAuthStore((s) => s.user);
  const displayName = useIdentityStore((s) => s.displayName);
  const handle = useIdentityStore((s) => s.handle);
  const busyRef = useRef(false);

  const isConnected  = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting' || connectionState === 'disconnecting';
  const showsAds     = user?.plan === 'free' || !!user?.testMode;

  // Same rules as the Connect tab's power control: quota guard, the tunnel
  // starts at once, the ad gate runs in parallel; disconnect shows the ad first.
  // A confirm dialog replaces the Connect tab's 3 s hold against stray taps.
  const onPower = () => {
    if (isConnecting || busyRef.current) return;
    if (isConnected) {
      Alert.alert('', t('wide.disconnectAsk'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('wide.disconnect'), style: 'destructive',
          onPress: () => {
            if (showsAds) {
              busyRef.current = true;
              gateActionWithAd(() => { busyRef.current = false; disconnect(); });
            } else disconnect();
          },
        },
      ]);
      return;
    }
    if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
      onNavigate('upgrade');
      return;
    }
    connect();
    if (showsAds) {
      busyRef.current = true;
      gateActionWithAd(() => { busyRef.current = false; });
    }
  };

  const status = isConnected ? t('home.connected') : isConnecting ? t('home.connecting') : t('home.disconnected');
  const dot    = isConnected ? Colors.status.connected : isConnecting ? Colors.gold[400] : Colors.text.muted;
  const server = selectedServer ? `${selectedServer.flag ?? ''} ${selectedServer.city || selectedServer.country || ''}`.trim() : '';

  const tiles: Array<{ key: string; icon: string; label: string }> = [
    { key: 'calls',   icon: '📞', label: t('nav.calls') },
    { key: 'clan',    icon: '👥', label: t('nav.clan') },
    { key: 'wallet',  icon: '💎', label: t('nav.wallet') },
    { key: 'game',    icon: '⚔',  label: t('nav.game') },
    { key: 'livetv',  icon: '📺', label: t('wide.liveTv') },
    { key: 'servers', icon: '🌐', label: t('nav.freedom') },
  ];

  return (
    <ScrollView
      style={styles.panel}
      contentContainerStyle={{ padding: Spacing[4], paddingTop: insets.top + Spacing[4], gap: Spacing[4] }}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity style={styles.me} activeOpacity={0.8} onPress={() => onNavigate('profile')}>
        <MyAvatar size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.meName} numberOfLines={1}>{displayLabel({ displayName, handle }) || 'RealGram'}</Text>
          {!!handle && <Text style={styles.meHandle} numberOfLines={1}>@{handle}</Text>}
        </View>
        <TouchableOpacity hitSlop={12} onPress={() => onNavigate('settings')} accessibilityLabel={t('st.title')}>
          <Text style={styles.gear}>⚙</Text>
        </TouchableOpacity>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Freedom</Text>
          <View style={styles.statusPill}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={styles.statusText}>{status}</Text>
          </View>
        </View>
        {!!server && <Text style={styles.server} numberOfLines={1}>{server}</Text>}
        <TouchableOpacity
          style={[styles.powerBtn, isConnected && styles.powerBtnOn, isConnecting && { opacity: 0.6 }]}
          onPress={onPower}
          disabled={isConnecting}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isConnected ? t('wide.disconnect') : t('wide.connect')}
        >
          <Text style={[styles.powerText, isConnected && styles.powerTextOn]}>
            {isConnected ? t('wide.disconnect') : isConnecting ? t('home.connecting') : t('wide.connect')}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>{t('wide.shortcuts')}</Text>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <TouchableOpacity
            key={tile.key}
            style={styles.tile}
            activeOpacity={0.8}
            onPress={() => onNavigate(tile.key)}
            accessibilityLabel={tile.label}
          >
            <Text style={styles.tileIcon}>{tile.icon}</Text>
            <Text style={styles.tileLabel} numberOfLines={1}>{tile.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ height: BottomNav.CONTENT_HEIGHT + insets.bottom }} />
    </ScrollView>
  );
}

/** Wide Chats: control panel on the left, the Inbox on the right. */
export function ChatsSplit({ onNavigate, children }: { onNavigate: Nav; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(380, Math.max(300, Math.round(width * 0.36)));
  return (
    <View style={styles.split}>
      <View style={{ width: panelWidth }}>
        <ControlPanel onNavigate={onNavigate} />
      </View>
      <View style={styles.divider} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  columnOuter: { flex: 1, alignItems: 'center', backgroundColor: Colors.bg.base },
  columnInner: { flex: 1, width: '100%', maxWidth: 720 },

  split:   { flex: 1, flexDirection: 'row', backgroundColor: Colors.bg.base },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: Colors.border.default },
  panel:   { flex: 1, backgroundColor: Colors.bg.surface },

  me:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  meName:   { fontFamily: Typography.family.heading, fontSize: Typography.size.lg, color: Colors.text.primary },
  meHandle: { fontSize: Typography.size.sm, color: Colors.text.secondary },
  gear:     { fontSize: 22, color: Colors.text.secondary },

  card:       { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, padding: Spacing[4], gap: Spacing[3] },
  cardHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:  { fontFamily: Typography.family.heading, fontSize: Typography.size.lg, color: Colors.text.primary },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:        { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: Typography.size.sm, color: Colors.text.secondary },
  server:     { fontSize: Typography.size.sm, color: Colors.text.secondary },
  powerBtn:   { height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.gold[400] },
  powerBtnOn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.gold[400] },
  powerText:  { fontFamily: Typography.family.heading, fontSize: Typography.size.md, color: Colors.bg.base },
  powerTextOn:{ color: Colors.gold[400] },

  section: { fontSize: Typography.size.sm, color: Colors.text.secondary, marginTop: Spacing[1] },
  grid:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[3] },
  tile:    {
    width: '30%', flexGrow: 1, aspectRatio: 1.1, borderRadius: Radius.lg,
    backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  tileIcon:  { fontSize: 24 },
  tileLabel: { fontSize: Typography.size.sm, color: Colors.text.primary },
});
