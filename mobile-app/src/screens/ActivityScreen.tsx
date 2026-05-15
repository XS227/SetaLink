/**
 * Activity Screen — Connection Logs
 *
 * Shows:
 *   - Traffic chart (sparkline)
 *   - Today's summary
 *   - Connection log timeline
 */

import React from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';

interface LogEntry {
  id: string;
  server: string;
  flag: string;
  protocol: string;
  duration: string;
  upload: string;
  download: string;
  time: string;
  status: 'success' | 'dropped' | 'timeout';
}

const LOGS: LogEntry[] = [
  { id: '1', server: 'Frankfurt, DE', flag: '🇩🇪', protocol: 'VLESS·Reality',   duration: '2h 34m', upload: '1.2 GB', download: '4.8 GB', time: '11:48', status: 'success' },
  { id: '2', server: 'Amsterdam, NL', flag: '🇳🇱', protocol: 'WebSocket',        duration: '0h 12m', upload: '0.1 GB', download: '0.4 GB', time: '09:31', status: 'success' },
  { id: '3', server: 'Paris, FR',     flag: '🇫🇷', protocol: 'Reality·Stealth',  duration: '0h 03m', upload: '0.0 GB', download: '0.0 GB', time: 'Yesterday', status: 'dropped' },
  { id: '4', server: 'Singapore, SG', flag: '🇸🇬', protocol: 'VLESS',            duration: '1h 02m', upload: '0.5 GB', download: '2.1 GB', time: 'Yesterday', status: 'success' },
  { id: '5', server: 'New York, US',  flag: '🇺🇸', protocol: 'WebSocket',        duration: '0h 01m', upload: '0.0 GB', download: '0.0 GB', time: 'Mon',      status: 'timeout' },
  { id: '6', server: 'London, UK',    flag: '🇬🇧', protocol: 'VLESS·Reality',   duration: '3h 11m', upload: '2.0 GB', download: '7.2 GB', time: 'Mon',      status: 'success' },
];

// Fake sparkline data (hourly Mbps)
const SPARK = [2, 5, 12, 8, 3, 18, 24, 19, 14, 22, 17, 9, 6, 11, 15, 21, 28, 23, 19, 16, 12, 8, 4, 7];
const SPARK_MAX = Math.max(...SPARK);

function Sparkline() {
  const BAR_WIDTH = 8;
  const BAR_GAP   = 3;
  const HEIGHT    = 56;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: HEIGHT, gap: BAR_GAP }}>
      {SPARK.map((v, i) => {
        const h = Math.max(4, (v / SPARK_MAX) * HEIGHT);
        const isHigh = v > SPARK_MAX * 0.7;
        return (
          <View
            key={i}
            style={{
              width: BAR_WIDTH,
              height: h,
              borderRadius: 3,
              backgroundColor: isHigh
                ? Colors.emerald[400]
                : 'rgba(0,232,122,0.25)',
            }}
          />
        );
      })}
    </View>
  );
}

const STATUS_COLOR: Record<string, string> = {
  success: Colors.emerald[400],
  dropped: '#FFB800',
  timeout: Colors.status.disconnected,
};
const STATUS_LABEL: Record<string, string> = {
  success: 'OK',
  dropped: 'Drop',
  timeout: 'Timeout',
};

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab: NavTab;
}

export function ActivityScreen({ onNavigate, activeTab }: Props) {
  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Activity</Text>
          <Text style={styles.date}>Today, 15 May</Text>
        </View>

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          {[
            { label: 'Total Data',  value: '6.0 GB',  accent: true },
            { label: 'Sessions',    value: '6',        accent: false },
            { label: 'Total Time',  value: '7h 03m',  accent: false },
          ].map(item => (
            <GlassCard
              key={item.label}
              style={styles.summaryCard}
              glowColor={item.accent ? Colors.emerald[400] : undefined}
            >
              <Text style={[styles.summaryValue, item.accent && styles.summaryAccent]}>
                {item.value}
              </Text>
              <Text style={styles.summaryLabel}>{item.label}</Text>
            </GlassCard>
          ))}
        </View>

        {/* Traffic chart */}
        <GlassCard>
          <View style={styles.chartHeader}>
            <Text style={styles.cardLabel}>Bandwidth · Today</Text>
            <Text style={styles.chartPeak}>Peak 28 MB/s</Text>
          </View>
          <Sparkline />
          <View style={styles.chartXAxis}>
            {['00', '06', '12', '18', '24'].map(h => (
              <Text key={h} style={styles.chartXLabel}>{h}h</Text>
            ))}
          </View>
        </GlassCard>

        {/* Log timeline */}
        <View>
          <Text style={styles.sectionTitle}>Connection Log</Text>

          {LOGS.map((log, i) => (
            <View key={log.id}>
              {/* Date separator */}
              {(i === 0 || LOGS[i - 1].time !== log.time) && (
                <Text style={styles.dateSep}>{log.time}</Text>
              )}

              <View style={styles.logRow}>
                {/* Left timeline */}
                <View style={styles.timeline}>
                  <View style={[styles.timelineDot, { backgroundColor: STATUS_COLOR[log.status] }]} />
                  {i < LOGS.length - 1 && <View style={styles.timelineLine} />}
                </View>

                {/* Content */}
                <GlassCard style={styles.logCard}>
                  <View style={styles.logTop}>
                    <View style={styles.logLeft}>
                      <Text style={styles.logFlag}>{log.flag}</Text>
                      <View>
                        <Text style={styles.logServer}>{log.server}</Text>
                        <Text style={styles.logProtocol}>{log.protocol}</Text>
                      </View>
                    </View>
                    <View style={[
                      styles.statusPill,
                      { backgroundColor: STATUS_COLOR[log.status] + '18',
                        borderColor: STATUS_COLOR[log.status] + '40' },
                    ]}>
                      <Text style={[styles.statusText, { color: STATUS_COLOR[log.status] }]}>
                        {STATUS_LABEL[log.status]}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.logMeta}>
                    <Text style={styles.metaItem}>⏱ {log.duration}</Text>
                    <Text style={styles.metaDivider}>·</Text>
                    <Text style={styles.metaItem}>↑ {log.upload}</Text>
                    <Text style={styles.metaDivider}>·</Text>
                    <Text style={styles.metaItem}>↓ {log.download}</Text>
                  </View>
                </GlassCard>
              </View>
            </View>
          ))}
        </View>

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
  scroll: { flex: 1 },
  content: {
    paddingTop: Layout.statusBarHeight + Spacing[2],
    paddingHorizontal: Layout.screenPadding,
    gap: Spacing[5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: Typography.size['2xl'],
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  date: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing[2],
  },
  summaryValue: {
    fontSize: Typography.size.lg,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  summaryAccent: {
    color: Colors.emerald[400],
  },
  summaryLabel: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    textAlign: 'center',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[3],
  },
  cardLabel: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartPeak: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.emerald[400],
  },
  chartXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing[2],
  },
  chartXLabel: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  sectionTitle: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    marginBottom: Spacing[3],
  },
  dateSep: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing[2],
    marginLeft: 32,
  },
  logRow: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginBottom: Spacing[2],
  },
  timeline: {
    width: 20,
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 20,
    flexShrink: 0,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: Colors.border.subtle,
    marginTop: 4,
  },
  logCard: {
    flex: 1,
    gap: Spacing[2],
  },
  logTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  logFlag: {
    fontSize: 22,
  },
  logServer: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  logProtocol: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  statusPill: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    letterSpacing: 0.5,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaItem: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  metaDivider: {
    color: Colors.text.muted,
    fontSize: Typography.size.xs,
  },
});
