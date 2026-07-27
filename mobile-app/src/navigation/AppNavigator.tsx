/**
 * AppNavigator — React Navigation v7
 *
 * Stack:
 *   Splash → (boot sequence) → Auth | Main
 *   Main   → BottomTabs (Home | Servers | AI | Activity | Profile | Game)
 *            Footer shows Home | Servers | AI | Game — Profile stays a tab
 *            (reachable via TopBar) but isn't in the visible footer (B-22).
 *   Settings, Diagnostics → slide_from_right stack screens
 *
 * Boot sequence:
 *   SplashAdapter runs runBootSequence(), which checks auth state and
 *   autoConnect setting, then routes accordingly.
 *
 * Adapter pattern: screens expose { onNavigate, activeTab } — adapters
 * translate React Navigation props to that interface with no screen changes.
 */

import React, { useEffect, useState } from 'react';
import { AppState, View, Text, TouchableOpacity, StyleSheet, Modal, Linking, Alert, Platform, Share } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';

import { SplashScreen }      from '../screens/SplashScreen';
import { LanguageScreen }    from '../screens/LanguageScreen';
import { OnboardingScreen }  from '../screens/OnboardingScreen';
import { AuthScreen }        from '../screens/AuthScreen';
import { WelcomeScreen }     from '../screens/WelcomeScreen';
import { HomeScreen }        from '../screens/HomeScreen';
import { ServersScreen }     from '../screens/ServersScreen';
import { SmartAIScreen }     from '../screens/SmartAIScreen';
import { ActivityScreen }    from '../screens/ActivityScreen';
import { RealGramProfileScreen } from '../screens/RealGramProfileScreen';
import { RealGramClanScreen }    from '../screens/RealGramClanScreen';
import { StarlinkScreen }        from '../screens/StarlinkScreen';
import { GameScreen }        from '../screens/GameScreen';
import { TrustAiLinkScreen } from '../screens/TrustAiLinkScreen';
import { SettingsScreen }    from '../screens/SettingsScreen';
import { BypassAppsScreen }  from '../screens/BypassAppsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { BottomNav, NavTab }        from '../components/BottomNav';
import { Toast }                    from '../components/Toast';
import { BiometricLockScreen }      from '../components/BiometricLockScreen';
import { PremiumScreen }            from '../screens/PremiumScreen';
import { InboxScreen }             from '../screens/InboxScreen';
import { TransferScreen }          from '../screens/TransferScreen';
import { WalletScreen }            from '../screens/WalletScreen';

import { runBootSequence }       from '../services/bootService';
import { claimPendingReferral }  from '../services/deepLinkService';
import { checkForUpdate, isUpdateSnoozed, snoozeUpdate, downloadUpdate, openUpdateInBrowser } from '../services/updateService';
import type { UpdateCheckResult } from '../services/updateService';
import { getStableDeviceId, getDeviceFingerprint, saveStableDeviceId } from '../services/deviceIdentityService';
import { registerDevice } from '../services/entitlementService';
import { useInboxStore }  from '../stores/inboxStore';
import { useDMStore }     from '../stores/dmStore';
import { BiometricService }      from '../services/biometricService';
import { getAdapter }            from '../services/vpnBridge';
import { useAuthStore }          from '../stores/authStore';
import { useSettingsStore }      from '../stores/settingsStore';
import { useVpnStore }           from '../stores/vpnStore';
import { useServerStore }        from '../stores/serverStore';
import { useAppBoot }            from '../hooks/useAppBoot';
import { useDeepLinks }          from '../hooks/useDeepLinks';
import { ensureNotificationPermission, consumeInitialRoute, parseInboxRoute } from '../services/dmNotifications';
import { useT }                   from '../i18n';

import type { RootStackParamList, MainTabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<MainTabParamList>();

const SCREEN_TO_TAB: Record<string, NavTab> = {
  Home:     'home',
  Servers:  'servers',
  AI:       'ai',
  Activity: 'activity',
  Profile:  'profile',
  Game:     'game',
  Chats:    'chats',
  Wallet:   'wallet',
  Clan:     'clan',
};

const TAB_TO_SCREEN: Record<NavTab, keyof MainTabParamList> = {
  home:     'Home',
  servers:  'Servers',
  ai:       'AI',
  activity: 'Activity',
  profile:  'Profile',
  game:     'Game',
  chats:    'Chats',
  wallet:   'Wallet',
  clan:     'Clan',
};

type ScreenAdapterProps = { navigation: any; route: any };

function makeOnNavigate(navigation: any): (tab: NavTab) => void {
  return (tab) => {
    if ((tab as string) === 'settings')       { navigation.navigate('Settings');       return; }
    if ((tab as string) === 'diagnostics')    { navigation.navigate('Diagnostics');    return; }
    if ((tab as string) === 'upgrade')        { navigation.navigate('Upgrade');        return; }
    if ((tab as string) === 'inbox')           { navigation.navigate('Inbox');          return; }
    if ((tab as string) === 'support')         { navigation.navigate('Inbox', { threadKey: '__support__' }); return; }
    if ((tab as string) === 'transfer')        { navigation.navigate('Transfer');       return; }
    if ((tab as string) === 'trustai-link')    { navigation.navigate('TrustAiLink');    return; }
    navigation.navigate(TAB_TO_SCREEN[tab] ?? 'Home');
  };
}

// ── Main tab shell with AppState lifecycle ────────────────────────────────────

function MainTabs() {
  useAppBoot(); // registers AppState listener for kill-switch / reconnect logic

  const { t } = useT();
  const token               = useAuthStore((s) => s.token);
  const fetchServers        = useServerStore((s) => s.fetchServers);
  const loadBootstrapIfEmpty = useServerStore((s) => s.loadBootstrapIfEmpty);
  const biometricLock       = useSettingsStore((s) => s.biometricLock);
  const setBiometricLock    = useSettingsStore((s) => s.setBiometricLock);
  const connectionState     = useVpnStore((s) => s.connectionState);
  const setSessionBytes     = useVpnStore((s) => s.setSessionBytes);
  const updateChannel       = useSettingsStore((s) => s.updateChannel);
  // Country comes from the backend entitlement (geo-detected server-side);
  // used for staged per-country rollouts (e.g. Iran-first releases).
  const userCountry         = useAuthStore((s) => s.user?.country) || undefined;
  const [isLocked, setIsLocked] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const appStateRef = React.useRef(AppState.currentState);

  // Opens the SAME ABI-resolved apkUrl externally (never hardcoded
  // setalink-latest). Surfaces failure — no silent path.
  const handleOpenInBrowser = React.useCallback(() => {
    const r = updateResult;
    if (!r) return;
    openUpdateInBrowser(r.apkUrl).catch((err: { message?: string }) => {
      Alert.alert(t('upd.downloadFailedTitle'), err?.message || t('upd.downloadFailedBody'));
    });
  }, [updateResult, t]);

  // Kicks off the OTA download and, crucially, surfaces failures to the user.
  // The old `.catch(() => {})` swallowed every error (missing install
  // permission, failed download, blocked DownloadManager) — which is why
  // "Download did nothing" with no visible feedback. On failure we offer
  // Retry and the browser fallback so the user is never stuck.
  const handleDownloadUpdate = React.useCallback(() => {
    const r = updateResult;
    if (!r) return;
    downloadUpdate(r.apkUrl, r.latestVersion).catch((err: { code?: string; message?: string }) => {
      const isPerm = err?.code === 'INSTALL_PERMISSION_REQUIRED';
      Alert.alert(
        isPerm ? t('upd.installPermTitle') : t('upd.downloadFailedTitle'),
        isPerm ? t('upd.installPermBody')  : (err?.message || t('upd.downloadFailedBody')),
        [
          { text: t('upd.retry'),         onPress: handleDownloadUpdate },
          { text: t('upd.openInBrowser'), onPress: handleOpenInBrowser },
          { text: t('upd.later'),         style: 'cancel' },
        ],
      );
    });
  }, [updateResult, t, handleOpenInBrowser]);

  useEffect(() => {
    if (token) { fetchServers(token).catch(() => {}); }
  }, [token, fetchServers]);

  // On first launch (no servers imported), try to fetch the remote bootstrap profile.
  // This gives fresh installs a working "install → open → connect" experience.
  useEffect(() => {
    loadBootstrapIfEmpty().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: if biometric lock is enabled, verify the device actually supports it.
  // If unavailable, silently disable the setting so the user is never locked out.
  useEffect(() => {
    if (!biometricLock) return;
    BiometricService.isAvailable().then((available) => {
      if (!available) setBiometricLock(false);
    }).catch(() => setBiometricLock(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current === 'active' && nextState.match(/inactive|background/)) {
        // Only lock if biometric lock is still enabled (it may have been auto-disabled above)
        if (useSettingsStore.getState().biometricLock) setIsLocked(true);
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  // Update check — Android only. iOS ships through TestFlight/App Store; APK
  // versionCode and build numbers are incomparable across the two platforms.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const tid = setTimeout(async () => {
      try {
        const result = await checkForUpdate(userCountry, updateChannel);
        if (result && result.hasUpdate && result.isInRollout) {
          if (!result.forceUpdate && isUpdateSnoozed()) return;
          setUpdateResult(result);
        }
      } catch {}
    }, 4_000);
    return () => clearTimeout(tid);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Inbox poll — on shell mount and every time the app returns to foreground,
  // so admin messages reach users who never connect the VPN.
  useEffect(() => {
    const fetchInbox = () => {
      const deviceId = useAuthStore.getState().user?.deviceId;
      if (deviceId) {
        useInboxStore.getState().refresh(deviceId).catch(() => {});
        useDMStore.getState().refresh(deviceId).catch(() => {});
      }
    };
    fetchInbox();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') fetchInbox();
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Global traffic poller — runs at the shell level regardless of which tab is active.
  // Ensures sessionBytes stays up to date for Activity, Profile, and Home displays.
  useEffect(() => {
    if (connectionState !== 'connected') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await getAdapter().getStats();
        if (!cancelled) setSessionBytes({ sent: s.uploadBytes, received: s.downloadBytes });
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  const showBanner = updateResult && !updateResult.forceUpdate && !updateBannerDismissed;

  return (
    <>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => {
          const routeName = props.state.routes[props.state.index].name as string;
          const activeTab = SCREEN_TO_TAB[routeName] ?? 'home';
          // NEVER hide this — Khabat, 2026-07-22: hiding it while a season2
          // overlay was open (previously gated on `overlayOpen`) trapped him
          // inside Shahnameh with literally no way back to Profile/Clan/
          // Freedom/Wallet, forcing a force-close. RealGram navigation must
          // stay reachable at all times; season2's own bottom-nav-height CSS
          // var (see ShahnamehEmbed.tsx) already reserves space so this bar
          // doesn't cover the page's content, which was the original reason
          // for hiding it.
          return (
            <BottomNav
              active={activeTab}
              onPress={(tab) => props.navigation.navigate(TAB_TO_SCREEN[tab])}
            />
          );
        }}
      >
        <Tab.Screen name="Home"     component={HomeAdapter} />
        <Tab.Screen name="Servers"  component={ServersAdapter} />
        <Tab.Screen name="AI"       component={AIAdapter} />
        <Tab.Screen name="Activity" component={ActivityAdapter} />
        <Tab.Screen name="Profile"  component={ProfileAdapter} />
        {/* B-22: Game replaces Profile's slot in the visible footer (see
            BottomNav.TAB_KEYS). Profile stays registered here so it's still
            reachable via TopBar's profile icon, just no longer in the footer. */}
        <Tab.Screen name="Game"     component={GameAdapter} />
        {/* §5.10.1 — approved 2026-07-18 footer: Home · Chats · Freedom(Servers)
            · Wallet · Clan · Profile. AI/Activity/Game stay registered (reachable
            via TopBar/Home shortcuts) but no longer have a footer slot — see
            BottomNav.tsx TABS. */}
        <Tab.Screen name="Chats"    component={ChatsAdapter} />
        <Tab.Screen name="Wallet"   component={WalletAdapter} />
        <Tab.Screen name="Clan"     component={ClanAdapter} />
      </Tab.Navigator>

      {/* Optional update banner — dismissible */}
      {showBanner && (
        <View style={updStyles.banner}>
          <Text style={updStyles.bannerTitle}>{t('upd.updateAvailable').replace('{v}', updateResult!.latestVersion)}</Text>
          <Text style={updStyles.bannerSub} numberOfLines={1}>{updateResult!.changelog?.[0] ?? ''}</Text>
          <View style={updStyles.bannerBtns}>
            <TouchableOpacity
              style={updStyles.bannerBtn}
              onPress={handleDownloadUpdate}
            >
              <Text style={updStyles.bannerBtnText}>{t('upd.download')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={updStyles.bannerDismiss}
              onPress={handleOpenInBrowser}
            >
              <Text style={updStyles.bannerDismissText}>{t('upd.openInBrowser')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={updStyles.bannerDismiss}
              onPress={() => { snoozeUpdate(); setUpdateBannerDismissed(true); }}
            >
              <Text style={updStyles.bannerDismissText}>{t('upd.later')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Force update modal — blocks app until user downloads */}
      <Modal
        visible={!!(updateResult?.forceUpdate)}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={updStyles.forceOverlay}>
          <View style={updStyles.forceCard}>
            <Text style={updStyles.forceTitle}>{t('upd.forceTitle')}</Text>
            <Text style={updStyles.forceBody}>
              {t('upd.requiredBody').replace('{v}', updateResult?.latestVersion ?? '')}
            </Text>
            {(updateResult?.changelog ?? []).slice(0, 3).map((line, i) => (
              <Text key={i} style={updStyles.forceChange}>• {line}</Text>
            ))}
            <TouchableOpacity
              style={updStyles.forceBtn}
              activeOpacity={0.85}
              onPress={handleDownloadUpdate}
            >
              <Text style={updStyles.forceBtnText}>{t('upd.downloadUpdate')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={updStyles.forceSecondaryBtn}
              activeOpacity={0.85}
              onPress={handleOpenInBrowser}
            >
              <Text style={updStyles.forceSecondaryBtnText}>{t('upd.openInBrowser')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <BiometricLockScreen visible={isLocked} onUnlock={() => setIsLocked(false)} />
    </>
  );
}

const updStyles = StyleSheet.create({
  banner:         { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#0D1828', borderBottomWidth: 1, borderBottomColor: 'rgba(0,232,122,0.25)', paddingHorizontal: 16, paddingTop: 44, paddingBottom: 10, zIndex: 100 },
  bannerTitle:    { fontSize: 13, fontWeight: '700', color: '#00E87A', marginBottom: 2 },
  bannerSub:      { fontSize: 11, color: '#8A9BBF', marginBottom: 8 },
  bannerBtns:     { flexDirection: 'row', gap: 8 },
  bannerBtn:      { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: '#00E87A' },
  bannerBtnText:  { fontSize: 12, fontWeight: '700', color: '#030609' },
  bannerDismiss:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  bannerDismissText: { fontSize: 12, color: '#8A9BBF' },
  forceOverlay:   { flex: 1, backgroundColor: 'rgba(3,6,9,0.95)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  forceCard:      { backgroundColor: '#0D1828', borderRadius: 16, padding: 24, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: 'rgba(255,80,80,0.3)', gap: 12 },
  forceTitle:     { fontSize: 20, fontWeight: '700', color: '#FF5050', textAlign: 'center' },
  forceBody:      { fontSize: 14, color: '#C8D8F0', textAlign: 'center', lineHeight: 22 },
  forceChange:    { fontSize: 12, color: '#8A9BBF', lineHeight: 20 },
  forceBtn:       { marginTop: 8, backgroundColor: '#00E87A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  forceBtnText:   { fontSize: 15, fontWeight: '700', color: '#030609' },
  forceSecondaryBtn:     { marginTop: 4, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  forceSecondaryBtnText: { fontSize: 14, fontWeight: '600', color: '#C8D8F0' },
});

// ── Tab adapters ──────────────────────────────────────────────────────────────

function HomeAdapter({ navigation, route }: ScreenAdapterProps) {
  return <HomeScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'home'} onNavigate={makeOnNavigate(navigation)} />;
}

function ServersAdapter({ navigation, route }: ScreenAdapterProps) {
  const { t } = useT();
  return (
    <ServersScreen
      activeTab={SCREEN_TO_TAB[route.name] ?? 'servers'}
      onNavigate={makeOnNavigate(navigation)}
      onInvite={() => {
        const code = (useAuthStore.getState().user?.referralCode || '').toUpperCase();
        Share.share({ message: t('pr.shareMessage').replace(/\{code\}/g, code) }).catch(() => {});
      }}
    />
  );
}

function AIAdapter({ navigation, route }: ScreenAdapterProps) {
  return <SmartAIScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'ai'} onNavigate={makeOnNavigate(navigation)} />;
}

function ActivityAdapter({ navigation, route }: ScreenAdapterProps) {
  return <ActivityScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'activity'} onNavigate={makeOnNavigate(navigation)} />;
}

function GameAdapter() {
  // Tab screen now (B-22) — no back button, the footer is how you leave it.
  return <GameScreen />;
}

function ChatsAdapter({ navigation }: ScreenAdapterProps) {
  // §5.10.1: Chats is now a top-level tab (was buried in a Profile card).
  // InboxScreen's own header always renders a back button (it doubles as a
  // Stack-pushed screen for the support/notification deep-link cases) — as a
  // tab there's nothing to "go back" to, so it returns to Home.
  return <InboxScreen onBack={() => navigation.navigate('Home')} />;
}

function WalletAdapter({ navigation, route }: ScreenAdapterProps) {
  return <WalletScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'wallet'} onNavigate={makeOnNavigate(navigation)} />;
}

function ClanAdapter({ navigation }: ScreenAdapterProps) {
  // Native RealGram Community/Clan screen (Khabat, 2026-07-22: "designed
  // around RealGram community features — members, referrals, shared
  // rewards, Starlink progress, data contributions, rankings — rather than
  // a direct Shahnameh migration"). Was ShahnamehEmbed(guild.html) until
  // v0.9.86; that swap alone was still a 1:1 guild-data reskin, so this
  // pass reframes it around RealGram's own community mechanics (referral
  // network, Starlink) instead, with the Shahnameh guild (if the user has
  // one) folded in as one secondary card, not the whole screen.
  const { t } = useT();
  return (
    <RealGramClanScreen
      onOpenStarlink={() => navigation.navigate('Starlink')}
      onInvite={() => {
        const code = (useAuthStore.getState().user?.referralCode || '').toUpperCase();
        Share.share({ message: t('pr.shareMessage').replace(/\{code\}/g, code) }).catch(() => {});
      }}
    />
  );
}

function ProfileAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <RealGramProfileScreen
      onSignOut={() => {
        useAuthStore.getState().logout();
        navigation.replace('Auth');
      }}
      onSettings={() => navigation.navigate('Settings')}
    />
  );
}

// ── Stack adapters ────────────────────────────────────────────────────────────

// Converts a silent boot failure (the old white screen) into a visible,
// screenshot-able alert and runs a safe recovery so the app never dead-ends.
// Diagnostic aid for the v0.9.3x first-run flow.
function reportBootFailure(where: string, err: unknown, recover?: () => void) {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : (err ? String(err) : '');
  // eslint-disable-next-line no-console
  console.error('[Boot]', where, detail);
  Alert.alert(
    'Startup diagnostic',
    `${where}\n\n${detail.slice(0, 600) || '(no error message — likely a hung network/native call)'}`,
    [{ text: 'Continue', onPress: () => recover?.() }],
    { cancelable: false },
  );
}

async function tryAutoRegister(): Promise<boolean> {
  try {
    const deviceId    = await getStableDeviceId();
    const fingerprint = await getDeviceFingerprint().catch(() => ({}));
    const { language } = useSettingsStore.getState();
    const entitlement = await registerDevice(deviceId, Platform.OS, { language, fingerprint });

    // If backend returned a canonical device_id (fingerprint dedup), persist it
    if (entitlement.device_id && entitlement.device_id !== deviceId) {
      await saveStableDeviceId(entitlement.device_id).catch(() => {});
    }

    useAuthStore.getState().loginWithDevice(entitlement);
    // Auto-claim a referral that arrived via install link / deep link before
    // the device existed on the backend (item: referral must claim on first start).
    claimPendingReferral().catch(() => {});
    // Bootstrap profile loading is handled by loadBootstrapIfEmpty in MainTabs.
    // Do not import a raw VLESS here — it creates stale single-profile entries that
    // don't carry altProfiles and accumulate across server migrations.
    return true;
  } catch {
    return false;
  }
}

function SplashAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <SplashScreen
      onFinish={async () => {
        // The splash has already faded to opacity 0 by the time this runs, so any
        // unhandled throw OR a hung await here leaves a silent white screen that the
        // root ErrorBoundary can't catch (async). Track the step, run a watchdog,
        // and surface failures on-screen so boot can never dead-end invisibly.
        let step = 'runBootSequence';
        const watchdog = setTimeout(() => {
          reportBootFailure(`Splash stalled at: ${step}`, null, () => navigation.replace('Auth'));
        }, 12_000);
        try {
          const result = await runBootSequence();
          step = 'readSettings';
          const { hasOnboarded, hasSelectedLanguage, hasSeenWelcome } = useSettingsStore.getState();

          if (!hasSelectedLanguage) { clearTimeout(watchdog); navigation.replace('Language'); return; }

          if (!hasOnboarded) {
            // Khabat, 2026-07-19: a reinstall (or a fresh install on hardware
            // that already played RealGram/Shahnameh before) must NOT force a
            // brand-new @handle claim. register-device's fingerprint dedup
            // (android_id_hash) already reunites reinstalls with the same
            // account server-side — this just checks for an existing REAL-ID
            // BEFORE forcing Onboarding, instead of only after it finishes.
            // (register-device's response was also missing linked_real_account
            // entirely until this same change — see api.php — so this check
            // would have silently always failed before.)
            step = 'checkExistingRealId';
            const registered      = await tryAutoRegister();
            const existingRealId  = registered ? useAuthStore.getState().user?.realId : '';
            if (existingRealId) {
              useSettingsStore.getState().completeOnboarding();
              clearTimeout(watchdog);
              navigation.replace(hasSeenWelcome ? 'Main' : 'Welcome');
              return;
            }
            clearTimeout(watchdog);
            navigation.replace('Onboarding');
            return;
          }

          if (result.status === 'auth_required') {
            step = 'autoRegister';
            const registered = await tryAutoRegister();
            clearTimeout(watchdog);
            navigation.replace(registered ? 'Welcome' : 'Auth');
            return;
          }

          // Already authenticated — refresh registration in background so admin shows
          // current device/version immediately, even if the user never logged out.
          getStableDeviceId().then(async (deviceId) => {
            const fingerprint = await getDeviceFingerprint().catch(() => ({}));
            const { language } = useSettingsStore.getState();
            const entitlement = await registerDevice(deviceId, Platform.OS, { language, fingerprint });
            if (entitlement.device_id && entitlement.device_id !== deviceId) {
              await saveStableDeviceId(entitlement.device_id).catch(() => {});
            }
            useAuthStore.getState().updateFromEntitlement(entitlement);
            useInboxStore.getState().refresh(entitlement.device_id || deviceId).catch(() => {});
            useDMStore.getState().refresh(entitlement.device_id || deviceId).catch(() => {});
            claimPendingReferral().catch(() => {});
          }).catch(() => {});

          clearTimeout(watchdog);
          if (!hasSeenWelcome) { navigation.replace('Welcome'); return; }

          navigation.replace('Main');
          if (result.shouldAutoConnect) {
            setTimeout(() => useVpnStore.getState().connect(), 600);
          }
        } catch (err) {
          clearTimeout(watchdog);
          reportBootFailure(`Splash threw at: ${step}`, err, () => navigation.replace('Auth'));
        }
      }}
    />
  );
}

function WelcomeAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <WelcomeScreen
      onStart={() => {
        useSettingsStore.getState().markWelcomeSeen();
        navigation.replace('Main');
      }}
    />
  );
}

function LanguageAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <LanguageScreen
      onSelect={() => {
        const { hasOnboarded } = useSettingsStore.getState();
        navigation.replace(hasOnboarded ? 'Main' : 'Onboarding');
      }}
    />
  );
}

function OnboardingAdapter({ navigation }: ScreenAdapterProps) {
  const { completeOnboarding } = useSettingsStore();
  return (
    <OnboardingScreen
      onFinish={async () => {
        // Same hazard as SplashAdapter: an unhandled throw/hang here would strand
        // the user on the last slide. Watchdog + try/catch make it visible + safe.
        let step = 'completeOnboarding';
        const watchdog = setTimeout(() => {
          reportBootFailure(`Onboarding stalled at: ${step}`, null, () => navigation.replace('Auth'));
        }, 12_000);
        try {
          completeOnboarding();
          if (useAuthStore.getState().isAuthenticated) {
            clearTimeout(watchdog);
            navigation.replace('Main');
          } else {
            step = 'autoRegister';
            const registered = await tryAutoRegister();
            clearTimeout(watchdog);
            navigation.replace(registered ? 'Welcome' : 'Auth');
          }
        } catch (err) {
          clearTimeout(watchdog);
          reportBootFailure(`Onboarding threw at: ${step}`, err, () => navigation.replace('Auth'));
        }
      }}
    />
  );
}

function AuthAdapter({ navigation }: ScreenAdapterProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) navigation.replace('Main');
  }, [isAuthenticated]);

  if (isAuthenticated) return null;
  return <AuthScreen onAuth={() => navigation.replace('Main')} />;
}

// ── Deep link handler — must be inside NavigationContainer ───────────────────

function DeepLinkHandler() {
  const navigation = useNavigation();
  useDeepLinks(navigation);
  return null;
}

// Opens the Inbox when the app is launched/resumed via a message notification
// tap (Issue 2), and requests POST_NOTIFICATIONS once on Android 13+.
function NotificationRouteHandler() {
  const navigation = useNavigation<any>();
  useEffect(() => {
    let mounted = true;
    ensureNotificationPermission().catch(() => {});
    const route = async () => {
      const parsed = parseInboxRoute(await consumeInitialRoute());
      if (mounted && parsed.open) {
        try { navigation.navigate('Inbox', { threadKey: parsed.threadKey }); } catch {}
      }
    };
    route();
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') route(); });
    return () => { mounted = false; sub.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ── Root navigator ────────────────────────────────────────────────────────────

export function AppNavigator() {
  // Read here, in AppNavigator's own render — not inside the Starlink
  // Stack.Screen's children function below, which is a plain closure, not
  // guaranteed the same hook-safe treatment as a real component (see
  // MainTabs' tabBar fix, v0.9.82: a hook called inside a similar
  // render-prop closure crashed every cold start).
  const { t } = useT();
  return (
    <NavigationContainer>
      <DeepLinkHandler />
      <NotificationRouteHandler />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="Splash"      component={SplashAdapter} />
        <Stack.Screen name="Language"    component={LanguageAdapter} />
        <Stack.Screen name="Onboarding"  component={OnboardingAdapter} />
        <Stack.Screen name="Auth"        component={AuthAdapter} />
        <Stack.Screen name="Welcome"     component={WelcomeAdapter} />
        <Stack.Screen name="Main"        component={MainTabs} />
        <Stack.Screen
          name="Settings"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <SettingsScreen
              onBack={() => navigation.goBack()}
              onSmartConnect={() => navigation.navigate('Main', { screen: 'AI' })}
              onActivity={() => navigation.navigate('Main', { screen: 'Activity' })}
              onDiagnostics={() => navigation.navigate('Diagnostics')}
              onBypassApps={() => navigation.navigate('BypassApps')}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="BypassApps"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <BypassAppsScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="TrustAiLink"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <TrustAiLinkScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Diagnostics"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <DiagnosticsScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Starlink"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <StarlinkScreen
              onBack={() => navigation.goBack()}
              onInvite={() => {
                const code = (useAuthStore.getState().user?.referralCode || '').toUpperCase();
                Share.share({ message: t('pr.shareMessage').replace(/\{code\}/g, code) }).catch(() => {});
              }}
              onConnect={() => navigation.navigate('Main', { screen: 'Servers' } as never)}
              onUpgrade={() => navigation.navigate('Upgrade')}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Upgrade"
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        >
          {({ navigation }) => (
            <PremiumScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        {/* ProfileImport route removed (build 78): config import/export disabled
            so credentials can't be exported to other clients. */}
        <Stack.Screen
          name="Inbox"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation, route }) => (
            <InboxScreen
              onBack={() => navigation.goBack()}
              initialThreadKey={(route.params as any)?.threadKey ?? null}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Transfer"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <TransferScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
      </Stack.Navigator>
      <Toast />
    </NavigationContainer>
  );
}
