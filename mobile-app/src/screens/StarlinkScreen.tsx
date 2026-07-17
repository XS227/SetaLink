import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useStarlinkStore } from '../stores/starlinkStore';
import { useAuthStore } from '../stores/authStore';
import type { StarlinkHealth } from '../services/api/starlink.api';
import { useT } from '../i18n';

/**
 * Dedicated Starlink Experience page (b97 addendum #2).
 *
 * Khabat: the user should think "how on earth can I connect to Starlink
 * through my phone?" — not "oh, another server." This page answers that:
 * status, unlock progression, why it's special, node health, and collapsible
 * advanced telemetry for power users. All data from /v1/starlink/unlock-status.
 */

interface Props {
  onBack:    () => void;
  onInvite:  () => void;
  onConnect: () => void;
  onUpgrade: () => void;
}

const HEALTH_STYLE: Record<StarlinkHealth, { color: string; key: string }> = {
  ONLINE:      { color: Colors.emerald[400],          key: 'sl.healthOnline' },
  DEGRADED:    { color: '#FFB800',                    key: 'sl.healthDegraded' },
  MAINTENANCE: { color: '#FFB800',                    key: 'sl.healthMaintenance' },
  OFFLINE:     { color: Colors.status.disconnected,   key: 'sl.healthOffline' },
};

function fmtUptime(secs: number | null | undefined): string {
  if (secs == null) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtKbps(kbps: number | null | undefined): string {
  if (kbps == null) return '—';
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}

export function StarlinkScreen({ onBack, onInvite, onConnect, onUpgrade }: Props) {
  const { t, isRTL } = useT();
  const status  = useStarlinkStore((s) => s.status);
  const refresh = useStarlinkStore((s) => s.refresh);
  const token   = useAuthStore((s) => s.token);
  const [showTelemetry, setShowTelemetry] = useState(false);

  useEffect(() => {
    if (token) refresh(token).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = status?.unlock;
  const node   = status?.node;
  const health = (node?.health ?? (node?.available ? 'ONLINE' : 'OFFLINE')) as StarlinkHealth;
  const hs     = HEALTH_STYLE[health] ?? HEALTH_STYLE.OFFLINE;
  const tel    = node?.telemetry;
  const invitesLeft = unlock ? Math.max(0, unlock.invitesRequired - unlock.invitesVerified) : 0;
  const progress    = unlock ? Math.min(1, unlock.invitesVerified / Math.max(1, unlock.invitesRequired)) : 0;

  const unlockedVia =
    unlock?.reason === 'premium'   ? t('sl.unlockedPremium') :
    unlock?.reason === 'test_mode' ? t('sl.unlockedTest') :
    unlock?.reason === 'invites'   ? t('sl.unlockedInvites') : '';

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, isRTL && styles.rtlRow]}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleBlock}>
            <Text style={[styles.headerTitle, isRTL && styles.rtlText]}>🛰️ {t('sl.title')}</Text>
            <Text style={[styles.headerSub, isRTL && styles.rtlText]}>{t('sl.poweredBy')}</Text>
          </View>
        </View>

        {/* Status */}
        <GlassCard glowColor={hs.color} style={styles.statusCard}>
          <View style={[styles.statusRow, isRTL && styles.rtlRow]}>
            <View style={[styles.healthDot, { backgroundColor: hs.color }]} />
            <Text style={[styles.statusText, { color: hs.color }]}>{t(hs.key)}</Text>
            {node?.country ? <Text style={styles.statusCountry}>· {node.country}</Text> : null}
          </View>
          {!node?.available && (
            <Text style={[styles.maintenanceNote, isRTL && styles.rtlText]}>{t('sl.maintenance')}</Text>
          )}
          {unlock?.unlocked && node?.available && (
            <TouchableOpacity style={styles.connectBtn} onPress={onConnect} activeOpacity={0.85}>
              <Text style={styles.connectBtnText}>{t('sl.connectCta')}</Text>
            </TouchableOpacity>
          )}
        </GlassCard>

        {/* Unlock progression */}
        <GlassCard style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('sl.accessTitle')}</Text>
          {unlock?.unlocked ? (
            <View style={[styles.unlockedRow, isRTL && styles.rtlRow]}>
              <Text style={styles.unlockedIcon}>✦</Text>
              <Text style={[styles.unlockedText, isRTL && styles.rtlText]}>{unlockedVia}</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.bodyText, isRTL && styles.rtlText]}>
                {t('sl.unlockHint').replace('{n}', String(unlock?.invitesRequired ?? 11))}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` as unknown as number }]} />
              </View>
              <View style={[styles.progressRow, isRTL && styles.rtlRow]}>
                <Text style={styles.progressLabel}>
                  🔥 {t('sl.friendsToGo').replace('{n}', String(invitesLeft))}
                </Text>
                <Text style={styles.progressCount}>
                  {unlock?.invitesVerified ?? 0} / {unlock?.invitesRequired ?? 11}
                </Text>
              </View>
              <View style={[styles.ctaRow, isRTL && styles.rtlRow]}>
                <TouchableOpacity style={[styles.cta, styles.ctaPrimary]} onPress={onInvite} activeOpacity={0.85}>
                  <Text style={styles.ctaPrimaryText}>{t('sl.inviteCta')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.cta, styles.ctaSecondary]} onPress={onUpgrade} activeOpacity={0.85}>
                  <Text style={styles.ctaSecondaryText}>⭐ {t('sl.premiumCta')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </GlassCard>

        {/* Why this is special */}
        <GlassCard style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('sl.whyTitle')}</Text>
          {(['sl.why1', 'sl.why2', 'sl.why3'] as const).map((k) => (
            <View key={k} style={[styles.whyRow, isRTL && styles.rtlRow]}>
              <Text style={styles.whyIcon}>{k === 'sl.why1' ? '🛰️' : k === 'sl.why2' ? '🌍' : '🔥'}</Text>
              <Text style={[styles.bodyText, styles.whyText, isRTL && styles.rtlText]}>{t(k)}</Text>
            </View>
          ))}
        </GlassCard>

        {/* Advanced telemetry — collapsible, power users only */}
        <TouchableOpacity
          style={styles.telemetryToggle}
          onPress={() => setShowTelemetry((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={styles.telemetryToggleText}>
            {showTelemetry ? '▾' : '▸'} {t('sl.telemetryTitle')}
          </Text>
        </TouchableOpacity>

        {showTelemetry && (
          <GlassCard style={styles.sectionCard}>
            {tel ? (
              <>
                {([
                  ['sl.telLatency',   tel.latencyMs != null ? `${tel.latencyMs} ms` : '—'],
                  ['sl.telLoss',      tel.packetLossPct != null ? `${tel.packetLossPct.toFixed(1)} %` : '—'],
                  ['sl.telUptime',    fmtUptime(tel.uptimeSecs)],
                  ['sl.telDownload',  fmtKbps(tel.downloadKbps)],
                  ['sl.telUpload',    fmtKbps(tel.uploadKbps)],
                  ['sl.telSessions',  `${tel.sessions} / ${node?.maxSessions ?? '—'}`],
                  ['sl.telHeartbeat', tel.lastHeartbeatAgeSecs != null ? `${tel.lastHeartbeatAgeSecs}s` : '—'],
                ] as Array<[string, string]>).map(([k, v]) => (
                  <View key={k} style={styles.telRow}>
                    <Text style={styles.telKey}>{t(k)}</Text>
                    <Text style={styles.telVal}>{v}</Text>
                  </View>
                ))}
                <Text style={[styles.telHint, isRTL && styles.rtlText]}>{t('sl.telemetryHint')}</Text>
              </>
            ) : (
              <Text style={styles.bodyText}>—</Text>
            )}
          </GlassCard>
        )}

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>
    </View>
  );
}

const GOLD = Colors.gold[400];

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.base },
  scroll:  { flex: 1 },
  content: { paddingTop: Layout.statusBarHeight, paddingHorizontal: Layout.screenPadding, gap: Spacing[4] },

  header:           { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingTop: Spacing[2] },
  rtlRow:           { flexDirection: 'row-reverse' },
  rtlText:          { textAlign: 'right', writingDirection: 'rtl' },
  backBtn:          { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  backIcon:         { fontSize: 22, color: Colors.text.secondary, marginTop: -2 },
  headerTitleBlock: { flex: 1 },
  headerTitle:      { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.gold[300], letterSpacing: 1.5 },
  headerSub:        { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 1, textTransform: 'uppercase', marginTop: 1 },

  statusCard:      { gap: Spacing[3] },
  statusRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  healthDot:       { width: 10, height: 10, borderRadius: 5 },
  statusText:      { fontSize: Typography.size.md, fontFamily: Typography.family.heading, letterSpacing: 0.5 },
  statusCountry:   { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary },
  maintenanceNote: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#FFB800', lineHeight: 17 },
  connectBtn:      { backgroundColor: GOLD, borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  connectBtnText:  { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: 0.5 },

  sectionCard:  { gap: Spacing[3] },
  sectionTitle: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1.5 },
  bodyText:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },

  unlockedRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  unlockedIcon: { fontSize: 18, color: Colors.gold[300] },
  unlockedText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.gold[300] },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(212,175,55,0.15)', overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3, backgroundColor: GOLD },
  progressRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.gold[300] },
  progressCount: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },

  ctaRow:           { flexDirection: 'row', gap: Spacing[3] },
  cta:              { flex: 1, borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center', borderWidth: 1 },
  ctaPrimary:       { backgroundColor: 'rgba(212,175,55,0.16)', borderColor: 'rgba(212,175,55,0.55)' },
  ctaPrimaryText:   { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.gold[300] },
  ctaSecondary:     { backgroundColor: Colors.bg.surface, borderColor: Colors.border.default },
  ctaSecondaryText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.secondary },

  whyRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3] },
  whyIcon: { fontSize: 18, marginTop: 1 },
  whyText: { flex: 1 },

  telemetryToggle:     { paddingVertical: Spacing[1], paddingHorizontal: Spacing[1] },
  telemetryToggleText: { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 0.5 },
  telRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  telKey:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted },
  telVal:  { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  telHint: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, fontStyle: 'italic', marginTop: Spacing[1] },
});
