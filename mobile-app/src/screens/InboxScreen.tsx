import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Image,
  Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useAuthStore }  from '../stores/authStore';
import { useInboxStore } from '../stores/inboxStore';
import { useDMStore }    from '../stores/dmStore';
import { useToastStore } from '../stores/toastStore';
import { DM_MAX_LEN } from '../services/entitlementService';
import { buildConversations, type Conversation, type ChatMessage } from '../utils/unifiedThreads';
import { useT } from '../i18n';

const REALINK_LOGO = require('../assets/logo_mark.png');

interface Props {
  onBack: () => void;
  /** Deep-link: open straight into this conversation (push-notification tap). */
  initialThreadKey?: string | null;
}

/**
 * Inbox — one unified messenger surface (2026-07-07). WhatsApp/Telegram style:
 * a single conversation list holding the pinned official ReaLink thread (the
 * announcements we send) alongside user-to-user DM threads. Tapping any row
 * opens the same chat-bubble view. A push-notification tap deep-links straight
 * into its thread via `initialThreadKey`.
 */
export function InboxScreen({ onBack, initialThreadKey }: Props) {
  const { t } = useT();
  const user        = useAuthStore((s) => s.user);
  const deviceId    = user?.deviceId ?? '';
  const myId        = user?.userId ?? '';

  // Direct messages
  const dms           = useDMStore((s) => s.messages);
  const dmRefresh     = useDMStore((s) => s.refresh);
  const dmSend        = useDMStore((s) => s.send);
  const dmMarkRead    = useDMStore((s) => s.markRead);
  const dmDeleteMsg   = useDMStore((s) => s.deleteMessage);
  const dmDeleteThread= useDMStore((s) => s.deleteThread);
  const sending       = useDMStore((s) => s.sending);

  // Admin announcements (folded into the official thread)
  const announcements = useInboxStore((s) => s.messages);
  const annMarkRead   = useInboxStore((s) => s.markRead);
  const refreshInbox  = useInboxStore((s) => s.refresh);

  const [composeOpen, setCompose] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [draft, setDraft]         = useState('');
  const [openKey, setOpenKey]     = useState<string | null>(null);
  const [threadDraft, setThreadDraft] = useState('');

  const supportName = t('dm.support');
  const conversations = useMemo(
    () => buildConversations(dms, announcements, supportName, myId),
    [dms, announcements, supportName, myId],
  );
  const openConvo = openKey ? conversations.find(c => c.key === openKey) ?? null : null;

  // Mark a conversation's unread incoming messages read. The Support thread
  // mixes DM + announcement messages, so ack each via its own store path.
  const markConvoRead = (c: Conversation) => {
    c.messages.forEach(m => {
      if (m.direction === 'in' && !m.read) {
        if (m.kind === 'ann') annMarkRead(deviceId, m.id);
        else                  dmMarkRead(deviceId, m.id);
      }
    });
  };

  const openConvoView = (c: Conversation) => {
    markConvoRead(c);
    setThreadDraft('');
    setOpenKey(c.key);
  };

  const sendInThread = async () => {
    const body = threadDraft.trim();
    if (!body || !openConvo) return;
    // Support replies address the support account; DM replies address the peer.
    const peer = openConvo.peerUserId || openConvo.peerDevice || '';
    if (!peer) return;
    try {
      await dmSend(deviceId, peer, body);
      setThreadDraft('');
    } catch (e: any) {
      Alert.alert('', String(e?.message ?? 'Error'));
    }
  };

  const confirmDeleteThread = (c: Conversation) => {
    if (c.support) return;    // the Support thread is not deletable
    Alert.alert(t('dm.deleteThread'), t('dm.deleteChatConfirm'), [
      { text: t('dm.cancel'), style: 'cancel' },
      { text: t('dm.deleteThread'), style: 'destructive', onPress: () => {
        dmDeleteThread(deviceId, c.peerDevice || '');
        setOpenKey(null);
      } },
    ]);
  };

  const confirmDeleteMessage = (c: Conversation, m: ChatMessage) => {
    if (c.support || m.kind === 'ann') return;   // support / announcements aren't deletable
    Alert.alert(t('dm.deleteMessage'), t('dm.deleteMsgConfirm'), [
      { text: t('dm.cancel'), style: 'cancel' },
      { text: t('dm.deleteMessage'), style: 'destructive', onPress: () => dmDeleteMsg(deviceId, m.id) },
    ]);
  };

  useEffect(() => {
    if (!deviceId) return;
    dmRefresh(deviceId).catch(() => {});
    refreshInbox(deviceId).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link: when arriving from a notification tap, auto-open the target
  // thread once the conversation exists. Retries as data loads in.
  useEffect(() => {
    if (!initialThreadKey) return;
    const target = conversations.find(c => c.key === initialThreadKey);
    if (target) openConvoView(target);
  }, [initialThreadKey, conversations]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const Avatar = ({ support, label, size = 44 }: { support: boolean; label: string; size?: number }) => (
    support ? (
      <View style={[styles.avatar, styles.avatarOfficial, { width: size, height: size, borderRadius: size / 2 }]}>
        <Image source={REALINK_LOGO} style={{ width: size * 0.6, height: size * 0.6, resizeMode: 'contain' }} />
      </View>
    ) : (
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={styles.avatarText}>{(label || '?').slice(0, 1).toUpperCase()}</Text>
      </View>
    )
  );

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('pr.inbox')}</Text>
        <TouchableOpacity style={styles.newBtn} activeOpacity={0.8} onPress={() => setCompose(true)}>
          <Text style={styles.newBtnText}>＋</Text>
        </TouchableOpacity>
      </View>

      {/* Unified conversation list */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {conversations.length === 0 ? (
          <GlassCard style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>{t('dm.empty')}</Text>
          </GlassCard>
        ) : (
          conversations.map((c) => {
            const preview = !c.latest
              ? t('dm.supportIntro')
              : c.latest.direction === 'out'
                ? `${t('dm.you')}: ${c.latest.body}`
                : c.latest.title
                  ? `${c.latest.title} — ${c.latest.body}`
                  : c.latest.body;
            return (
              <TouchableOpacity
                key={c.key}
                testID={`convo-${c.key}`}
                style={[styles.item, c.unread > 0 && styles.itemUnread]}
                activeOpacity={0.8}
                onPress={() => openConvoView(c)}
                onLongPress={() => confirmDeleteThread(c)}
              >
                <Avatar support={c.support} label={c.title} />
                <View style={styles.itemMain}>
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemTitle, c.unread > 0 && styles.itemTitleUnread]} numberOfLines={1}>
                      {c.title}
                    </Text>
                    {c.support && (
                      <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>✓</Text></View>
                    )}
                    {!!c.latest && <Text style={styles.itemDate}>{c.latest.createdAt.slice(5, 16)}</Text>}
                  </View>
                  <View style={styles.threadPreviewRow}>
                    <Text style={styles.itemBody} numberOfLines={1}>{preview}</Text>
                    {c.unread > 0 && (
                      <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{c.unread}</Text></View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: Spacing[8] }} />
      </ScrollView>

      {/* Chat thread modal — Telegram-style conversation for DMs + official */}
      <Modal testID="convo-modal" visible={!!openConvo} transparent animationType="slide" onRequestClose={() => setOpenKey(null)}>
        <KeyboardAvoidingView
          style={styles.threadRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {!!openConvo && (
            <View style={styles.threadCard}>
              {/* Thread header: avatar + peer/official + delete */}
              <View style={styles.threadHeader}>
                <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={() => setOpenKey(null)}>
                  <Text style={styles.backIcon}>‹</Text>
                </TouchableOpacity>
                <Avatar support={openConvo.support} label={openConvo.title} size={34} />
                <View style={styles.threadPeerWrap}>
                  <View style={styles.threadPeerRow}>
                    <Text style={styles.threadPeer} numberOfLines={1}>{openConvo.title}</Text>
                    {openConvo.support && (
                      <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>✓</Text></View>
                    )}
                  </View>
                  {openConvo.support && <Text style={styles.threadSubtitle}>{t('dm.supportTag')}</Text>}
                </View>
                {!openConvo.support && (
                  <TouchableOpacity testID="convo-delete" style={styles.threadDeleteBtn} activeOpacity={0.7} onPress={() => confirmDeleteThread(openConvo)}>
                    <Text style={styles.threadDeleteIcon}>🗑</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Conversation */}
              <ScrollView style={styles.threadScroll} contentContainerStyle={styles.threadScrollContent}>
                {/* Support thread opens with a pinned intro note (localized). */}
                {openConvo.support && (
                  <View style={styles.introNote}>
                    <Text style={styles.introText}>{t('dm.supportIntro')}</Text>
                  </View>
                )}
                {openConvo.messages.map((m) => {
                  const out = m.direction === 'out';
                  return (
                    <TouchableOpacity
                      key={m.key}
                      activeOpacity={0.9}
                      onLongPress={() => confirmDeleteMessage(openConvo, m)}
                      style={[styles.bubbleRow, out ? styles.bubbleRowOut : styles.bubbleRowIn]}
                    >
                      <View style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}>
                        {!!m.title && <Text style={styles.bubbleTitle}>{m.title}</Text>}
                        <Text style={[styles.bubbleText, out && styles.bubbleTextOut]}>{m.body}</Text>
                        <Text style={[styles.bubbleTime, out && styles.bubbleTimeOut]}>{m.createdAt.slice(11, 16)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Reply input — two-way for both Support and DM threads */}
              <View style={styles.threadInputRow}>
                <TextInput
                  testID="convo-input"
                  style={styles.threadInput}
                  value={threadDraft}
                  onChangeText={(v) => setThreadDraft(v.slice(0, DM_MAX_LEN))}
                  placeholder={t('dm.messagePlaceholder')}
                  placeholderTextColor={Colors.text.muted}
                  multiline
                  maxLength={DM_MAX_LEN}
                />
                <TouchableOpacity
                  testID="convo-send"
                  style={[styles.threadSendBtn, (sending || !threadDraft.trim()) && styles.sendBtnDisabled]}
                  activeOpacity={0.85}
                  disabled={sending || !threadDraft.trim()}
                  onPress={sendInThread}
                >
                  {sending ? <ActivityIndicator color="#021b10" size="small" /> : <Text style={styles.threadSendText}>➤</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Compose modal */}
      <Modal testID="dm-compose-modal" visible={composeOpen} transparent animationType="slide" onRequestClose={() => setCompose(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('dm.composeTitle')}</Text>
            {!!myId && <Text style={styles.modalYourId}>{t('dm.yourId')}: {myId}</Text>}

            <Text style={styles.fieldLabel}>{t('dm.recipientLabel')}</Text>
            <TextInput
              testID="dm-recipient-input"
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

  scroll:        { flex: 1 },
  content:       { paddingHorizontal: Layout.screenPadding, gap: Spacing[3], paddingTop: Spacing[1] },
  emptyCard:     { alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[8] },
  emptyIcon:     { fontSize: 40 },
  emptyText:     { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', paddingHorizontal: Spacing[4] },

  // Conversation row (avatar + text)
  item:          { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], borderRadius: Radius.lg, padding: Spacing[3], backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.subtle },
  itemUnread:    { borderColor: 'rgba(0,232,122,0.25)', backgroundColor: 'rgba(0,232,122,0.05)' },
  itemMain:      { flex: 1, gap: 4 },
  itemHeader:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemTitle:     { flex: 1, fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  itemTitleUnread: { color: Colors.text.primary },
  itemDate:      { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  itemBody:      { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },

  avatar:        { backgroundColor: Colors.bg.base, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  avatarOfficial:{ backgroundColor: 'rgba(0,232,122,0.10)', borderColor: 'rgba(0,232,122,0.4)' },
  avatarText:    { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.emerald[400] },
  verifiedBadge: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  verifiedText:  { fontSize: 10, color: '#021b10', fontWeight: '700' },

  threadPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  unreadBadge:   { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: '#021b10', fontWeight: '700' },

  // Chat thread modal
  threadRoot:    { flex: 1, backgroundColor: Colors.bg.base },
  threadCard:    { flex: 1 },
  threadHeader:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  threadPeerWrap:{ flex: 1 },
  threadPeerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  threadPeer:    { flexShrink: 1, fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  threadSubtitle:{ fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  threadDeleteBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  threadDeleteIcon: { fontSize: 16 },
  threadScroll:  { flex: 1 },
  threadScrollContent: { padding: Layout.screenPadding, gap: Spacing[2] },
  bubbleRow:     { flexDirection: 'row' },
  bubbleRowOut:  { justifyContent: 'flex-end' },
  bubbleRowIn:   { justifyContent: 'flex-start' },
  bubble:        { maxWidth: '82%', borderRadius: Radius.lg, paddingHorizontal: Spacing[3], paddingVertical: Spacing[2] },
  bubbleIn:      { backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.subtle, borderTopLeftRadius: 4 },
  bubbleOut:     { backgroundColor: Colors.emerald[400], borderTopRightRadius: 4 },
  bubbleTitle:   { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.emerald[400], marginBottom: 3 },
  bubbleText:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.primary, lineHeight: 20 },
  bubbleTextOut: { color: '#021b10' },
  bubbleTime:    { fontSize: 9, fontFamily: Typography.family.mono, color: Colors.text.muted, alignSelf: 'flex-end', marginTop: 2 },
  bubbleTimeOut: { color: 'rgba(2,27,16,0.6)' },
  threadInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing[2], paddingHorizontal: Layout.screenPadding, paddingVertical: Spacing[3], paddingBottom: Spacing[6], borderTopWidth: 1, borderTopColor: Colors.border.subtle },
  threadInput:   { flex: 1, maxHeight: 110, borderRadius: Radius.lg, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Platform.OS === 'ios' ? 12 : 8, color: Colors.text.primary, fontFamily: Typography.family.body, fontSize: Typography.size.base },
  threadSendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  threadSendText:{ fontSize: 20, color: '#021b10', fontWeight: '700' },
  introNote:     { backgroundColor: 'rgba(0,232,122,0.06)', borderWidth: 1, borderColor: 'rgba(0,232,122,0.2)', borderRadius: Radius.lg, padding: Spacing[3], marginBottom: Spacing[2] },
  introText:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.secondary, textAlign: 'center', lineHeight: 18 },

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
