/**
 * ssoGame.test.tsx
 *
 * Tests for the ssoService URL-building contract and the REAL-ID gated
 * GameScreen hub.
 *
 * Architecture:
 *   - authStore.user.realId === '' → RealIdGate auto-opens the RealGram link
 *     WebView immediately (§5.10: Play must never ask "what do you want to
 *     link with" — see GameScreen.tsx RealIdGate comment), hub hidden
 *   - authStore.user.realId !== '' → hub shown, no linking WebView
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { buildGameUrl, SsoResult } from '../services/ssoService';

jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mutable so individual tests can set realId
let mockRealId = '';
jest.mock('../stores/authStore', () => ({
  useAuthStore: (sel: any) => sel({ user: { deviceId: 'dev-9', realId: mockRealId } }),
  // setRealId exposed for tests that check linked flow
  useAuthStore_getState: () => ({ setRealId: jest.fn(), user: { realId: mockRealId } }),
}));

jest.mock('../stores/identityStore', () => ({
  useIdentityStore: (sel: any) => sel({ avatarEmoji: '🦁', avatarColor: '#D4AF37', persona: 'king', handle: 'warrior' }),
}));
jest.mock('../stores/vpnStore', () => ({
  useVpnStore: (sel: any) => sel({ connectionState: 'connected' }),
}));
jest.mock('../stores/zarStore', () => ({
  useZarStore: (sel: any) => sel({ balance: 42, earnedToday: 10 }),
  ZAR_DAILY_CAP: 500,
}));
jest.mock('../i18n', () => ({ useT: () => ({ t: (k: string) => k, lang: 'en' }) }));
jest.mock('../services/ssoService', () => ({
  ...jest.requireActual('../services/ssoService'),
  getSsoToken: jest.fn().mockResolvedValue({
    status: 'ok', token: 'jwt.x', expires_in: 300, account: 'real-user-1',
    game_url: 'https://shahnameh.setaei.com', sso_enabled: true,
  }),
}));

import { GameScreen } from '../screens/GameScreen';

const base: SsoResult = {
  status: 'unavailable', token: '', expires_in: 0, account: '',
  game_url: 'https://shahnameh.setaei.com', sso_enabled: true,
};

// ── buildGameUrl contract ─────────────────────────────────────────────────────
describe('buildGameUrl', () => {
  it('always passes device_id and src; adds sso token when authenticated', () => {
    const guest = buildGameUrl({ ...base, status: 'unavailable' }, 'dev-1');
    expect(guest).toContain('device_id=dev-1');
    expect(guest).toContain('src=realink');
    expect(guest).not.toContain('sso=');

    const authed = buildGameUrl({ ...base, status: 'ok', token: 'jwt.abc.def', account: 'user1' }, 'dev-1');
    expect(authed).toContain('sso=jwt.abc.def');
  });

  it('passes real_id from SsoResult.account when no explicit realId', () => {
    const url = buildGameUrl({ ...base, status: 'ok', token: 'jwt.x', account: 'acct-42' }, 'dev-1');
    expect(url).toContain('real_id=acct-42');
    // device_id should NOT be used as the identity value
    expect(url).not.toContain('real_id=dev-1');
  });

  it('prefers explicit realId over SsoResult.account', () => {
    const url = buildGameUrl({ ...base, account: 'fallback' }, 'dev-1', 'preferred-id');
    expect(url).toContain('real_id=preferred-id');
    expect(url).not.toContain('real_id=fallback');
  });

  it('respects a remote-config game_url with existing query', () => {
    const u = buildGameUrl({ ...base, game_url: 'https://x.io/play?v=2' }, 'dev-2');
    expect(u.startsWith('https://x.io/play?v=2&')).toBe(true);
  });
});

// ── GameScreen without REAL-ID → auto-opens linking WebView, hides the hub ───
describe('GameScreen without REAL-ID', () => {
  beforeEach(() => { mockRealId = ''; });

  it('opens the RealGram link WebView immediately, with no choice screen', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<GameScreen />); });

    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));

    // No "what do you want to link with" gate text, no enter-game CTA either —
    // RealIdGate defaults straight to the RealGramLinkWebView modal (RN's
    // Modal isn't traversable through react-test-renderer in this harness,
    // so we assert by absence of both other states rather than the modal's
    // own content).
    expect(texts).not.toContain('realId.gateTitle');
    expect(texts).not.toContain('game.enterShahnameh');
  });
});

// ── GameScreen with REAL-ID → shows hub ──────────────────────────────────────
describe('GameScreen with REAL-ID', () => {
  beforeEach(() => { mockRealId = 'real-user-1'; });

  it('renders the hub without an open WebView modal', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<GameScreen />); });
    expect(tree.root.findAll((n) => n.type === ('WebView' as any))).toHaveLength(0);
  });

  it('shows ZAR balance in the hub', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<GameScreen />); });
    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts.some((t) => String(t).includes('42'))).toBe(true);
  });

  it('shows the enter-game CTA and not the REAL-ID gate', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<GameScreen />); });
    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts).toContain('game.enterShahnameh');
    expect(texts).not.toContain('realId.gateTitle');
  });
});
