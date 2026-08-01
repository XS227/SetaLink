import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Mock the ads SDK the same way adsInterstitial/homeBanner tests do — a bare
// pass-through so we can invoke the SDK's event callbacks directly in tests.
// A real class component (like the real BannerAd) so `.instance.load` is
// reachable via react-test-renderer, letting the retry tests assert the
// SAME instance is reloaded rather than a fresh one being mounted.
// TrackedBannerAd defers its actual <BannerAd> mount (and thus its implicit
// native ad request) via InteractionManager.runAfterInteractions (Khabat,
// 2026-07-29 — real device session showed the request landing mid-transition)
// — run it synchronously in tests, same convention as adsInterstitial.test.ts.
// Mocking the specific submodule path (not the whole 'react-native' barrel)
// avoids dragging in the real TurboModule registry, unavailable outside an
// actual device/simulator.
jest.mock('react-native/Libraries/Interaction/InteractionManager', () => ({
  runAfterInteractions: (cb: () => void) => {
    cb();
    return { then: (f: () => void) => f(), done: () => {}, cancel: () => {} };
  },
}));

jest.mock('react-native-google-mobile-ads', () => {
  const React = require('react');
  class BannerAdMock extends React.Component<any> {
    load = jest.fn();
    render() { return React.createElement('BannerAd', { testID: 'banner-ad', ...this.props }); }
  }
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
    BannerAd: BannerAdMock,
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

// vpnStore is lazy-required from adsService's vpnConnectedNow() — mock it so
// vpn_connected in AD_LOAD_ERROR telemetry is deterministic instead of
// depending on whatever the real store resolves to under test.
jest.mock('../stores/vpnStore', () => ({
  __esModule: true,
  useVpnStore: { getState: () => ({ connectionState: 'idle' }) },
}));

import { TrackedBannerAd } from '../components/TrackedBannerAd';
import { initAds } from '../services/adsService';

// TrackedBannerAd now waits for MobileAds.initialize() (Khabat, 2026-07-20)
// before mounting the underlying <BannerAd> at all — pre-warm it here, same
// as the interstitial tests do, so each test starts from the steady state
// instead of racing the one-time init promise.
beforeEach(async () => {
  mockTrackEvent.mockClear();
  await initAds();
});

async function mount(props: React.ComponentProps<typeof TrackedBannerAd>) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<TrackedBannerAd {...props} />); });
  return tree;
}

describe('TrackedBannerAd — shared config + telemetry for Home and Freedom banners', () => {
  it('fires AD_BANNER_REQUEST on mount, tagged with slot', async () => {
    await mount({ slot: 'home_banner' });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_BANNER_REQUEST', 'dev-test-1', { slot: 'home_banner' },
    );
  });

  it('tags load telemetry with the given slot', async () => {
    const tree = await mount({ slot: 'home_banner' });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdLoaded(); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_BANNER_LOADED', 'dev-test-1', { slot: 'home_banner' },
    );
  });

  it('tags fail telemetry (AD_LOAD_ERROR) with slot, code, message, domain, vpn state and platform', async () => {
    const tree = await mount({ slot: 'freedom_banner' });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    const err = Object.assign(new Error('No fill.'), { code: 'googleMobileAds/no-fill', namespace: 'googleMobileAds' });
    act(() => { banner.props.onAdFailedToLoad(err); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_LOAD_ERROR', 'dev-test-1',
      expect.objectContaining({
        slot: 'freedom_banner', code: 'googleMobileAds/no-fill', message: 'No fill.',
        domain: 'googleMobileAds', vpn_connected: false,
      }),
    );
  });

  it('tags click telemetry (onAdOpened) with slot', async () => {
    const tree = await mount({ slot: 'home_banner' });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdOpened(); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_BANNER_CLICK', 'dev-test-1', { slot: 'home_banner' },
    );
  });

  it('tags impression telemetry (onPaid) with slot, value and currency', async () => {
    const tree = await mount({ slot: 'freedom_banner' });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onPaid({ value: 0.002, currency: 'USD', precision: 1 }); });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'AD_BANNER_IMPRESSION', 'dev-test-1',
      { slot: 'freedom_banner', value: 0.002, currency: 'USD' },
    );
  });

  it('still calls the local onAdLoaded callback alongside telemetry', async () => {
    const onAdLoaded = jest.fn();
    const tree = await mount({ slot: 'home_banner', onAdLoaded });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdLoaded(); });
    expect(onAdLoaded).toHaveBeenCalledTimes(1);
  });
});

describe('TrackedBannerAd — retry-with-backoff on failure, no remount (Khabat, 2026-07-20)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries the SAME instance via ref.load() instead of telling the parent right away', async () => {
    const onAdFailedToLoad = jest.fn();
    const tree = await mount({ slot: 'home_banner', onAdFailedToLoad });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    // `testID` is set on the mock's *inner* host string element (BannerAdMock
    // spreads it there, matching how the real BannerAd forwards its own
    // props) — that host node has no instance of its own; the class
    // instance holding `.load` is one level up, on BannerAdMock itself.
    const loadSpy = banner.parent!.instance.load as jest.Mock;

    act(() => {
      banner.props.onAdFailedToLoad(Object.assign(new Error('no fill'), { code: 'googleMobileAds/no-fill' }));
    });
    expect(onAdFailedToLoad).not.toHaveBeenCalled();   // first failure: retry, don't give up yet
    expect(loadSpy).not.toHaveBeenCalled();             // not yet — still waiting out the 5s backoff

    act(() => { jest.advanceTimersByTime(5_000); });
    expect(loadSpy).toHaveBeenCalledTimes(1);           // same instance reloaded, no remount
    expect(onAdFailedToLoad).not.toHaveBeenCalled();
  });

  it('gives up and calls the parent after the 5s/15s/30s schedule is exhausted', async () => {
    const onAdFailedToLoad = jest.fn();
    const tree = await mount({ slot: 'home_banner', onAdFailedToLoad });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    const fail = () => act(() => {
      banner.props.onAdFailedToLoad(Object.assign(new Error('no fill'), { code: 'googleMobileAds/no-fill' }));
    });

    fail();                                   // attempt 1 fails → schedules retry #1 (5s)
    act(() => { jest.advanceTimersByTime(5_000); });
    fail();                                   // attempt 2 fails → schedules retry #2 (15s)
    act(() => { jest.advanceTimersByTime(15_000); });
    fail();                                   // attempt 3 fails → schedules retry #3 (30s)
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(onAdFailedToLoad).not.toHaveBeenCalled();    // still within the schedule

    fail();                                   // attempt 4 fails → schedule exhausted, give up
    expect(onAdFailedToLoad).toHaveBeenCalledTimes(1);
  });

  it('a successful load still fires the parent onAdLoaded normally', async () => {
    const onAdLoaded = jest.fn();
    const tree = await mount({ slot: 'home_banner', onAdLoaded });
    const banner = tree.root.findByProps({ testID: 'banner-ad' });
    act(() => { banner.props.onAdLoaded(); });
    expect(onAdLoaded).toHaveBeenCalledTimes(1);
  });
});
