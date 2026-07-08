import { newIncomingToNotify, parseInboxRoute, type NotifiableMessage } from '../services/dmNotifications';

// Issue 2: only NEW received-and-unread messages should trigger a notification,
// and never the same message twice (dedup).
const msg = (over: Partial<NotifiableMessage>): NotifiableMessage => ({
  id: 1, direction: 'in', read: false, peerUserId: 'SL-227-62DAC5F0', peerDevice: 'dev-x', ...over,
});

describe('newIncomingToNotify', () => {
  it('notifies for a new unread incoming message, with a deep-link route', () => {
    expect(newIncomingToNotify([msg({ id: 5 })], [])).toEqual([{ id: 5, sender: 'SL-227-62DAC5F0', route: 'inbox:dev-x' }]);
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
    expect(newIncomingToNotify([msg({ id: 7, peerUserId: '' })], [])).toEqual([{ id: 7, sender: 'dev-x', route: 'inbox:dev-x' }]);
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

describe('parseInboxRoute — notification-tap deep-link', () => {
  it('returns closed for null/unknown routes', () => {
    expect(parseInboxRoute(null)).toEqual({ open: false, threadKey: null });
    expect(parseInboxRoute('settings')).toEqual({ open: false, threadKey: null });
  });

  it('opens the inbox list for a bare "inbox"', () => {
    expect(parseInboxRoute('inbox')).toEqual({ open: true, threadKey: null });
  });

  it('deep-links into a specific DM thread', () => {
    expect(parseInboxRoute('inbox:dev-x')).toEqual({ open: true, threadKey: 'dev-x' });
  });

  it('deep-links into the official thread', () => {
    expect(parseInboxRoute('inbox:__official__')).toEqual({ open: true, threadKey: '__official__' });
  });

  it('treats an empty key as the inbox list', () => {
    expect(parseInboxRoute('inbox:')).toEqual({ open: true, threadKey: null });
  });
});
