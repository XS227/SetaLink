// Contract: showInterstitialOnConnect() must NEVER block or throw, and only show
// when an interstitial is already loaded — so an ad can never stand between the
// user and connecting.

jest.mock('react-native-google-mobile-ads', () => {
  const listeners: Record<string, () => void> = {};
  const show = jest.fn();
  const load = jest.fn();
  const inst = {
    addAdEventListener: (type: string, cb: () => void) => { listeners[type] = cb; return () => {}; },
    load,
    show,
  };
  return {
    __esModule: true,
    default: () => ({
      setRequestConfiguration: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn().mockResolvedValue(undefined),
    }),
    RewardedAd: { createForAdRequest: jest.fn() },
    RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'earned' },
    AdEventType: { LOADED: 'loaded', CLOSED: 'closed', ERROR: 'error' },
    InterstitialAd: { createForAdRequest: jest.fn(() => inst) },
    TestIds: { REWARDED: 'test-rewarded', INTERSTITIAL: 'test-interstitial' },
    MaxAdContentRating: { PG: 'PG' },
    __mock: { listeners, show, load },
  };
});

import { showInterstitialOnConnect, preloadInterstitial } from '../services/adsService';

const { listeners, show, load } = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;

describe('showInterstitialOnConnect — non-blocking ad on connect', () => {
  beforeEach(() => { show.mockClear(); load.mockClear(); });

  it('does NOT show and does NOT throw when no ad is loaded (kicks a preload)', () => {
    let shown: boolean | undefined;
    expect(() => { shown = showInterstitialOnConnect(); }).not.toThrow();
    expect(shown).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalled();      // preloaded for next time
  });

  it('shows exactly once when an interstitial has finished loading', () => {
    preloadInterstitial();
    // Simulate AdMob signalling the preload finished.
    listeners['loaded']?.();

    expect(showInterstitialOnConnect()).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);

    // One-shot: a second tap before the next preload lands does not re-show.
    expect(showInterstitialOnConnect()).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
