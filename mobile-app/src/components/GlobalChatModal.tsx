/**
 * GlobalChatModal — one shared chat room every RealGram user can post in
 * (Khabat, 2026-07-31: "på social så kan det være en social chat der alle
 * brukere av realgram kan skrive i men begrensning på antall meldinger pr
 * minut ... så det ikke blir kaos der").
 *
 * Server enforces the rate limit (lib/globalChat.php: 3/min, 100/day per
 * device) — this component just surfaces whatever the server says
 * ('rate_limited_minute'/'rate_limited_day') rather than re-implementing
 * the limit client-side, which would be trivially bypassable anyway.
 * Polls for new messages while open (no WebSocket/push infra for this
 * room exists) — same posture InboxScreen's own typing-indicator poll
 * already uses elsewhere in this app.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { useToastStore } from '../stores/toastStore';
import { getGlobalMessages, sendGlobalMessage, GlobalChatMessage } from '../services/entitlementService';

const POLL_MS = 4000;
const MAX_LEN = 500;

interface Props {
  visible: boolean;
  deviceId: string;
  displayName: string;
  onClose: () => void;
}

function timeLabel(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function GlobalChatModal({ visible, deviceId, displayName, onClose }: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);
  const [messages, setMessages] = useState<GlobalChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const latestIdRef = useRef(0);

  const load = useCallback(() => {
    getGlobalMessages(50).then((rows) => {
      setMessages(rows);
      if (rows.length > 0) latestIdRef.current = rows[0].id;
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!visible) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [visible, load]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending || !deviceId) return;
    setSending(true);
    const result = await sendGlobalMessage(deviceId, displayName, body);
    setSending(false);
    if (!result.ok) {
      const key = result.error === 'rate_limited_minute' ? 'social.chatRateLimitedMinute'
        : result.error === 'rate_limited_day' ? 'social.chatRateLimitedDay'
        : 'social.chatSendFailed';
      showToast(t(key), 'error');
      return;
    }
    setDraft('');
    setMessages((prev) => [result.message, ...prev]);
    latestIdRef.current = result.message.id;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.screen, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('social.globalChatTitle')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeIcon}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.centered}><ActivityIndicator size="large" color={Colors.gold[400]} /></View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => String(m.id)}
            inverted
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.device_id === deviceId && styles.bubbleMine]}>
                <View style={styles.bubbleHeadRow}>
                  <Text style={styles.bubbleName} numberOfLines={1}>{item.display_name || t('social.chatAnon')}</Text>
                  <Text style={styles.bubbleTime}>{timeLabel(item.created_at)}</Text>
                </View>
                <Text style={styles.bubbleBody}>{item.body}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>{t('social.chatEmpty')}</Text>}
          />
        )}

        <View style={[styles.composer, { paddingBottom: insets.bottom + Spacing[2] }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('social.chatPlaceholder')}
            placeholderTextColor={Colors.text.muted}
            maxLength={MAX_LEN}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            activeOpacity={0.85}
          >
            {sending
              ? <ActivityIndicator size="small" color={Colors.bg.void} />
              : <Text style={styles.sendBtnText}>{t('social.chatSend')}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[3],
    borderBottomWidth: 1, borderBottomColor: Colors.border.subtle,
  },
  title: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.elevated },
  closeIcon: { fontSize: 14, color: Colors.text.secondary },

  list: { padding: Spacing[4], gap: Spacing[2], flexGrow: 1 },
  emptyText: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', marginTop: Spacing[8] },

  bubble: {
    maxWidth: '82%', alignSelf: 'flex-start',
    backgroundColor: Colors.bg.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border.subtle,
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    marginBottom: Spacing[2],
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: 'rgba(212,175,55,0.10)', borderColor: 'rgba(212,175,55,0.3)' },
  bubbleHeadRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing[3], marginBottom: 2 },
  bubbleName: { fontSize: 11, fontFamily: Typography.family.heading, color: Colors.gold[400], flexShrink: 1 },
  bubbleTime: { fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.muted },
  bubbleBody: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.primary, lineHeight: 18 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing[2],
    paddingHorizontal: Spacing[4], paddingTop: Spacing[2],
    borderTopWidth: 1, borderTopColor: Colors.border.subtle,
  },
  input: {
    flex: 1, maxHeight: 100, minHeight: 40,
    backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border.default,
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.primary,
  },
  sendBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3] },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
