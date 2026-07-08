import { buildConversations, buildSupportConversation, totalUnread, SUPPORT_KEY, SUPPORT_USER_ID } from '../utils/unifiedThreads';
import type { DirectMessage } from '../services/entitlementService';
import type { InboxMessage } from '../stores/inboxStore';

const dm = (o: Partial<DirectMessage>): DirectMessage => ({
  id: 1, direction: 'in', peerUserId: 'SL-A', peerDevice: 'dev-a', body: 'hi', read: false,
  createdAt: '2026-06-15T10:00:00', ...o,
});
const ann = (o: Partial<InboxMessage>): InboxMessage => ({
  id: 1, title: 'Title', body: 'body', createdAt: '2026-06-15T10:00:00', read: false, ...o,
});

describe('unifiedThreads.buildConversations', () => {
  it('always pins a Support thread first, DMs after', () => {
    const convos = buildConversations([dm({ id: 1, peerDevice: 'dev-a' })], [], 'Support');
    expect(convos[0]!.key).toBe(SUPPORT_KEY);
    expect(convos[0]!.support).toBe(true);
    expect(convos[0]!.kind).toBe('support');
    expect(convos[0]!.peerUserId).toBe(SUPPORT_USER_ID);
    expect(convos[1]!.kind).toBe('dm');
    expect(convos[1]!.peerDevice).toBe('dev-a');
  });

  it('keeps a Support thread even with no messages (empty, latest null)', () => {
    const convos = buildConversations([], [], 'Support');
    expect(convos).toHaveLength(1);
    expect(convos[0]!.key).toBe(SUPPORT_KEY);
    expect(convos[0]!.latest).toBeNull();
    expect(convos[0]!.messages).toHaveLength(0);
  });

  it('routes DMs with the support id INTO the Support thread (not a separate row)', () => {
    const convos = buildConversations(
      [dm({ id: 1, peerUserId: SUPPORT_USER_ID, peerDevice: 'dev-sup', body: 'hello support' }),
       dm({ id: 2, peerUserId: 'SL-OTHER', peerDevice: 'dev-o', body: 'peer msg' })],
      [], 'Support',
    );
    expect(convos).toHaveLength(2);
    expect(convos[0]!.key).toBe(SUPPORT_KEY);
    expect(convos[0]!.messages.map(m => m.body)).toContain('hello support');
    expect(convos[1]!.peerDevice).toBe('dev-o');
  });

  it('folds admin announcements into the Support thread', () => {
    const convos = buildConversations([], [ann({ id: 5, body: 'welcome' })], 'Support');
    expect(convos[0]!.key).toBe(SUPPORT_KEY);
    expect(convos[0]!.messages.map(m => m.body)).toContain('welcome');
    expect(convos[0]!.messages[0]!.kind).toBe('ann');
  });

  it('does not inject a self Support thread for the support account itself', () => {
    const convos = buildConversations(
      [dm({ id: 1, peerUserId: 'SL-USER', peerDevice: 'dev-u' })],
      [ann({ id: 5 })],
      'Support',
      SUPPORT_USER_ID,   // current user IS support
    );
    expect(convos.every(c => c.key !== SUPPORT_KEY)).toBe(true);
    expect(convos[0]!.kind).toBe('dm');
  });

  it('orders DM threads newest-first (after the pinned Support thread)', () => {
    const convos = buildConversations(
      [dm({ id: 1, peerUserId: 'SL-OLD', peerDevice: 'dev-old' }),
       dm({ id: 9, peerUserId: 'SL-NEW', peerDevice: 'dev-new' })],
      [], 'Support',
    );
    expect(convos.slice(1).map(c => c.peerDevice)).toEqual(['dev-new', 'dev-old']);
  });

  it('counts unread across support DMs + announcements + peer DMs', () => {
    const convos = buildConversations(
      [dm({ id: 1, peerUserId: SUPPORT_USER_ID, peerDevice: 'dev-sup', direction: 'in', read: false }),
       dm({ id: 2, peerUserId: 'SL-OTHER', peerDevice: 'dev-o', direction: 'in', read: false })],
      [ann({ id: 5, read: false }), ann({ id: 6, read: true })],
      'Support',
    );
    expect(totalUnread(convos)).toBe(3);   // 1 support DM + 1 announcement + 1 peer DM
  });
});

describe('unifiedThreads.buildSupportConversation', () => {
  it('merges support DMs + announcements chronologically', () => {
    const c = buildSupportConversation(
      [dm({ id: 3, peerUserId: SUPPORT_USER_ID, body: 'later', createdAt: '2026-06-15T12:00:00' })],
      [ann({ id: 5, body: 'earlier', createdAt: '2026-06-15T09:00:00' })],
      'Support',
    );
    expect(c.messages.map(m => m.body)).toEqual(['earlier', 'later']);
    expect(c.latest!.body).toBe('later');
    expect(c.title).toBe('Support');
    expect(c.support).toBe(true);
  });

  it('is empty (latest null) with no messages', () => {
    const c = buildSupportConversation([], [], 'Support');
    expect(c.latest).toBeNull();
    expect(c.messages).toHaveLength(0);
    expect(c.peerUserId).toBe(SUPPORT_USER_ID);
  });
});
