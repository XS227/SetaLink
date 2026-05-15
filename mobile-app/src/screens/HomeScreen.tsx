/**
 * Home Screen — Main connection hub
 *
 * Layout (top to bottom):
 *   Status bar area
 *   Header: greeting + notification bell
 *   Connection status badge
 *   Large connect button (center)
 *   Server info pill
 *   Metric row: ping, upload, download
 *   Network quality bar
 *   AI optimize button
 *   Traffic stats card
 *   Bottom nav
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Animated,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { ConnectButton } from '../components/ConnectButton';
import { StatusBadge } from '../components/StatusBadge';
import { MetricPill } from '../components/MetricPill';
import { NetworkQualityBar } from '../components/NetworkQualityBar';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';

const { width } = Dimensions.get('window');

type ConnState = 'idle' | 'connecting' | 'connected' | 'disconnecting';
const STATUS_MAP: Record<ConnState, 'idle' | 'connecting' | 'connected' | 'disconnected'> = {
  idle:          'idle',
  connecting:    'connecting',
  connected:     'connected',
  disconnecting: 'connecting',
};

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab: NavTab;
}

export function HomeScreen({ onNavigate, activeTab }: Props) {
  const [connState, setConnState] = useState<ConnState>('idle');
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(contentTranslate, {
        toValue: 0,
        damping: 20,
        stiffness: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleConnect = () => {
    if (connState === 'idle') {
      setConnState('connecting');
      setTimeout(() => setConnState('connected'), 1800);
    } else if (connState === 'connected') {
      setConnState('disconnecting');
      setTimeout(() => setConnState('idle'), 1000);
    }
  };

  const isConnected = connState === 'connected';

  return (
    <View style={styles.screen}>
      {/* Ambient glow — visible when connected */}
      {isConnected && (
        <View style={styles.ambientGlow} pointerEvents="none" />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
          <View>
            <Text style={styles.greeting}>Good evening</Text>
            <Text style={styles.username}>Khabat ↗</Text>
          </View>
          <TouchableOpacity style={styles.bellBtn}>
            <Text style={styles.bellIcon}>◌</Text>
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </Animated.View>

        {/* Status */}
        <Animated.View style={[
          styles.statusRow,
          { opacity: headerOpacity, transform: [{ translateY: contentTranslate }] },
        ]}>
          <StatusBadge status={STATUS_MAP[connState]} />
          {isConnected && (
            <View style={styles.protocolBadge}>
              <Text style={styles.protocolText}>VLESS · Reality</Text>
            </View>
          )}
        </Animated.View>

        {/* Connect button */}
        <Animated.View style={[
          styles.connectArea,
          { transform: [{ translateY: contentTranslate }] },
        ]}>
          <ConnectButton state={connState} onPress={handleConnect} />

          {/* Session timer */}
          {isConnected && (
            <Text style={styles.timer}>02:34:17</Text>
          )}
        </Animated.View>

        {/* Server pill */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <TouchableOpacity
            style={[styles.serverPill, isConnected && styles.serverPillActive]}
            onPress={() => onNavigate('servers')}
            activeOpacity={0.75}
          >
            <Text style={styles.serverFlag}>🇩🇪</Text>
            <View style={styles.serverInfo}>
              <Text style={styles.serverName}>Frankfurt, Germany</Text>
              <Text style={styles.serverSub}>CDN Edge · Premium</Text>
            </View>
            <View style={styles.serverMeta}>
              <View style={[styles.pingDot, { backgroundColor: Colors.emerald[400] }]} />
              <Text style={styles.serverPing}>24ms</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Metric row */}
        <Animated.View style={[
          styles.metricRow,
          { transform: [{ translateY: contentTranslate }] },
        ]}>
          <MetricPill
            label="Ping"
            value="24"
            unit="ms"
            accent={isConnected}
            style={{ flex: 1 }}
          />
          <MetricPill
            label="Upload"
            value={isConnected ? '4.2' : '—'}
            unit={isConnected ? 'MB/s' : ''}
            style={{ flex: 1 }}
          />
          <MetricPill
            label="Download"
            value={isConnected ? '18.7' : '—'}
            unit={isConnected ? 'MB/s' : ''}
            style={{ flex: 1 }}
          />
        </Animated.View>

        {/* Network quality */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <GlassCard glowColor={isConnected ? Colors.emerald[400] : undefined}>
            <NetworkQualityBar quality={isConnected ? 91 : 0} />
          </GlassCard>
        </Animated.View>

        {/* AI Optimize */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <TouchableOpacity
            style={styles.aiBtn}
            onPress={() => onNavigate('ai')}
            activeOpacity={0.8}
          >
            <View style={styles.aiBtnLeft}>
              <View style={styles.aiOrb} />
              <View>
                <Text style={styles.aiBtnTitle}>AI Optimize</Text>
                <Text style={styles.aiBtnSub}>
                  {isConnected
                    ? 'Route optimized · Stealth active'
                    : 'Will optimize on connect'}
                </Text>
              </View>
            </View>
            <View style={styles.aiArrow}>
              <Text style={styles.aiArrowText}>›</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Traffic stats */}
        {isConnected && (
          <GlassCard style={styles.trafficCard}>
            <Text style={styles.cardLabel}>Session Traffic</Text>
            <View style={styles.trafficRow}>
              <View style={styles.trafficItem}>
                <Text style={styles.trafficIcon}>↑</Text>
                <Text style={styles.trafficValue}>1.2 GB</Text>
                <Text style={styles.trafficSub}>Sent</Text>
              </View>
              <View style={styles.trafficDivider} />
              <View style={styles.trafficItem}>
                <Text style={[styles.trafficIcon, { color: Colors.blue[400] }]}>↓</Text>
                <Text style={styles.trafficValue}>4.8 GB</Text>
                <Text style={styles.trafficSub}>Received</Text>
              </View>
              <View style={styles.trafficDivider} />
              <View style={styles.trafficItem}>
                <Text style={styles.trafficIcon}>⬡</Text>
                <Text style={styles.trafficValue}>DE·01</Text>
                <Text style={styles.trafficSub}>Node</Text>
              </View>
            </View>
          </GlassCard>
        )}

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg.base,
  },
  ambientGlow: {
    position: 'absolute',
    width: width,
    height: width,
    borderRadius: width / 2,
    backgroundColor: Colors.emerald[900],
    opacity: 0.12,
    top: -width * 0.3,
    left: 0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: Layout.statusBarHeight,
    paddingHorizontal: Layout.screenPadding,
    gap: Spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing[2],
  },
  greeting: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    letterSpacing: Typography.tracking.wide,
  },
  username: {
    fontSize: Typography.size.xl,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.bg.surface,
    borderWidth: 1,
    borderColor: Colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellIcon: {
    fontSize: 18,
    color: Colors.text.secondary,
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.emerald[400],
    borderWidth: 1.5,
    borderColor: Colors.bg.base,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  protocolBadge: {
    backgroundColor: 'rgba(0,232,122,0.1)',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border.glow,
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
  },
  protocolText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.emerald[400],
    letterSpacing: 0.5,
  },
  connectArea: {
    alignItems: 'center',
    paddingVertical: Spacing[4],
    gap: Spacing[3],
  },
  timer: {
    fontSize: Typography.size.md,
    fontFamily: Typography.family.mono,
    color: Colors.text.secondary,
    letterSpacing: 2,
  },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: Spacing[4],
    gap: Spacing[3],
  },
  serverPillActive: {
    borderColor: Colors.border.glow,
    backgroundColor: 'rgba(0,232,122,0.04)',
  },
  serverFlag: {
    fontSize: 28,
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  serverSub: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    marginTop: 2,
  },
  serverMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  serverPing: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.mono,
    color: Colors.emerald[400],
  },
  chevron: {
    fontSize: 20,
    color: Colors.text.muted,
    marginLeft: -4,
  },
  metricRow: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(0,232,122,0.15)',
    padding: Spacing[4],
    ...Shadow.card,
  },
  aiBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  aiOrb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,232,122,0.12)',
    borderWidth: 1,
    borderColor: Colors.border.glow,
    shadowColor: Colors.emerald[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  aiBtnTitle: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  aiBtnSub: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    marginTop: 2,
  },
  aiArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.bg.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiArrowText: {
    fontSize: 18,
    color: Colors.emerald[400],
  },
  trafficCard: {
    gap: Spacing[3],
  },
  cardLabel: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  trafficRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trafficItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  trafficIcon: {
    fontSize: Typography.size.xl,
    color: Colors.emerald[400],
    fontFamily: Typography.family.heading,
  },
  trafficValue: {
    fontSize: Typography.size.lg,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  trafficSub: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trafficDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.border.subtle,
  },
});
