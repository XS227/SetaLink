/**
 * GameScreen — Shahnameh hub.
 *
 * REAL-ID identity gate:
 *   - REAL-ID set → hub shown; tapping any section opens SSO/JWT-authenticated WebView
 *   - REAL-ID absent → gate with two equal paths:
 *       1. Telegram bot (@shahnameh_bot) — for bot-preference users
 *       2. RealGram WebView — in-app web auth via shahnameh.setaei.com/api/link-gate
 *          (same Telegram auth under the hood → same canonical account → no duplicates)
 *
 * On mount: silently probes the SSO endpoint; if already linked server-side
 * (e.g. linked in a previous session via deep-link) the REAL-ID is cached and
 * the gate disappears without user action.
 *
 * DeviceId = secure lookup key only (anti-abuse, rate-limiting). REAL-ID is the
 * account identity embedded in the JWT and passed as real_id= to the game URL.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Pressable,
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

const BASE_GAME_URL  = 'https://shahnameh.setaei.com';
const PANEL_API      = 'https://setalink.no/api.php';
const BOT_LINK_BASE  = 'https://t.me/shahnameh_bot?start=linkvpn_';

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
// "You're already in the game before you've pressed Play" (§5.10 principle,
// 2026-07-18) — RealGram and Shahnameh are one account, so Play must
// never ask the user to CHOOSE how to link. Both old paths (RealGram WebView /
// Telegram bot) funnel through the same Telegram auth server-side and yield the
// same canonical account string — presenting them as two competing buttons was
// itself "the question", not a real choice. Now: the WebView opens automatically
// on mount. The Telegram-bot link only reappears as a small fallback if that
// WebView is closed or fails without completing — never as a first-class option.
function RealIdGate({ deviceId }: { deviceId: string }) {
  const { t }  = useT();
  const insets = useSafeAreaInsets();
  const [checking, setChecking]     = useState(false);
  const [showRealGram, setShowRealGram] = useState(true); // auto-open
  const [linkFailed, setLinkFailed] = useState(false);
  const [error, setError] = useState('');

  const openTelegramBot = useCallback(() => {
    Linking.openURL(`${BOT_LINK_BASE}${deviceId}`);
  }, [deviceId]);

  const handleLinked = useCallback(() => {
    setShowRealGram(false);
    // authStore.realId was already set by the handler — gate will un-render
  }, []);

  // WebView closed or failed to load without completing linking — fall back
  // to a minimal retry screen instead of leaving the user stuck.
  const handleWebViewClosed = useCallback(() => {
    setShowRealGram(false);
    setLinkFailed(true);
  }, []);

  // "Check again" — user may have completed the Telegram bot fallback and returned.
  const checkLinked = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      const r = await getSsoToken(deviceId);
      if (r.status === 'ok' && r.account) {
        useAuthStore.getState().setRealId(r.account);
      } else if (r.status === 'unlinked') {
        setError(t('realId.notLinkedYet'));
      }
    } catch {
      setError(t('realId.checkFailed'));
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
      <Text style={gateStyles.body}>
        {linkFailed ? t('realId.linkClosedBody') : t('realId.gateBody')}
      </Text>

      <TouchableOpacity
        style={gateStyles.primaryBtn}
        onPress={() => { setLinkFailed(false); setShowRealGram(true); }}
        activeOpacity={0.85}
      >
        <Text style={gateStyles.primaryBtnText}>{t('realId.tryAgain')}</Text>
      </TouchableOpacity>

      {/* Fallback only — not a competing first-class choice. */}
      <TouchableOpacity onPress={openTelegramBot} activeOpacity={0.7}>
        <Text style={gateStyles.fallbackLink}>{t('realId.linkTelegram')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={gateStyles.checkBtn}
        onPress={checkLinked}
        disabled={checking}
        activeOpacity={0.7}
      >
        {checking
          ? <ActivityIndicator size="small" color={Colors.text.muted} />
          : <Text style={gateStyles.checkBtnText}>{t('realId.checkLinked')}</Text>}
      </TouchableOpacity>

      {!!error && <Text style={gateStyles.errorText}>{error}</Text>}
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
                     textDecorationLine: 'underline', marginTop: Spacing[1] },
  checkBtn:        { paddingVertical: Spacing[2], minHeight: 36 },
  checkBtnText:    { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body,
                     textDecorationLine: 'underline' },
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
    getSsoToken(deviceId).then((r) => {
      if (r.status === 'ok' && r.account && !useAuthStore.getState().user?.realId) {
        useAuthStore.getState().setRealId(r.account);
      }
      const base   = `${BASE_GAME_URL}${path}`;
      const params = new URLSearchParams({ src: 'realink', device_id: deviceId });
      if (realId) params.set('real_id', realId);
      if (r.status === 'ok' && r.token) params.set('sso', r.token);
      setUrl(`${base}?${params}`);
      setReady(true);
    }).catch(() => {
      const params = new URLSearchParams({ src: 'realink', device_id: deviceId });
      if (realId) params.set('real_id', realId);
      setUrl(`${BASE_GAME_URL}${path}?${params}`);
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
  // True while we're checking whether the user has a linked account server-side.
  // Prevents the gate from flashing for users navigating from RealGram who are
  // already linked (linked_real_account set in entitlement).
  const [checking, setChecking] = useState(!realId && !!deviceId);

  // On first render: silently probe SSO in case the user already linked via
  // a deep-link or RealGram in a previous session but realId wasn't cached yet.
  useEffect(() => {
    if (!realId && deviceId) {
      checkAndCacheRealId(deviceId).finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dailyPct    = Math.min(1, earnedToday / ZAR_DAILY_CAP);
  const cappedToday = earnedToday >= ZAR_DAILY_CAP;

  const personaLabel = persona === 'king'
    ? `👑 ${t('game.king')}`
    : persona === 'queen' ? `👸 ${t('game.queen')}` : null;

  const handleTap = useCallback(() => {
    if (!isConnected) return;
    const res = useZarStore.getState().tap();
    if (res.earned > 0) setBurstKey((k) => k + 1);
  }, [isConnected]);

  // While probing server-side link status, show a neutral spinner so users
  // who are already linked (e.g. navigating from the RealGram shortcut)
  // never see the gate flash.
  if (checking) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.gold[400]} />
      </View>
    );
  }

  // Gate: show REAL-ID creation prompt if not linked
  if (!realId) {
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
          onPress={() => setWebPath('/')}
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
