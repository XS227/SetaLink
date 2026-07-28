// Contract: showInterstitialOnConnect() must NEVER block or throw, and only show
// when an ad is already loaded — so an ad can never stand between the user and
// connecting.
//
// Khabat, 2026-07-22: every full-screen ad on Connect must be a REWARDED VIDEO,
// never a static image interstitial. Rewarded Interstitial was tried first; a
// load failure fell through to plain Rewarded (also always video) once — never
// further back to a static interstitial.
//
// Khabat, 2026-07-27: revised — a classic Interstitial (dedicated production ad
// unit for Connect) is now tried FIRST, ahead of Rewarded Interstitial, in
// exchange for a much higher fill rate. Rewarded Interstitial -> Rewarded Video
// remains the unchanged fallback chain once the classic Interstitial fails.
// Reward crediting still gates strictly on AdMob's EARNED_REWARD callback,
// never on OPENED/CLOSED alone (classic Interstitial has no reward event at
// all, so it never claims a reward).
//
// Khabat, 2026-07-28: the "Rewarded Interstitial" unit was confirmed via
// AdMob's own adUnits.list API to actually be plain INTERSTITIAL format —
// every RewardedInterstitialAd request against it failed with "Ad unit
// doesn't match format". Fixed in code rather than recreating the AdMob
// unit: it's now loaded as a second classic Interstitial (same InterstitialAd
// class as the primary unit), so the chain is Interstitial -> fallback
// Interstitial -> Rewarded Video. Neither Interstitial slot ever earns a
// reward; only the final Rewarded Video step does.
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
  // Primary and fallback Interstitial units both go through InterstitialAd
  // (see 2026-07-28 note above) — iCreate is called once per attempt,
  // regardless of which of the two unit IDs is behind it.
  const iCreate  = jest.fn(() => inst);
  const rCreate  = jest.fn(() => inst);
  return {
    __esModule: true,
    default: () => ({
      setRequestConfiguration: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn().mockResolvedValue(undefined),
    }),
    RewardedAd: { createForAdRequest: rCreate },
    InterstitialAd: { createForAdRequest: iCreate },
    RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'earned' },
    AdEventType: {
      LOADED: 'loaded', CLOSED: 'closed', ERROR: 'error',
      OPENED: 'opened', PAID: 'paid', CLICKED: 'clicked',
    },
    TestIds: { REWARDED: 'test-rewarded', INTERSTITIAL: 'test-interstitial' },
    MaxAdContentRating: { PG: 'PG' },
    __mock: { listeners, show, load, iCreate, rCreate },
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

describe('full-screen ads on connect (classic Interstitial primary)', () => {
  let ads: AdsModule;
  let listeners: Record<string, (payload?: any) => void>;
  let show: jest.Mock;
  let load: jest.Mock;
  let iCreate: jest.Mock;
  let setVpnState: (s: string) => void;

  beforeEach(async () => {
    jest.resetModules();   // fresh adsService module state per test
    jest.useFakeTimers();  // the load-timeout guard schedules a real setTimeout otherwise
    const adMock = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;
    listeners = adMock.listeners;
    show = adMock.show;
    load = adMock.load;
    iCreate = adMock.iCreate;
    show.mockClear();
    load.mockClear();
    iCreate.mockClear();
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
    expect(iCreate).toHaveBeenCalledTimes(1);  // classic Interstitial tried first
  });

  it('shows exactly once when a classic Interstitial has finished loading', () => {
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

describe('fallback chain: Interstitial -> fallback Interstitial -> Rewarded Video (Khabat, 2026-07-22, 2026-07-27 & 2026-07-28)', () => {
  let ads: AdsModule;
  let listeners: Record<string, (payload?: any) => void>;
  let load: jest.Mock;
  let iCreate: jest.Mock;
  let rCreate: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const adMock = (jest.requireMock('react-native-google-mobile-ads') as any).__mock;
    listeners = adMock.listeners;
    load = adMock.load;
    iCreate = adMock.iCreate;
    rCreate = adMock.rCreate;
    load.mockClear();
    iCreate.mockClear();
    rCreate.mockClear();
    (jest.requireMock('../stores/vpnStore') as any).__setConnectionState('idle');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ads = require('../services/adsService');
    await ads.initAds();
  });

  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('falls back to the fallback Interstitial when the primary errors, then to plain Rewarded if that also fails', () => {
    ads.preloadInterstitial();
    expect(iCreate).toHaveBeenCalledTimes(1);
    expect(rCreate).not.toHaveBeenCalled();

    listeners['error']?.({ code: 'no-fill' });   // primary Interstitial has no fill

    expect(iCreate).toHaveBeenCalledTimes(2);    // fell back to the second Interstitial unit
    expect(load).toHaveBeenCalledTimes(2);

    listeners['error']?.({ code: 'no-fill' });   // fallback Interstitial also has no fill

    expect(rCreate).toHaveBeenCalledTimes(1);    // fell back to plain Rewarded — never a static ad again this cycle
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('falls back to the fallback Interstitial when the primary load times out', () => {
    ads.preloadInterstitial();
    expect(iCreate).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(15_000);   // direct-network load timeout

    expect(iCreate).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('falls back to plain Rewarded when the fallback Interstitial (post-primary-fallback) load times out', () => {
    ads.preloadInterstitial();
    listeners['error']?.({ code: 'no-fill' });   // primary Interstitial fails -> fallback Interstitial starts
    expect(iCreate).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(15_000);

    expect(rCreate).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
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
      expect.objectContaining({ slot: 'interstitial', format: 'interstitial', code: 'timeout', vpn_connected: true }),
    );
    // Timing out immediately falls through to the Rewarded Interstitial
    // fallback (Khabat, 2026-07-22/2026-07-27 chain) — that's the "retry".
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
    listeners['loaded']?.();

    listeners['opened']?.();
    expect(trackEvent).toHaveBeenCalledWith(
      'AD_INTERSTITIAL_SHOWN', 'test-device', { slot: 'interstitial', format: 'interstitial' },
    );

    listeners['paid']?.({ value: 0.012, currency: 'USD' });
    expect(trackEvent).toHaveBeenCalledWith(
      'AD_INTERSTITIAL_IMPRESSION', 'test-device',
      { slot: 'interstitial', format: 'interstitial', value: 0.012, currency: 'USD' },
    );

    listeners['clicked']?.();
    expect(trackEvent).toHaveBeenCalledWith(
      'AD_INTERSTITIAL_CLICK', 'test-device', { slot: 'interstitial', format: 'interstitial' },
    );
  });

  it('classic Interstitial never earns a reward — closing it goes through the "continuing" path, not a reward credit', () => {
    ads.preloadInterstitial();
    listeners['loaded']?.();
    listeners['opened']?.();

    // Classic Interstitial has no EARNED_REWARD event at all — closing it
    // must never log a reward.
    listeners['closed']?.();
    expect(trackEvent).not.toHaveBeenCalledWith(
      'AD_INTERSTITIAL_EARNED_REWARD', expect.anything(), expect.anything(),
    );
  });
});
