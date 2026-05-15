/**
 * Diagnostics Screen
 *
 * Premium technical view:
 *   - Real-time metrics grid
 *   - Protocol chain visualization
 *   - CDN / TLS health indicators
 *   - Route hop list
 *   - Domain health checks
 *   - Export logs button
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Animated, TouchableOpacity,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';

function PulsingDot({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.6, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute',
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: color,
        opacity: pulse.interpolate({ inputRange: [1, 1.6], outputRange: [0.3, 0] }),
        transform: [{ scale: pulse }],
      }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

function MetricCard({
  label, value, unit, sub, color,
}: {
  label: string; value: string; unit?: string; sub?: string; color?: string;
}) {
  return (
    <GlassCard style={metStyles.card}>
      <Text style={metStyles.label}>{label}</Text>
      <Text style={[metStyles.value, color ? { color } : {}]}>
        {value}
        {unit && <Text style={metStyles.unit}> {unit}</Text>}
      </Text>
      {sub && <Text style={metStyles.sub}>{sub}</Text>}
    </GlassCard>
  );
}

const metStyles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 4,
    minWidth: '46%',
  },
  label: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    fontSize: Typography.size['2xl'],
    fontFamily: Typography.family.mono,
    color: Colors.text.primary,
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  sub: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
  },
});

function HealthRow({ label, status, detail }: { label: string; status: 'ok' | 'warn' | 'fail'; detail: string }) {
  const color =
    status === 'ok'   ? Colors.emerald[400] :
    status === 'warn' ? '#FFB800' :
    Colors.status.disconnected;
  const text =
    status === 'ok'   ? 'Healthy' :
    status === 'warn' ? 'Degraded' : 'Failed';

  return (
    <View style={healthStyles.row}>
      <PulsingDot color={color} />
      <View style={healthStyles.info}>
        <Text style={healthStyles.label}>{label}</Text>
        <Text style={healthStyles.detail}>{detail}</Text>
      </View>
      <View style={[healthStyles.badge, { backgroundColor: color + '18', borderColor: color + '40' }]}>
        <Text style={[healthStyles.badgeText, { color }]}>{text}</Text>
      </View>
    </View>
  );
}

const healthStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
  },
  info: { flex: 1 },
  label: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    color: Colors.text.primary,
  },
  detail: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
    marginTop: 2,
  },
  badge: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing[3],
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    letterSpacing: 0.5,
  },
});

const HOPS = [
  { hop: 1, ip: '10.0.0.1',       rtt: '1ms',   label: 'Local Gateway' },
  { hop: 2, ip: '185.220.101.34', rtt: '8ms',   label: 'ISP Transit' },
  { hop: 3, ip: '104.26.12.55',   rtt: '14ms',  label: 'CDN Edge (CF)' },
  { hop: 4, ip: '5.180.62.12',    rtt: '22ms',  label: 'SetaLink DE·01' },
  { hop: 5, ip: '0.0.0.0',        rtt: '—',     label: 'Destination (hidden)' },
];

export function DiagnosticsScreen() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

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
            <Text style={styles.title}>Diagnostics</Text>
            <Text style={styles.sub}>Live connection analysis</Text>
          </View>
          <View style={styles.liveBadge}>
            <PulsingDot color={Colors.emerald[400]} />
            <Text style={styles.liveText}>LIVE · {fmt(elapsed)}</Text>
          </View>
        </View>

        {/* Metric grid */}
        <View style={styles.metricGrid}>
          <MetricCard
            label="Latency"
            value="24"
            unit="ms"
            sub="Excellent"
            color={Colors.emerald[400]}
          />
          <MetricCard
            label="Packet Loss"
            value="0.0"
            unit="%"
            sub="No loss detected"
            color={Colors.emerald[400]}
          />
          <MetricCard
            label="Jitter"
            value="2.1"
            unit="ms"
            sub="Very stable"
          />
          <MetricCard
            label="Uptime"
            value={fmt(elapsed + 9450)}
            sub="This session"
          />
        </View>

        {/* Protocol & route info */}
        <GlassCard glowColor={Colors.emerald[400]}>
          <Text style={styles.cardLabel}>Active Connection</Text>

          {[
            { key: 'Protocol',     val: 'VLESS + Reality' },
            { key: 'Transport',    val: 'TCP (XHTTP)' },
            { key: 'Server SNI',   val: 'cdn.setalink.net' },
            { key: 'Destination',  val: '5.180.62.12:443' },
            { key: 'TLS Version',  val: 'TLS 1.3' },
            { key: 'Cipher',       val: 'TLS_AES_256_GCM_SHA384' },
            { key: 'ALPN',         val: 'h2, http/1.1' },
          ].map(item => (
            <View key={item.key} style={styles.infoRow}>
              <Text style={styles.infoKey}>{item.key}</Text>
              <Text style={styles.infoVal}>{item.val}</Text>
            </View>
          ))}
        </GlassCard>

        {/* TLS / CDN health */}
        <GlassCard>
          <Text style={styles.cardLabel}>Health Checks</Text>
          <HealthRow label="TLS Certificate"    status="ok"   detail="Valid · Expires 2027-03-01" />
          <HealthRow label="CDN Edge (DE)"      status="ok"   detail="Cloudflare · 104.26.12.55" />
          <HealthRow label="SNI Consistency"    status="ok"   detail="cdn.setalink.net ↔ cert match" />
          <HealthRow label="Domain Health"      status="ok"   detail="setalink.net · A record live" />
          <HealthRow label="Fallback Domain"    status="warn" detail="alt.setalink.io · slow response" />
          <HealthRow label="DNS Resolution"     status="ok"   detail="Cloudflare DoH · 1ms" />
          <View style={{ height: 1 }} />
        </GlassCard>

        {/* Route trace */}
        <View>
          <Text style={styles.sectionTitle}>Route Trace</Text>
          <GlassCard noPadding>
            {HOPS.map((hop, i) => (
              <View key={hop.hop} style={[
                styles.hopRow,
                i < HOPS.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
              ]}>
                <View style={[
                  styles.hopNum,
                  i === HOPS.length - 1 && { opacity: 0.4 },
                ]}>
                  <Text style={styles.hopNumText}>{hop.hop}</Text>
                </View>

                {/* Connector line */}
                <View style={styles.hopConnector}>
                  <View style={styles.hopLine} />
                  <View style={[
                    styles.hopDot,
                    { backgroundColor: i === 3
                      ? Colors.emerald[400]
                      : Colors.text.muted + '80' },
                  ]} />
                </View>

                <View style={styles.hopInfo}>
                  <Text style={styles.hopLabel}>{hop.label}</Text>
                  <Text style={styles.hopIp}>{hop.ip}</Text>
                </View>

                <Text style={[
                  styles.hopRtt,
                  { color: hop.rtt === '—' ? Colors.text.muted : Colors.emerald[400] },
                ]}>
                  {hop.rtt}
                </Text>
              </View>
            ))}
          </GlassCard>
        </View>

        {/* Throughput mini chart */}
        <GlassCard>
          <Text style={styles.cardLabel}>Real-time Throughput</Text>
          <View style={styles.throughputRow}>
            <View style={styles.throughputItem}>
              <Text style={styles.throughputIcon}>↑</Text>
              <View style={styles.throughputBar}>
                <View style={[styles.throughputFill, {
                  width: '23%',
                  backgroundColor: Colors.emerald[400],
                }]} />
              </View>
              <Text style={styles.throughputVal}>4.2 MB/s</Text>
            </View>
            <View style={styles.throughputItem}>
              <Text style={[styles.throughputIcon, { color: Colors.blue[400] }]}>↓</Text>
              <View style={styles.throughputBar}>
                <View style={[styles.throughputFill, {
                  width: '67%',
                  backgroundColor: Colors.blue[400],
                }]} />
              </View>
              <Text style={styles.throughputVal}>18.7 MB/s</Text>
            </View>
          </View>
        </GlassCard>

        {/* Export */}
        <TouchableOpacity style={styles.exportBtn} activeOpacity={0.8}>
          <Text style={styles.exportText}>Export Diagnostic Report</Text>
        </TouchableOpacity>

        <View style={{ height: Spacing[12] }} />
      </ScrollView>
    </View>
  );
}

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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: Typography.size['2xl'],
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  sub: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    marginTop: 2,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border.glow,
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
  },
  liveText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.emerald[400],
    letterSpacing: 1,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
  cardLabel: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing[3],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing[2] + 1,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
  },
  infoKey: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
  },
  infoVal: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.mono,
    color: Colors.text.secondary,
    textAlign: 'right',
    maxWidth: '60%',
  },
  sectionTitle: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    marginBottom: Spacing[3],
  },
  hopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    gap: Spacing[3],
  },
  hopNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.bg.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  hopNumText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  hopConnector: {
    alignItems: 'center',
    flexShrink: 0,
  },
  hopLine: {
    position: 'absolute',
    width: 1,
    height: 40,
    backgroundColor: Colors.border.subtle,
    top: -20,
  },
  hopDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  hopInfo: { flex: 1 },
  hopLabel: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    color: Colors.text.primary,
  },
  hopIp: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
    marginTop: 2,
  },
  hopRtt: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.mono,
  },
  throughputRow: {
    gap: Spacing[3],
  },
  throughputItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  throughputIcon: {
    fontSize: Typography.size.lg,
    color: Colors.emerald[400],
    width: 20,
    textAlign: 'center',
  },
  throughputBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.bg.elevated,
    overflow: 'hidden',
  },
  throughputFill: {
    height: '100%',
    borderRadius: 3,
  },
  throughputVal: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.mono,
    color: Colors.text.secondary,
    width: 80,
    textAlign: 'right',
  },
  exportBtn: {
    borderWidth: 1,
    borderColor: Colors.border.glow,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[4],
    alignItems: 'center',
    backgroundColor: 'rgba(0,232,122,0.05)',
  },
  exportText: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    color: Colors.emerald[400],
    letterSpacing: 0.5,
  },
});
