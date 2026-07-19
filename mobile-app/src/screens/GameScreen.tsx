/**
 * GameScreen — Shahnameh hub.
 *
 * REAL-ID is the primary identity here — Telegram is never required to
 * play (Khabat, 2026-07-19, TASK_SPLIT.md). On mount, GameScreen silently
 * probes the SSO endpoint with forGame=true (checkAndCacheRealId): the
 * panel mints straight off this device's own RealGram identity when no
 * Telegram account is linked yet, rather than reporting 'unlinked' — so
 * for virtually every RealGram user this resolves instantly and they never
 * see any gate at all, Telegram or otherwise.
 *
 * REAL-ID identity gate (RealIdGate below) only renders when that silent
 * probe genuinely fails (backend unreachable/misconfigured): an internal
 * RealGram error + retry, never an auto-opened Telegram screen. Linking an
 * existing Telegram account's history is still possible from here, but as
 * a manual, clearly-secondary action — never automatic, never the default.
 *
 * DeviceId = secure lookup key only (anti-abuse, rate-limiting). REAL-ID is the
 * account identity embedded in the JWT and passed as real_id= to the game URL.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import type {
  WebViewNavigationEvent, WebViewErrorEvent, WebViewHttpErrorEvent, ShouldStartLoadRequest,
} from 'react-native-webview/lib/WebViewTypes';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT }             from '../i18n';
import { useIdentityStore } from '../stores/identityStore';
import { useAuthStore }     from '../stores/authStore';
import { getSsoToken, checkAndCacheRealId } from '../services/ssoService';
import { linkRealAccount }  from '../services/realWalletService';
import { parseDeepLink }    from '../services/deepLinkService';
import { pushEcosystemProfile } from '../services/ecosystemProfileService';
import { getCachedConfig }  from '../services/remoteConfigService';
import { initZarSync } from '../services/zarSyncService';

const BASE_GAME_URL  = 'https://shahnameh.setaei.com';
const PANEL_API      = 'https://setalink.no/api.php';

// ── RealGram in-app linking WebView ──────────────────────────────────────────
// Opens the ecosystem link-gate page. Intercepts the setalink:// deep-link that
// the gate redirects to after successful authentication.
function RealGramLinkWebView({
  deviceId, onLinked, onClose,
}: { deviceId: string; onLinked: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const { t }  = useT();
  const identity = useIdentityStore();

  const url = `${PANEL_API}?mobile=1&action=realgram-link-gate&_token=setalink-mobile-diag-v1&device_id=${encodeURIComponent(deviceId)}`;

  // After linking: update authStore and push profile to the ecosystem so all
  // REAL apps immediately see the correct avatar/handle without re-asking.
  const afterLink = useCallback((account: string) => {
    useAuthStore.getState().setRealId(account);
    pushEcosystemProfile(
      deviceId,
      identity.handle ?? '',
      identity.displayName,
      identity.avatarEmoji,
      identity.avatarColor,
      identity.persona ?? '',
    );
    onLinked();
  }, [deviceId, identity, onLinked]);

  // Handle setalink:// deep-links that the linking page redirects to.
  const handleNavChange = useCallback((state: WebViewNavigation) => {
    if (!state.url.startsWith('setalink://')) return;
    const action = parseDeepLink(state.url);
    if (action?.type !== 'LINK_REAL') return;
    if (action.deviceId && action.deviceId !== deviceId) return;

    setBusy(true);
    linkRealAccount(deviceId, action.account, action.ts, action.sig)
      .then(() => afterLink(action.account))
      .catch(() => setBusy(false));
  }, [deviceId, afterLink]);

  // Handle postMessage from pages that prefer JS messaging over deep-link.
  const handleMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as Record<string, unknown>;
      if (msg.type !== 'realid-linked') return;
      const { account, ts, sig } = msg as { account: string; ts: number; sig: string };
      if (!account || !ts || !sig) return;
      setBusy(true);
      linkRealAccount(deviceId, account, ts, sig)
        .then(() => afterLink(account))
        .catch(() => setBusy(false));
    } catch { /* ignore non-JSON messages */ }
  }, [deviceId, afterLink]);

  return (
    <View style={[wvStyles.container, { paddingTop: insets.top }]}>
      <View style={wvStyles.bar}>
        <TouchableOpacity onPress={onClose} style={wvStyles.backBtn} hitSlop={12}>
          <Text style={wvStyles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={wvStyles.barTitle}>RealGram</Text>
        <View style={wvStyles.backBtn} />
      </View>
      {busy ? (
        <View style={wvStyles.loader}>
          <ActivityIndicator color={Colors.gold[400]} size="large" />
          <Text style={wvStyles.linkingText}>{t('realId.retrying')}</Text>
        </View>
      ) : (
        <WebView
          source={{ uri: url }}
          style={wvStyles.web}
          startInLoadingState
          renderLoading={() => (
            <View style={wvStyles.loader}>
              <ActivityIndicator color={Colors.gold[400]} size="large" />
            </View>
          )}
          originWhitelist={['https://*', 'setalink://*']}
          onNavigationStateChange={handleNavChange}
          onMessage={handleMessage}
          injectedJavaScriptBeforeContentLoaded={`
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
            document.head.appendChild(meta);
            true;
          `}
        />
      )}
    </View>
  );
}

const wvStyles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg.void },
  bar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                padding: Spacing[4], borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  barTitle:   { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  backBtn:    { width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
                backgroundColor: Colors.bg.surface, borderRadius: 18 },
  backText:   { fontSize: 22, color: Colors.text.secondary, marginTop: -2 },
  // Cinematic embed (2026-07-19): floats over the WebView instead of a
  // fixed header bar, so Shahnameh's own page reads as full-bleed.
  floatingBack: {
    position: 'absolute', top: Spacing[3], left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  loader:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[3], paddingHorizontal: Spacing[6] },
  linkingText:{ fontSize: 14, color: Colors.text.muted, fontFamily: Typography.family.body },
  web:        { flex: 1 },
  errorText:  { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, lineHeight: 20 },
  retryBtn:      { backgroundColor: Colors.gold[400], borderRadius: Radius.xl,
                   paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  retryBtnText:  { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});

// ── REAL-ID gate ─────────────────────────────────────────────────────────────
// Reached only when GameScreen's silent on-mount probe (checkAndCacheRealId,
// forGame=true) did NOT come back with a REAL-ID — with the panel's REAL-ID
// auto-fallback (2026-07-19), that probe mints straight off this device's own
// RealGram identity with no Telegram involvement, so it should succeed for
// virtually every RealGram user and this screen should rarely render at all.
// When it does (backend misconfigured/unreachable), Khabat's explicit
// requirement is an INTERNAL RealGram error + retry — never a Telegram login
// screen, and never auto-opened. Linking an existing Telegram account is a
// separate, clearly-optional, manually-triggered action here (not a
// first-class or automatic path) — the real home for it is profile/settings
// (see TASK_SPLIT.md), this is a stopgap until that's built.
function RealIdGate({ deviceId }: { deviceId: string }) {
  const { t }  = useT();
  const insets = useSafeAreaInsets();
  const [checking, setChecking]         = useState(false);
  const [showRealGram, setShowRealGram] = useState(false); // manual only, never auto-opens
  const [error, setError] = useState('');

  const handleLinked = useCallback(() => {
    setShowRealGram(false);
    // authStore.realId was already set by the handler — gate will un-render
  }, []);

  const handleWebViewClosed = useCallback(() => {
    setShowRealGram(false);
  }, []);

  // "Try again" — retries the same silent REAL-ID probe GameScreen ran on
  // mount. The primary, expected-to-work path (req #6).
  //
  // TEMP DEBUG (2026-07-19, build-109 real-device report): this callback
  // previously had ZERO logging — a tap that did nothing was indistinguishable
  // from a tap that never registered. Also: the old copy here always said
  // "Could not reach server", even when the server had responded fine but
  // just wasn't 'ok', and even when getSsoToken never got a response at all.
  // Khabat proved server + REAL-ID backend both up via direct curl with this
  // exact device_id — so "can't reach server" is actively wrong messaging.
  // Replaced with a flow-internal-error message; the real reason still goes
  // to [REALDBG] logs, not the user-facing string.
  const retry = useCallback(async () => {
    console.log('[REALDBG:4/7] RealIdGate "Try again" PRESSED', { deviceId, hasDeviceId: !!deviceId });
    if (!deviceId) {
      console.log('[REALDBG:4/7] ABORTING retry — deviceId is empty, getSsoToken will not be called');
      setError(t('realId.internalError'));
      return;
    }
    setChecking(true);
    setError('');
    try {
      const r = await getSsoToken(deviceId, true);
      console.log('[REALDBG:4/7] retry: getSsoToken returned', { status: r.status, hasAccount: !!r.account });
      if (r.status === 'ok' && r.account) {
        useAuthStore.getState().setRealId(r.account);
        console.log('[REALDBG:4/7] retry: setRealId applied — gate should un-render now', { account: r.account });
      } else {
        console.log('[REALDBG:4/7] retry: server responded but status did not qualify', { status: r.status });
        setError(t('realId.internalError'));
      }
    } catch (e: any) {
      console.log('[REALDBG:4/7] retry: getSsoToken THREW', { name: e?.name, message: e?.message });
      setError(t('realId.internalError'));
    } finally {
      setChecking(false);
    }
  }, [deviceId, t]);

  if (showRealGram) {
    return (
      <RealGramLinkWebView
        deviceId={deviceId}
        onLinked={handleLinked}
        onClose={handleWebViewClosed}
      />
    );
  }

  return (
    <View style={[gateStyles.container, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={gateStyles.bigIcon}>⚔️</Text>
      <Text style={gateStyles.title}>{t('realId.gateTitle')}</Text>
      <Text style={gateStyles.body}>{t('realId.gateBody')}</Text>

      <TouchableOpacity
        style={gateStyles.primaryBtn}
        onPress={retry}
        disabled={checking}
        activeOpacity={0.85}
      >
        {checking
          ? <ActivityIndicator size="small" color={Colors.bg.void} />
          : <Text style={gateStyles.primaryBtnText}>{t('realId.tryAgain')}</Text>}
      </TouchableOpacity>

      {!!error && <Text style={gateStyles.errorText}>{error}</Text>}

      {/* Manual, clearly-optional — never automatic, never the default path.
          Only relevant to an existing Telegram player (req #4/#5). */}
      <TouchableOpacity onPress={() => setShowRealGram(true)} activeOpacity={0.7}>
        <Text style={gateStyles.fallbackLink}>{t('realId.linkTelegram')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const gateStyles = StyleSheet.create({
  container:       { flex: 1, alignItems: 'center', justifyContent: 'center',
                     paddingHorizontal: Spacing[6], gap: Spacing[4] },
  bigIcon:         { fontSize: 56 },
  title:           { fontSize: 20, fontFamily: Typography.family.heading,
                     color: Colors.text.primary, textAlign: 'center' },
  body:            { fontSize: 13, color: Colors.text.muted, textAlign: 'center',
                     fontFamily: Typography.family.body, lineHeight: 20 },
  primaryBtn:      { width: '100%', backgroundColor: Colors.gold[400], borderRadius: Radius.xl,
                     paddingVertical: Spacing[4], alignItems: 'center' },
  primaryBtnText:  { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.bg.void },
  fallbackLink:    { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body,
                     textDecorationLine: 'underline', marginTop: Spacing[2] },
  errorText:       { fontSize: 12, color: '#FF6B6B', textAlign: 'center',
                     fontFamily: Typography.family.body },
});

const WEBVIEW_LOAD_TIMEOUT_MS = 20_000;

// ── Authenticated game view — inline, not a modal ────────────────────────────
// SSO token is fetched fresh; REAL-ID goes in URL as identity; device_id as
// security. Deliberately NOT a <Modal>: a sliding popup with its own title
// bar and X-close reads as "an external page opened on top of the app" —
// Shahnameh is meant to feel like a page of RealGram, not a browser tab
// launched inside it (Khabat, 2026-07-19). Renders in the same screen space
// the Game tab occupies, with a plain back arrow like any other in-app
// navigation, not a dismiss action.
//
// This is now the ONLY thing GameScreen shows once REAL-ID resolves (build
// 111, Khabat 2026-07-19: "RealGram-versjonen skal i praksis være
// Shahnameh-siden innebygd direkte" — the real Shahnameh page's own
// profile/Treasury/chapter-progress/bottom-nav IS the design, not a native
// re-implementation). Also the fix target for Khabat's build-110 report:
// pressing "ورود به شاهنامه"/Chapter/Continue opened a black screen with a
// spinner that never finished. WebView previously had NO onLoadStart/
// onLoadEnd/onError/onHttpError/timeout — a hang anywhere in that chain was
// indistinguishable from "still loading". All of that is instrumented below.
function GameWebView({
  path, deviceId, realId, onBack,
}: { path: string; deviceId: string; realId: string; onBack: () => void }) {
  const { t }   = useT();
  const webRef  = useRef<React.ElementRef<typeof WebView>>(null);
  const [url, setUrl]           = useState('');
  const [ready, setReady]       = useState(false);   // our own sso-token fetch done, URL built
  const [loadError, setLoadError]     = useState('');   // set by onError/onHttpError/timeout
  const [canGoBack, setCanGoBack]     = useState(false);
  const [retryKey, setRetryKey]       = useState(0);    // bump to force a full WebView remount
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  const armLoadTimeout = useCallback((forUrl: string) => {
    clearLoadTimeout();
    timeoutRef.current = setTimeout(() => {
      console.log('[REALDBG:7/7] GameWebView TIMEOUT — page never fired onLoadEnd within', WEBVIEW_LOAD_TIMEOUT_MS, 'ms', { url: forUrl });
      setLoadError(t('game.webviewTimedOut'));
    }, WEBVIEW_LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout, t]);

  useEffect(() => {
    // TEMP DEBUG (2026-07-19) — remove once confirmed fixed on device.
    // Reached only once RealIdGate has already passed (realId truthy) — this
    // is step 7 (navigating into the actual game view) mounting, which fires
    // its OWN fresh /v1/sso-token call (a second, later one than the
    // mount-time probe in GameScreen). There is no separate "/user/sync"
    // request anywhere in this build's flow — the minted token in the game
    // URL itself is what the game backend uses to sync the account. If step
    // 6 in Khabat's spec is expected to be a distinct network call, it does
    // not exist yet in this code and needs to be built, not just logged.
    console.log('[REALDBG:7/7] GameWebView MOUNTED (RealIdGate passed) — this is a fresh, second sso-token call for the WebView URL', { deviceId, path, realId, retryKey });
    console.log('[REALDBG:6/7] NOTE: no separate /user/sync call exists in this flow — skipping (not a bug, just not implemented)');
    setLoadError('');
    getSsoToken(deviceId, true).then((r) => {
      console.log('[REALDBG:7/7] GameWebView: sso-token resolved', { status: r.status, hasToken: !!r.token, account: r.account });
      if (r.status === 'ok' && r.account && !useAuthStore.getState().user?.realId) {
        useAuthStore.getState().setRealId(r.account);
      }
      const base   = `${BASE_GAME_URL}${path}`;
      const params = new URLSearchParams({ src: 'realink', device_id: deviceId });
      if (realId) params.set('real_id', realId);
      if (r.status === 'ok' && r.token) params.set('sso', r.token);
      const finalUrl = `${base}?${params}`;
      console.log('[REALDBG:7/7] WebView opening', { url: finalUrl, hasSsoParam: finalUrl.includes('sso='), hasRealIdParam: finalUrl.includes('real_id=') });
      setUrl(finalUrl);
      setReady(true);
      armLoadTimeout(finalUrl);
    }).catch((e) => {
      console.log('[REALDBG:7/7] GameWebView: sso-token THREW — opening WebView WITHOUT sso token (fallback path)', {
        name: e?.name, message: e?.message,
      });
      const params = new URLSearchParams({ src: 'realink', device_id: deviceId });
      if (realId) params.set('real_id', realId);
      const finalUrl = `${BASE_GAME_URL}${path}?${params}`;
      console.log('[REALDBG:7/7] WebView opening (fallback path, no sso token)', { url: finalUrl });
      setUrl(finalUrl);
      setReady(true);
      armLoadTimeout(finalUrl);
    });
    return () => clearLoadTimeout();
  }, [deviceId, path, realId, retryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    console.log('[REALDBG:7/7] GameWebView "Try again" pressed — remounting WebView', { url });
    setLoadError('');
    setReady(false);
    setRetryKey((k) => k + 1);
  }, [url]);

  const goBack = useCallback(() => {
    if (canGoBack) {
      console.log('[REALDBG:7/7] GameWebView back arrow — WebView.goBack() (in-page history)');
      webRef.current?.goBack();
    } else {
      console.log('[REALDBG:7/7] GameWebView back arrow — no in-page history, leaving to caller onBack()');
      onBack();
    }
  }, [canGoBack, onBack]);

  // No title bar, no border, no "SHAHNAMEH" label — Khabat, 2026-07-19: "la
  // det bli 10% RealGram design og 90% Shahnameh... må ha den cinematic
  // følelsen". A persistent header reads as browser chrome wrapped around
  // an external page; Shahnameh's own homepage already carries the
  // profile/Treasury/nav design, so this should feel like arriving on a
  // page of the app, not opening a tab inside it. Only a small floating
  // back affordance remains, overlaid on the content instead of eating a
  // fixed strip of vertical space.
  return (
    <View style={wvStyles.container}>
      <TouchableOpacity
        onPress={goBack}
        style={wvStyles.floatingBack}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={wvStyles.backText}>‹</Text>
      </TouchableOpacity>
      {!!loadError && (
        <View style={wvStyles.loader}>
          <Text style={wvStyles.errorText}>{loadError}</Text>
          <TouchableOpacity style={wvStyles.retryBtn} onPress={retry} activeOpacity={0.85}>
            <Text style={wvStyles.retryBtnText}>{t('realId.tryAgain')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {!loadError && !ready ? (
        <View style={wvStyles.loader}>
          <ActivityIndicator color={Colors.gold[400]} size="large" />
        </View>
      ) : !loadError && (
        <WebView
          key={retryKey}
          ref={webRef}
          source={{ uri: url }}
          style={wvStyles.web}
          startInLoadingState
          renderLoading={() => (
            <View style={wvStyles.loader}><ActivityIndicator color={Colors.gold[400]} size="large" /></View>
          )}
          originWhitelist={['https://*']}
          allowsBackForwardNavigationGestures
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          onLoadStart={(e: WebViewNavigationEvent): void => {
            console.log('[REALDBG:7/7] WebView onLoadStart', { url: e.nativeEvent.url });
          }}
          onLoadEnd={(e: WebViewNavigationEvent | WebViewErrorEvent): void => {
            console.log('[REALDBG:7/7] WebView onLoadEnd', { url: e.nativeEvent.url, title: (e.nativeEvent as any).title });
            clearLoadTimeout();
          }}
          onError={(e: WebViewErrorEvent): void => {
            console.log('[REALDBG:7/7] WebView onError (native load failure)', {
              url: e.nativeEvent.url, code: e.nativeEvent.code, description: e.nativeEvent.description,
            });
            clearLoadTimeout();
            setLoadError(t('game.webviewLoadError'));
          }}
          onHttpError={(e: WebViewHttpErrorEvent): void => {
            console.log('[REALDBG:7/7] WebView onHttpError (server responded with an error status)', {
              url: e.nativeEvent.url, statusCode: e.nativeEvent.statusCode,
            });
            clearLoadTimeout();
            setLoadError(t('game.webviewLoadError'));
          }}
          onNavigationStateChange={(state: WebViewNavigation): void => {
            // Every hop in a redirect chain fires this — exactly what's
            // needed to see a redirect loop or a bounce to an unexpected
            // origin/scheme instead of guessing from a stuck spinner.
            console.log('[REALDBG:7/7] WebView onNavigationStateChange', {
              url: state.url, loading: state.loading, title: state.title,
              canGoBack: state.canGoBack, navigationType: (state as any).navigationType,
            });
            setCanGoBack(state.canGoBack);
          }}
          onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest): boolean => {
            const allowed = req.url.startsWith('https://');
            if (!allowed) {
              console.log('[REALDBG:7/7] WebView BLOCKED non-https navigation (would otherwise hang silently)', { url: req.url });
            }
            return allowed;
          }}
          injectedJavaScriptBeforeContentLoaded={`
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
            document.head.appendChild(meta);
            true;
          `}
        />
      )}
    </View>
  );
}

// ── Main GameScreen ───────────────────────────────────────────────────────────
// Khabat, 2026-07-19: the previous native "hub" here (tap-to-earn card,
// Daily Missions/Story/Heroes/Rewards cards, an "Enter Shahnameh" button)
// was a separate, simplified re-implementation living alongside the real
// Shahnameh site — explicitly NOT what was wanted: "RealGram-versjonen skal
// i praksis være Shahnameh-siden innebygd direkte... Ikke lag en ny
// parallell spillforside." Shahnameh's own page already has the profile
// card, Treasury (FARR/ZAR/GEMS/XP/REAL/TON), Continue Journey, chapter
// progress and its own bottom nav (Home/Tap/Heroes/Learn/Earn/Guild/
// Social) — that IS the design. So GameScreen no longer renders a native
// destination screen at all: once REAL-ID resolves, it goes straight into
// GameWebView pointed at Shahnameh's homepage ('/'), which is that design,
// live. The identity-check spinner below is the only "skeleton" state.
export function GameScreen() {
  const deviceId    = useAuthStore((s) => s.user?.deviceId ?? '');
  const realId      = useAuthStore((s) => s.user?.realId   ?? '');
  const insets      = useSafeAreaInsets();

  // True while we're checking/waiting for identity to be ready. Starts true
  // whenever there's no realId yet — INCLUDING when deviceId itself isn't
  // populated yet (e.g. a Zustand persist rehydration race on a cold app
  // start). Previously this only started checking when deviceId was
  // already truthy, so an empty deviceId at mount time silently skipped
  // the whole probe instead of waiting for it — Khabat's build-108 report:
  // zero /v1/sso-token requests ever attempted on a real device. Fix,
  // 2026-07-19: wait for deviceId instead of giving up when it's empty.
  const [checking, setChecking] = useState(!realId);

  // On first render: silently probe SSO in case the user already linked via
  // a deep-link or RealGram in a previous session but realId wasn't cached
  // yet. If deviceId isn't populated yet, POLL for it (bounded) instead of
  // skipping the probe outright.
  useEffect(() => {
    // TEMP DEBUG (2026-07-19, Khabat's build-109 real-device report: zero
    // /v1/sso-token requests EVER leave the phone, incl. after "Try again").
    // Numbered to match Khabat's flow spec (REAL button -> realId ->
    // deviceId -> checkAndCacheRealId -> /v1/sso-token -> navigate). Every
    // branch below logs explicitly, including ones that previously failed
    // silently, so a missing step is provable instead of guessed.
    // Remove once confirmed fixed on a real device.
    console.log('[REALDBG:2/7] GameScreen mount: realId read from authStore', { realId, hasRealId: !!realId });
    console.log('[REALDBG:3/7] GameScreen mount: deviceId read from authStore', { deviceId, hasDeviceId: !!deviceId });

    if (realId) {
      console.log('[REALDBG:4/7] SKIPPING checkAndCacheRealId — realId already cached, nothing to probe');
      setChecking(false);
      return;
    }

    let cancelled = false;

    const runProbe = (id: string) => {
      console.log('[REALDBG:4/7] remote config at probe time', getCachedConfig());
      console.log('[REALDBG:4/7] checkAndCacheRealId STARTING (forGame=true internally)', { deviceId: id });
      checkAndCacheRealId(id)
        .then(() => {
          console.log('[REALDBG:4/7] checkAndCacheRealId returned (see ssoService [REALDBG:5/7] logs above for why)', {
            realIdAfter: useAuthStore.getState().user?.realId || '(still empty)',
          });
        })
        .catch((e) => {
          // checkAndCacheRealId's own contract is "never throws" (see
          // ssoService.ts) — reaching this .catch would itself be a bug.
          console.log('[REALDBG:4/7] UNEXPECTED — checkAndCacheRealId threw despite its never-throws contract', e);
        })
        .finally(() => { if (!cancelled) setChecking(false); });
    };

    if (deviceId) {
      runProbe(deviceId);
      return () => { cancelled = true; };
    }

    // deviceId not ready yet — WAIT instead of skipping. Poll briefly,
    // bounded to ~5s so a genuinely broken auth store doesn't spin forever.
    console.log('[REALDBG:3/7] deviceId empty at mount — WAITING instead of skipping (polling authStore)');
    let attempts = 0;
    const maxAttempts = 25; // 25 * 200ms = 5s
    const poll = () => {
      if (cancelled) return;
      attempts++;
      const liveDeviceId = useAuthStore.getState().user?.deviceId ?? '';
      console.log('[REALDBG:3/7] poll for deviceId', { attempt: attempts, liveDeviceId });
      if (liveDeviceId) {
        runProbe(liveDeviceId);
      } else if (attempts >= maxAttempts) {
        console.log('[REALDBG:3/7] GAVE UP waiting for deviceId after', attempts,
          'attempts (~5s) — checkAndCacheRealId will NEVER run this mount, deviceId genuinely never populated');
        setChecking(false);
      } else {
        setTimeout(poll, 200);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [deviceId, realId]); // eslint-disable-line react-hooks/exhaustive-deps

  // TEMP DEBUG (2026-07-19, build-109 real-device report): the identity
  // effect above has deps [deviceId, realId] and this is a bottom-tab screen
  // (createBottomTabNavigator keeps tabs mounted after first visit) — so if
  // the FIRST-EVER mount of this tab this session already resolved to
  // realId='' (checking=false), pressing the REAL/RealGram Home shortcut
  // again just re-focuses the SAME already-decided screen instance without
  // re-running the identity effect (its deps haven't changed). That would
  // look exactly like "pressing REAL again does nothing" if someone presses
  // the Home shortcut instead of the in-gate "Try again" button. Logged as a
  // plain mount-timestamp ref (not useFocusEffect — GameScreen is rendered
  // standalone in tests, outside any NavigationContainer, and useFocusEffect
  // throws without one) so this stays testable and still proves/disproves
  // the theory from a Metro/logcat capture. Remove once confirmed on device.
  const mountedAtRef = useRef<number | null>(null);
  if (mountedAtRef.current === null) {
    mountedAtRef.current = Date.now();
    console.log('[REALDBG:mount] GameScreen instance created', { mountedAt: mountedAtRef.current });
  }

  // Server-synced ZAR (contract §8, REALGRAM_UNIFIED_PLATFORM.md §B):
  // starts Shahnameh's tap-sync flush timer once deviceId is known. Also
  // piggybacks tapAnalytics' own init (see zarSyncService.ts) — kept even
  // though the native tap-to-earn card is gone (2026-07-19 redesign), since
  // this is that system's only wiring point and taps now happen inside the
  // embedded Shahnameh page itself, which still goes through this same
  // buffered sync path server-side.
  useEffect(() => {
    if (deviceId) initZarSync(deviceId);
  }, [deviceId]);

  // While probing server-side link status, show a neutral spinner so users
  // who are already linked (e.g. navigating from the RealGram shortcut)
  // never see the gate flash. This is the ONLY native "skeleton" state —
  // once realId resolves, GameWebView (the real Shahnameh page) is the
  // entire screen (Khabat, 2026-07-19 redesign — no parallel native hub).
  if (checking) {
    console.log('[REALDBG] render: spinner (checking=true)', { deviceId, realId });
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.gold[400]} />
      </View>
    );
  }

  // Gate: show REAL-ID creation prompt if not linked
  if (!realId) {
    console.log('[REALDBG] render: RealIdGate (realId empty after checking)', { deviceId, realId });
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <RealIdGate deviceId={deviceId} />
      </View>
    );
  }

  console.log('[REALDBG] render: GameWebView (realId present) — Shahnameh homepage IS the game screen', { deviceId, realId });
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GameWebView
        path="/"
        deviceId={deviceId}
        realId={realId}
        onBack={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
