import { buildConversations, buildOfficialConversation, totalUnread, OFFICIAL_KEY } from '../utils/unifiedThreads';
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
  it('pins the official announcements thread first, DMs after', () => {
    const convos = buildConversations(
      [dm({ id: 1, peerDevice: 'dev-a' })],
      [ann({ id: 5 })],
      'ReaLink',
    );
    expect(convos[0]!.key).toBe(OFFICIAL_KEY);
    expect(convos[0]!.official).toBe(true);
    expect(convos[0]!.kind).toBe('official');
    expect(convos[1]!.kind).toBe('dm');
    expect(convos[1]!.peerDevice).toBe('dev-a');
  });

  it('omits the official thread entirely when there are no announcements', () => {
    const convos = buildConversations([dm({ id: 1 })], [], 'ReaLink');
    expect(convos.every(c => !c.official)).toBe(true);
    expect(convos).toHaveLength(1);
  });

  it('collapses one DM peer into a single conversation (no split rows)', () => {
    const convos = buildConversations(
      [dm({ id: 1, peerDevice: 'dev-a', direction: 'in' }),
       dm({ id: 2, peerDevice: 'dev-a', direction: 'out', body: 'reply' })],
      [], 'ReaLink',
    );
    expect(convos).toHaveLength(1);
    expect(convos[0]!.messages).toHaveLength(2);
    expect(convos[0]!.latest.body).toBe('reply');       // newest last
  });

  it('orders DM threads newest-first', () => {
    const convos = buildConversations(
      [dm({ id: 1, peerDevice: 'dev-old' }), dm({ id: 9, peerDevice: 'dev-new' })],
      [], 'ReaLink',
    );
    expect(convos.map(c => c.peerDevice)).toEqual(['dev-new', 'dev-old']);
  });

  it('counts unread across DMs + announcements', () => {
    const convos = buildConversations(
      [dm({ id: 1, direction: 'in', read: false })],
      [ann({ id: 5, read: false }), ann({ id: 6, read: true })],
      'ReaLink',
    );
    expect(totalUnread(convos)).toBe(2);   // 1 DM + 1 announcement unread
  });
});

describe('unifiedThreads.buildOfficialConversation', () => {
  it('returns null with no announcements', () => {
    expect(buildOfficialConversation([], 'ReaLink')).toBeNull();
  });

  it('sorts announcements oldest→newest and marks all incoming', () => {
    const c = buildOfficialConversation([ann({ id: 9, body: 'new' }), ann({ id: 2, body: 'old' })], 'ReaLink')!;
    expect(c.messages.map(m => m.body)).toEqual(['old', 'new']);
    expect(c.messages.every(m => m.direction === 'in')).toBe(true);
    expect(c.latest.body).toBe('new');
    expect(c.title).toBe('ReaLink');
  });
});
