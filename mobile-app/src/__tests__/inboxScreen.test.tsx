import React from 'react';
import renderer, { act } from 'react-test-renderer';

// BUG-1 / v0.9.35 #2 regression: tapping a conversation opens the chat THREAD
// (showing the message body, marking it read), NOT the compose modal.

const mockDmMarkRead = jest.fn();

jest.mock('../i18n', () => ({ useT: () => ({ t: (k: string) => k }) }));

jest.mock('../stores/authStore', () => ({
  useAuthStore: (sel: any) => sel({ user: { deviceId: 'dev-me', userId: 'SL-ME-0001' } }),
}));

jest.mock('../stores/toastStore', () => ({
  useToastStore: { getState: () => ({ show: () => {} }) },
}));

const mockAnnMarkRead = jest.fn();
let mockAnnouncements: any[] = [];
jest.mock('../stores/inboxStore', () => ({
  useInboxStore: (sel: any) => sel({
    messages: mockAnnouncements, markRead: mockAnnMarkRead, markAllRead: () => {}, refresh: () => Promise.resolve(0),
  }),
}));

jest.mock('../stores/dmStore', () => ({
  useDMStore: (sel: any) => sel({
    messages: [{
      id: 1, direction: 'in', peerUserId: 'SL-227-AAAAAAAA', peerDevice: 'dev-x',
      body: 'hello there', read: false, createdAt: '2026-06-15T12:00:00',
    }],
    refresh: () => Promise.resolve(0),
    send: () => Promise.resolve(),
    markRead: mockDmMarkRead,
    deleteMessage: () => {},
    deleteThread: () => {},
    sending: false,
  }),
}));

import { InboxScreen } from '../screens/InboxScreen';

function textValues(root: any): string[] {
  return root.findAllByType('Text').flatMap((n: any) => {
    const c = n.props.children;
    return typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((x: any) => typeof x === 'string') : [];
  });
}

describe('InboxScreen — unified messenger', () => {
  beforeEach(() => { mockDmMarkRead.mockClear(); mockAnnMarkRead.mockClear(); mockAnnouncements = []; });

  it('groups by peer and opens the chat thread (not compose), marking read', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;

    expect(root.findByProps({ testID: 'convo-modal' }).props.visible).toBe(false);
    expect(root.findByProps({ testID: 'dm-compose-modal' }).props.visible).toBe(false);

    // One conversation row keyed by peer device.
    act(() => { root.findByProps({ testID: 'convo-dev-x' }).props.onPress(); });

    expect(root.findByProps({ testID: 'convo-modal' }).props.visible).toBe(true);
    expect(root.findByProps({ testID: 'dm-compose-modal' }).props.visible).toBe(false);
    expect(textValues(root)).toContain('hello there');
    expect(mockDmMarkRead).toHaveBeenCalledWith('dev-me', 1);
  });

  it('exposes a delete + reply control in an open DM thread', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;
    act(() => { root.findByProps({ testID: 'convo-dev-x' }).props.onPress(); });
    expect(root.findByProps({ testID: 'convo-delete' })).toBeTruthy();
    expect(root.findByProps({ testID: 'convo-input' })).toBeTruthy();
  });

  it('always pins a Support thread and folds announcements into it (two-way)', () => {
    mockAnnouncements = [{ id: 9, title: 'Welcome', body: 'thanks for joining', createdAt: '2026-06-16T09:00:00', read: false }];
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;
    // Pinned Support conversation row exists alongside the DM row.
    const support = root.findByProps({ testID: 'convo-__support__' });
    expect(support).toBeTruthy();

    act(() => { support.props.onPress(); });
    // Support thread shows the folded announcement + IS two-way (reply input present).
    expect(textValues(root)).toContain('thanks for joining');
    expect(root.findByProps({ testID: 'convo-input' })).toBeTruthy();
    expect(mockAnnMarkRead).toHaveBeenCalledWith('dev-me', 9);
  });

  it('shows the Support thread even with no messages', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;
    expect(root.findByProps({ testID: 'convo-__support__' })).toBeTruthy();
  });

  it('deep-links straight into a thread via initialThreadKey (push tap)', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} initialThreadKey="dev-x" />); });
    const root = tree.root;
    // The target conversation opens automatically.
    expect(root.findByProps({ testID: 'convo-modal' }).props.visible).toBe(true);
    expect(textValues(root)).toContain('hello there');
  });
});
