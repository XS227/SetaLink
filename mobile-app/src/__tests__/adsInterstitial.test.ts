// Contract: showInterstitialOnConnect() must NEVER block or throw, and only show
// when an ad is already loaded — so an ad can never stand between the user and
// connecting.
//
// Khabat, 2026-07-22: every full-screen ad on Connect must be a REWARDED VIDEO,
// never a static image interstitial. Rewarded Interstitial is tried first; a
// load failure falls through to plain Rewarded (also always video) once — never
// further back to a static interstitial. Reward crediting gates strictly on
// AdMob's EARNED_REWARD callback, never on OPENED/CLOSED alone.
//
// Iran flash fix: an ad whose creative was fetched THROUGH the tunnel cannot
// stream once the tunnel is down (Google is blocked on the direct network) —
// showing it renders a blank flash. Such ads are dropped at tap time, and
// showInterstitialAfterConnect() shows the ad once the tunnel is up instead.

jest.mock('react-native-google-mobile-ads', () => {
  const listeners: Record<string, (payload?: any) => void> = {};
  const show = jest.fn();
  const load = jest.fn();
  const inst = {
    addAdEventListener: (type: string, cb: (payload?: any) => void) => { listeners[type] = cb; return () => {}; },
    load,
    show,
  };
  const riCreate = jest.fn(() => inst);
  const rCreate = jest.fn(() => inst);
  return {
    __esModule: true,
    default: () => ({
      setRequestConfiguration: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn().mockResolvedValue(undefined),
    }),
    RewardedAd: { createForAdRequest: rCreate },
    RewardedInterstitialAd: { createForAdRequest: riCreate },
    RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'earned' },
    AdEventType: {
      LOADED: 'loaded', CLOSED: 'closed', ERROR: 'error',
      OPENED: 'opened', PAID: 'paid', CLICKED: 'clicked',
    },
    TestIds: { REWARDED: 'test-rewarded', REWARDED_INTERSTITIAL: 'test-rewarded-interstitial', INTERSTITIAL: 'test-interstitial' },
    MaxAdContentRating: { PG: 'PG' },
    __mock: { listeners, show, load, riCreate, rCreate },
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

// Rewarded/Rewarded Interstitial both need serverSideVerificationOptions.userId
// at request time (Khabat, 2026-07-22) — preloadInterstitial() now bails
// (schedules an ambient retry instead of loading) without a deviceId, so every
// test needs one available via authStore.
jest.mock('../stores/authStore', () => {
  const state = { user: { deviceId: 'test-device', quotaBytesTotal: 0 }, updateFromEntitlement: jest.fn() };
  return {
    __esModule: true,
    useAuthStore: { getState: () => state },
    __state: state,
  };
});

jest.mock('../services/entitlementService', () => ({
  __esModule: true,
  syncEntitlement: jest.fn().mockResolvedValue({ quota_bytes_total: 0 }),
}));

jest.mock('../stores/toastStore', () => {
  const show = jest.fn();
  return {
    __esModule: true,
    useToastStore: { getState: () => ({ show }) },
    __show: show,
  };
});

jest.mock('../i18n', () => ({
  __esModule: true,
  tr: (key: string) => key,
}));

type AdsModule = typeof import('../services/adsService');

describe('full-screen ads on connect (Rewarded Interstitial)', () => {
  let ads: AdsModule;
  let listeners: Record<string, (payload?: any) => void>;
  let show: jest.Mock;
  let load: jest.Mock;
  let riCreate: jest.Mock;
  let setVpnState: (s: string) => void;

  beforeEach(async () => {
    jest.resetModules();   // fresh adsService module state per test
    jest.useFakeTimers();  // the load-timeout guard schedules a real setTimeout otherwise
    const adMock = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;
    listeners = adMock.listeners;
    show = adMock.show;
    load = adMock.load;
    riCreate = adMock.riCreate;
    show.mockClear();
    load.mockClear();
    riCreate.mockClear();
    adMock.rCreate.mockClear();
    setVpnState = (jest.requireMock('../stores/vpnStore') as any).__setConnectionState;
    setVpnState('idle');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ads = require('../services/adsService');
    // preloadInterstitial() now gates on MobileAds.initialize() having
    // resolved (Khabat, 2026-07-20) — pre-warm it here, same as HomeScreen/
    // WatchAdCard do at boot, so tests exercise the steady state rather than
    // the one-time init race.
    await ads.initAds();
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
    expect(load).toHaveBeenCalled();          // preloaded for next time
    expect(riCreate).toHaveBeenCalledTimes(1); // Rewarded Interstitial tried first
  });

  it('shows exactly once when a Rewarded Interstitial has finished loading', () => {
    ads.preloadInterstitial();
    // Simulate AdMob signalling the preload finished (on the direct network).
    listeners['rewarded_loaded']?.();

    expect(ads.showInterstitialOnConnect()).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);

    // One-shot: a second tap before the next preload lands does not re-show.
    expect(ads.showInterstitialOnConnect()).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('drops a tunnel-loaded ad when tapping Connect with the tunnel down (no blank flash)', () => {
    setVpnState('connected');
    ads.preloadInterstitial();
    listeners['rewarded_loaded']?.();      // creative fetched through the tunnel

    setVpnState('idle');          // user disconnected; next Connect tap
    expect(ads.showInterstitialOnConnect()).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);   // original preload + replacement
  });

  it('showInterstitialAfterConnect shows the ad when the tunnel-side preload lands in the window', () => {
    setVpnState('connected');
    expect(ads.showInterstitialAfterConnect()).toBe(false);  // nothing ready yet
    expect(load).toHaveBeenCalled();

    listeners['rewarded_loaded']?.();      // preload arrives through the tunnel
    expect(show).toHaveBeenCalledTimes(1);

    // Window consumed: the next loaded ad does not auto-show.
    listeners['closed']?.();      // triggers self-reload
    listeners['rewarded_loaded']?.();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('showInterstitialAfterConnect does NOT auto-show if the user already disconnected', () => {
    setVpnState('connected');
    ads.showInterstitialAfterConnect();
    setVpnState('idle');          // user dropped the tunnel before the ad loaded
    listeners['rewarded_loaded']?.();
    expect(show).not.toHaveBeenCalled();
  });
});

describe('no static image fallback (Khabat, 2026-07-22)', () => {
  let ads: AdsModule;
  let listeners: Record<string, (payload?: any) => void>;
  let load: jest.Mock;
  let riCreate: jest.Mock;
  let rCreate: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const adMock = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;
    listeners = adMock.listeners;
    load = adMock.load;
    riCreate = adMock.riCreate;
    rCreate = adMock.rCreate;
    load.mockClear();
    riCreate.mockClear();
    rCreate.mockClear();
    (jest.requireMock('../stores/vpnStore') as any).__setConnectionState('idle');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ads = require('../services/adsService');
    await ads.initAds();
  });

  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('falls back to plain Rewarded (video) when Rewarded Interstitial errors — never a static interstitial', () => {
    ads.preloadInterstitial();
    expect(riCreate).toHaveBeenCalledTimes(1);
    expect(rCreate).not.toHaveBeenCalled();

    listeners['error']?.({ code: 'no-fill' });   // Rewarded Interstitial has no fill

    expect(rCreate).toHaveBeenCalledTimes(1);    // fell back to plain Rewarded, not a static ad
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('falls back to plain Rewarded when Rewarded Interstitial load times out', () => {
    ads.preloadInterstitial();
    expect(riCreate).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(15_000);   // direct-network load timeout

    expect(rCreate).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('tunnel-gated preload (Iran fix — Khabat, 2026-07-18)', () => {
  let ads: AdsModule;
  let load: jest.Mock;
  let setVpnState: (s: string) => void;
  let trackEvent: jest.Mock;

  beforeEach(async () => {
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
    await ads.initAds();
  });

  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

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
    // Connected: the load timeout is the longer, VPN-aware 20s ceiling
    // (Khabat, 2026-07-20: raise from 8s — extra RTT through the tunnel was
    // tripping the old timeout on perfectly healthy loads).
    setVpnState('connected');
    ads.showInterstitialAfterConnect();
    expect(load).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(20_000);

    expect(trackEvent).toHaveBeenCalledWith(
      'AD_LOAD_ERROR', 'test-device',
      expect.objectContaining({ slot: 'interstitial', format: 'rewarded_interstitial', code: 'timeout', vpn_connected: true }),
    );
    // Timing out immediately falls through to the plain-Rewarded fallback
    // (Khabat, 2026-07-22: never a static interstitial) — that's the "retry".
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

describe('full-screen ad telemetry (Khabat, 2026-07-19 — saw an ad on Connect, admin showed nothing)', () => {
  let ads: AdsModule;
  let listeners: Record<string, (payload?: any) => void>;
  let trackEvent: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const adMock = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;
    listeners = adMock.listeners;
    (jest.requireMock('../stores/vpnStore') as any).__setConnectionState('idle');
    trackEvent = (jest.requireMock('../services/analytics') as any).trackEvent;
    trackEvent.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ads = require('../services/adsService');
    // Pre-warm init (see the first describe block's identical comment) — this
    // block used to skip it, which left `preloadInterstitial()`'s calls below
    // racing the async `initAds()` cold-start path instead of exercising the
    // steady state these tests actually mean to cover.
    await ads.initAds();
  });

  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('a successful show/impression/click each log their own event, tagged with format', () => {
    ads.preloadInterstitial();
    listeners['rewarded_loaded']?.();

    listeners['opened']?.();
    expect(trackEvent).toHaveBeenCalledWith(
      'AD_INTERSTITIAL_SHOWN', 'test-device', { slot: 'interstitial', format: 'rewarded_interstitial' },
    );

    listeners['paid']?.({ value: 0.012, currency: 'USD' });
    expect(trackEvent).toHaveBeenCalledWith(
      'AD_INTERSTITIAL_IMPRESSION', 'test-device',
      { slot: 'interstitial', format: 'rewarded_interstitial', value: 0.012, currency: 'USD' },
    );

    listeners['clicked']?.();
    expect(trackEvent).toHaveBeenCalledWith(
      'AD_INTERSTITIAL_CLICK', 'test-device', { slot: 'interstitial', format: 'rewarded_interstitial' },
    );
  });

  it('EARNED_REWARD logs AD_INTERSTITIAL_EARNED_REWARD — reward only counts once Google confirms', () => {
    ads.preloadInterstitial();
    listeners['rewarded_loaded']?.();
    listeners['opened']?.();

    // Dismissing without the earned callback must NOT log a reward.
    expect(trackEvent).not.toHaveBeenCalledWith(
      'AD_INTERSTITIAL_EARNED_REWARD', expect.anything(), expect.anything(),
    );

    listeners['earned']?.();
    expect(trackEvent).toHaveBeenCalledWith(
      'AD_INTERSTITIAL_EARNED_REWARD', 'test-device', { slot: 'interstitial', format: 'rewarded_interstitial' },
    );
  });
});
