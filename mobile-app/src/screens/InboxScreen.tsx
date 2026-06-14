import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore }  from '../stores/authStore';
import { useInboxStore } from '../stores/inboxStore';
import { useDMStore }    from '../stores/dmStore';
import { useToastStore } from '../stores/toastStore';
import { DM_MAX_LEN } from '../services/entitlementService';
import { useT } from '../i18n';

interface Props {
  onBack: () => void;
}

type Tab = 'direct' | 'announce';

/**
 * Inbox — two surfaces:
 *   • Messages     — user-to-user direct messages (v0.9.33), addressed by
 *                    SetaLink ID. Compose via the + button.
 *   • Announcements — admin broadcast/announcement center (existing).
 */
export function InboxScreen({ onBack }: Props) {
  const { t } = useT();
  const user        = useAuthStore((s) => s.user);
  const deviceId    = user?.deviceId ?? '';
  const myId        = user?.userId ?? '';

  // Direct messages
  const dms         = useDMStore((s) => s.messages);
  const dmRefresh   = useDMStore((s) => s.refresh);
  const dmSend      = useDMStore((s) => s.send);
  const dmMarkRead  = useDMStore((s) => s.markRead);
  const sending     = useDMStore((s) => s.sending);

  // Admin announcements
  const messages     = useInboxStore((s) => s.messages);
  const markRead     = useInboxStore((s) => s.markRead);
  const markAllRead  = useInboxStore((s) => s.markAllRead);
  const refreshInbox = useInboxStore((s) => s.refresh);

  const [tab, setTab]             = useState<Tab>('direct');
  const [composeOpen, setCompose] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [draft, setDraft]         = useState('');

  useEffect(() => {
    if (!deviceId) return;
    dmRefresh(deviceId).catch(() => {});
    refreshInbox(deviceId).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const announceUnread = messages.some(m => !m.read);

  const submit = async () => {
    const to = recipient.trim();
    const body = draft.trim();
    if (!to)   { Alert.alert('', t('dm.recipientRequired')); return; }
    if (!body) { Alert.alert('', t('dm.messageRequired'));   return; }
    try {
      await dmSend(deviceId, to, body);
      setCompose(false);
      setRecipient('');
      setDraft('');
      useToastStore.getState().show(`✅ ${t('dm.sentToast')}`, 'success');
    } catch (e: any) {
      Alert.alert('', String(e?.message ?? 'Error'));
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('pr.inbox')}</Text>
        {tab === 'direct' ? (
          <TouchableOpacity style={styles.newBtn} activeOpacity={0.8} onPress={() => setCompose(true)}>
            <Text style={styles.newBtnText}>＋</Text>
          </TouchableOpacity>
        ) : announceUnread ? (
          <TouchableOpacity style={styles.markAllBtn} activeOpacity={0.75} onPress={() => markAllRead(deviceId)}>
            <Text style={styles.markAllText}>{t('pr.markAllRead')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['direct', 'announce'] as Tab[]).map((key) => {
          const active = tab === key;
          const unread = key === 'direct'
            ? dms.filter(m => m.direction === 'in' && !m.read).length
            : messages.filter(m => !m.read).length;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.tab, active && styles.tabActive]}
              activeOpacity={0.8}
              onPress={() => setTab(key)}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {key === 'direct' ? t('dm.tabDirect') : t('dm.tabAnnounce')}
                {unread > 0 ? `  ${unread}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'direct' ? (
          dms.length === 0 ? (
            <GlassCard style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>{t('dm.empty')}</Text>
            </GlassCard>
          ) : (
            dms.map((m) => {
              const incoming = m.direction === 'in';
              const unread = incoming && !m.read;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.item, unread && styles.itemUnread]}
                  activeOpacity={0.8}
                  onPress={() => { if (unread) dmMarkRead(deviceId, m.id); }}
                >
                  <View style={styles.itemHeader}>
                    {unread && <View style={styles.dot} />}
                    <Text style={[styles.itemTitle, unread && styles.itemTitleUnread]} numberOfLines={1}>
                      {incoming ? (m.peerUserId || m.peerDevice) : `${t('dm.you')} → ${m.peerUserId || m.peerDevice}`}
                    </Text>
                    <Text style={styles.itemDate}>{m.createdAt.slice(5, 16)}</Text>
                  </View>
                  <Text style={styles.itemBody}>{m.body}</Text>
                </TouchableOpacity>
              );
            })
          )
        ) : (
          messages.length === 0 ? (
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
          )
        )}

        <View style={{ height: Spacing[8] }} />
      </ScrollView>

      {/* Compose modal */}
      <Modal visible={composeOpen} transparent animationType="slide" onRequestClose={() => setCompose(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('dm.composeTitle')}</Text>
            {!!myId && <Text style={styles.modalYourId}>{t('dm.yourId')}: {myId}</Text>}

            <Text style={styles.fieldLabel}>{t('dm.recipientLabel')}</Text>
            <TextInput
              style={styles.input}
              value={recipient}
              onChangeText={setRecipient}
              placeholder={t('dm.recipientPlaceholder')}
              placeholderTextColor={Colors.text.muted}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={draft}
              onChangeText={(v) => setDraft(v.slice(0, DM_MAX_LEN))}
              placeholder={t('dm.messagePlaceholder')}
              placeholderTextColor={Colors.text.muted}
              multiline
              maxLength={DM_MAX_LEN}
            />
            <Text style={styles.counter}>{draft.length}/{DM_MAX_LEN}</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.8} onPress={() => setCompose(false)}>
                <Text style={styles.cancelText}>{t('dm.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
                activeOpacity={0.85}
                disabled={sending}
                onPress={submit}
              >
                {sending
                  ? <ActivityIndicator color="#021b10" size="small" />
                  : <Text style={styles.sendText}>{t('dm.send')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: Colors.bg.base },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing[3] },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  backIcon:      { fontSize: 26, color: Colors.text.secondary, marginTop: -2 },
  title:         { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary },
  newBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  newBtnText:    { fontSize: 22, color: '#021b10', marginTop: -2, fontWeight: '700' },
  markAllBtn:    { paddingHorizontal: Spacing[3], paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface },
  markAllText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  headerSpacer:  { width: 36 },

  tabs:          { flexDirection: 'row', gap: Spacing[2], paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing[3] },
  tab:           { flex: 1, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.subtle, backgroundColor: Colors.bg.surface, alignItems: 'center' },
  tabActive:     { borderColor: 'rgba(0,232,122,0.4)', backgroundColor: 'rgba(0,232,122,0.08)' },
  tabText:       { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.muted },
  tabTextActive: { color: Colors.emerald[400] },

  scroll:        { flex: 1 },
  content:       { paddingHorizontal: Layout.screenPadding, gap: Spacing[3] },
  emptyCard:     { alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[8] },
  emptyIcon:     { fontSize: 40 },
  emptyText:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', paddingHorizontal: Spacing[4] },
  item:          { borderRadius: Radius.lg, padding: Spacing[4], backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.subtle, gap: 6 },
  itemUnread:    { borderColor: 'rgba(0,232,122,0.25)', backgroundColor: 'rgba(0,232,122,0.05)' },
  itemHeader:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.emerald[400] },
  itemTitle:     { flex: 1, fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  itemTitleUnread: { color: Colors.text.primary },
  itemDate:      { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  itemBody:      { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  markHint:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400], marginTop: 2 },

  modalRoot:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  modalCard:     { backgroundColor: Colors.bg.base, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, padding: Layout.screenPadding, paddingBottom: Spacing[8], gap: Spacing[2] },
  modalTitle:    { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary, marginBottom: 2 },
  modalYourId:   { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginBottom: Spacing[2] },
  fieldLabel:    { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, marginTop: Spacing[2] },
  input:         { borderRadius: Radius.lg, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Platform.OS === 'ios' ? 12 : 8, color: Colors.text.primary, fontFamily: Typography.family.body, fontSize: Typography.size.base },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top', marginTop: Spacing[2] },
  counter:       { alignSelf: 'flex-end', fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  modalActions:  { flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[3] },
  cancelBtn:     { flex: 1, paddingVertical: 14, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface, alignItems: 'center' },
  cancelText:    { fontSize: Typography.size.base, fontFamily: Typography.family.label, color: Colors.text.secondary },
  sendBtn:       { flex: 1, paddingVertical: 14, borderRadius: Radius.full, backgroundColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.6 },
  sendText:      { fontSize: Typography.size.base, fontFamily: Typography.family.label, color: '#021b10', fontWeight: '700' },
});
