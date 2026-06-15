import React from 'react';
import renderer, { act } from 'react-test-renderer';

// BUG-1 regression: tapping a received message must open the message DETAIL
// view (and mark it read), NOT the "New message" compose modal.

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
      body: 'hello there', read: false, createdAt: '2026-06-14T12:00:00',
    }],
    refresh: () => Promise.resolve(0),
    send: () => Promise.resolve(),
    markRead: mockDmMarkRead,
    sending: false,
  }),
}));

import { InboxScreen } from '../screens/InboxScreen';

describe('InboxScreen — received message tap (BUG-1)', () => {
  beforeEach(() => mockDmMarkRead.mockClear());

  it('opens the detail modal (not compose) and marks the message read', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;

    // Before tapping: both modals closed.
    expect(root.findByProps({ testID: 'dm-detail-modal' }).props.visible).toBe(false);
    expect(root.findByProps({ testID: 'dm-compose-modal' }).props.visible).toBe(false);

    // Tap the received message row.
    act(() => { root.findByProps({ testID: 'dm-row-1' }).props.onPress(); });

    // Detail opens; compose stays closed; read marked once.
    expect(root.findByProps({ testID: 'dm-detail-modal' }).props.visible).toBe(true);
    expect(root.findByProps({ testID: 'dm-compose-modal' }).props.visible).toBe(false);
    expect(mockDmMarkRead).toHaveBeenCalledTimes(1);
    expect(mockDmMarkRead).toHaveBeenCalledWith('dev-me', 1);
  });

  it('Reply prefills the sender ID and switches to compose', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InboxScreen onBack={() => {}} />); });
    const root = tree.root;

    act(() => { root.findByProps({ testID: 'dm-row-1' }).props.onPress(); });
    act(() => { root.findByProps({ testID: 'dm-reply-btn' }).props.onPress(); });

    expect(root.findByProps({ testID: 'dm-detail-modal' }).props.visible).toBe(false);
    expect(root.findByProps({ testID: 'dm-compose-modal' }).props.visible).toBe(true);
    expect(root.findByProps({ testID: 'dm-recipient-input' }).props.value).toBe('SL-227-62DAC5F0');
  });
});
