import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';

// RN's own jest preset mocks AccessibilityInfo.isReduceMotionEnabled as a
// bare jest.fn() with no default resolution — gold-theme's EmberField
// (ambient background, now used here) calls it directly in a mount effect,
// same gap as realWalletCard.test.tsx's GoldButton fix.
(AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);

// BUG-1 / v0.9.35 #2 regression: tapping a conversation opens the chat THREAD
// (showing the message body, marking it read), NOT the compose modal.

const mockDmMarkRead = jest.fn();

jest.mock('../i18n', () => ({ useT: () => ({ t: (k: string) => k }) }));

// Gold-theme's scroll-clearance fix (BottomNav.CONTENT_HEIGHT + insets.bottom)
// added a real useSafeAreaInsets() call here — no SafeAreaProvider exists in
// this test tree, same pattern already used in ssoGame.test.tsx.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../stores/authStore', () => ({
  useAuthStore: (sel: any) => sel({ user: { deviceId: 'dev-me', userId: 'SL-ME-0001' } }),
}));

jest.mock('../stores/toastStore', () => ({
  useToastStore: { getState: () => ({ show: () => {} }) },
}));

// AdBanner pulls in react-native-google-mobile-ads (native module, not
// registered under jest) — irrelevant to this file's actual assertions
// (thread-open/read-marking behavior), so stub it out same as the other
// store/service mocks above rather than dragging the ad SDK into every
// Inbox test.
jest.mock('../components/AdBanner', () => ({ AdBanner: () => null }));

// InboxScreen now imports callService.ts (the "Call" button, Khabat
// 2026-07-28), which imports react-native-webrtc -- a native module that
// throws at import time outside a real app (`WebRTCModule === null`).
// Stubbed the same way as AdBanner's ad SDK above: this file's assertions
// are about thread-open/read-marking, not calling, and the calling
// useEffect below is inert anyway (canCall is true for this mocked user,
// but RealCallSignalingClient.connect() only ever tries a real
// `new WebSocket(...)` -- also unavailable here, so mock that constructor
// too rather than let it throw).
jest.mock('react-native-webrtc', () => ({
  RTCPeerConnection: class { addEventListener() {} close() {} },
  RTCIceCandidate: class {},
  RTCSessionDescription: class {},
  MediaStream: class {},
  mediaDevices: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) },
}));
(globalThis as any).WebSocket = class {
  onopen: (() => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  close() {}
  send() {}
};

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

// RN's own jest mock gives every host view a bare `measureInWindow = jest.fn()`
// with no default implementation (node_modules/react-native/jest/
// mockNativeComponent.js) — same class of gap as the AccessibilityInfo mock
// above. InboxScreen.tsx's thread/peer overflow menus (the 2026-07-31
// popup-jump fix, acfbe5b) now gate opening on that callback actually
// firing, so without this, menu-driven tests would hang open forever with
// nothing to assert on. The ref this app code calls measureInWindow on
// isn't the same instance `findByProps({testID})` returns (TouchableOpacity
// forwards its ref down to the underlying host View, a separate node) —
// walking the whole tree for every instance exposing measureInWindow and
// stubbing it once covers both known callers (peer-menu + thread-menu)
// without depending on that internal ref plumbing.
function stubMeasureInWindow(root: any): void {
  root.findAll((n: any) => !!n.instance && typeof n.instance.measureInWindow === 'function')
    .forEach((n: any) => { (n.instance.measureInWindow as jest.Mock).mockImplementation((cb: any) => cb(0, 0, 0, 0)); });
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
    stubMeasureInWindow(root);
    act(() => { root.findByProps({ testID: 'convo-dev-x' }).props.onPress(); });
    // Delete now lives behind the header's overflow menu (2026-07-29
    // declutter — was three always-visible icons, see InboxScreen.tsx).
    // Opening it is gated on a measureInWindow callback since acfbe5b's
    // popup-jump fix, hence the stub above.
    act(() => { root.findByProps({ testID: 'convo-menu' }).props.onPress(); });
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
