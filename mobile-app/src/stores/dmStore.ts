import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';
import type { DirectMessage } from '../services/entitlementService';

/**
 * User-to-user direct messages (v0.9.33 MVP).
 *
 * Like the admin announcement inbox, transport is poll-based (no FCM):
 * `refresh()` pulls the device's full thread (inbox + sent) from list-messages.
 * The server is the source of truth, so we replace the local cache on each
 * fetch rather than merging. Bodies are decrypted server-side. Recipients are
 * addressed by Realink ID only — no phone/email/IP is ever involved.
 */

interface DMState {
  messages:    DirectMessage[];
  lastFetchAt: number;
  sending:     boolean;

  unreadCount: () => number;
  refresh:     (deviceId: string) => Promise<number>;            // returns # unread
  send:        (deviceId: string, recipient: string, body: string) => Promise<void>;
  markRead:    (deviceId: string, messageId: number) => void;
  deleteMessage: (deviceId: string, messageId: number) => void;
  deleteThread:  (deviceId: string, peer: string) => void;
}

const MAX_STORED = 200;

export const useDMStore = create<DMState>()(
  persist(
    (set, get) => ({
      messages:    [],
      lastFetchAt: 0,
      sending:     false,

      unreadCount: () => get().messages.filter(m => m.direction === 'in' && !m.read).length,

      refresh: async (deviceId: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { listMessages } = require('../services/entitlementService');
          const fetched = await listMessages(deviceId) as DirectMessage[];
          const prevUnread = get().messages.filter(m => m.direction === 'in' && !m.read).length;
          const unread = fetched.filter(m => m.direction === 'in' && !m.read).length;
          set({ messages: fetched.slice(0, MAX_STORED), lastFetchAt: Date.now() });
          if (unread > prevUnread) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { useToastStore } = require('./toastStore');
              const n = unread - prevUnread;
              useToastStore.getState().show(
                n === 1 ? '💬 New message' : `💬 ${n} new messages`, 'info');
            } catch {}
            // OS notification for newly received messages (Issue 2). Gated by the
            // user's push-notifications setting; title-only, never the body.
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { notifyNewIncoming } = require('../services/dmNotifications');
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { useSettingsStore } = require('./settingsStore');
              const enabled = !!useSettingsStore.getState().pushNotifications;
              notifyNewIncoming(fetched, enabled).catch(() => {});
            } catch {}
          }
          return unread;
        } catch {
          return get().messages.filter(m => m.direction === 'in' && !m.read).length;
        }
      },

      send: async (deviceId, recipient, body) => {
        set({ sending: true });
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { sendMessage } = require('../services/entitlementService');
          await sendMessage(deviceId, recipient.trim(), body.trim());
          await get().refresh(deviceId);
        } finally {
          set({ sending: false });
        }
      },

      markRead: (deviceId, messageId) => {
        set(s => ({
          messages: s.messages.map(m => m.id === messageId ? { ...m, read: true } : m),
        }));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { markMessageRead } = require('../services/entitlementService');
          markMessageRead(deviceId, messageId).catch(() => {});
        } catch {}
      },

      deleteMessage: (deviceId, messageId) => {
        set(s => ({ messages: s.messages.filter(m => m.id !== messageId) }));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { deleteMessage } = require('../services/entitlementService');
          deleteMessage(deviceId, messageId).catch(() => {});
        } catch {}
      },

      deleteThread: (deviceId, peer) => {
        // Optimistically drop every message with this peer (by device or user id).
        set(s => ({ messages: s.messages.filter(m => m.peerDevice !== peer && m.peerUserId !== peer) }));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { deleteThread } = require('../services/entitlementService');
          deleteThread(deviceId, peer).catch(() => {});
        } catch {}
      },
    }),
    {
      name:    'setalink-dm-v1',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ messages: s.messages, lastFetchAt: s.lastFetchAt }) as any,
    }
  )
);
