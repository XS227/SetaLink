import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Image,
  Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { AdBanner } from '../components/AdBanner';
import { useAuthStore }  from '../stores/authStore';
import { useInboxStore } from '../stores/inboxStore';
import { useDMStore }    from '../stores/dmStore';
import { useToastStore } from '../stores/toastStore';
import { DM_MAX_LEN } from '../services/entitlementService';
import { buildConversations, dmToChat, type Conversation, type ChatMessage } from '../utils/unifiedThreads';
import { useT } from '../i18n';
import { DM_REACTIONS } from '../services/entitlementService';
import { setTyping as apiSetTyping, getTyping as apiGetTyping } from '../services/entitlementService';
import { listThreadMessages, searchMessages } from '../services/entitlementService';
import { blockUser, reportMessage, type DMReportReason } from '../services/entitlementService';
import { Logger } from '../utils/logger';

const REALINK_LOGO = require('../assets/logo_mark.png');

// Disappearing-message timer steps the composer chip cycles through (seconds
// after the recipient reads; 0 = permanent). Wickr-style, kept playful.
const BURN_STEPS = [0, 30, 60, 300, 3600, 86400] as const;

// Admin announcements (e.g. "new build ready") often carry a plain-text URL
// in the body — messages were previously rendered as inert <Text>, so the
// link was there but not tappable (users had to manually select+copy it).
const URL_RE = /https?:\/\/[^\s]+/;

/** First http(s) URL found in a message body, or null. */
export function extractUrl(body: string): string | null {
  const m = body.match(URL_RE);
  return m ? m[0] : null;
}

/** Compact human label for a burn duration: 30s · 1m · 5m · 1h · 24h. */
export function burnLabel(secs: number): string {
  if (secs < 60)    return `${secs}s`;
  if (secs < 3600)  return `${Math.round(secs / 60)}m`;
  return `${Math.round(secs / 3600)}h`;
}

/** Epoch ms for a server 'YYYY-MM-DD HH:MM:SS' UTC timestamp. */
export function burnDeadlineMs(expiresAt: string): number {
  return Date.parse(expiresAt.replace(' ', 'T') + 'Z');
}

/** Remaining-time label for a burning message ('4:59', '1h 12m'). */
export function burnRemaining(expiresAt: string, nowMs: number): string {
  const left = Math.max(0, Math.floor((burnDeadlineMs(expiresAt) - nowMs) / 1000));
  if (left >= 3600) return `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

interface Props {
  onBack: () => void;
  /** Deep-link: open straight into this conversation (push-notification tap). */
  initialThreadKey?: string | null;
}

/**
 * Inbox — one unified messenger surface (2026-07-07). WhatsApp/Telegram style:
 * a single conversation list holding the pinned official RealGram thread (the
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
  const dmReact       = useDMStore((s) => s.react);
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
  const [burnSecs, setBurnSecs]   = useState(0);   // composer disappearing-timer
  const [nowMs, setNowMs]         = useState(Date.now());
  const [reactingTo, setReactingTo] = useState<number | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Tick once a second while the open thread contains disappearing messages,
  // so burn countdowns run and expired bubbles vanish without waiting for the
  // next server poll. No burning messages -> no timer at all.
  const hasBurning = !!openKey && dms.some(m => (m.expireSecs ?? 0) > 0);
  useEffect(() => {
    if (!hasBurning) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasBurning]);

  const cycleBurn = () => {
    const i = BURN_STEPS.indexOf(burnSecs as (typeof BURN_STEPS)[number]);
    const next = BURN_STEPS[(i + 1) % BURN_STEPS.length] ?? 0;
    setBurnSecs(next);
    useToastStore.getState().show(
      next === 0 ? `⏱ ${t('dm.burnOff')}` : `🔥 ${t('dm.burnSet').replace('{t}', burnLabel(next))}`,
      'info', 1800,
    );
  };

  /** True once a burning message's post-read timer has run out (hide locally —
   *  the server hard-deletes it on its side). */
  const isBurned = (m: ChatMessage) =>
    !!m.expiresAt && burnDeadlineMs(m.expiresAt) <= nowMs;

  const supportName = t('dm.support');
  const conversations = useMemo(
    () => buildConversations(dms, announcements, supportName, myId),
    [dms, announcements, supportName, myId],
  );

  // Message search (2026-07-22) — entirely client-side: every message the
  // conversation list already has locally (title + full message bodies), no
  // new backend call. A conversation matches if its title matches, or any
  // message in it does.
  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.body.toLowerCase().includes(q)));
  }, [conversations, searchQuery]);

  // Server-side search fallback (2026-07-22, chat audit bug #2) — the filter
  // above only ever sees the locally-cached 200-message window, so anything
  // older is silently unsearchable. Debounced (400ms) so it doesn't fire a
  // request per keystroke; results are merged in below as a distinct section
  // rather than replacing the instant local results, since local stays
  // faster for anything already cached.
  const [serverSearchResults, setServerSearchResults] = useState<Awaited<ReturnType<typeof searchMessages>>>([]);
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !deviceId) { setServerSearchResults([]); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      searchMessages(deviceId, q).then((r) => { if (!cancelled) setServerSearchResults(r); }).catch(() => {});
    }, 400);
    return () => { cancelled = true; clearTimeout(id); };
  }, [searchQuery, deviceId]);

  // Server hits not already covered by a locally-cached conversation — these
  // are specifically the "beyond the 200-window" matches bug #2 was about.
  const extraServerResults = useMemo(() => {
    if (!serverSearchResults.length) return [];
    const localIds = new Set<number>();
    conversations.forEach((c) => c.messages.forEach((m) => { if (m.kind === 'dm') localIds.add(m.id); }));
    return serverSearchResults.filter((r) => !localIds.has(r.id));
  }, [serverSearchResults, conversations]);

  const openSearchResult = (r: (typeof extraServerResults)[number]) => {
    // The overwhelming common case: this peer has *some* recent message too,
    // so a real Conversation already exists locally — open it (its own
    // "load older" button, bug #1's fix, reaches the rest of the history).
    const existing = conversations.find((c) => !c.support && (
      (!!r.peerUserId && c.peerUserId === r.peerUserId) || (!!r.peerDevice && c.peerDevice === r.peerDevice)
    ));
    if (existing) { setSearchOpen(false); setSearchQuery(''); openConvoView(existing); return; }
    // Rare edge case: literally every message from this peer is older than
    // the 200-window, so there's no local conversation entry point at all.
    // Not building a full ad-hoc-thread UI for this narrow case (out of
    // today's scope) — tell the user plainly rather than a silent dead end.
    useToastStore.getState().show(t('dm.searchResultNoThread'), 'info');
  };

  const openConvo = openKey ? conversations.find(c => c.key === openKey) ?? null : null;
  const openPeer  = !openConvo?.support ? (openConvo?.peerUserId || openConvo?.peerDevice || '') : '';

  // "Load older messages" pagination (2026-07-22, chat audit bug #1) — the
  // store's own `messages` (dms) is a combined-all-threads 200 cap, so a
  // thread's full history can silently be missing beyond that window. These
  // hold whatever's been fetched *beyond* that window for the currently open
  // thread only; reset whenever the open thread changes. Kept out of the
  // persisted dmStore on purpose — this is scoped to "the thread you have
  // open right now", not something that needs to survive an app restart.
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder]   = useState(false);
  const [noMoreOlder, setNoMoreOlder]     = useState(false);
  useEffect(() => {
    setOlderMessages([]);
    setLoadingOlder(false);
    setNoMoreOlder(false);
  }, [openKey]);

  // Older-loaded + store-cached messages, oldest first — what the thread
  // actually renders. Safe across dmRefresh polls: olderMessages only ever
  // holds ids strictly below anything the 200-window has ever contained for
  // this thread, so a refresh replacing `dms` can't invalidate it.
  const threadMessages = useMemo(
    () => [...olderMessages, ...(openConvo?.messages ?? [])],
    [olderMessages, openConvo],
  );

  const loadOlderMessages = async () => {
    if (!openConvo || openConvo.support || loadingOlder || noMoreOlder || !openPeer) return;
    const oldestDm = threadMessages.find(m => m.kind === 'dm');
    if (!oldestDm) return;
    setLoadingOlder(true);
    try {
      const older = await listThreadMessages(deviceId, openPeer, oldestDm.id, 50);
      if (older.length === 0) { setNoMoreOlder(true); return; }
      // Server returns newest-first (same contract as list-messages);
      // ChatMessage[]/Conversation.messages is oldest-first, so reverse
      // before prepending.
      const chats = older.map(dmToChat).reverse();
      setOlderMessages(prev => [...chats, ...prev]);
      if (older.length < 50) setNoMoreOlder(true);
    } catch (e) {
      Logger.warn('InboxScreen', `loadOlderMessages failed: ${e}`);
    } finally {
      setLoadingOlder(false);
    }
  };

  // Typing indicator (2026-07-22) — poll while a DM thread is open (not
  // Support, which isn't a live peer). Cheap GET, same cadence as the
  // burn-countdown tick would be, but only while it's actually useful.
  useEffect(() => {
    if (!deviceId || !openPeer) { setPeerTyping(false); return; }
    let cancelled = false;
    const poll = () => apiGetTyping(deviceId, openPeer).then((v) => { if (!cancelled) setPeerTyping(v); }).catch(() => {});
    poll();
    const id = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(id); setPeerTyping(false); };
  }, [deviceId, openPeer]);

  // Tell the peer we're typing — fire-and-forget, debounced to once per 2.5s
  // rather than every keystroke (the server treats it as a cheap upsert, but
  // no reason to hammer it on every character).
  const lastTypingPingRef = useRef(0);
  // Bug fix 2026-07-22 (chat audit #4): this ref was shared across every
  // thread with no reset, so switching to a new peer within 2.5s of typing
  // in the last one silently suppressed the first ping to the new peer --
  // they wouldn't see "typing..." for up to 2.5s longer than they should.
  useEffect(() => { lastTypingPingRef.current = 0; }, [openPeer]);
  const pingTyping = () => {
    if (!deviceId || !openPeer) return;
    const now = Date.now();
    if (now - lastTypingPingRef.current < 2500) return;
    lastTypingPingRef.current = now;
    apiSetTyping(deviceId, openPeer).catch(() => {});
  };

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
      await dmSend(deviceId, peer, body, burnSecs);
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

  // Khabat, 2026-07-24: report an abusive message. Own messages (m.direction
  // === 'out') skip straight to delete — reporting your own message makes no
  // sense — real incoming DMs get a Report option ahead of Delete. Support
  // thread is excluded entirely (confirmDeleteMessage's own guard already
  // blocks it; kept consistent here for the same reason — nothing to report
  // on an official channel).
  const handleMessageLongPress = (c: Conversation, m: ChatMessage) => {
    if (c.support || m.kind === 'ann') return;
    if (m.direction === 'out') { confirmDeleteMessage(c, m); return; }
    Alert.alert('', undefined, [
      { text: 'Report', style: 'destructive', onPress: () => confirmReportMessage(c, m) },
      { text: t('dm.deleteMessage'), style: 'destructive', onPress: () => confirmDeleteMessage(c, m) },
      { text: t('dm.cancel'), style: 'cancel' },
    ]);
  };

  const confirmReportMessage = (c: Conversation, m: ChatMessage) => {
    Alert.alert('Report message', 'Why are you reporting this?', [
      { text: 'Spam', onPress: () => submitReport(m.id, 'spam') },
      { text: 'Harassment/abuse', onPress: () => submitReport(m.id, 'harassment') },
      { text: 'Other', onPress: () => submitReport(m.id, 'other') },
      { text: t('dm.cancel'), style: 'cancel' },
    ]);
  };

  const submitReport = (messageId: number, reason: DMReportReason) => {
    reportMessage(deviceId, messageId, reason)
      .then(() => Alert.alert('', 'Reported — thanks, we’ll take a look.'))
      .catch((e: any) => Alert.alert('', String(e?.message ?? 'Could not send report')));
  };

  const confirmBlockUser = (c: Conversation) => {
    if (c.support) return;    // can't block the official support account
    const peer = c.peerUserId || c.peerDevice || '';
    if (!peer) return;
    Alert.alert(
      `Block ${c.title}?`,
      'They won’t be able to message you, and you won’t be able to message them. You can unblock later from Settings.',
      [
        { text: t('dm.cancel'), style: 'cancel' },
        {
          text: 'Block', style: 'destructive',
          onPress: () => {
            blockUser(deviceId, peer)
              .then(() => { setOpenKey(null); })
              .catch((e: any) => Alert.alert('', String(e?.message ?? 'Could not block')));
          },
        },
      ],
    );
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
        <TouchableOpacity
          style={styles.searchBtn}
          activeOpacity={0.7}
          onPress={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchQuery(''); }}
        >
          <Text style={styles.searchBtnText}>{searchOpen ? '✕' : '🔍'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.newBtn} activeOpacity={0.8} onPress={() => setCompose(true)}>
          <Text style={styles.newBtnText}>＋</Text>
        </TouchableOpacity>
      </View>

      {searchOpen && (
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('dm.searchPlaceholder')}
            placeholderTextColor={Colors.text.muted}
            autoFocus
          />
        </View>
      )}

      {/* Unified conversation list */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filteredConversations.length === 0 ? (
          <GlassCard style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>{searchQuery ? t('dm.noSearchResults') : t('dm.empty')}</Text>
          </GlassCard>
        ) : (
          filteredConversations.map((c) => {
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

        {/* Server-side search fallback results (2026-07-22, chat audit bug
            #2) — matches found on the server that aren't in any locally
            cached conversation above (i.e. older than the 200-window). */}
        {extraServerResults.length > 0 && (
          <>
            <Text style={styles.moreResultsLabel}>{t('dm.moreResults')}</Text>
            {extraServerResults.map((r) => (
              <TouchableOpacity
                key={`search-${r.id}`}
                style={styles.item}
                activeOpacity={0.8}
                onPress={() => openSearchResult(r)}
              >
                <Avatar support={false} label={r.peerUserId || r.peerDevice} />
                <View style={styles.itemMain}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{r.peerUserId || r.peerDevice}</Text>
                    <Text style={styles.itemDate}>{r.createdAt.slice(5, 16)}</Text>
                  </View>
                  <Text style={styles.itemBody} numberOfLines={1}>{r.body}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
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
                  {!openConvo.support && peerTyping && (
                    <Text style={styles.threadSubtitle}>{t('dm.typing')}</Text>
                  )}
                </View>
                {!openConvo.support && (
                  <TouchableOpacity testID="convo-block" style={styles.threadDeleteBtn} activeOpacity={0.7} onPress={() => confirmBlockUser(openConvo)}>
                    <Text style={styles.threadDeleteIcon}>🚫</Text>
                  </TouchableOpacity>
                )}
                {!openConvo.support && (
                  <TouchableOpacity testID="convo-delete" style={styles.threadDeleteBtn} activeOpacity={0.7} onPress={() => confirmDeleteThread(openConvo)}>
                    <Text style={styles.threadDeleteIcon}>🗑</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Ad banner — Khabat, 2026-07-24: AdMob showed on Freedom/Home
                  but not here; support threads are the one Inbox surface it's
                  safe to place an ad on (never inside a real person-to-person
                  DM thread). */}
              {openConvo.support && (
                <AdBanner
                  show={user?.plan === 'free' || !!user?.testMode}
                  slot="inbox_banner"
                  style={styles.threadAdBanner}
                />
              )}

              {/* Conversation */}
              <ScrollView style={styles.threadScroll} contentContainerStyle={styles.threadScrollContent}>
                {/* Support thread opens with a pinned intro note (localized). */}
                {openConvo.support && (
                  <View style={styles.introNote}>
                    <Text style={styles.introText}>{t('dm.supportIntro')}</Text>
                  </View>
                )}
                {/* "Load older messages" (2026-07-22, chat audit bug #1) — a
                    button rather than silent infinite-scroll-on-drag: this is
                    a ScrollView, not a FlatList, so there's no onEndReached to
                    hook, and a visible button also makes it obvious to the
                    user that older history exists and is one tap away, rather
                    than messages just quietly appearing. */}
                {!openConvo.support && !noMoreOlder && threadMessages.some(m => m.kind === 'dm') && (
                  <TouchableOpacity
                    style={styles.loadOlderBtn}
                    activeOpacity={0.7}
                    onPress={loadOlderMessages}
                    disabled={loadingOlder}
                  >
                    {loadingOlder
                      ? <ActivityIndicator size="small" color={Colors.text.secondary} />
                      : <Text style={styles.loadOlderText}>{t('dm.loadOlder')}</Text>}
                  </TouchableOpacity>
                )}
                {threadMessages.filter(m => !isBurned(m)).map((m) => {
                  const out = m.direction === 'out';
                  const burning = (m.expireSecs ?? 0) > 0;
                  const canReact = m.kind === 'dm';
                  const reactionEntries = Object.entries(m.reactions ?? {}).filter(([, n]) => n > 0);
                  return (
                    <View key={m.key}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => canReact && setReactingTo(reactingTo === m.id ? null : m.id)}
                        onLongPress={() => handleMessageLongPress(openConvo, m)}
                        style={[styles.bubbleRow, out ? styles.bubbleRowOut : styles.bubbleRowIn]}
                      >
                        <View style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn, burning && styles.bubbleBurn]}>
                          {!!m.title && <Text style={styles.bubbleTitle}>{m.title}</Text>}
                          <Text style={[styles.bubbleText, out && styles.bubbleTextOut]}>{m.body}</Text>
                          {(() => {
                            const url = extractUrl(m.body);
                            if (!url) return null;
                            return (
                              <TouchableOpacity
                                style={styles.bubbleLinkBtn}
                                activeOpacity={0.75}
                                onPress={() => Linking.openURL(url).catch(() => {})}
                              >
                                <Text style={styles.bubbleLinkText}>🔗 {t('dm.openLink')}</Text>
                              </TouchableOpacity>
                            );
                          })()}
                          {burning && (
                            <Text style={styles.burnNote}>
                              🔥 {m.expiresAt
                                ? t('dm.burnLeft').replace('{t}', burnRemaining(m.expiresAt, nowMs))
                                : t('dm.burnPending').replace('{t}', burnLabel(m.expireSecs ?? 0))}
                            </Text>
                          )}
                          <Text style={[styles.bubbleTime, out && styles.bubbleTimeOut]}>{m.createdAt.slice(11, 16)}</Text>
                        </View>
                      </TouchableOpacity>

                      {reactionEntries.length > 0 && (
                        <View style={[styles.reactionBadgeRow, out ? styles.bubbleRowOut : styles.bubbleRowIn]}>
                          {reactionEntries.map(([emoji, count]) => (
                            <TouchableOpacity
                              key={emoji}
                              style={[styles.reactionBadge, m.myReaction === emoji && styles.reactionBadgeMine]}
                              onPress={() => dmReact(deviceId, m.id, emoji)}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.reactionBadgeText}>{emoji} {count}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                      {canReact && reactingTo === m.id && (
                        <View style={[styles.reactionPickerRow, out ? styles.reactionPickerOut : styles.reactionPickerIn]}>
                          {DM_REACTIONS.map((emoji) => (
                            <TouchableOpacity
                              key={emoji}
                              style={styles.reactionPickerBtn}
                              onPress={() => { dmReact(deviceId, m.id, emoji); setReactingTo(null); }}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              {/* Reply input — two-way for both Support and DM threads */}
              <View style={styles.threadInputRow}>
                <TouchableOpacity
                  testID="convo-burn"
                  style={[styles.burnChip, burnSecs > 0 && styles.burnChipOn]}
                  activeOpacity={0.7}
                  onPress={cycleBurn}
                >
                  <Text style={styles.burnChipText}>
                    {burnSecs > 0 ? `🔥${burnLabel(burnSecs)}` : '⏱'}
                  </Text>
                </TouchableOpacity>
                <TextInput
                  testID="convo-input"
                  style={styles.threadInput}
                  value={threadDraft}
                  onChangeText={(v) => { setThreadDraft(v.slice(0, DM_MAX_LEN)); pingTyping(); }}
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
  searchBtn:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  searchBtnText: { fontSize: 16 },
  searchBar:     { paddingHorizontal: Layout.screenPadding, paddingBottom: Spacing[2] },
  searchInput:   { backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, borderRadius: Radius.lg, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], color: Colors.text.primary, fontSize: Typography.size.sm, fontFamily: Typography.family.body },

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
  threadAdBanner: { marginHorizontal: Layout.screenPadding, marginTop: Spacing[2] },
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
  bubbleLinkBtn: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: Radius.sm, paddingHorizontal: Spacing[2], paddingVertical: 4 },
  bubbleLinkText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400] },
  bubbleTime:    { fontSize: 9, fontFamily: Typography.family.mono, color: Colors.text.muted, alignSelf: 'flex-end', marginTop: 2 },
  bubbleTimeOut: { color: 'rgba(2,27,16,0.6)' },

  reactionBadgeRow: { flexDirection: 'row', gap: 4, marginTop: -6, marginBottom: 6, paddingHorizontal: 4 },
  reactionBadge:    { flexDirection: 'row', backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.subtle, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  reactionBadgeMine:{ borderColor: Colors.emerald[400] },
  reactionBadgeText:{ fontSize: 11, color: Colors.text.secondary },

  // No alignSelf here (bug fix 2026-07-22, chat audit #3): it used to be
  // hardcoded 'flex-start', which pins the picker to the left edge even for
  // your own (right-aligned) sent messages -- justifyContent from
  // bubbleRowOut/In has no effect on a shrink-to-fit row's own position, only
  // on its children. reactionPickerOut/In below (mirroring bubbleRowOut/In's
  // naming) set the real per-direction alignSelf instead.
  reactionPickerRow: { flexDirection: 'row', gap: 6, marginTop: -4, marginBottom: 8, paddingHorizontal: 4, backgroundColor: Colors.bg.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border.default, paddingVertical: 4 },
  reactionPickerOut: { alignSelf: 'flex-end' },
  reactionPickerIn:  { alignSelf: 'flex-start' },
  reactionPickerBtn: { paddingHorizontal: 4 },
  reactionPickerEmoji: { fontSize: 20 },
  bubbleBurn:    { borderWidth: 1, borderColor: 'rgba(255,140,60,0.5)' },
  burnNote:      { fontSize: 10, fontFamily: Typography.family.mono, color: '#FF8C3C', marginTop: 3 },
  burnChip:      { height: 46, minWidth: 46, paddingHorizontal: 6, borderRadius: 23, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface, alignItems: 'center', justifyContent: 'center' },
  burnChipOn:    { borderColor: '#FF8C3C', backgroundColor: 'rgba(255,140,60,0.12)' },
  burnChipText:  { fontSize: 13, color: '#FF8C3C', fontFamily: Typography.family.mono },
  threadInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing[2], paddingHorizontal: Layout.screenPadding, paddingVertical: Spacing[3], paddingBottom: Spacing[6], borderTopWidth: 1, borderTopColor: Colors.border.subtle },
  threadInput:   { flex: 1, maxHeight: 110, borderRadius: Radius.lg, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Platform.OS === 'ios' ? 12 : 8, color: Colors.text.primary, fontFamily: Typography.family.body, fontSize: Typography.size.base },
  threadSendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center' },
  threadSendText:{ fontSize: 20, color: '#021b10', fontWeight: '700' },
  introNote:     { backgroundColor: 'rgba(0,232,122,0.06)', borderWidth: 1, borderColor: 'rgba(0,232,122,0.2)', borderRadius: Radius.lg, padding: Spacing[3], marginBottom: Spacing[2] },
  introText:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.secondary, textAlign: 'center', lineHeight: 18 },
  loadOlderBtn:  { alignSelf: 'center', paddingHorizontal: Spacing[3], paddingVertical: Spacing[2], borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface, marginBottom: Spacing[2] },
  loadOlderText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.secondary },
  moreResultsLabel: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: Spacing[3], marginBottom: Spacing[1], paddingHorizontal: Spacing[1], textTransform: 'uppercase', letterSpacing: 0.5 },

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
