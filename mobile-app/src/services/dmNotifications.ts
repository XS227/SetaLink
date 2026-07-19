import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { storage, syncGet } from '../storage/storage';

/**
 * Direct-message local notifications (Issue 2, first step — option B).
 *
 * RN core can't post Android notifications, so this wraps the native
 * `DmNotification` module (NotificationHelper.showMessage). It is best-effort and
 * degrades to a no-op when the native module is absent (e.g. in tests or an old
 * build). The DM poll calls `notifyNewIncoming()` whenever `list-messages`
 * returns new received messages; for privacy we show only the sender label
 * ("New message from SL-…"), never the decrypted body.
 *
 * Fully-closed delivery (app process killed) needs FCM or a WorkManager poll —
 * tracked as Phase 2. This step covers foreground + backgrounded-but-alive.
 */

const NOTIFIED_KEY = 'setalink-dm-notified-v1';
const MAX_TRACKED  = 300;

export interface NotifiableMessage {
  id:         number;
  direction:  'in' | 'out';
  read:       boolean;
  peerUserId: string;
  peerDevice: string;
}

/** Pure: pick received, unread messages we haven't notified about yet. Each
 *  carries the deep-link route into its DM thread ('inbox:<peerDevice>') so a
 *  notification tap opens straight into that conversation. */
export function newIncomingToNotify(
  messages: NotifiableMessage[],
  alreadyNotified: number[],
): Array<{ id: number; sender: string; route: string }> {
  const seen = new Set(alreadyNotified);
  return messages
    .filter(m => m.direction === 'in' && !m.read && !seen.has(m.id))
    .map(m => ({
      id:     m.id,
      sender: m.peerUserId || m.peerDevice || 'RealGram',
      route:  m.peerDevice ? `inbox:${m.peerDevice}` : 'inbox',
    }));
}

function loadNotified(): number[] {
  try {
    const raw = syncGet(NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch { return []; }
}

function saveNotified(ids: number[]): void {
  try { storage.setItem(NOTIFIED_KEY, JSON.stringify(ids.slice(-MAX_TRACKED))); } catch {}
}

function nativeModule(): any | null {
  return (NativeModules as any)?.DmNotification ?? null;
}

/** Ask for POST_NOTIFICATIONS on Android 13+ (no-op below 33 / non-Android). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
  try {
    const perm = (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS;
    if (!perm) return true;
    const granted = await PermissionsAndroid.request(perm);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch { return false; }
}

/**
 * Fire notifications for any new received messages. `enabled` mirrors the user's
 * push-notifications setting. Returns the count of notifications posted.
 */
export async function notifyNewIncoming(
  messages: NotifiableMessage[],
  enabled: boolean,
): Promise<number> {
  if (!enabled) return 0;
  const mod = nativeModule();
  if (!mod?.notifyMessage) return 0;

  const notified = loadNotified();
  const toNotify = newIncomingToNotify(messages, notified);
  if (toNotify.length === 0) return 0;

  let posted = 0;
  for (const m of toNotify) {
    try {
      // Title only — never leak the message body into the notification (privacy).
      // `route` deep-links the tap into this DM thread; older native builds that
      // ignore the extra arg simply fall back to the inbox list.
      await mod.notifyMessage(`New message from ${m.sender}`, null, m.id, m.route);
      posted++;
    } catch { /* best-effort */ }
  }
  saveNotified([...notified, ...toNotify.map(m => m.id)]);
  return posted;
}

/** Route the app was opened into via a notification tap, else null. Forms:
 *    'inbox'                 → open the inbox list
 *    'inbox:<threadKey>'     → deep-link straight into that conversation
 *  where <threadKey> is a DM peer key or the official key ('__official__'). */
export async function consumeInitialRoute(): Promise<string | null> {
  const mod = nativeModule();
  if (!mod?.consumeInitialRoute) return null;
  try { return (await mod.consumeInitialRoute()) ?? null; } catch { return null; }
}

export interface InboxRoute { open: boolean; threadKey: string | null; }

/** Pure: parse a native route string into an inbox navigation intent. */
export function parseInboxRoute(route: string | null | undefined): InboxRoute {
  if (!route) return { open: false, threadKey: null };
  if (route === 'inbox') return { open: true, threadKey: null };
  if (route.startsWith('inbox:')) {
    const key = route.slice('inbox:'.length).trim();
    return { open: true, threadKey: key.length ? key : null };
  }
  return { open: false, threadKey: null };
}
