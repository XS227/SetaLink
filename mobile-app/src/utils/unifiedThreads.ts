import type { DirectMessage } from '../services/entitlementService';
import type { InboxMessage } from '../stores/inboxStore';
import { groupDmsByPeer } from './dmThreads';

/**
 * Unified inbox model (2026-07-07) — one messenger surface, WhatsApp/Telegram
 * style. Collapses the two former tabs (user-to-user DMs + admin announcements)
 * into a single conversation list:
 *
 *   • one Conversation per DM peer (via groupDmsByPeer), and
 *   • ONE pinned "official" Conversation carrying every admin announcement, so
 *     the messages we send a user read as a single chat thread with the REAL
 *     account instead of a separate, split-off list.
 *
 * The official conversation is pinned to the top; DM threads follow, newest
 * first. Tapping any conversation opens the same chat-bubble view.
 */

// Stable key for the official/announcements conversation.
export const OFFICIAL_KEY = '__official__';

export interface ChatMessage {
  key:       string;          // unified stable key: 'dm-<id>' | 'ann-<id>'
  id:        number;          // original numeric id (per kind)
  direction: 'in' | 'out';
  title?:    string;          // announcements carry a title line
  body:      string;
  createdAt: string;
  read:      boolean;
}

export interface Conversation {
  key:        string;            // OFFICIAL_KEY | DM peerKey
  kind:       'official' | 'dm';
  title:      string;            // display name
  official:   boolean;           // drives verified badge + REAL logo avatar
  peerDevice?: string;           // DM only
  peerUserId?: string;           // DM only
  latest:     ChatMessage;
  unread:     number;
  messages:   ChatMessage[];     // ascending by natural order (oldest → newest)
}

function dmToChat(m: DirectMessage): ChatMessage {
  return {
    key:       `dm-${m.id}`,
    id:        m.id,
    direction: m.direction,
    body:      m.body,
    createdAt: m.createdAt,
    read:      m.read,
  };
}

function announcementToChat(m: InboxMessage): ChatMessage {
  return {
    key:       `ann-${m.id}`,
    id:        m.id,
    direction: 'in',            // announcements always come from us → incoming
    title:     m.title,
    body:      m.body,
    createdAt: m.createdAt,
    read:      m.read,
  };
}

/**
 * Build the pinned official conversation from admin announcements, or null when
 * there are none (so an empty official thread never clutters the list).
 */
export function buildOfficialConversation(
  announcements: InboxMessage[],
  officialName: string,
): Conversation | null {
  if (!announcements.length) return null;
  // Oldest → newest so the chat reads top-to-bottom like any messenger.
  const asc = [...announcements].sort((a, b) => a.id - b.id).map(announcementToChat);
  const latest = asc[asc.length - 1]!;
  const unread = asc.filter(m => !m.read).length;
  return {
    key:      OFFICIAL_KEY,
    kind:     'official',
    title:    officialName,
    official: true,
    latest,
    unread,
    messages: asc,
  };
}

/**
 * Merge DM threads + the official announcements thread into one ordered list.
 * Official is always first (pinned); DM threads follow, most-recent first.
 */
export function buildConversations(
  dms: DirectMessage[],
  announcements: InboxMessage[],
  officialName: string,
): Conversation[] {
  const dmThreads: Conversation[] = groupDmsByPeer(dms).map(th => ({
    key:        th.peerKey,
    kind:       'dm' as const,
    title:      th.peerUserId || th.peerDevice,
    official:   false,
    peerDevice: th.peerDevice,
    peerUserId: th.peerUserId,
    latest:     dmToChat(th.latest),
    unread:     th.unread,
    messages:   th.messages.map(dmToChat),
  }));

  // DM threads newest-first (groupDmsByPeer already sorts, but be explicit).
  dmThreads.sort((a, b) => b.latest.id - a.latest.id);

  const official = buildOfficialConversation(announcements, officialName);
  return official ? [official, ...dmThreads] : dmThreads;
}

/** Total unread across every conversation (drives the inbox badge). */
export function totalUnread(convos: Conversation[]): number {
  return convos.reduce((n, c) => n + c.unread, 0);
}
