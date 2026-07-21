import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Mock the ads SDK (BannerAd + everything adsService imports at load).
jest.mock('react-native-google-mobile-ads', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => ({
      setRequestConfiguration: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn().mockResolvedValue(undefined),
    }),
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

jest.mock('../stores/vpnStore', () => ({
  __esModule: true,
  useVpnStore: { getState: () => ({ connectionState: 'idle' }) },
}));

import { HomeBanner } from '../components/HomeBanner';
import { initAds } from '../services/adsService';

const has = (root: any, testID: string) => root.findAllByProps({ testID }).length > 0;

// TrackedBannerAd (rendered inside HomeBanner) now waits for
// MobileAds.initialize() before mounting the underlying <BannerAd> at all
// (Khabat, 2026-07-20) — pre-warm it here so these tests exercise the steady
// state instead of the one-time init race.
beforeEach(async () => { await initAds(); });

async function mountHomeBanner(showAds: boolean) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HomeBanner showAds={showAds} />); });
  return tree;
}

describe('HomeBanner — fixed ad with promo fallback (no rotation)', () => {
  it('premium users (showAds=false) only ever see the promo, never an ad', async () => {
    const tree = await mountHomeBanner(false);
    expect(has(tree.root, 'promo')).toBe(true);
    expect(has(tree.root, 'banner-ad')).toBe(false);
  });

  it('free users mount the ad slot immediately, promo stays up until it loads (no blank flash)', async () => {
    const tree = await mountHomeBanner(true);
    expect(has(tree.root, 'banner-ad')).toBe(true);
    expect(has(tree.root, 'promo')).toBe(true);   // ad not loaded yet — promo still up
  });

  it('once the ad loads, it replaces the promo and stays — no timer reverts it back', async () => {
    const tree = await mountHomeBanner(true);
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdLoaded(); });
    expect(has(tree.root, 'banner-ad')).toBe(true);
    expect(has(tree.root, 'promo')).toBe(false);
  });

  describe('failure handling (retries before giving up — Khabat, 2026-07-20)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('a single failure does NOT fall back yet — it retries first (5s/15s/30s backoff)', async () => {
      const tree = await mountHomeBanner(true);
      const banner = tree.root.findByProps({ testID: 'banner-ad' });
      act(() => { banner.props.onAdFailedToLoad(new Error('no fill')); });
      // Still showing the pending ad slot + promo — TrackedBannerAd is
      // retrying internally, hasn't told HomeBanner to give up yet.
      expect(has(tree.root, 'banner-ad')).toBe(true);
      expect(has(tree.root, 'promo')).toBe(true);
    });

    it('falls back to the promo for good once the retry schedule is exhausted', async () => {
      const tree = await mountHomeBanner(true);
      const fail = () => act(() => {
        tree.root.findByProps({ testID: 'banner-ad' }).props.onAdFailedToLoad(new Error('no fill'));
      });

      fail();                                    // attempt 1 → retry #1 in 5s
      act(() => { jest.advanceTimersByTime(5_000); });
      fail();                                    // attempt 2 → retry #2 in 15s
      act(() => { jest.advanceTimersByTime(15_000); });
      fail();                                    // attempt 3 → retry #3 in 30s
      act(() => { jest.advanceTimersByTime(30_000); });
      expect(has(tree.root, 'banner-ad')).toBe(true);   // schedule not exhausted yet

      fail();                                    // attempt 4 → schedule exhausted, give up
      expect(has(tree.root, 'banner-ad')).toBe(false);
      expect(has(tree.root, 'promo')).toBe(true);
    });
  });
});
