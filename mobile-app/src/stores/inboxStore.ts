import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';

/**
 * Admin → user message inbox (announcement center).
 *
 * Transport is poll-based (no FCM): `refresh()` pulls unacked messages from
 * get-messages and stores them locally as unread. The unread count drives the
 * BottomNav badge; `markRead()` acks the message on the backend (so it never
 * comes back) and flips it locally. Messages persist so users can re-read
 * announcements after acking.
 */

export interface InboxMessage {
  id:        number;
  title:     string;
  body:      string;
  createdAt: string;
  read:      boolean;
}

interface InboxState {
  messages:    InboxMessage[];
  lastFetchAt: number;

  unreadCount: () => number;
  refresh:     (deviceId: string) => Promise<number>;  // returns # of new messages
  markRead:    (deviceId: string, messageId: number) => void;
  markAllRead: (deviceId: string) => void;
}

const MAX_STORED = 50;

export const useInboxStore = create<InboxState>()(
  persist(
    (set, get) => ({
      messages:    [],
      lastFetchAt: 0,

      unreadCount: () => get().messages.filter(m => !m.read).length,

      refresh: async (deviceId: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getMessages } = require('../services/entitlementService');
          const fetched = await getMessages(deviceId) as Array<{ id: number; title: string; body: string; created_at: string }>;
          const existing = new Set(get().messages.map(m => m.id));
          const fresh = fetched
            .filter(m => !existing.has(m.id))
            .map(m => ({
              id:        m.id,
              title:     m.title || 'RealGram',
              body:      m.body,
              createdAt: m.created_at,
              read:      false,
            }));
          if (fresh.length > 0) {
            set(s => ({
              messages:    [...fresh, ...s.messages].slice(0, MAX_STORED),
              lastFetchAt: Date.now(),
            }));
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { useToastStore } = require('./toastStore');
              useToastStore.getState().show(
                fresh.length === 1 ? `📬 ${fresh[0]!.title}` : `📬 ${fresh.length} new messages`,
                'info'
              );
            } catch {}
          } else {
            set({ lastFetchAt: Date.now() });
          }
          return fresh.length;
        } catch {
          return 0;     // offline — retry on next poll
        }
      },

      markRead: (deviceId, messageId) => {
        set(s => ({
          messages: s.messages.map(m => m.id === messageId ? { ...m, read: true } : m),
        }));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { ackMessage } = require('../services/entitlementService');
          ackMessage(deviceId, messageId).catch(() => {});
        } catch {}
      },

      markAllRead: (deviceId) => {
        const unread = get().messages.filter(m => !m.read);
        set(s => ({ messages: s.messages.map(m => ({ ...m, read: true })) }));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { ackMessage } = require('../services/entitlementService');
          unread.forEach(m => ackMessage(deviceId, m.id).catch(() => {}));
        } catch {}
      },
    }),
    {
      name:    'setalink-inbox-v1',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ messages: s.messages, lastFetchAt: s.lastFetchAt }) as any,
    }
  )
);
