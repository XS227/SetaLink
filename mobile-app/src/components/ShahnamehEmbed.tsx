/**
 * ShahnamehEmbed — reusable REAL-ID-gated embed of a Shahnameh page.
 *
 * Extracted 2026-07-19 from GameScreen.tsx so the exact same instrumented,
 * hardened WebView (onLoadStart/onLoadEnd/onError/onHttpError/timeout/retry,
 * built after Khabat's build-110/111 black-spinner reports) can be reused
 * for other Shahnameh-backed tabs — starting with a planned Profile-tab
 * swap (Khabat, 2026-07-19: "de skal bli ett i appen") — without copy-pasting
 * ~250 lines or letting the two copies drift out of sync on the next bug fix.
 *
 * REAL-ID is the primary identity here — Telegram is never required to
 * play (Khabat, 2026-07-19, TASK_SPLIT.md). On mount, silently probes the
 * SSO endpoint with forGame=true (checkAndCacheRealId): the panel mints
 * straight off this device's own RealGram identity when no Telegram
 * account is linked yet, rather than reporting 'unlinked' — so for
 * virtually every RealGram user this resolves instantly and they never see
 * any gate at all, Telegram or otherwise.
 *
 * REAL-ID identity gate (RealIdGate below) only renders when that silent
 * probe genuinely fails (backend unreachable/misconfigured): an internal
 * RealGram error + retry, never an auto-opened Telegram screen. Linking an
 * existing Telegram account's history is still possible from here, but as
 * a manual, clearly-secondary action — never automatic, never the default.
 *
 * DeviceId = secure lookup key only (anti-abuse, rate-limiting). REAL-ID is
 * the account identity embedded in the JWT and passed as real_id= to the
 * embedded page's URL.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import type {
  WebViewNavigationEvent, WebViewErrorEvent, WebViewHttpErrorEvent, ShouldStartLoadRequest,
} from 'react-native-webview/lib/WebViewTypes';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { BottomNav } from './BottomNav';
import { useT } from '../i18n';
import { useIdentityStore } from '../stores/identityStore';
import { useAuthStore } from '../stores/authStore';
import { useOverlayStore } from '../stores/overlayStore';
import { getSsoToken, checkAndCacheRealId } from '../services/ssoService';
import { linkRealAccount } from '../services/realWalletService';
import { parseDeepLink } from '../services/deepLinkService';
import { pushEcosystemProfile } from '../services/ecosystemProfileService';
import { getCachedConfig } from '../services/remoteConfigService';
import { buildQueryString } from '../utils/queryString';

// '/' off the bare domain is shahnameh.setaei.com's public marketing/
// landing page (a separate Next.js deployment, no game logic at all —
// confirmed 2026-07-19 by agent B reading its source: no real_id/sso
// parsing, no JWT verification, no profile/treasury/chapter fetch
// anywhere in it). The actual playable game — sync.js's REAL-ID/SSO
// handling, home.js's profile/treasury/chapter hydration — lives at
// /season2/ (index.html), a completely different, vanilla-JS codebase.
// This was the real root cause of the build-110/111 black-spinner
// reports: the WebView loaded successfully (200 OK, real content) but
// that content had zero code to ever act on real_id/sso/device_id
// (agent B, commit a1feea8 on the pre-refactor GameScreen.tsx; ported
// here since BASE_GAME_URL now lives in this shared component instead).
const BASE_GAME_URL = 'https://shahnameh.setaei.com/season2';
const PANEL_API     = 'https://setalink.no/api.php';

// Shared by the initial before-content-loaded injection AND the live-update
// effect below (ShahnamehWebView) so both paths set the exact same variable
// the exact same way — season2's CSS reads this to reserve space for
// RealGram's native bottom tab bar (Khabat's "RealGram bottom nav dekker
// spillinnhold" report, 2026-07-19; chapter/guild retest still broken,
// 2026-07-20 — root cause was `injectedJavaScriptBeforeContentLoaded` only
// ever firing once per page load, never updated afterward).
function bottomNavHeightScript(px: number): string {
  return `document.documentElement.style.setProperty('--realgram-bottom-nav-height', '${px}px'); true;`;
}

// ── Debug bus (2026-07-19, Khabat: "vi trenger konkret runtime-bevis fra
// enheten, ikke flere antakelser") ──────────────────────────────────────
// A device retest still black-screens even with app storage fully wiped —
// ruling out WebView cache — and server logs confirm the request never
// reaches shahnameh.setaei.com at all, so whatever's hanging is upstream
// of the WebView, in one of THREE separate spinners that all render
// identically (gold ActivityIndicator on void bg): ShahnamehEmbed's own
// "checking" gate, ShahnamehWebView's own "waiting for sso-token" gate,
// and finally react-native-webview's own startInLoadingState/renderLoading
// spinner once the WebView actually mounts. Module-level so state survives
// the component-tree boundary between those three without prop-drilling a
// callback through RealIdGate/ShahnamehWebView/ShahnamehEmbed. Never sent
// off-device — purely an on-screen (no-adb-needed) diagnostic.
type DebugEntry = { step: string; at: number; detail?: string };
type DebugState = {
  startedAt: number;
  trace: DebugEntry[];
  url: string;
  lastNativeEvent: string;
  lastPageStep: string;
  lastPageError: string;
  httpStatus: number | undefined;
  nativeError: string;
};
const debugBus = (() => {
  const state: DebugState = {
    startedAt: Date.now(), trace: [], url: '', lastNativeEvent: '',
    lastPageStep: '', lastPageError: '', httpStatus: undefined, nativeError: '',
  };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    report(step: string, detail?: string, patch?: Partial<DebugState>) {
      state.trace = [...state.trace.slice(-11), { step, at: Date.now(), detail }];
      if (patch) Object.assign(state, patch);
      notify();
    },
    reset() {
      state.startedAt = Date.now();
      state.trace = [];
      state.url = ''; state.lastNativeEvent = ''; state.lastPageStep = '';
      state.lastPageError = ''; state.httpStatus = undefined; state.nativeError = '';
      notify();
    },
    get: () => state,
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
})();

function useDebugBus(): DebugState {
  const [, force] = useState(0);
  useEffect(() => debugBus.subscribe(() => force((n) => n + 1)), []);
  return debugBus.get();
}

// True once `ms` has elapsed since the shared debugBus start (NOT since
// whichever of the three spinners is currently on-screen — a single
// 10s-from-first-render budget, matching Khabat's ask, not a fresh 10s
// grace period every time one gate hands off to the next).
function useShowDebugAfter(ms: number): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const remaining = Math.max(0, ms - (Date.now() - debugBus.get().startedAt));
    const tid = setTimeout(() => setShow(true), remaining);
    return () => clearTimeout(tid);
  }, [ms]);
  return show;
}

const DEBUG_OVERLAY_AFTER_MS = 10_000;

function DebugOverlay({ debugLabel }: { debugLabel: string }) {
  const d = useDebugBus();
  const elapsedS = ((Date.now() - d.startedAt) / 1000).toFixed(1);
  return (
    <View style={debugStyles.wrap}>
      <Text style={debugStyles.title}>Still loading — {debugLabel} — {elapsedS}s</Text>
      <ScrollView style={debugStyles.scroll} contentContainerStyle={debugStyles.scrollContent}>
        <Text style={debugStyles.mono}>url: {d.url || '(not built yet)'}</Text>
        <Text style={debugStyles.mono}>last native event: {d.lastNativeEvent || '(none)'}</Text>
        <Text style={debugStyles.mono}>last page step: {d.lastPageStep || '(none — page JS may never have run)'}</Text>
        <Text style={debugStyles.mono}>http status: {d.httpStatus ?? '(none)'}</Text>
        <Text style={debugStyles.mono}>native error: {d.nativeError || '(none)'}</Text>
        <Text style={debugStyles.mono}>page error: {d.lastPageError || '(none)'}</Text>
        <Text style={debugStyles.sectionTitle}>trace:</Text>
        {d.trace.map((e, i) => (
          <Text key={i} style={debugStyles.traceLine}>
            +{((e.at - d.startedAt) / 1000).toFixed(1)}s  {e.step}{e.detail ? ` — ${e.detail}` : ''}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const debugStyles = StyleSheet.create({
  wrap:         { flex: 1, backgroundColor: '#0a0a0e', padding: 16, gap: 8 },
  title:        { color: '#FF6B6B', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  scroll:       { flex: 1 },
  scrollContent:{ gap: 4, paddingBottom: 24 },
  mono:         { color: '#C8D8F0', fontSize: 11, fontFamily: 'monospace' },
  sectionTitle: { color: '#8A9BBF', fontSize: 11, fontWeight: '700', marginTop: 8 },
  traceLine:    { color: '#8A9BBF', fontSize: 10, fontFamily: 'monospace' },
});

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
  web:        { flex: 1, backgroundColor: Colors.bg.void },
  webWrap:    { flex: 1 },
  // Opaque — must fully hide the WebView's own paint underneath until
  // pageVisuallyReady, not just add a spinner on top of a visible page.
  pageLoadingOverlay: { backgroundColor: Colors.bg.void },
  errorText:  { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, lineHeight: 20 },
  retryBtn:      { backgroundColor: Colors.gold[400], borderRadius: Radius.xl,
                   paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  retryBtnText:  { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});

// ── REAL-ID gate ─────────────────────────────────────────────────────────────
// Reached only when the silent on-mount probe (checkAndCacheRealId,
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
function RealIdGate({ deviceId, debugLabel }: { deviceId: string; debugLabel: string }) {
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

  // "Try again" — retries the same silent REAL-ID probe run on mount. The
  // primary, expected-to-work path (req #6).
  const retry = useCallback(async () => {
    console.log(`[REALDBG:4/7][${debugLabel}] RealIdGate "Try again" PRESSED`, { deviceId, hasDeviceId: !!deviceId });
    if (!deviceId) {
      console.log(`[REALDBG:4/7][${debugLabel}] ABORTING retry — deviceId is empty, getSsoToken will not be called`);
      setError(t('realId.internalError'));
      return;
    }
    setChecking(true);
    setError('');
    try {
      const r = await getSsoToken(deviceId, true);
      console.log(`[REALDBG:4/7][${debugLabel}] retry: getSsoToken returned`, { status: r.status, hasAccount: !!r.account });
      if (r.status === 'ok' && r.account) {
        useAuthStore.getState().setRealId(r.account);
        console.log(`[REALDBG:4/7][${debugLabel}] retry: setRealId applied — gate should un-render now`, { account: r.account });
      } else {
        console.log(`[REALDBG:4/7][${debugLabel}] retry: server responded but status did not qualify`, { status: r.status });
        setError(t('realId.internalError'));
      }
    } catch (e: any) {
      console.log(`[REALDBG:4/7][${debugLabel}] retry: getSsoToken THREW`, { name: e?.name, message: e?.message, code: e?.code });
      // Debug suffix (Khabat, 2026-07-19): getSsoToken now has its own hard
      // watchdog (ssoService.ts) so this can no longer hang forever, but
      // surfacing WHY it failed (e.g. code=HARD_TIMEOUT means the fetch
      // never settled even after abort()) directly here means Khabat can
      // read the reason off this screen without adb.
      setError(`${t('realId.internalError')} [${e?.code || e?.name || 'error'}]`);
    } finally {
      setChecking(false);
    }
  }, [deviceId, t, debugLabel]);

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

const WEBVIEW_LOAD_TIMEOUT_MS = 10_000; // lowered from 20s per Khabat/A->B(30)'s explicit deliverable ask

// ── Authenticated Shahnameh view — inline, not a modal ───────────────────────
// SSO token is fetched fresh; REAL-ID goes in URL as identity; device_id as
// security. Deliberately NOT a <Modal>: a sliding popup with its own title
// bar and X-close reads as "an external page opened on top of the app" —
// Shahnameh is meant to feel like a page of RealGram, not a browser tab
// launched inside it (Khabat, 2026-07-19). Renders in the same screen space
// the tab occupies, with a plain back arrow like any other in-app
// navigation, not a dismiss action.
//
// Fix target for Khabat's build-110/111 reports: pressing into Shahnameh
// opened a black screen with a spinner that never finished. WebView
// previously had NO onLoadStart/onLoadEnd/onError/onHttpError/timeout — a
// hang anywhere in that chain was indistinguishable from "still loading".
// All of that is instrumented below.
function ShahnamehWebView({
  path, deviceId, realId, onBack, debugLabel,
}: { path: string; deviceId: string; realId: string; onBack: () => void; debugLabel: string }) {
  const { t }   = useT();
  const insets  = useSafeAreaInsets();
  const webRef  = useRef<React.ElementRef<typeof WebView>>(null);
  const [url, setUrl]           = useState('');
  const [ready, setReady]       = useState(false);   // our own sso-token fetch done, URL built
  const [loadError, setLoadError]     = useState('');   // set by onError/onHttpError/timeout
  const [canGoBack, setCanGoBack]     = useState(false);
  const [retryKey, setRetryKey]       = useState(0);    // bump to force a full WebView remount
  // True once season2 has actually painted Home (or onLoadEnd fired as a
  // fallback) — NOT the same as `ready` above, which only means "our own
  // URL is built." Khabat, 2026-07-19 (post-fix retest): a few seconds of
  // white/black screen showed before Home appeared, because the WebView
  // itself was visible and painting the whole time `ready` was true. Until
  // this flips, a native gold-on-void overlay covers the WebView instead —
  // the WebView keeps loading underneath so it can still fire the
  // postMessage that flips this — so the user only ever sees native
  // Shahnameh/REAL-styled loading, never the page's own blank/white paint.
  const [pageVisuallyReady, setPageVisuallyReady] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // BottomNav.CONTENT_HEIGHT is the single source of truth for the nav's own
  // height (see BottomNav.tsx) — insets.bottom is reactive (rotation,
  // foldables) so this is recomputed on every render, not read once.
  const bottomNavHeightPx = BottomNav.CONTENT_HEIGHT + insets.bottom;

  // injectedJavaScriptBeforeContentLoaded (below, in the WebView JSX) only
  // ever fires once per page load — it does NOT re-run if insets.bottom
  // changes while the page is already loaded (rotation, etc.), so without
  // this the CSS variable can go stale or, if the before-load script never
  // fired for this particular navigation, never get set at all (confirmed
  // 2026-07-20: chapter.html retest still showed the footer overlap despite
  // the server-side CSS fix being live). injectJavaScript() pushes an
  // update into the already-loaded page; harmless no-op if the WebView
  // hasn't painted anything yet (the before-load script covers that case).
  useEffect(() => {
    webRef.current?.injectJavaScript(bottomNavHeightScript(bottomNavHeightPx));
  }, [bottomNavHeightPx]);

  // ── Overlay bridge (2026-07-21) ────────────────────────────────────────
  // season2/realgram-bridge.js posts {source:'season2bridge', type:'overlay-
  // open'|'overlay-closed'} whenever any modal/bottom-sheet/quiz/chapter
  // overlay/full-screen menu shows or hides — see that file for the
  // DOM-observation approach (overlay implementations aren't unified across
  // season2's pages, so it watches for known overlay-root selectors rather
  // than requiring every call site to notify explicitly).
  const isFocused = useIsFocused();

  // Reset on blur/unmount — this tab may not be the one on screen anymore
  // (Tab.Navigator keeps screens mounted across tab switches, no
  // unmountOnBlur), so a stale "overlay open" from a backgrounded tab must
  // never leave the OTHER tab's nav hidden.
  useEffect(() => {
    if (!isFocused) useOverlayStore.getState().setOpen(false);
  }, [isFocused]);
  useEffect(() => () => useOverlayStore.getState().setOpen(false), []);

  // Android hardware back: while this screen is focused AND season2 reports
  // an overlay open, forward the press into the page (closes the topmost
  // overlay) instead of the default behavior (leaving the tab / app-exit
  // confirmation). Matches Khabat's ask: "close the web modal first, not
  // the whole game."
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isFocused) return false;
      if (!useOverlayStore.getState().isOpen) return false;
      webRef.current?.injectJavaScript(
        'window.RealGramBridge && window.RealGramBridge.handleNativeBack(); true;'
      );
      return true;
    });
    return () => sub.remove();
  }, [isFocused]);

  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  const armLoadTimeout = useCallback((forUrl: string) => {
    clearLoadTimeout();
    timeoutRef.current = setTimeout(() => {
      console.log(`[REALDBG:7/7][${debugLabel}] ShahnamehWebView TIMEOUT — page never fired onLoadEnd within`, WEBVIEW_LOAD_TIMEOUT_MS, 'ms', { url: forUrl });
      debugBus.report('webview:timeout', `no onLoadEnd within ${WEBVIEW_LOAD_TIMEOUT_MS}ms`);
      setLoadError(t('game.webviewTimedOut'));
    }, WEBVIEW_LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout, t, debugLabel]);

  useEffect(() => {
    console.log(`[REALDBG:7/7][${debugLabel}] ShahnamehWebView MOUNTED (RealIdGate passed) — fresh sso-token call for the WebView URL`, { deviceId, path, realId, retryKey });
    debugBus.report('webview:mounted, fetching sso-token');
    setLoadError('');
    setPageVisuallyReady(false);
    getSsoToken(deviceId, true).then((r) => {
      console.log(`[REALDBG:7/7][${debugLabel}] ShahnamehWebView: sso-token resolved`, { status: r.status, hasToken: !!r.token, account: r.account });
      debugBus.report('webview:sso-token resolved', `status=${r.status} hasToken=${!!r.token}`);
      if (r.status === 'ok' && r.account && !useAuthStore.getState().user?.realId) {
        useAuthStore.getState().setRealId(r.account);
      }
      const base = `${BASE_GAME_URL}${path}`;
      // Root cause (Khabat, 2026-07-19, confirmed via the debug panel below):
      // this device's URLSearchParams throws "URLSearchParams.set is not
      // implemented" — .set() used to throw here synchronously, before the
      // WebView URL was ever built (matches "url: not built yet" in the
      // debug panel). buildQueryString never calls .set()/.append()/.delete().
      const qs = buildQueryString({
        src: 'realink',
        device_id: deviceId,
        real_id: realId || undefined,
        sso: (r.status === 'ok' && r.token) ? r.token : undefined,
      });
      const finalUrl = `${base}?${qs}`;
      console.log(`[REALDBG:7/7][${debugLabel}] WebView opening`, { url: finalUrl, hasSsoParam: finalUrl.includes('sso='), hasRealIdParam: finalUrl.includes('real_id=') });
      debugBus.report('webview:url built', undefined, { url: finalUrl });
      setUrl(finalUrl);
      setReady(true);
      armLoadTimeout(finalUrl);
    }).catch((e) => {
      console.log(`[REALDBG:7/7][${debugLabel}] ShahnamehWebView: sso-token THREW — opening WebView WITHOUT sso token (fallback path)`, {
        name: e?.name, message: e?.message,
      });
      debugBus.report('webview:sso-token THREW (fallback, no sso param)', `${e?.name}: ${e?.message}`);
      const qs = buildQueryString({
        src: 'realink',
        device_id: deviceId,
        real_id: realId || undefined,
      });
      const finalUrl = `${BASE_GAME_URL}${path}?${qs}`;
      console.log(`[REALDBG:7/7][${debugLabel}] WebView opening (fallback path, no sso token)`, { url: finalUrl });
      debugBus.report('webview:url built (fallback, no sso)', undefined, { url: finalUrl });
      setUrl(finalUrl);
      setReady(true);
      armLoadTimeout(finalUrl);
    });
    return () => clearLoadTimeout();
  }, [deviceId, path, realId, retryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const showDebug = useShowDebugAfter(DEBUG_OVERLAY_AFTER_MS);

  const retry = useCallback(() => {
    console.log(`[REALDBG:7/7][${debugLabel}] "Try again" pressed — remounting WebView`, { url });
    setLoadError('');
    setReady(false);
    setRetryKey((k) => k + 1);
  }, [url, debugLabel]);

  const goBack = useCallback(() => {
    if (canGoBack) {
      console.log(`[REALDBG:7/7][${debugLabel}] back arrow — WebView.goBack() (in-page history)`);
      webRef.current?.goBack();
    } else {
      console.log(`[REALDBG:7/7][${debugLabel}] back arrow — no in-page history, leaving to caller onBack()`);
      onBack();
    }
  }, [canGoBack, onBack, debugLabel]);

  // No title bar, no border, no page label — Khabat, 2026-07-19: "la det bli
  // 10% RealGram design og 90% Shahnameh... må ha den cinematic følelsen". A
  // persistent header reads as browser chrome wrapped around an external
  // page; Shahnameh's own page already carries the design (profile/
  // Treasury/nav), so this should feel like arriving on a page of the app,
  // not opening a tab inside it. Only a small floating back affordance
  // remains, overlaid on the content instead of eating a fixed strip of
  // vertical space.
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
      {!loadError && !ready && (
        showDebug ? <DebugOverlay debugLabel={debugLabel} /> : (
          <View style={wvStyles.loader}>
            <ActivityIndicator color={Colors.gold[400]} size="large" />
          </View>
        )
      )}
      {!loadError && ready && (
        // Khabat, 2026-07-19 (post-fix retest): "noen sekunder med hvit/
        // svart skjerm" before Home appeared — the WebView was visible and
        // painting its own blank/white surface for the whole gap between
        // `ready` (our URL is built) and the page actually rendering
        // something. The WebView now always mounts here (so it can load
        // and fire the postMessage that flips `pageVisuallyReady`), but a
        // native, Shahnameh/REAL-styled overlay covers it — same visual
        // language as the rest of this screen — until that happens, so the
        // user only ever sees ONE controlled native loading experience,
        // never the page's own default paint.
        <View style={wvStyles.webWrap}>
          <WebView
            key={retryKey}
            ref={webRef}
            source={{ uri: url }}
            style={wvStyles.web}
            javaScriptEnabled
            originWhitelist={['https://*']}
          allowsBackForwardNavigationGestures
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          onLoadStart={(e: WebViewNavigationEvent): void => {
            console.log(`[REALDBG:7/7][${debugLabel}] WebView onLoadStart`, { url: e.nativeEvent.url });
            debugBus.report('native:onLoadStart', e.nativeEvent.url, { lastNativeEvent: 'onLoadStart' });
          }}
          onLoadEnd={(e: WebViewNavigationEvent | WebViewErrorEvent): void => {
            console.log(`[REALDBG:7/7][${debugLabel}] WebView onLoadEnd`, { url: e.nativeEvent.url, title: (e.nativeEvent as any).title });
            debugBus.report('native:onLoadEnd', e.nativeEvent.url, { lastNativeEvent: 'onLoadEnd' });
            clearLoadTimeout();
            // Fallback reveal: if season2's postMessage step never arrives
            // (older cached page, message dropped, etc.), don't leave the
            // native overlay up forever once the browser itself says the
            // page finished loading.
            setPageVisuallyReady(true);
          }}
          onError={(e: WebViewErrorEvent): void => {
            console.log(`[REALDBG:7/7][${debugLabel}] WebView onError (native load failure)`, {
              url: e.nativeEvent.url, code: e.nativeEvent.code, description: e.nativeEvent.description,
            });
            debugBus.report('native:onError', `code=${e.nativeEvent.code} ${e.nativeEvent.description}`, {
              lastNativeEvent: 'onError', nativeError: `${e.nativeEvent.code}: ${e.nativeEvent.description}`,
            });
            clearLoadTimeout();
            setLoadError(t('game.webviewLoadError'));
          }}
          onHttpError={(e: WebViewHttpErrorEvent): void => {
            console.log(`[REALDBG:7/7][${debugLabel}] WebView onHttpError (server responded with an error status)`, {
              url: e.nativeEvent.url, statusCode: e.nativeEvent.statusCode,
            });
            debugBus.report('native:onHttpError', `status=${e.nativeEvent.statusCode}`, {
              lastNativeEvent: 'onHttpError', httpStatus: e.nativeEvent.statusCode,
            });
            clearLoadTimeout();
            setLoadError(t('game.webviewLoadError'));
          }}
          onNavigationStateChange={(state: WebViewNavigation): void => {
            // Every hop in a redirect chain fires this — exactly what's
            // needed to see a redirect loop or a bounce to an unexpected
            // origin/scheme instead of guessing from a stuck spinner.
            console.log(`[REALDBG:7/7][${debugLabel}] WebView onNavigationStateChange`, {
              url: state.url, loading: state.loading, title: state.title,
              canGoBack: state.canGoBack, navigationType: (state as any).navigationType,
            });
            debugBus.report('native:onNavigationStateChange', `loading=${state.loading} url=${state.url}`, {
              lastNativeEvent: 'onNavigationStateChange',
            });
            setCanGoBack(state.canGoBack);
          }}
          onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest): boolean => {
            const allowed = req.url.startsWith('https://');
            if (!allowed) {
              console.log(`[REALDBG:7/7][${debugLabel}] WebView BLOCKED non-https navigation (would otherwise hang silently)`, { url: req.url });
              debugBus.report('native:BLOCKED non-https navigation', req.url);
            }
            return allowed;
          }}
          // Bridge for season2's own window.__realDebug bridge (sync.js):
          // it already calls window.ReactNativeWebView.postMessage({source:
          // 'season2debug', step/error, ...}) on every init step and on any
          // window.onerror/unhandledrejection — this WebView simply never
          // had an onMessage handler to receive it (Khabat's checklist
          // point 3/4, 2026-07-19). Without this, those postMessage calls
          // were firing into the void the whole time.
          onMessage={(e: { nativeEvent: { data: string } }): void => {
            try {
              const msg = JSON.parse(e.nativeEvent.data) as Record<string, unknown>;
              if (msg.source === 'season2bridge') {
                if (msg.type === 'overlay-open')   useOverlayStore.getState().setOpen(true);
                if (msg.type === 'overlay-closed') useOverlayStore.getState().setOpen(false);
                return;
              }
              if (msg.source !== 'season2debug') return;
              const step = String(msg.step || (msg.error ? `error:${msg.error}` : 'page-message'));
              console.log(`[REALDBG:7/7][${debugLabel}] page postMessage (season2debug)`, msg);
              debugBus.report(`page:${step}`, JSON.stringify(msg).slice(0, 200), {
                lastPageStep: step,
                ...(msg.error ? { lastPageError: String(msg.error) } : {}),
              });
              // Primary reveal signal (Khabat, 2026-07-19: kill the white/
              // black flash before Home shows). home.js's own boot sequence
              // renders Home from local cache before touching the network
              // (bootHomeHydration — see B->A(29)) — "sync-render-done" is
              // the earliest step where there's actually something on
              // screen worth showing, well before the slower
              // "realsync-ready" (fresh-from-server) step.
              if (step.includes('sync-render-done') || step.includes('realsync-ready')) {
                setPageVisuallyReady(true);
              }
            } catch { /* ignore non-JSON / non-season2debug messages */ }
          }}
          // Tell season2's own CSS how much space RealGram's native bottom
          // tab bar occupies, so its scroll containers/menus can reserve
          // room for it — there's no native safe-area for a sibling native
          // view like our tab bar, only for the OS chrome (Khabat's
          // "RealGram bottom nav dekker spillinnhold" report, 2026-07-19).
          // This only covers the initial paint of each page load — the
          // useEffect above (keyed on bottomNavHeightPx) handles updates
          // to an already-loaded page, and BottomNav.CONTENT_HEIGHT (not a
          // separately hand-maintained constant) is the single source of
          // truth for the nav's own height.
          injectedJavaScriptBeforeContentLoaded={`
            ${bottomNavHeightScript(bottomNavHeightPx)}
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
            document.head.appendChild(meta);
            true;
          `}
          />
          {!pageVisuallyReady && (
            <View style={[StyleSheet.absoluteFillObject, wvStyles.loader, wvStyles.pageLoadingOverlay]}>
              {showDebug ? <DebugOverlay debugLabel={debugLabel} /> : (
                <ActivityIndicator color={Colors.gold[400]} size="large" />
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * ShahnamehEmbed — mount this to embed a REAL-ID-gated Shahnameh page as an
 * entire screen. Handles the identity check (silent probe -> gate -> embed)
 * end to end; the caller only supplies which Shahnameh path to open and a
 * short label for REALDBG log correlation (multiple embeds can be mounted
 * across different tabs in the same app session — the label disambiguates
 * their logs, e.g. "game" vs "profile").
 */
export function ShahnamehEmbed({ path, debugLabel }: { path: string; debugLabel: string }) {
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const realId   = useAuthStore((s) => s.user?.realId   ?? '');
  const insets   = useSafeAreaInsets();

  // True while we're checking/waiting for identity to be ready. Starts true
  // whenever there's no realId yet — INCLUDING when deviceId itself isn't
  // populated yet (e.g. a Zustand persist rehydration race on a cold app
  // start). Previously this only started checking when deviceId was already
  // truthy, so an empty deviceId at mount time silently skipped the whole
  // probe instead of waiting for it — Khabat's build-108 report: zero
  // /v1/sso-token requests ever attempted on a real device. Fix, 2026-07-19:
  // wait for deviceId instead of giving up when it's empty.
  const [checking, setChecking] = useState(!realId);
  const showDebug = useShowDebugAfter(DEBUG_OVERLAY_AFTER_MS);

  // One shared diagnostic clock per actual mount of this screen (not per
  // re-render) — see the debugBus comment above.
  useEffect(() => { debugBus.reset(); }, []);

  // On first render: silently probe SSO in case the user already linked via
  // a deep-link or RealGram in a previous session but realId wasn't cached
  // yet. If deviceId isn't populated yet, POLL for it (bounded) instead of
  // skipping the probe outright.
  useEffect(() => {
    console.log(`[REALDBG:2/7][${debugLabel}] mount: realId read from authStore`, { realId, hasRealId: !!realId });
    console.log(`[REALDBG:3/7][${debugLabel}] mount: deviceId read from authStore`, { deviceId, hasDeviceId: !!deviceId });
    debugBus.report('embed:mounted', `deviceId=${deviceId || '(empty)'} realId=${realId || '(empty)'}`);

    if (realId) {
      console.log(`[REALDBG:4/7][${debugLabel}] SKIPPING checkAndCacheRealId — realId already cached, nothing to probe`);
      debugBus.report('embed:skip-probe (realId already cached)');
      setChecking(false);
      return;
    }

    let cancelled = false;

    const runProbe = (id: string) => {
      console.log(`[REALDBG:4/7][${debugLabel}] remote config at probe time`, getCachedConfig());
      console.log(`[REALDBG:4/7][${debugLabel}] checkAndCacheRealId STARTING (forGame=true internally)`, { deviceId: id });
      debugBus.report('embed:checkAndCacheRealId starting');
      checkAndCacheRealId(id)
        .then(() => {
          console.log(`[REALDBG:4/7][${debugLabel}] checkAndCacheRealId returned (see ssoService [REALDBG:5/7] logs above for why)`, {
            realIdAfter: useAuthStore.getState().user?.realId || '(still empty)',
          });
          debugBus.report('embed:checkAndCacheRealId returned', `realIdAfter=${useAuthStore.getState().user?.realId || '(still empty)'}`);
        })
        .catch((e) => {
          // checkAndCacheRealId's own contract is "never throws" (see
          // ssoService.ts) — reaching this .catch would itself be a bug.
          console.log(`[REALDBG:4/7][${debugLabel}] UNEXPECTED — checkAndCacheRealId threw despite its never-throws contract`, e);
          debugBus.report('embed:checkAndCacheRealId UNEXPECTEDLY THREW', String(e));
        })
        .finally(() => { if (!cancelled) setChecking(false); });
    };

    if (deviceId) {
      runProbe(deviceId);
      return () => { cancelled = true; };
    }

    // deviceId not ready yet — WAIT instead of skipping. Poll briefly,
    // bounded to ~5s so a genuinely broken auth store doesn't spin forever.
    console.log(`[REALDBG:3/7][${debugLabel}] deviceId empty at mount — WAITING instead of skipping (polling authStore)`);
    debugBus.report('embed:deviceId empty — polling authStore');
    let attempts = 0;
    const maxAttempts = 25; // 25 * 200ms = 5s
    const poll = () => {
      if (cancelled) return;
      attempts++;
      const liveDeviceId = useAuthStore.getState().user?.deviceId ?? '';
      console.log(`[REALDBG:3/7][${debugLabel}] poll for deviceId`, { attempt: attempts, liveDeviceId });
      if (liveDeviceId) {
        debugBus.report('embed:deviceId appeared', `after ${attempts} polls`);
        runProbe(liveDeviceId);
      } else if (attempts >= maxAttempts) {
        console.log(`[REALDBG:3/7][${debugLabel}] GAVE UP waiting for deviceId after`, attempts,
          'attempts (~5s) — checkAndCacheRealId will NEVER run this mount, deviceId genuinely never populated');
        debugBus.report('embed:GAVE UP waiting for deviceId', `after ${attempts} polls (~5s)`);
        setChecking(false);
      } else {
        setTimeout(poll, 200);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [deviceId, realId, debugLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // While probing server-side link status, show a neutral spinner so users
  // who are already linked never see the gate flash. This is the ONLY
  // native "skeleton" state — once realId resolves, the embedded Shahnameh
  // page is the entire screen.
  if (checking) {
    console.log(`[REALDBG][${debugLabel}] render: spinner (checking=true)`, { deviceId, realId });
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        {showDebug
          ? <DebugOverlay debugLabel={debugLabel} />
          : <ActivityIndicator size="large" color={Colors.gold[400]} />}
      </View>
    );
  }

  // Gate: show REAL-ID creation prompt if not linked
  if (!realId) {
    console.log(`[REALDBG][${debugLabel}] render: RealIdGate (realId empty after checking)`, { deviceId, realId });
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <RealIdGate deviceId={deviceId} debugLabel={debugLabel} />
      </View>
    );
  }

  console.log(`[REALDBG][${debugLabel}] render: ShahnamehWebView (realId present)`, { deviceId, realId, path });
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ShahnamehWebView
        path={path}
        deviceId={deviceId}
        realId={realId}
        onBack={() => {}}
        debugLabel={debugLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
