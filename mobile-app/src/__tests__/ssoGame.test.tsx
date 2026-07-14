import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { buildGameUrl, SsoResult } from '../services/ssoService';

// react-native-webview is a native module — mock it so the screen renders.
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));

const mockGetSsoToken = jest.fn();
jest.mock('../services/ssoService', () => ({
  ...jest.requireActual('../services/ssoService'),
  getSsoToken: (...a: any[]) => mockGetSsoToken(...a),
}));

jest.mock('../stores/authStore', () => ({
  useAuthStore: (sel: any) => sel({ user: { deviceId: 'dev-9' } }),
}));
jest.mock('../i18n', () => ({ useT: () => ({ t: (k: string) => k, lang: 'en' }) }));

import { GameScreen } from '../screens/GameScreen';

const base: SsoResult = {
  status: 'unavailable', token: '', expires_in: 0, account: '',
  game_url: 'https://shahnameh.setaei.com', sso_enabled: true,
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('buildGameUrl (SSO contract 6)', () => {
  it('passes device_id + src always, sso token only when authenticated', () => {
    const guest = buildGameUrl({ ...base, status: 'unavailable' }, 'dev-1');
    expect(guest).toContain('device_id=dev-1');
    expect(guest).toContain('src=realink');
    expect(guest).not.toContain('sso=');

    const authed = buildGameUrl({ ...base, status: 'ok', token: 'jwt.abc.def' }, 'dev-1');
    expect(authed).toContain('sso=jwt.abc.def');
  });

  it('respects a remote-config game_url with existing query', () => {
    const u = buildGameUrl({ ...base, game_url: 'https://x.io/play?v=2' }, 'dev-2');
    expect(u.startsWith('https://x.io/play?v=2&')).toBe(true);
  });
});

describe('GameScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the link prompt when the account is unlinked', async () => {
    mockGetSsoToken.mockResolvedValue({ ...base, status: 'unlinked' });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<GameScreen />); });
    await flush();
    const texts = tree.root.findAllByType('Text' as any)
      .flatMap((n) => React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'));
    expect(texts).toContain('game.linkTitle');
    expect(tree.root.findAll((n) => n.type === ('WebView' as any)).length).toBe(0);
  });

  it('renders the WebView when authenticated', async () => {
    mockGetSsoToken.mockResolvedValue({ ...base, status: 'ok', token: 'jwt.x' });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<GameScreen />); });
    await flush();
    expect(tree.root.findAll((n) => n.type === ('WebView' as any)).length).toBe(1);
  });

  it('loads the WebView (guest) when the issuer is unavailable', async () => {
    mockGetSsoToken.mockResolvedValue({ ...base, status: 'unavailable' });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<GameScreen />); });
    await flush();
    expect(tree.root.findAll((n) => n.type === ('WebView' as any)).length).toBe(1);
  });
});
