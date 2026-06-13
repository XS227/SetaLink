import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore }  from '../stores/authStore';
import { useInboxStore } from '../stores/inboxStore';
import { useT } from '../i18n';

interface Props {
  onBack: () => void;
}

/**
 * Dedicated inbox — full list of admin announcements. The Profile screen only
 * shows a compact entry card with the unread badge; the real reading surface
 * (mark-read on tap, mark-all-read) lives here.
 */
export function InboxScreen({ onBack }: Props) {
  const { t } = useT();
  const user         = useAuthStore((s) => s.user);
  const messages     = useInboxStore((s) => s.messages);
  const markRead     = useInboxStore((s) => s.markRead);
  const markAllRead  = useInboxStore((s) => s.markAllRead);
  const refreshInbox = useInboxStore((s) => s.refresh);

  useEffect(() => {
    if (user?.deviceId) refreshInbox(user.deviceId).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deviceId   = user?.deviceId ?? '';
  const hasUnread  = messages.some(m => !m.read);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('pr.inbox')}</Text>
        {hasUnread ? (
          <TouchableOpacity
            style={styles.markAllBtn}
            activeOpacity={0.75}
            onPress={() => markAllRead(deviceId)}
          >
            <Text style={styles.markAllText}>{t('pr.markAllRead')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 ? (
          <GlassCard style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>{t('pr.inboxEmpty')}</Text>
          </GlassCard>
        ) : (
          messages.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.item, !m.read && styles.itemUnread]}
              activeOpacity={0.8}
              onPress={() => { if (!m.read) markRead(deviceId, m.id); }}
            >
              <View style={styles.itemHeader}>
                {!m.read && <View style={styles.dot} />}
                <Text style={[styles.itemTitle, !m.read && styles.itemTitleUnread]} numberOfLines={1}>
                  {m.title}
                </Text>
                <Text style={styles.itemDate}>{m.createdAt.slice(0, 10)}</Text>
              </View>
              <Text style={styles.itemBody}>{m.body}</Text>
              {!m.read && <Text style={styles.markHint}>{t('pr.tapToMarkRead')}</Text>}
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: Spacing[8] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: Colors.bg.base },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing[3] },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  backIcon:      { fontSize: 26, color: Colors.text.secondary, marginTop: -2 },
  title:         { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  markAllBtn:    { paddingHorizontal: Spacing[3], paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface },
  markAllText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  headerSpacer:  { width: 36 },
  scroll:        { flex: 1 },
  content:       { paddingHorizontal: Layout.screenPadding, gap: Spacing[3] },
  emptyCard:     { alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[8] },
  emptyIcon:     { fontSize: 40 },
  emptyText:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted },
  item:          { borderRadius: Radius.lg, padding: Spacing[4], backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.subtle, gap: 6 },
  itemUnread:    { borderColor: 'rgba(0,232,122,0.25)', backgroundColor: 'rgba(0,232,122,0.05)' },
  itemHeader:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.emerald[400] },
  itemTitle:     { flex: 1, fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  itemTitleUnread: { color: Colors.text.primary },
  itemDate:      { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  itemBody:      { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  markHint:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400], marginTop: 2 },
});
