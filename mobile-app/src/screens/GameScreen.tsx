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
  ActivityIndicator, Image, Pressable,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GoldBeatBurst }    from '../components/GoldBeatBurst';
import { REAL_TOKEN_IMAGE } from '../components/EcosystemBanner';
import { useT }             from '../i18n';
import { useIdentityStore } from '../stores/identityStore';
import { useVpnStore }      from '../stores/vpnStore';
import { useZarStore, ZAR_DAILY_CAP } from '../stores/zarStore';
import { useAuthStore }     from '../stores/authStore';
import { getSsoToken, checkAndCacheRealId } from '../services/ssoService';
import { linkRealAccount }  from '../services/realWalletService';
import { parseDeepLink }    from '../services/deepLinkService';
import { pushEcosystemProfile } from '../services/ecosystemProfileService';
import { getCachedConfig }  from '../services/remoteConfigService';
import { initZarSync, recordZarTap } from '../services/zarSyncService';

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
  loader:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[3] },
  linkingText:{ fontSize: 14, color: Colors.text.muted, fontFamily: Typography.family.body },
  web:        { flex: 1 },
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

// ── Authenticated game view — inline, not a modal ────────────────────────────
// SSO token is fetched fresh; REAL-ID goes in URL as identity; device_id as
// security. Deliberately NOT a <Modal>: a sliding popup with its own title
// bar and X-close reads as "an external page opened on top of the app" —
// Shahnameh is meant to feel like a page of RealGram, not a browser tab
// launched inside it (Khabat, 2026-07-19). Renders in the same screen space
// the Game tab's hub occupies, with a plain back arrow like any other
// in-app navigation, not a dismiss action.
function GameWebView({
  path, deviceId, realId, onBack,
}: { path: string; deviceId: string; realId: string; onBack: () => void }) {
  const insets  = useSafeAreaInsets();
  const [url, setUrl]     = useState('');
  const [ready, setReady] = useState(false);

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
    console.log('[REALDBG:7/7] GameWebView MOUNTED (RealIdGate passed) — this is a fresh, second sso-token call for the WebView URL', { deviceId, path, realId });
    console.log('[REALDBG:6/7] NOTE: no separate /user/sync call exists in this flow — skipping (not a bug, just not implemented)');
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
      console.log('[REALDBG:7/7] WebView opening', { url: finalUrl });
      setUrl(finalUrl);
      setReady(true);
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
    });
  }, [deviceId, path, realId]);

  return (
    <View style={[wvStyles.container, { paddingTop: insets.top }]}>
      <View style={wvStyles.bar}>
        <TouchableOpacity onPress={onBack} style={wvStyles.backBtn} hitSlop={12}>
          <Text style={wvStyles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={wvStyles.barTitle}>SHAHNAMEH</Text>
        <View style={wvStyles.backBtn} />
      </View>
      {!ready ? (
        <View style={wvStyles.loader}>
          <ActivityIndicator color={Colors.gold[400]} size="large" />
        </View>
      ) : (
        <WebView
          source={{ uri: url }}
          style={wvStyles.web}
          startInLoadingState
          renderLoading={() => (
            <View style={wvStyles.loader}><ActivityIndicator color={Colors.gold[400]} size="large" /></View>
          )}
          originWhitelist={['https://*']}
          allowsBackForwardNavigationGestures
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

// ── Hub section card ──────────────────────────────────────────────────────────
function HubCard({
  icon, title, sub, accent, onPress,
}: { icon: string; title: string; sub: string; accent?: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[hubStyles.card, accent ? { borderColor: accent + '40' } : null]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={hubStyles.icon}>{icon}</Text>
      <View style={hubStyles.text}>
        <Text style={[hubStyles.title, accent ? { color: accent } : null]}>{title}</Text>
        <Text style={hubStyles.sub}>{sub}</Text>
      </View>
      <Text style={hubStyles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const hubStyles = StyleSheet.create({
  card:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
           backgroundColor: Colors.bg.surface, borderRadius: Radius.lg,
           padding: Spacing[4], borderWidth: 1, borderColor: Colors.border.subtle },
  icon:  { fontSize: 24 },
  text:  { flex: 1, gap: 2 },
  title: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },
  sub:   { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body },
  arrow: { fontSize: 18, color: Colors.text.muted },
});

// ── Main GameScreen ───────────────────────────────────────────────────────────
export function GameScreen() {
  const { t }       = useT();
  const insets      = useSafeAreaInsets();
  const deviceId    = useAuthStore((s) => s.user?.deviceId ?? '');
  const realId      = useAuthStore((s) => s.user?.realId   ?? '');
  const persona     = useIdentityStore((s) => s.persona);
  const handle      = useIdentityStore((s) => s.handle);
  const avatarEmoji = useIdentityStore((s) => s.avatarEmoji);
  const balance     = useZarStore((s) => s.balance);
  const earnedToday = useZarStore((s) => s.earnedToday);
  const isConnected = useVpnStore((s) => s.connectionState === 'connected');

  const [webPath, setWebPath]   = useState<string | null>(null);
  const [burstKey, setBurstKey] = useState(0);
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
  // start buffering/flushing taps to Shahnameh once deviceId is known.
  // initZarSync is safe to call again (resets the flush timer) so this
  // doesn't need to guard against re-running when deviceId changes shape.
  useEffect(() => {
    if (deviceId) initZarSync(deviceId);
  }, [deviceId]);

  const dailyPct    = Math.min(1, earnedToday / ZAR_DAILY_CAP);
  const cappedToday = earnedToday >= ZAR_DAILY_CAP;

  const personaLabel = persona === 'king'
    ? `👑 ${t('game.king')}`
    : persona === 'queen' ? `👸 ${t('game.queen')}` : null;

  const handleTap = useCallback(() => {
    if (!isConnected) return;
    const res = useZarStore.getState().tap();
    if (res.earned > 0) {
      setBurstKey((k) => k + 1);
      recordZarTap(); // buffers for the next server sync — see zarSyncService
    }
  }, [isConnected]);

  // While probing server-side link status, show a neutral spinner so users
  // who are already linked (e.g. navigating from the RealGram shortcut)
  // never see the gate flash.
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

  // Game content replaces the hub in the same tab — not a modal overlaid on
  // top of it. This is meant to read as "you're on a different page of
  // RealGram now", the same feel as navigating to any other tab, not
  // "an external page just opened" (Khabat, 2026-07-19).
  if (webPath !== null) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <GameWebView
          path={webPath}
          deviceId={deviceId}
          realId={realId}
          onBack={() => setWebPath(null)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 80 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero identity ── */}
        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <Text style={styles.heroAvatar}>{avatarEmoji}</Text>
            <View style={styles.heroMeta}>
              {personaLabel && <Text style={styles.personaTag}>{personaLabel}</Text>}
              {handle && <Text style={styles.handle}>@{handle}</Text>}
              <Text style={styles.heroTitle}>SHAHNAMEH</Text>
            </View>
          </View>
          <View style={styles.zarPill}>
            <Text style={styles.zarLabel}>ZAR</Text>
            <Text style={styles.zarValue}>{balance.toLocaleString()}</Text>
          </View>
        </View>

        {/* ── REAL coin: tap-to-earn ── */}
        <View style={styles.tapCard}>
          <View style={styles.tapCardLeft}>
            <Pressable onPress={handleTap} style={styles.coinBtn}>
              <Image source={{ uri: REAL_TOKEN_IMAGE }} style={styles.coin} />
              <GoldBeatBurst burstKey={burstKey} />
            </Pressable>
          </View>
          <View style={styles.tapCardRight}>
            <Text style={styles.tapTitle}>{t('game.tapToEarn')}</Text>
            <Text style={styles.tapSub}>
              {cappedToday
                ? t('game.capReached')
                : isConnected
                  ? t('game.tapHintConnected')
                  : t('game.connectFirst')}
            </Text>
            <View style={styles.tapProgress}>
              <View style={styles.tapBar}>
                <View style={[styles.tapBarFill, { flex: dailyPct }]} />
                <View style={{ flex: 1 - dailyPct }} />
              </View>
              <Text style={styles.tapProgressText}>{earnedToday}/{ZAR_DAILY_CAP}</Text>
            </View>
          </View>
        </View>

        {/* ── Hub sections ── */}
        <View style={styles.sectionGroup}>
          <HubCard
            icon="⚔️" title={t('game.dailyMissions')} sub={t('game.dailyMissionsSub')}
            accent={Colors.gold[400]} onPress={() => setWebPath('/quests')}
          />
          <HubCard
            icon="📖" title={t('game.storyProgress')} sub={t('game.storyProgressSub')}
            onPress={() => setWebPath('/story')}
          />
          <HubCard
            icon="🦸" title={t('game.heroes')} sub={t('game.heroesSub')}
            onPress={() => setWebPath('/heroes')}
          />
          <HubCard
            icon="🏆" title={t('game.rewards')} sub={t('game.rewardsSub')}
            accent={Colors.gold[400]} onPress={() => setWebPath('/rewards')}
          />
        </View>

        {/* ── Enter game button ── */}
        <TouchableOpacity
          style={styles.enterBtn}
          onPress={() => {
            // TEMP DEBUG (2026-07-19) — remove once confirmed fixed on device.
            console.log('[REALDBG] Enter Shahnameh pressed', { deviceId, realId });
            setWebPath('/');
          }}
          activeOpacity={0.85}
        >
          <Image source={{ uri: REAL_TOKEN_IMAGE }} style={styles.enterBtnIcon} />
          <Text style={styles.enterBtnText}>{t('game.enterShahnameh')}</Text>
          <Text style={styles.enterBtnArrow}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const GOLD = Colors.gold[400];

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { justifyContent: 'center', alignItems: 'center' },
  scroll:   { flex: 1 },
  content:  { paddingHorizontal: Spacing[5], paddingTop: Spacing[4], gap: Spacing[4] },

  hero:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLeft:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  heroAvatar: { fontSize: 38 },
  heroMeta:   { gap: 2 },
  heroTitle:  { fontSize: 18, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: 1 },
  personaTag: { fontSize: 12, color: GOLD, fontFamily: Typography.family.heading },
  handle:     { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body },
  zarPill:    { alignItems: 'center', backgroundColor: 'rgba(212,175,55,0.1)',
                borderRadius: Radius.lg, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2],
                borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  zarLabel:   { fontSize: 10, color: Colors.gold[600], fontFamily: Typography.family.heading, letterSpacing: 1.5 },
  zarValue:   { fontSize: 22, color: GOLD, fontFamily: Typography.family.heading },

  tapCard:     { flexDirection: 'row', backgroundColor: Colors.bg.surface, borderRadius: Radius.xl,
                 borderWidth: 1, borderColor: 'rgba(212,175,55,0.15)', overflow: 'hidden' },
  tapCardLeft: { width: 90, alignItems: 'center', justifyContent: 'center',
                 padding: Spacing[3], borderRightWidth: 1, borderRightColor: Colors.border.subtle },
  coinBtn:     { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  coin:        { width: 60, height: 60, borderRadius: 30 },
  tapCardRight:{ flex: 1, padding: Spacing[4], gap: Spacing[2], justifyContent: 'center' },
  tapTitle:    { fontSize: 13, fontFamily: Typography.family.heading, color: GOLD, letterSpacing: 0.5 },
  tapSub:      { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body },
  tapProgress: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: 2 },
  tapBar:      { flex: 1, height: 4, borderRadius: 2, flexDirection: 'row',
                 backgroundColor: 'rgba(212,175,55,0.12)', overflow: 'hidden' },
  tapBarFill:  { backgroundColor: GOLD, borderRadius: 2 },
  tapProgressText: { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.mono },

  sectionGroup: { gap: Spacing[3] },

  enterBtn:     { flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
                  backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: Radius.xl,
                  padding: Spacing[4], borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  enterBtnIcon: { width: 36, height: 36, borderRadius: 18 },
  enterBtnText: { flex: 1, fontSize: 15, fontFamily: Typography.family.heading, color: GOLD },
  enterBtnArrow:{ fontSize: 22, color: Colors.gold[600] },
});
