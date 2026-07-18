import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Mock the ads SDK the same way adsInterstitial/homeBanner tests do — a bare
// pass-through so we can invoke the SDK's event callbacks directly in tests.
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

const mockTrackEvent = jest.fn();
jest.mock('../services/analytics', () => ({ trackEvent: (...a: any[]) => mockTrackEvent(...a) }));

jest.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { deviceId: 'dev-test-1' } }) },
}));

import { TrackedBannerAd } from '../components/TrackedBannerAd';

describe('TrackedBannerAd — shared config + telemetry for Home and Freedom banners', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('tags load telemetry with the given slot', () => {
    const tree = renderer.create(<TrackedBannerAd slot="home_banner" />);
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdLoaded(); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_BANNER_LOADED', 'dev-test-1', { slot: 'home_banner' },
    );
  });

  it('tags fail telemetry (AD_LOAD_ERROR) with slot, code and message', () => {
    const tree = renderer.create(<TrackedBannerAd slot="freedom_banner" />);
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    const err = Object.assign(new Error('No fill.'), { code: 'googleMobileAds/no-fill' });
    act(() => { banner.props.onAdFailedToLoad(err); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_LOAD_ERROR', 'dev-test-1',
      { slot: 'freedom_banner', code: 'googleMobileAds/no-fill', message: 'No fill.' },
    );
  });

  it('tags click telemetry (onAdOpened) with slot', () => {
    const tree = renderer.create(<TrackedBannerAd slot="home_banner" />);
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdOpened(); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_BANNER_CLICK', 'dev-test-1', { slot: 'home_banner' },
    );
  });

  it('tags impression telemetry (onPaid) with slot, value and currency', () => {
    const tree = renderer.create(<TrackedBannerAd slot="freedom_banner" />);
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onPaid({ value: 0.002, currency: 'USD', precision: 1 }); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_BANNER_IMPRESSION', 'dev-test-1',
      { slot: 'freedom_banner', value: 0.002, currency: 'USD' },
    );
  });

  it('still calls the local onAdLoaded/onAdFailedToLoad callbacks alongside telemetry', () => {
    const onAdLoaded = jest.fn();
    const onAdFailedToLoad = jest.fn();
    const tree = renderer.create(
      <TrackedBannerAd slot="home_banner" onAdLoaded={onAdLoaded} onAdFailedToLoad={onAdFailedToLoad} />,
    );
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdLoaded(); });
    expect(onAdLoaded).toHaveBeenCalledTimes(1);
    act(() => { banner.props.onAdFailedToLoad(new Error('x')); });
    expect(onAdFailedToLoad).toHaveBeenCalledTimes(1);
  });
});
