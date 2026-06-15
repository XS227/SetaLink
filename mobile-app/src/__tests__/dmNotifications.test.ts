import { newIncomingToNotify, type NotifiableMessage } from '../services/dmNotifications';

// Issue 2: only NEW received-and-unread messages should trigger a notification,
// and never the same message twice (dedup).
const msg = (over: Partial<NotifiableMessage>): NotifiableMessage => ({
  id: 1, direction: 'in', read: false, peerUserId: 'SL-227-62DAC5F0', peerDevice: 'dev-x', ...over,
});

describe('newIncomingToNotify', () => {
  it('notifies for a new unread incoming message', () => {
    expect(newIncomingToNotify([msg({ id: 5 })], [])).toEqual([{ id: 5, sender: 'SL-227-62DAC5F0' }]);
  });

  it('ignores outgoing messages', () => {
    expect(newIncomingToNotify([msg({ id: 5, direction: 'out' })], [])).toEqual([]);
  });

  it('ignores already-read messages', () => {
    expect(newIncomingToNotify([msg({ id: 5, read: true })], [])).toEqual([]);
  });

  it('does not re-notify messages already notified (dedup)', () => {
    expect(newIncomingToNotify([msg({ id: 5 })], [5])).toEqual([]);
  });

  it('falls back to peerDevice when no user id', () => {
    expect(newIncomingToNotify([msg({ id: 7, peerUserId: '' })], [])).toEqual([{ id: 7, sender: 'dev-x' }]);
  });

  it('handles a mixed batch', () => {
    const batch = [
      msg({ id: 1, read: true }),               // read → skip
      msg({ id: 2 }),                            // new → notify
      msg({ id: 3, direction: 'out' }),          // out → skip
      msg({ id: 4 }),                            // already notified → skip
    ];
    expect(newIncomingToNotify(batch, [4]).map(m => m.id)).toEqual([2]);
  });
});
