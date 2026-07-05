/**
 * Advanced → VPS Helper (Case 2: server-side exit for the VPS/SSH workflow).
 *
 * For users who SSH into their OWN VPS with Termius and run tools like Claude
 * Code THERE. The backend provisions a dedicated, revocable ReaLink node
 * identity for this device and returns ONE install command to paste into the
 * VPS. Termius stays direct; only the tools the user points at the proxy
 * (HTTPS_PROXY) exit via ReaLink.
 *
 * This screen NEVER changes the VPN, Smart Mode, per-app bypass, or routes
 * Termius. It only calls the provisioning backend and shows the command.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Clipboard, Alert, ActivityIndicator,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { vpsHelperService, type VpsHelperState } from '../services/vpsHelperService';

export function VpsHelperScreen({ onBack }: { onBack?: () => void }) {
  const { t } = useT();
  const deviceId = useAuthStore.getState().user?.deviceId ?? '';
  const [state, setState] = useState<VpsHelperState>({ status: 'none' });
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    const s = await vpsHelperService.getStatus(deviceId);
    setState(s);
    return s;
  }, [deviceId]);

  useEffect(() => {
    refresh();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [refresh]);

  // While pending/revoking, poll until it settles.
  useEffect(() => {
    if (state.status === 'pending' || state.status === 'revoking') {
      if (!poll.current) poll.current = setInterval(refresh, 4000);
    } else if (poll.current) {
      clearInterval(poll.current); poll.current = null;
    }
  }, [state.status, refresh]);

  const onProvision = async () => {
    setBusy(true);
    const s = await vpsHelperService.provision(deviceId);
    setState(s);
    setBusy(false);
    if (s.status === 'error') Alert.alert(t('vps.errorTitle'), s.error ?? '');
  };

  const onRevoke = () => {
    Alert.alert(t('vps.revokeTitle'), t('vps.revokeConfirm'), [
      { text: t('sv.cancel'), style: 'cancel' },
      {
        text: t('vps.revoke'), style: 'destructive',
        onPress: async () => { setBusy(true); setState(await vpsHelperService.revoke(deviceId)); setBusy(false); },
      },
    ]);
  };

  const copyCmd = () => {
    if (state.installCommand) {
      Clipboard.setString(state.installCommand);
      Alert.alert(t('vps.copiedTitle'), t('vps.copiedBody'));
    }
  };

  const active = state.status === 'active';
  const working = state.status === 'pending' || state.status === 'revoking' || busy;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('vps.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>{t('vps.lead')}</Text>
        <Text style={styles.note}>{t('vps.note')}</Text>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>{t('vps.status')}</Text>
            <Text style={[styles.statusVal, active && { color: Colors.emerald[400] }]}>
              {t(`vps.state.${state.status}`)}
              {state.exitIp && active ? `  ·  ${state.node} (${state.exitIp})` : ''}
            </Text>
          </View>

          {working && (
            <View style={styles.pending}>
              <ActivityIndicator color={Colors.emerald[400]} />
              <Text style={styles.pendingText}>{t('vps.provisioning')}</Text>
            </View>
          )}

          {active && state.installCommand && (
            <>
              <Text style={styles.cmdLabel}>{t('vps.cmdLabel')}</Text>
              <View style={styles.cmdBox}>
                <Text style={styles.cmd} selectable numberOfLines={4}>{state.installCommand}</Text>
              </View>
              <TouchableOpacity style={styles.copyBtn} onPress={copyCmd}>
                <Text style={styles.copyText}>{t('vps.copy')}</Text>
              </TouchableOpacity>
              <Text style={styles.afterText}>{t('vps.after')}</Text>
            </>
          )}

          {!active && !working && (
            <TouchableOpacity style={styles.primaryBtn} onPress={onProvision} disabled={!deviceId}>
              <Text style={styles.primaryText}>{t('vps.request')}</Text>
            </TouchableOpacity>
          )}

          {(active || state.status === 'error') && (
            <TouchableOpacity style={styles.revokeBtn} onPress={onRevoke}>
              <Text style={styles.revokeText}>{t('vps.revoke')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.disclaimer}>{t('vps.disclaimer')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg.base },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[5], paddingTop: Spacing[12], paddingBottom: Spacing[4] },
  back: { color: Colors.text.primary, fontSize: 32, lineHeight: 32 },
  title: { color: Colors.text.primary, fontSize: Typography.size.xl, fontFamily: Typography.family.display },
  body: { padding: Spacing[5], paddingBottom: Spacing[16] },
  lead: { color: Colors.text.primary, fontSize: Typography.size.base, fontFamily: Typography.family.body, lineHeight: 22, marginBottom: Spacing[2] },
  note: { color: Colors.text.secondary, fontSize: Typography.size.sm, fontFamily: Typography.family.body, lineHeight: 20, marginBottom: Spacing[5] },
  card: { backgroundColor: Colors.bg.surface, borderRadius: Radius.lg, padding: Spacing[5],
    borderWidth: 1, borderColor: Colors.border.default },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { color: Colors.text.secondary, fontSize: Typography.size.sm },
  statusVal: { color: Colors.text.primary, fontSize: Typography.size.sm, fontFamily: Typography.family.mono },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: Spacing[4] },
  pendingText: { color: Colors.text.secondary, fontSize: Typography.size.sm },
  cmdLabel: { color: Colors.text.secondary, fontSize: Typography.size.sm, marginTop: Spacing[5], marginBottom: 6 },
  cmdBox: { backgroundColor: Colors.bg.void, borderRadius: Radius.md, padding: Spacing[4],
    borderWidth: 1, borderColor: Colors.border.default },
  cmd: { color: Colors.text.primary, fontFamily: Typography.family.mono, fontSize: 11 },
  copyBtn: { backgroundColor: Colors.emerald[400], borderRadius: Radius.md, paddingVertical: 12,
    alignItems: 'center', marginTop: Spacing[4] },
  copyText: { color: Colors.bg.void, fontWeight: '700', fontSize: Typography.size.base },
  afterText: { color: Colors.text.secondary, fontSize: Typography.size.sm, marginTop: Spacing[4], lineHeight: 20 },
  primaryBtn: { backgroundColor: Colors.emerald[400], borderRadius: Radius.md, paddingVertical: 14,
    alignItems: 'center', marginTop: Spacing[5] },
  primaryText: { color: Colors.bg.void, fontWeight: '700', fontSize: Typography.size.base },
  revokeBtn: { borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center', marginTop: Spacing[2] },
  revokeText: { color: Colors.status.disconnected, fontWeight: '600', fontSize: Typography.size.sm },
  disclaimer: { color: Colors.text.muted, fontSize: Typography.size.xs, lineHeight: 18, marginTop: Spacing[5] },
});
