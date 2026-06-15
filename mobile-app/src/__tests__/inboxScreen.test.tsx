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

jest.mock('../stores/inboxStore', () => ({
  useInboxStore: (sel: any) => sel({
    messages: [], markRead: () => {}, markAllRead: () => {}, refresh: () => Promise.resolve(0),
  }),
}));

jest.mock('../stores/dmStore', () => ({
  useDMStore: (sel: any) => sel({
    messages: [{
      id: 1, direction: 'in', peerUserId: 'SL-227-62DAC5F0', peerDevice: 'dev-x',
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

describe('InboxScreen — conversation tap (v0.9.35 threads)', () => {
  beforeEach(() => mockDmMarkRead.mockClear());

  it('groups by peer and opens the chat thread (not compose), marking read', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;

    expect(root.findByProps({ testID: 'dm-thread-modal' }).props.visible).toBe(false);
    expect(root.findByProps({ testID: 'dm-compose-modal' }).props.visible).toBe(false);

    // One thread row keyed by peer device.
    act(() => { root.findByProps({ testID: 'dm-thread-dev-x' }).props.onPress(); });

    expect(root.findByProps({ testID: 'dm-thread-modal' }).props.visible).toBe(true);
    expect(root.findByProps({ testID: 'dm-compose-modal' }).props.visible).toBe(false);
    // Body is shown in the conversation.
    expect(textValues(root)).toContain('hello there');
    // Marked read on open.
    expect(mockDmMarkRead).toHaveBeenCalledWith('dev-me', 1);
  });

  it('exposes a delete-thread control in the open thread', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;
    act(() => { root.findByProps({ testID: 'dm-thread-dev-x' }).props.onPress(); });
    expect(root.findByProps({ testID: 'dm-thread-delete' })).toBeTruthy();
    expect(root.findByProps({ testID: 'dm-thread-input' })).toBeTruthy();
  });
});
