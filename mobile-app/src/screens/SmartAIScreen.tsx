import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard }         from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';

import { useAIStore, AI_MODES, AIFeatures } from '../stores/aiStore';
import { formatRelativeTime } from '../utils/formatters';

// ── AI Orb ────────────────────────────────────────────────────────────────────
// Visual only — all business logic stays in aiStore

function AIOrb({ active, color }: { active: boolean; color: string }) {
  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulse1, { toValue: 1.4, duration: 1500, useNativeDriver: true }),
            Animated.timing(pulse1, { toValue: 1,   duration: 1500, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.delay(500),
            Animated.timing(pulse2, { toValue: 1.6, duration: 1500, useNativeDriver: true }),
            Animated.timing(pulse2, { toValue: 1,   duration: 1500, useNativeDriver: true }),
          ]),
        ])
      ).start();

      Animated.loop(
        Animated.timing(rotate, { toValue: 1, duration: 8000, useNativeDriver: true })
      ).start();
    } else {
      pulse1.setValue(1);
      pulse2.setValue(1);
    }
  }, [active]);

  const rotateStr = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={orbStyles.wrapper}>
      {active && (
        <>
          <Animated.View style={[orbStyles.ring, { transform: [{ scale: pulse2 }], borderColor: color + '20' }]} />
          <Animated.View style={[orbStyles.ring, { width: 120, height: 120, borderRadius: 60, transform: [{ scale: pulse1 }], borderColor: color + '35' }]} />
        </>
      )}
      <Animated.View style={[orbStyles.orbit, { borderColor: color + '40', transform: [{ rotate: rotateStr }] }]} />
      <View style={[orbStyles.core, { shadowColor: color, backgroundColor: color + '15', borderColor: color + '60' }]}>
        <View style={[orbStyles.innerCore, { backgroundColor: color + '30' }]}>
          <Text style={[orbStyles.icon, { color }]}>◎</Text>
        </View>
      </View>
    </View>
  );
}

const orbStyles = StyleSheet.create({
  wrapper:   { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  ring:      { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 1 },
  orbit:     { position: 'absolute', width: 130, height: 130, borderRadius: 65, borderWidth: 1, borderStyle: 'dashed' },
  core:      { width: 80, height: 80, borderRadius: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 8 },
  innerCore: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  icon:      { fontSize: 28 },
});

// ── Feature toggle labels ─────────────────────────────────────────────────────

const FEATURE_LABELS: Record<keyof AIFeatures, { label: string; desc: string }> = {
  autoProtocol:        { label: 'Auto protocol selection',  desc: 'Switch protocols based on conditions' },
  smartReconnect:      { label: 'Smart reconnect',          desc: 'Reconnect automatically on drop' },
  domainRotation:      { label: 'Domain rotation',          desc: 'Rotate SNI to evade detection' },
  cdnFallback:         { label: 'CDN fallback',             desc: 'Use CDN edge if direct fails' },
  latencyAwareRouting: { label: 'Latency-aware routing',    desc: 'Route via lowest-latency path' },
};

// ── Screen ────────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

export function SmartAIScreen({ onNavigate, activeTab }: Props) {
  const { activeMode, features, liveLog, selectMode, toggleFeature, activeModeDef } = useAIStore();
  const mode = activeModeDef();

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Smart AI</Text>
            <Text style={styles.sub}>Adaptive protocol intelligence</Text>
          </View>
          <View style={[styles.aiBadge, { borderColor: mode.accentColor + '50' }]}>
            <View style={[styles.aiBadgeDot, { backgroundColor: mode.accentColor }]} />
            <Text style={[styles.aiBadgeText, { color: mode.accentColor }]}>Active</Text>
          </View>
        </View>

        {/* AI Orb */}
        <View style={styles.orbArea}>
          <AIOrb active color={mode.accentColor} />
          <View style={styles.orbLabels}>
            <Text style={[styles.activeMode, { color: mode.accentColor }]}>{mode.label} Mode</Text>
            <Text style={styles.orbDescription}>{mode.description}</Text>
          </View>
        </View>

        {/* Protocol chain */}
        <GlassCard glowColor={mode.accentColor}>
          <Text style={styles.cardLabel}>Active Protocol Chain</Text>
          <View style={styles.protoChain}>
            {mode.protocols.map((p, i) => (
              <React.Fragment key={p}>
                <View style={[styles.protoNode, { borderColor: mode.accentColor + '50' }]}>
                  <Text style={[styles.protoText, { color: mode.accentColor }]}>{p}</Text>
                </View>
                {i < mode.protocols.length - 1 && (
                  <Text style={styles.protoArrow}>→</Text>
                )}
              </React.Fragment>
            ))}
          </View>
        </GlassCard>

        {/* Mode selector grid */}
        <View>
          <Text style={styles.sectionTitle}>Connection Modes</Text>
          <View style={styles.modeGrid}>
            {AI_MODES.map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[
                  styles.modeCard,
                  activeMode === m.key && { borderColor: m.accentColor + '70', backgroundColor: m.accentColor + '0D' },
                ]}
                onPress={() => selectMode(m.key)}
                activeOpacity={0.75}
              >
                <Text style={[styles.modeIcon, { color: activeMode === m.key ? m.accentColor : Colors.text.muted }]}>
                  {m.icon}
                </Text>
                <Text style={[styles.modeLabel, { color: activeMode === m.key ? Colors.text.primary : Colors.text.secondary }]}>
                  {m.label}
                </Text>
                {activeMode === m.key && (
                  <View style={[styles.modeActiveDot, { backgroundColor: m.accentColor }]} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Feature toggles */}
        <GlassCard>
          <Text style={styles.cardLabel}>Intelligent Features</Text>
          {(Object.keys(FEATURE_LABELS) as (keyof AIFeatures)[]).map((key, i) => {
            const { label, desc } = FEATURE_LABELS[key];
            const on = features[key];
            return (
              <View key={key} style={[styles.toggleRow, i > 0 && styles.toggleRowBorder]}>
                <View style={styles.toggleLeft}>
                  <Text style={styles.toggleLabel}>{label}</Text>
                  <Text style={styles.toggleDesc}>{desc}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.toggle, on ? { backgroundColor: Colors.emerald[400] } : { backgroundColor: Colors.bg.elevated }]}
                  onPress={() => toggleFeature(key)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.toggleThumb, { transform: [{ translateX: on ? 16 : 0 }] }]} />
                </TouchableOpacity>
              </View>
            );
          })}
        </GlassCard>

        {/* Live decision log */}
        <View>
          <Text style={styles.sectionTitle}>Live Decisions</Text>
          <GlassCard noPadding>
            {liveLog.slice(0, 6).map((entry, i) => (
              <View key={entry.id} style={[styles.logRow, i < Math.min(liveLog.length, 6) - 1 && styles.logRowBorder]}>
                <View style={[
                  styles.logDot,
                  { backgroundColor: entry.level === 'success' ? Colors.emerald[400] : entry.level === 'warn' ? '#FFB800' : Colors.text.muted },
                ]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.logMsg}>{entry.message}</Text>
                  <Text style={styles.logTime}>{formatRelativeTime(new Date(entry.timestamp))}</Text>
                </View>
              </View>
            ))}
          </GlassCard>
        </View>

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:         { flex: 1, backgroundColor: Colors.bg.base },
  scroll:         { flex: 1 },
  content:        { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[5] },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:          { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  sub:            { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  aiBadge:        { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: Spacing[3], paddingVertical: 6, backgroundColor: Colors.bg.surface },
  aiBadgeDot:     { width: 6, height: 6, borderRadius: 3 },
  aiBadgeText:    { fontSize: Typography.size.xs, fontFamily: Typography.family.label, letterSpacing: 1, textTransform: 'uppercase' },
  orbArea:        { alignItems: 'center', gap: Spacing[4], paddingVertical: Spacing[4] },
  orbLabels:      { alignItems: 'center', gap: Spacing[1] },
  activeMode:     { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, letterSpacing: Typography.tracking.tight },
  orbDescription: { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  cardLabel:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[3] },
  protoChain:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing[2] },
  protoNode:      { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing[3], paddingVertical: Spacing[1], backgroundColor: Colors.bg.elevated },
  protoText:      { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, letterSpacing: 0.5 },
  protoArrow:     { fontSize: Typography.size.sm, color: Colors.text.muted },
  sectionTitle:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary, marginBottom: Spacing[3] },
  modeGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[3] },
  modeCard:       { width: '30%', backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, padding: Spacing[4], alignItems: 'center', gap: Spacing[1], position: 'relative' },
  modeIcon:       { fontSize: 24 },
  modeLabel:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, textAlign: 'center' },
  modeActiveDot:  { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3 },
  toggleRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3], gap: Spacing[3] },
  toggleRowBorder:{ borderTopWidth: 1, borderTopColor: Colors.border.subtle },
  toggleLeft:     { flex: 1, gap: 2 },
  toggleLabel:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.primary },
  toggleDesc:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  toggle:         { width: 40, height: 24, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 3 },
  toggleThumb:    { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.text.primary },
  logRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3], padding: Spacing[4] },
  logRowBorder:   { borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  logDot:         { width: 6, height: 6, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  logMsg:         { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  logTime:        { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 2 },
});
