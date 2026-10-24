import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import UserAvatar from '../components/UserAvatar';
import { AdBanner } from '../components/AdBanner';
import { BottomNav } from '../components/BottomNav';
import { useAuthStore }  from '../stores/authStore';
import { useInboxStore } from '../stores/inboxStore';
import { useDMStore }    from '../stores/dmStore';
import { useToastStore } from '../stores/toastStore';
import { useCallStore }  from '../stores/callStore';
import { CALLING_ENABLED } from '../config/featureFlags';
import { buildConversations } from '../utils/unifiedThreads';
import { buildCallLog, type CallLogEntry } from '../utils/callLog';
import { useT } from '../i18n';

const CORAL = '#FF858F';

interface Props {
  /** Open the DM thread for a call row (tap on the name). */
  onOpenChat: (threadKey: string) => void;
}

/**
 * Calls tab (Gold After Dark, v0.9.153). Real history only — read back from
 * the call-log DMs CallScreen already writes (see utils/callLog.ts), no
 * example rows and no invented online/presence state. Call-back buttons go
 * through the same callStore.startOutgoingCall path and the same
 * CALLING_ENABLED/plan gate as the chat thread header.
 */
export function CallsScreen({ onOpenChat }: Props) {
  const { t } = useT();
  const insets   = useSafeAreaInsets();
  const user     = useAuthStore((s) => s.user);
  const deviceId = user?.deviceId ?? '';
  const myId     = user?.userId ?? '';
  const dms           = useDMStore((s) => s.messages);
  const dmRefresh     = useDMStore((s) => s.refresh);
  const announcements = useInboxStore((s) => s.messages);
  const startCall     = useCallStore((s) => s.startOutgoingCall);
  const canCall = CALLING_ENABLED && (user?.plan !== 'free' || !!user?.testMode);

  useEffect(() => { if (deviceId) dmRefresh(deviceId).catch(() => {}); }, [deviceId, dmRefresh]);

  const supportName = t('dm.support');
  const entries = useMemo(
    () => buildCallLog(buildConversations(dms, announcements, supportName, myId)),
    [dms, announcements, supportName, myId],
  );

  const callBack = (e: CallLogEntry, video: boolean) => {
    if (!canCall) { useToastStore.getState().show(t('calls.notAvailable'), 'info'); return; }
    const c = e.conversation;
    startCall(c.peerDevice || c.peerUserId || '', c.title, video);
  };

  const statusLabel = (e: CallLogEntry) => {
    if (e.kind === 'missed') return e.direction === 'in' ? t('calls.missed') : t('calls.noAnswer');
    const kind = e.kind === 'video' ? t('calls.video') : t('calls.audio');
    const dir  = e.direction === 'in' ? t('calls.incoming') : t('calls.outgoing');
    return `${dir} · ${kind}${e.duration ? ` · ${e.duration}` : ''}`;
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('calls.title')}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: BottomNav.CONTENT_HEIGHT + insets.bottom + Spacing[4] }]}
        showsVerticalScrollIndicator={false}
      >
        <AdBanner show={user?.plan === 'free' || !!user?.testMode} slot="inbox_banner" style={styles.ad} />

        <Text style={styles.section}>{t('calls.recent')}</Text>

        {entries.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📞</Text>
            <Text style={styles.emptyTitle}>{t('calls.empty')}</Text>
            <Text style={styles.emptyText}>{t('calls.emptyHint')}</Text>
          </View>
        ) : entries.map((e) => {
          const missed = e.kind === 'missed' && e.direction === 'in';
          const initial = (e.conversation.title || '?').trim().charAt(0).toUpperCase();
          return (
            <View key={e.key} style={styles.row} testID={`call-${e.key}`}>
              <TouchableOpacity
                style={styles.rowMain}
                activeOpacity={0.75}
                onPress={() => onOpenChat(e.conversation.key)}
                accessibilityRole="button"
                accessibilityLabel={`${e.conversation.title}, ${statusLabel(e)}`}
              >
                <UserAvatar
                  seedId={e.conversation.peerDevice || e.conversation.title}
                  persona={e.conversation.peerPersona}
                  label={initial}
                  size={44}
                  color={Colors.violet[400]}
                />
                <View style={styles.rowText}>
                  <Text style={[styles.name, missed && { color: CORAL }]} numberOfLines={1}>{e.conversation.title}</Text>
                  <Text style={[styles.status, missed && { color: CORAL }]} numberOfLines={1}>
                    {e.direction === 'in' ? '↙ ' : '↗ '}{statusLabel(e)}
                  </Text>
                </View>
                <Text style={styles.time}>{e.createdAt.slice(5, 16)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.action} onPress={() => callBack(e, false)}
                accessibilityRole="button" accessibilityLabel={`${t('calls.audio')} ${e.conversation.title}`}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={styles.actionIcon}>📞</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.action} onPress={() => callBack(e, true)}
                accessibilityRole="button" accessibilityLabel={`${t('calls.video')} ${e.conversation.title}`}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={styles.actionIcon}>📹</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:     { flex: 1, backgroundColor: Colors.bg.base },
  header:     { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing[3] },
  title:      { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  scroll:     { flex: 1 },
  content:    { paddingHorizontal: Layout.screenPadding, gap: Spacing[2] },
  ad:         { marginBottom: Spacing[2] },
  section:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.secondary, marginTop: Spacing[1], marginBottom: Spacing[1] },
  empty:      { alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[10] },
  emptyIcon:  { fontSize: 40 },
  emptyTitle: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.text.primary },
  emptyText:  { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, textAlign: 'center', paddingHorizontal: Spacing[6] },
  row:        { flexDirection: 'row', alignItems: 'center', gap: Spacing[1], paddingVertical: Spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border.default },
  rowMain:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing[3], minHeight: 48 },
  avatar:     { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.bg.elevated, borderWidth: 2, borderColor: Colors.violet[400], alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.text.primary },
  rowText:    { flex: 1, minWidth: 0, gap: 2 },
  name:       { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  status:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary },
  time:       { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  action:     { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.bg.surface, alignItems: 'center', justifyContent: 'center' },
  actionIcon: { fontSize: 18 },
});
