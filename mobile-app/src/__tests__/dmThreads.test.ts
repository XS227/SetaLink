import { groupDmsByPeer } from '../utils/dmThreads';
import { DEFAULT_PEER_BADGE, type DirectMessage } from '../services/entitlementService';

const m = (over: Partial<DirectMessage>): DirectMessage => ({
  id: 1, direction: 'in', peerUserId: 'SL-A', peerDevice: 'dev-a',
  body: 'x', read: false, createdAt: '2026-06-15T10:00:00',
  expireSecs: 0, expiresAt: null, peerBadge: DEFAULT_PEER_BADGE, ...over,
});

describe('groupDmsByPeer', () => {
  it('collapses multiple messages with one peer into a single thread', () => {
    const msgs = [
      m({ id: 3, direction: 'out', peerDevice: 'dev-a', body: 'hi back' }),
      m({ id: 2, direction: 'in',  peerDevice: 'dev-a', body: 'hello', read: false }),
      m({ id: 1, direction: 'in',  peerDevice: 'dev-a', body: 'hey',   read: true }),
    ];
    const threads = groupDmsByPeer(msgs);
    expect(threads).toHaveLength(1);
    expect(threads[0].peerKey).toBe('dev-a');
    expect(threads[0].messages.map(x => x.id)).toEqual([1, 2, 3]); // ascending
    expect(threads[0].latest.id).toBe(3);
    expect(threads[0].unread).toBe(1); // only id 2 is incoming+unread
  });

  it('separates distinct peers and orders by most recent', () => {
    const msgs = [
      m({ id: 10, peerDevice: 'dev-b', peerUserId: 'SL-B' }),
      m({ id: 5,  peerDevice: 'dev-a', peerUserId: 'SL-A' }),
    ];
    const threads = groupDmsByPeer(msgs);
    expect(threads.map(t => t.peerKey)).toEqual(['dev-b', 'dev-a']); // newest latest first
  });

  it('uses a non-empty user id for display when some messages lack it', () => {
    const msgs = [
      m({ id: 2, peerDevice: 'dev-a', peerUserId: '' }),
      m({ id: 1, peerDevice: 'dev-a', peerUserId: 'SL-A' }),
    ];
    const [thread] = groupDmsByPeer(msgs);
    expect(thread.peerUserId).toBe('SL-A');
  });
});
