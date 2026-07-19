/**
 * ssoGame.test.tsx
 *
 * Tests for the ssoService URL-building contract and the REAL-ID gated
 * GameScreen hub.
 *
 * Architecture (updated 2026-07-19, REAL-ID auto-fallback — Khabat req that
 * Shahnameh never require Telegram inside RealGram):
 *   - authStore.user.realId === '' → GameScreen silently probes
 *     checkAndCacheRealId(deviceId) (forGame=true under the hood) on mount;
 *     with the panel's REAL-ID fallback this should resolve to 'ok' for
 *     virtually every RealGram user, so the gate is expected to be rare.
 *   - If that probe still doesn't produce a realId, RealIdGate shows an
 *     INTERNAL retry screen (realId.gateTitle) — never an auto-opened
 *     Telegram/RealGram WebView. Linking an existing Telegram account is a
 *     manual, secondary action only, never automatic.
 *   - authStore.user.realId !== '' → hub shown, no linking WebView
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { buildGameUrl, SsoResult } from '../services/ssoService';

jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mutable so individual tests can set realId; setRealId actually mutates it
// (mirrors the real store closely enough for checkAndCacheRealId's
// useAuthStore.getState().setRealId(...) call to have an observable effect).
let mockRealId = '';
const mockSetRealId = jest.fn((id: string) => { mockRealId = id; });
const useAuthStoreMock: any = (sel: any) => sel({ user: { deviceId: 'dev-9', realId: mockRealId } });
useAuthStoreMock.getState = () => ({
  setRealId: mockSetRealId,
  user: { deviceId: 'dev-9', realId: mockRealId },
});
jest.mock('../stores/authStore', () => ({ useAuthStore: useAuthStoreMock }));

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

// ── GameScreen without a cached REAL-ID → silently self-resolves, no Telegram ──
// (2026-07-19: the panel's REAL-ID auto-fallback means the on-mount probe
// should succeed for virtually every RealGram user with zero user action.)
describe('GameScreen without a cached REAL-ID, server-side probe succeeds', () => {
  const { getSsoToken } = require('../services/ssoService');

  beforeEach(() => { mockRealId = ''; mockSetRealId.mockClear(); (getSsoToken as jest.Mock).mockClear(); });

  it('never shows a Telegram/RealGram WebView or the retry gate — resolves straight to the hub', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<GameScreen />);
      await Promise.resolve(); await Promise.resolve();
    });

    expect(tree.root.findAll((n) => n.type === ('WebView' as any))).toHaveLength(0);
    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts).not.toContain('realId.gateTitle');
    expect(texts).toContain('game.enterShahnameh');
  });

  it('probes with forGame=true (req #1/#2/#3: RealGram auto-provisions via REAL-ID)', async () => {
    await act(async () => {
      renderer.create(<GameScreen />);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(getSsoToken).toHaveBeenCalledWith('dev-9', true);
  });
});

// ── GameScreen without a cached REAL-ID, server-side probe fails ─────────────
describe('GameScreen without a cached REAL-ID, server-side probe fails (req #6)', () => {
  const { getSsoToken } = require('../services/ssoService');

  beforeEach(() => {
    mockRealId = '';
    (getSsoToken as jest.Mock).mockReset().mockResolvedValue({ ...base, status: 'unlinked' });
  });

  it('shows an internal RealGram retry screen, never an auto-opened Telegram WebView', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<GameScreen />);
      await Promise.resolve(); await Promise.resolve();
    });

    expect(tree.root.findAll((n) => n.type === ('WebView' as any))).toHaveLength(0);
    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts).toContain('realId.gateTitle');
    expect(texts).toContain('realId.tryAgain');
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
