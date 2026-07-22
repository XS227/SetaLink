import type { DirectMessage } from '../services/entitlementService';
import type { InboxMessage } from '../stores/inboxStore';
import { groupDmsByPeer } from './dmThreads';

/**
 * Unified inbox model (2026-07-07) — one messenger surface, WhatsApp/Telegram
 * style. Collapses the two former tabs (user-to-user DMs + admin announcements)
 * into a single conversation list:
 *
 *   • a pinned two-way "Support" thread wired to the RealGram support account
 *     (SUPPORT_USER_ID). It carries every admin announcement AND any direct
 *     support DMs, so everything from us — and the user's replies to us — lives
 *     in one chat. Always present so a user can reach support with one tap.
 *   • one Conversation per other DM peer (via groupDmsByPeer).
 *
 * Support is pinned to the top; DM threads follow, newest first. Tapping any row
 * opens the same chat-bubble view.
 */

// The RealGram support account. Messages the user sends the Support thread are
// addressed here; incoming DMs from this id (and all admin announcements) render
// in the Support thread.
export const SUPPORT_USER_ID = 'SL-227-62DAC5F0';

// Stable conversation key for the pinned Support thread.
export const SUPPORT_KEY = '__support__';

export interface ChatMessage {
  key:       string;          // unified stable key: 'dm-<id>' | 'ann-<id>'
  id:        number;          // original numeric id (per kind)
  kind:      'dm' | 'ann';    // which store/ack path this message belongs to
  direction: 'in' | 'out';
  title?:    string;          // announcements carry a title line
  body:      string;
  createdAt: string;
  read:      boolean;
  /** Disappearing-message timer (secs after read); 0/undefined = permanent. */
  expireSecs?: number;
  /** UTC 'YYYY-MM-DD HH:MM:SS' burn moment, set once the recipient reads it. */
  expiresAt?: string | null;
  /** DM-only (kind:'dm') — reaction counts by emoji + this device's own pick. */
  reactions?: Record<string, number>;
  myReaction?: string | null;
}

export interface Conversation {
  key:        string;            // SUPPORT_KEY | DM peerKey
  kind:       'support' | 'dm';
  title:      string;            // display name
  support:    boolean;           // drives verified badge, logo avatar, intro note
  peerDevice?: string;           // DM only
  peerUserId?: string;           // support = SUPPORT_USER_ID; DM = peer id
  latest:     ChatMessage | null; // null when Support is still empty
  unread:     number;
  messages:   ChatMessage[];     // ascending (oldest → newest)
}

// Exported for InboxScreen's "load older messages" pagination (2026-07-22,
// chat audit bug #1), which needs to turn a page of raw DirectMessages
// fetched on demand into the same ChatMessage shape the rest of the thread
// already renders, without duplicating this mapping a second time.
export function dmToChat(m: DirectMessage): ChatMessage {
  return {
    key: `dm-${m.id}`, id: m.id, kind: 'dm', direction: m.direction,
    body: m.body, createdAt: m.createdAt, read: m.read,
    expireSecs: m.expireSecs, expiresAt: m.expiresAt,
    reactions: m.reactions, myReaction: m.myReaction,
  };
}

function announcementToChat(m: InboxMessage): ChatMessage {
  return {
    key: `ann-${m.id}`, id: m.id, kind: 'ann', direction: 'in',
    title: m.title, body: m.body, createdAt: m.createdAt, read: m.read,
  };
}

// Chronological order for a mixed DM + announcement stream. Falls back to a
// (kind, id) tiebreak when timestamps collide or are missing.
function byTime(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'ann' ? -1 : 1;
  return a.id - b.id;
}

/**
 * Build the pinned Support conversation: every admin announcement + every DM to
 * or from the support account, merged chronologically. Always returned (even
 * empty) so the user can always start a support chat.
 */
export function buildSupportConversation(
  supportDms: DirectMessage[],
  announcements: InboxMessage[],
  supportName: string,
): Conversation {
  const messages = [
    ...supportDms.map(dmToChat),
    ...announcements.map(announcementToChat),
  ].sort(byTime);
  const latest = messages.length ? messages[messages.length - 1]! : null;
  const unread = messages.filter(m => m.direction === 'in' && !m.read).length;
  return {
    key:        SUPPORT_KEY,
    kind:       'support',
    title:      supportName,
    support:    true,
    peerUserId: SUPPORT_USER_ID,
    latest,
    unread,
    messages,
  };
}

/**
 * Merge the pinned Support thread + other DM threads into one ordered list.
 * `myUserId` guards the support account's own app: when the current user IS
 * support, no self-thread is injected (they just see incoming user DMs).
 */
export function buildConversations(
  dms: DirectMessage[],
  announcements: InboxMessage[],
  supportName: string,
  myUserId?: string,
): Conversation[] {
  const isSupportAccount = !!myUserId && myUserId === SUPPORT_USER_ID;

  const supportDms = isSupportAccount ? [] : dms.filter(m => m.peerUserId === SUPPORT_USER_ID);
  const otherDms   = isSupportAccount ? dms : dms.filter(m => m.peerUserId !== SUPPORT_USER_ID);

  const dmThreads: Conversation[] = groupDmsByPeer(otherDms).map(th => ({
    key:        th.peerKey,
    kind:       'dm' as const,
    title:      th.peerUserId || th.peerDevice,
    support:    false,
    peerDevice: th.peerDevice,
    peerUserId: th.peerUserId,
    latest:     dmToChat(th.latest),
    unread:     th.unread,
    messages:   th.messages.map(dmToChat),
  }));
  dmThreads.sort((a, b) => (b.latest?.id ?? 0) - (a.latest?.id ?? 0));

  if (isSupportAccount) return dmThreads;

  const support = buildSupportConversation(supportDms, announcements, supportName);
  return [support, ...dmThreads];
}

/** Total unread across every conversation (drives the inbox badge). */
export function totalUnread(convos: Conversation[]): number {
  return convos.reduce((n, c) => n + c.unread, 0);
}
