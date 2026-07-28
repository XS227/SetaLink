/**
 * ssoGame.test.tsx
 *
 * Tests for the ssoService URL-building contract and the REAL-ID gated
 * GameScreen.
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
 *   - authStore.user.realId !== '' → GameScreen renders GameWebView
 *     (Shahnameh's own homepage) directly — no native hub, no "Enter
 *     Shahnameh" button (2026-07-19 redesign: "RealGram-versjonen skal i
 *     praksis være Shahnameh-siden innebygd direkte", Khabat — the native
 *     card hub was a parallel/duplicate page and is gone).
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { buildGameUrl, SsoResult } from '../services/ssoService';

// GameWebView (2026-07-19 redesign) arms a real 20s setTimeout as a load
// watchdog. The test WebView mock below never fires onLoadEnd/onError (it's
// just the string 'WebView', not an actual native view), so that timer is
// always still pending when a test finishes — with real timers it fires
// tens of seconds later, after Jest has torn the environment down, crashing
// the process. Fake timers keep it inert unless a test explicitly advances
// the clock; Promise microtask chains (the `await Promise.resolve()` flushes
// throughout this file) are unaffected by this and still resolve normally.
jest.useFakeTimers();

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
// getSsoToken is mocked directly; checkAndCacheRealId is ALSO mocked (not
// left as jest.requireActual's real implementation) because the real
// function's internal call to getSsoToken binds to the module's own
// internal reference, not the exported mock below -- overriding only the
// export doesn't intercept that internal call. Reimplementing
// checkAndCacheRealId here against the same mock keeps it testable and
// matches the real function's actual logic (see ssoService.ts).
const mockGetSsoToken = jest.fn().mockResolvedValue({
  status: 'ok', token: 'jwt.x', expires_in: 300, account: 'real-user-1',
  game_url: 'https://shahnameh.setaei.com', sso_enabled: true,
});
jest.mock('../services/ssoService', () => ({
  ...jest.requireActual('../services/ssoService'),
  getSsoToken: (...args: unknown[]) => mockGetSsoToken(...args),
  checkAndCacheRealId: jest.fn(async (deviceId: string) => {
    if (!deviceId) return;
    try {
      const r = await mockGetSsoToken(deviceId, true);
      if (r.status === 'ok' && r.account) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('../stores/authStore');
        const current = useAuthStore.getState().user?.realId;
        if (!current) useAuthStore.getState().setRealId(r.account);
      }
    } catch { /* ignore, matches real implementation */ }
  }),
}));

import { GameScreen } from '../screens/GameScreen';

const base: SsoResult = {
  status: 'unavailable', token: '', expires_in: 0, account: '', telegram_id: '',
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
  

  beforeEach(() => { mockRealId = ''; mockSetRealId.mockClear(); mockGetSsoToken.mockClear(); });

  it('never shows the retry gate — resolves straight into the Shahnameh WebView, no Telegram/RealGram linking screen', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<GameScreen />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    // Exactly one WebView — Shahnameh itself. Not zero (no native hub to
    // fall back to anymore) and not more than one (no auto-opened linking
    // WebView alongside it).
    expect(tree.root.findAll((n) => n.type === ('WebView' as any))).toHaveLength(1);
    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts).not.toContain('realId.gateTitle');
  });

  it('probes with forGame=true (req #1/#2/#3: RealGram auto-provisions via REAL-ID)', async () => {
    await act(async () => {
      renderer.create(<GameScreen />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(mockGetSsoToken).toHaveBeenCalledWith('dev-9', true);
  });
});

// ── GameScreen without a cached REAL-ID, server-side probe fails ─────────────
describe('GameScreen without a cached REAL-ID, server-side probe fails (req #6)', () => {
  

  beforeEach(() => {
    mockRealId = '';
    mockGetSsoToken.mockReset().mockResolvedValue({ ...base, status: 'unlinked' });
  });

  it('shows an internal RealGram retry screen, never an auto-opened Telegram WebView', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<GameScreen />);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(tree.root.findAll((n) => n.type === ('WebView' as any))).toHaveLength(0);
    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts).toContain('realId.gateTitle');
    expect(texts).toContain('realId.tryAgain');
  });
});

// ── GameScreen with REAL-ID → embeds Shahnameh directly ──────────────────────
// 2026-07-19 redesign (Khabat): no native hub screen at all — GameScreen IS
// GameWebView once REAL-ID is known. GameWebView's own sso-token fetch
// (a second, later call than any identity probe) is async, so these need
// promise-flushing act() calls, not sync ones.
describe('GameScreen with REAL-ID', () => {
  beforeEach(() => { mockRealId = 'real-user-1'; mockGetSsoToken.mockClear(); });

  const flush = () => act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await Promise.resolve(); await Promise.resolve();
  });

  it('renders exactly one WebView (Shahnameh itself), not a native hub', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<GameScreen />); });
    await flush();
    expect(tree.root.findAll((n) => n.type === ('WebView' as any))).toHaveLength(1);
  });

  it('does not show the REAL-ID gate', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<GameScreen />); });
    await flush();
    const texts = tree.root
      .findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts).not.toContain('realId.gateTitle');
  });

  it('fetches a fresh sso token for the embedded WebView URL (forGame=true)', async () => {
    await act(async () => { renderer.create(<GameScreen />); });
    await flush();
    expect(mockGetSsoToken).toHaveBeenCalledWith('dev-9', true);
  });
});
