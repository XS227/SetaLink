import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { useSessionStore } from '../stores/sessionStore';
import { formatBytes, formatDuration } from '../utils/formatters';
import { useT } from '../i18n';

function groupLabel(ts: number, todayStr: string, yesterdayStr: string): string {
  const d         = new Date(ts);
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())     return todayStr;
  if (d.toDateString() === yesterday.toDateString()) return yesterdayStr;
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function Sparkline({ data }: { data: number[] }) {
  const BAR_WIDTH = 8;
  const BAR_GAP   = 3;
  const HEIGHT    = 56;
  const max       = Math.max(...data, 1);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: HEIGHT, gap: BAR_GAP }}>
      {data.map((v, i) => {
        const h      = Math.max(4, (v / max) * HEIGHT);
        const isHigh = v > max * 0.7;
        return (
          <View
            key={i}
            style={{
              width:           BAR_WIDTH,
              height:          h,
              borderRadius:    3,
              backgroundColor: isHigh ? Colors.emerald[400] : 'rgba(0,232,122,0.25)',
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
  activeTab:  NavTab;
}

export function ActivityScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const { sessions, sessionsToday, totalBytesToday, totalDurationToday, hourlyDownload } =
    useSessionStore();

  const today      = sessionsToday();
  const totalBytes = totalBytesToday();
  const totalDur   = totalDurationToday();
  const spark      = hourlyDownload();
  const peakMb     = Math.max(...spark, 0);

  const todayLabel     = t('ac.today');
  const yesterdayLabel = t('ac.yesterday');

  const dateHeader = useMemo(() => {
    const d = new Date();
    return `${todayLabel}, ${d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`;
  }, [todayLabel]);

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('ac.title')}</Text>
          <Text style={styles.date}>{dateHeader}</Text>
        </View>

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          {[
            { label: t('ac.totalData'), value: formatBytes(totalBytes), accent: true },
            { label: t('ac.sessions'), value: String(today.length),    accent: false },
            { label: t('ac.totalTime'), value: formatDuration(totalDur), accent: false },
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
            <Text style={styles.cardLabel}>{t('ac.bandwidth')}</Text>
            <Text style={styles.chartPeak}>
              {peakMb > 0 ? `${t('ac.peak')} ${peakMb.toFixed(0)} MB` : t('ac.noPeak')}
            </Text>
          </View>
          <Sparkline data={spark} />
          <View style={styles.chartXAxis}>
            {['00', '06', '12', '18', '24'].map(h => (
              <Text key={h} style={styles.chartXLabel}>{h}h</Text>
            ))}
          </View>
        </GlassCard>

        {/* Log timeline */}
        <View>
          <Text style={styles.sectionTitle}>{t('ac.connLog')}</Text>

          {sessions.length === 0 ? (
            <GlassCard>
              <Text style={styles.emptyText}>{t('ac.noSessions')}</Text>
            </GlassCard>
          ) : (
            sessions.map((session, i) => {
              const label     = groupLabel(session.startedAt, todayLabel, yesterdayLabel);
              const prevLabel = i > 0 ? groupLabel(sessions[i - 1].startedAt, todayLabel, yesterdayLabel) : null;
              const showSep   = i === 0 || label !== prevLabel;

              return (
                <View key={session.id}>
                  {showSep && <Text style={styles.dateSep}>{label}</Text>}

                  <View style={styles.logRow}>
                    <View style={styles.timeline}>
                      <View style={[styles.timelineDot, { backgroundColor: STATUS_COLOR[session.status] }]} />
                      {i < sessions.length - 1 && <View style={styles.timelineLine} />}
                    </View>

                    <GlassCard style={styles.logCard}>
                      <View style={styles.logTop}>
                        <View style={styles.logLeft}>
                          <Text style={styles.logFlag}>{session.serverFlag}</Text>
                          <View>
                            <Text style={styles.logServer}>{session.serverName}</Text>
                            <Text style={styles.logProtocol}>{session.protocol}</Text>
                          </View>
                        </View>
                        <View style={[
                          styles.statusPill,
                          {
                            backgroundColor: STATUS_COLOR[session.status] + '18',
                            borderColor:     STATUS_COLOR[session.status] + '40',
                          },
                        ]}>
                          <Text style={[styles.statusText, { color: STATUS_COLOR[session.status] }]}>
                            {STATUS_LABEL[session.status]}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.logMeta}>
                        <Text style={styles.metaItem}>⏱ {formatDuration(session.duration)}</Text>
                        <Text style={styles.metaDivider}>·</Text>
                        <Text style={styles.metaItem}>↑ {formatBytes(session.sentBytes)}</Text>
                        <Text style={styles.metaDivider}>·</Text>
                        <Text style={styles.metaItem}>↓ {formatBytes(session.recvBytes)}</Text>
                        <Text style={styles.metaDivider}>·</Text>
                        <Text style={styles.metaItem}>{timeLabel(session.startedAt)}</Text>
                      </View>
                    </GlassCard>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: Colors.bg.base,
  },
  scroll:  { flex: 1 },
  content: {
    paddingTop:        Layout.statusBarHeight + Spacing[2],
    paddingHorizontal: Layout.screenPadding,
    gap:               Spacing[5],
  },
  header: {
    flexDirection:  'row',
    alignItems:     'baseline',
    justifyContent: 'space-between',
  },
  title: {
    fontSize:      Typography.size['2xl'],
    fontFamily:    Typography.family.heading,
    color:         Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  date: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
  },
  summaryRow: {
    flexDirection: 'row',
    gap:           Spacing[3],
  },
  summaryCard: {
    flex:             1,
    alignItems:       'center',
    gap:              4,
    paddingHorizontal: Spacing[2],
  },
  summaryValue: {
    fontSize:   Typography.size.lg,
    fontFamily: Typography.family.heading,
    color:      Colors.text.primary,
  },
  summaryAccent: {
    color: Colors.emerald[400],
  },
  summaryLabel: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
    textAlign:  'center',
  },
  chartHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   Spacing[3],
  },
  cardLabel: {
    fontSize:      Typography.size.xs,
    fontFamily:    Typography.family.label,
    color:         Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartPeak: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.mono,
    color:      Colors.emerald[400],
  },
  chartXAxis: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginTop:      Spacing[2],
  },
  chartXLabel: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.mono,
    color:      Colors.text.muted,
  },
  sectionTitle: {
    fontSize:     Typography.size.base,
    fontFamily:   Typography.family.heading,
    color:        Colors.text.primary,
    marginBottom: Spacing[3],
  },
  emptyText: {
    fontSize:        Typography.size.sm,
    fontFamily:      Typography.family.body,
    color:           Colors.text.muted,
    textAlign:       'center',
    paddingVertical: Spacing[4],
  },
  dateSep: {
    fontSize:      Typography.size.xs,
    fontFamily:    Typography.family.label,
    color:         Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom:  Spacing[2],
    marginLeft:    32,
  },
  logRow: {
    flexDirection: 'row',
    gap:           Spacing[3],
    marginBottom:  Spacing[2],
  },
  timeline: {
    width:      20,
    alignItems: 'center',
  },
  timelineDot: {
    width:        10,
    height:       10,
    borderRadius: 5,
    marginTop:    20,
    flexShrink:   0,
  },
  timelineLine: {
    flex:            1,
    width:           1,
    backgroundColor: Colors.border.subtle,
    marginTop:       4,
  },
  logCard: {
    flex: 1,
    gap:  Spacing[2],
  },
  logTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  logLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing[2],
  },
  logFlag: {
    fontSize: 22,
  },
  logServer: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.heading,
    color:      Colors.text.primary,
  },
  logProtocol: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.mono,
    color:      Colors.text.muted,
  },
  statusPill: {
    borderRadius:     Radius.full,
    borderWidth:      1,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  statusText: {
    fontSize:      Typography.size.xs,
    fontFamily:    Typography.family.label,
    letterSpacing: 0.5,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    flexWrap:      'wrap',
  },
  metaItem: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.mono,
    color:      Colors.text.muted,
  },
  metaDivider: {
    color:    Colors.text.muted,
    fontSize: Typography.size.xs,
  },
});
