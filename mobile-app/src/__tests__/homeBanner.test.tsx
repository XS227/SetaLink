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

import { HomeBanner } from '../components/HomeBanner';

const has = (root: any, testID: string) => root.findAllByProps({ testID }).length > 0;

describe('HomeBanner — rotating ad ⇄ promo', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('premium users (showAds=false) only ever see the promo, never an ad', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<HomeBanner showAds={false} />); });
    act(() => { jest.advanceTimersByTime(60000); });
    expect(has(tree.root, 'promo')).toBe(true);
    expect(has(tree.root, 'banner-ad')).toBe(false);
  });

  it('free users start on the promo, then the ad slot mounts after the interval', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<HomeBanner showAds={true} />); });
    // Initially promo, no ad mounted yet.
    expect(has(tree.root, 'promo')).toBe(true);
    expect(has(tree.root, 'banner-ad')).toBe(false);
    // After the rotation interval the ad slot mounts (promo stays until it loads).
    act(() => { jest.advanceTimersByTime(12000); });
    expect(has(tree.root, 'banner-ad')).toBe(true);
    expect(has(tree.root, 'promo')).toBe(true);   // no blank flash — promo still up
  });

  it('falls back to the promo when the ad fails to load', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<HomeBanner showAds={true} />); });
    act(() => { jest.advanceTimersByTime(12000); });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdFailedToLoad(new Error('no fill')); });
    expect(has(tree.root, 'banner-ad')).toBe(false);
    expect(has(tree.root, 'promo')).toBe(true);
  });
});
