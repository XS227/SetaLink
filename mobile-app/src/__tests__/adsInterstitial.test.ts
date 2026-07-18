// Contract: showInterstitialOnConnect() must NEVER block or throw, and only show
// when an interstitial is already loaded — so an ad can never stand between the
// user and connecting.
//
// Iran flash fix: an interstitial whose creative was fetched THROUGH the tunnel
// cannot stream once the tunnel is down (Google is blocked on the direct
// network) — showing it renders a blank flash. Such ads are dropped at tap time,
// and showInterstitialAfterConnect() shows the ad once the tunnel is up instead.

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

jest.mock('../stores/vpnStore', () => {
  const state = { connectionState: 'idle' };
  return {
    __esModule: true,
    useVpnStore: { getState: () => state },
    __setConnectionState: (s: string) => { state.connectionState = s; },
  };
});

jest.mock('../services/analytics', () => ({
  __esModule: true,
  trackEvent: jest.fn(),
}));

type AdsModule = typeof import('../services/adsService');

describe('interstitial ads on connect', () => {
  let ads: AdsModule;
  let listeners: Record<string, () => void>;
  let show: jest.Mock;
  let load: jest.Mock;
  let setVpnState: (s: string) => void;

  beforeEach(() => {
    jest.resetModules();   // fresh adsService module state per test
    jest.useFakeTimers();  // the load-timeout guard schedules a real setTimeout otherwise
    const adMock = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;
    listeners = adMock.listeners;
    show = adMock.show;
    load = adMock.load;
    show.mockClear();
    load.mockClear();
    setVpnState = (jest.requireMock('../stores/vpnStore') as any).__setConnectionState;
    setVpnState('idle');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ads = require('../services/adsService');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('does NOT show and does NOT throw when no ad is loaded (kicks a preload)', () => {
    let shown: boolean | undefined;
    expect(() => { shown = ads.showInterstitialOnConnect(); }).not.toThrow();
    expect(shown).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalled();      // preloaded for next time
  });

  it('shows exactly once when an interstitial has finished loading', () => {
    ads.preloadInterstitial();
    // Simulate AdMob signalling the preload finished (on the direct network).
    listeners['loaded']?.();

    expect(ads.showInterstitialOnConnect()).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);

    // One-shot: a second tap before the next preload lands does not re-show.
    expect(ads.showInterstitialOnConnect()).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('drops a tunnel-loaded ad when tapping Connect with the tunnel down (no blank flash)', () => {
    setVpnState('connected');
    ads.preloadInterstitial();
    listeners['loaded']?.();      // creative fetched through the tunnel

    setVpnState('idle');          // user disconnected; next Connect tap
    expect(ads.showInterstitialOnConnect()).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);   // original preload + replacement
  });

  it('showInterstitialAfterConnect shows the ad when the tunnel-side preload lands in the window', () => {
    setVpnState('connected');
    expect(ads.showInterstitialAfterConnect()).toBe(false);  // nothing ready yet
    expect(load).toHaveBeenCalled();

    listeners['loaded']?.();      // preload arrives through the tunnel
    expect(show).toHaveBeenCalledTimes(1);

    // Window consumed: the next loaded ad does not auto-show.
    listeners['closed']?.();      // triggers self-reload
    listeners['loaded']?.();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('showInterstitialAfterConnect does NOT auto-show if the user already disconnected', () => {
    setVpnState('connected');
    ads.showInterstitialAfterConnect();
    setVpnState('idle');          // user dropped the tunnel before the ad loaded
    listeners['loaded']?.();
    expect(show).not.toHaveBeenCalled();
  });
});

describe('tunnel-gated preload (Iran fix — Khabat, 2026-07-18)', () => {
  let ads: AdsModule;
  let load: jest.Mock;
  let setVpnState: (s: string) => void;
  let trackEvent: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    const adMock = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;
    load = adMock.load;
    load.mockClear();
    setVpnState = (jest.requireMock('../stores/vpnStore') as any).__setConnectionState;
    setVpnState('idle');
    trackEvent = (jest.requireMock('../services/analytics') as any).trackEvent;
    trackEvent.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ads = require('../services/adsService');
  });

  afterEach(() => { jest.useRealTimers(); });

  it('a load kicked off before Connect does not block the fresh tunnel-side load', () => {
    // A pre-connect preload attempt is in flight (never resolves — the direct
    // network to Google is blocked) when the user taps Connect.
    ads.preloadInterstitial();
    expect(load).toHaveBeenCalledTimes(1);

    setVpnState('connected');
    ads.showInterstitialAfterConnect();

    // Without the fix this would be a no-op (blocked by the "already loading"
    // guard); the fix invalidates the stale in-flight attempt so a genuinely
    // new request goes out through the now-up tunnel.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a stuck load times out, logs AD_LOAD_ERROR(code=timeout), and can then retry', () => {
    setVpnState('connected');
    ads.showInterstitialAfterConnect();
    expect(load).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(8_000);

    expect(trackEvent).toHaveBeenCalledWith(
      'AD_LOAD_ERROR', undefined,
      expect.objectContaining({ slot: 'interstitial', code: 'timeout' }),
    );
    // Bounded retry (backed off) should fire a second load attempt.
    jest.advanceTimersByTime(1_200);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('notifyVpnDisconnected clears the loading flag without starting a new request', () => {
    ads.preloadInterstitial();          // pre-connect attempt, never resolves
    expect(load).toHaveBeenCalledTimes(1);

    ads.notifyVpnDisconnected();
    expect(load).toHaveBeenCalledTimes(1);   // no new request fired on disconnect itself

    // The next preload call is now free to start (loading flag was stuck before the fix).
    ads.preloadInterstitial();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('disconnect then reconnect allows a brand new load (open network still works normally)', () => {
    setVpnState('connected');
    ads.showInterstitialAfterConnect();
    expect(load).toHaveBeenCalledTimes(1);

    setVpnState('idle');
    ads.notifyVpnDisconnected();

    setVpnState('connected');
    ads.showInterstitialAfterConnect();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
