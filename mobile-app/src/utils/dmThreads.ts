import type { DirectMessage } from '../services/entitlementService';

/**
 * Telegram-style thread grouping (v0.9.35 #2). The server returns a flat,
 * newest-first message list (inbox + sent). We collapse it to one thread per
 * peer so the inbox shows a single row per conversation with the latest message
 * and an unread count, and tapping opens the full chat.
 *
 * Peer identity keys on `peerDevice` (always present and stable); `peerUserId`
 * is used only for display. This is what stops the "multiple rows for the same
 * user" bug.
 */

export interface DmThread {
  peerKey:    string;          // peerDevice — stable grouping key
  peerUserId: string;          // for display (may be empty)
  peerDevice: string;
  latest:     DirectMessage;   // newest message in the thread
  unread:     number;          // incoming & unread
  messages:   DirectMessage[]; // ascending by id, for the chat view
}

export function groupDmsByPeer(messages: DirectMessage[]): DmThread[] {
  const byPeer = new Map<string, DirectMessage[]>();
  for (const m of messages) {
    const key = m.peerDevice || m.peerUserId || 'unknown';
    const arr = byPeer.get(key);
    if (arr) arr.push(m); else byPeer.set(key, [m]);
  }

  const threads: DmThread[] = [];
  for (const [peerKey, msgs] of byPeer) {
    // Newest first within the group → latest is msgs[0] when input is newest-first,
    // but don't assume: sort explicitly by id.
    const asc = [...msgs].sort((a, b) => a.id - b.id);
    const latest = asc[asc.length - 1]!;
    const unread = asc.filter(m => m.direction === 'in' && !m.read).length;
    // Prefer a non-empty user id from any message in the thread for display.
    const peerUserId = (asc.find(m => m.peerUserId)?.peerUserId) || '';
    threads.push({ peerKey, peerUserId, peerDevice: latest.peerDevice, latest, unread, messages: asc });
  }

  // Most recent conversation first.
  threads.sort((a, b) => b.latest.id - a.latest.id);
  return threads;
}
