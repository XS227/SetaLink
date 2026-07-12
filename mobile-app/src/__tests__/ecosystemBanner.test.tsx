import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';

// Remote config is the unit under test's input — swap it per test.
const mockGetCachedConfig = jest.fn();
jest.mock('../services/remoteConfigService', () => ({
  getCachedConfig: (...a: any[]) => mockGetCachedConfig(...a),
}));

const mockTrackEvent = jest.fn();
jest.mock('../services/analytics', () => ({
  trackEvent: (...a: any[]) => mockTrackEvent(...a),
  Events: { ECOSYSTEM_BANNER_CLICK: 'ecosystem_banner_click' },
}));

jest.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { deviceId: 'dev-test-1' } }) },
}));

jest.mock('../i18n', () => ({
  useT: () => ({ t: (k: string) => k, isRTL: false, lang: 'en' }),
}));

import { EcosystemBanner } from '../components/EcosystemBanner';

const texts = (tree: renderer.ReactTestRenderer): string[] =>
  tree.root.findAllByType('Text' as any).flatMap((n) =>
    React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'),
  ) as string[];

describe('EcosystemBanner — remote-config campaigns', () => {
  beforeEach(() => {
    jest.useFakeTimers();  // the banner runs Animated loops + a rotation interval
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
  });
  afterEach(() => jest.useRealTimers());

  it('renders the embedded promos when no remote config is cached', () => {
    mockGetCachedConfig.mockReturnValue({});
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<EcosystemBanner pin="shahnameh" />); });
    expect(texts(tree)).toContain('bn.shahTitle');
  });

  it('hides entirely when the remote kill switch is off', () => {
    mockGetCachedConfig.mockReturnValue({ ecosystem: { banner_enabled: false } });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<EcosystemBanner />); });
    expect(tree.toJSON()).toBeNull();
  });

  it('remote promos replace the embedded list and localize with en fallback', () => {
    mockGetCachedConfig.mockReturnValue({
      ecosystem: {
        banner_enabled: true,
        promos: [
          { id: 'campaign1', url: 'https://t.me/shahnameh_bot', emoji: '🎮', title_en: 'Play & earn REAL', sub_en: 'New season' },
          { id: 'broken', url: '', title_en: 'no url — dropped' },
        ],
      },
    });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<EcosystemBanner />); });
    const all = texts(tree);
    expect(all).toContain('Play & earn REAL');
    expect(all).not.toContain('bn.shahTitle');
    expect(all).not.toContain('no url — dropped');
  });

  it('tap emits ecosystem_banner_click telemetry and opens the promo URL', () => {
    mockGetCachedConfig.mockReturnValue({
      ecosystem: {
        promos: [{ id: 'campaign1', url: 'https://example.org/p', title_en: 'Promo' }],
      },
    });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<EcosystemBanner />); });
    act(() => { tree.root.findAllByProps({ activeOpacity: 0.85 })[0]!.props.onPress(); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'ecosystem_banner_click',
      'dev-test-1',
      { promo: 'campaign1', url: 'https://example.org/p' },
    );
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.org/p');
  });
});
