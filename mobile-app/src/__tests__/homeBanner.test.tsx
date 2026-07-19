import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Mock the ads SDK (BannerAd + everything adsService imports at load).
jest.mock('react-native-google-mobile-ads', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => ({ setRequestConfiguration: jest.fn(), initialize: jest.fn() }),
    RewardedAd: { createForAdRequest: jest.fn() },
    RewardedAdEventType: { LOADED: 'rl', EARNED_REWARD: 'er' },
    AdEventType: { LOADED: 'loaded', CLOSED: 'closed', ERROR: 'error' },
    InterstitialAd: { createForAdRequest: jest.fn(() => ({ addAdEventListener: () => () => {}, load: jest.fn(), show: jest.fn() })) },
    BannerAd: (p: any) => React.createElement('BannerAd', { testID: 'banner-ad', ...p }),
    BannerAdSize: { ANCHORED_ADAPTIVE_BANNER: 'anchored' },
    TestIds: { REWARDED: 'tr', INTERSTITIAL: 'ti', BANNER: 'tb' },
    MaxAdContentRating: { PG: 'PG' },
  };
});

jest.mock('../components/EcosystemBanner', () => {
  const React = require('react');
  return { EcosystemBanner: () => React.createElement('EcosystemBanner', { testID: 'promo' }) };
});

jest.mock('../services/analytics', () => ({ trackEvent: jest.fn() }));

jest.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { deviceId: 'dev-test-1' } }) },
}));

import { HomeBanner } from '../components/HomeBanner';

const has = (root: any, testID: string) => root.findAllByProps({ testID }).length > 0;

describe('HomeBanner — fixed ad with promo fallback (no rotation)', () => {
  it('premium users (showAds=false) only ever see the promo, never an ad', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<HomeBanner showAds={false} />); });
    expect(has(tree.root, 'promo')).toBe(true);
    expect(has(tree.root, 'banner-ad')).toBe(false);
  });

  it('free users mount the ad slot immediately, promo stays up until it loads (no blank flash)', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<HomeBanner showAds={true} />); });
    expect(has(tree.root, 'banner-ad')).toBe(true);
    expect(has(tree.root, 'promo')).toBe(true);   // ad not loaded yet — promo still up
  });

  it('once the ad loads, it replaces the promo and stays — no timer reverts it back', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<HomeBanner showAds={true} />); });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdLoaded(); });
    expect(has(tree.root, 'banner-ad')).toBe(true);
    expect(has(tree.root, 'promo')).toBe(false);
  });

  it('falls back to the promo for good when the ad fails to load', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<HomeBanner showAds={true} />); });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdFailedToLoad(new Error('no fill')); });
    expect(has(tree.root, 'banner-ad')).toBe(false);
    expect(has(tree.root, 'promo')).toBe(true);
  });
});
