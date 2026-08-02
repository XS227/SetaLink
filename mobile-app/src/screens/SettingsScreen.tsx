import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking, Platform, Modal,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EcosystemFooter } from '../components/EcosystemFooter';
import { RealGramLinkWebView } from '../components/ShahnamehEmbed';
import { useSettingsStore } from '../stores/settingsStore';
import { useServerStore }   from '../stores/serverStore';
import { useAuthStore }     from '../stores/authStore';
import { BiometricService } from '../services/biometricService';
import { listBlockedUsers, unblockUser } from '../services/entitlementService';
import { getSsoToken } from '../services/ssoService';
import { useT, SUPPORTED_LANGUAGES } from '../i18n';
import { APP_VERSION, APP_BUILD } from '../utils/version';
import { checkForUpdate, downloadUpdate, openUpdateInBrowser } from '../services/updateService';
import type { UpdateCheckResult } from '../services/updateService';
const GITHUB_URL      = 'https://github.com/XS227/RealGram';
const WEBSITE_URL     = 'https://realgram.no';

// Khabat, 2026-07-30: "languages er bare 4 stk så vis heller flagene" — flag
// per SUPPORTED_LANGUAGES' nativeLabel (i18n/index.ts). Keyed by nativeLabel
// rather than Lang code since that's what SelectRow's options/value actually
// are; falls back to no flag for anything unmapped instead of throwing.
const LANGUAGE_FLAGS: Record<string, string> = {
  English: '🇬🇧',
  'فارسی': '🇮🇷',
  '中文':   '🇨🇳',
  'Русский': '🇷🇺',
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label:        string;
  description?: string;
  value:        boolean;
  onChange:     () => void;
  comingSoon?:  boolean;
}

function ToggleRow({ label, description, value, onChange, comingSoon = false }: ToggleRowProps) {
  const handlePress = comingSoon
    ? () => Alert.alert('Coming soon', `${label} will be available in a future update.`)
    : onChange;

  return (
    <TouchableOpacity style={rowStyles.row} onPress={handlePress} activeOpacity={0.75}>
      <View style={rowStyles.left}>
        <View style={rowStyles.labelRow}>
          <Text style={[rowStyles.label, comingSoon && rowStyles.labelMuted]}>{label}</Text>
          {comingSoon && <Text style={rowStyles.badge}>Soon</Text>}
        </View>
        {description && <Text style={rowStyles.desc}>{description}</Text>}
      </View>
      <View style={[
        rowStyles.toggle,
        comingSoon ? rowStyles.toggleDisabled : (value ? rowStyles.toggleOn : rowStyles.toggleOff),
      ]}>
        <View style={[rowStyles.thumb, { transform: [{ translateX: comingSoon ? 0 : (value ? 16 : 0) }] }]} />
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3] + 2, gap: Spacing[4] },
  left:          { flex: 1, gap: 2 },
  labelRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  label:         { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  labelMuted:    { color: Colors.text.muted },
  desc:          { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  badge:         { fontSize: 9, fontFamily: Typography.family.label, color: Colors.text.muted, borderWidth: 1, borderColor: Colors.border.default, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, letterSpacing: 0.5, textTransform: 'uppercase' },
  toggle:        { width: 40, height: 24, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 3 },
  toggleOn:      { backgroundColor: Colors.emerald[400] },
  toggleOff:     { backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  toggleDisabled:{ backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.subtle, opacity: 0.4 },
  thumb:         { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
});

const blockedRowStyles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[2], paddingLeft: Spacing[3] },
  name:    { flex: 1, fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, marginRight: Spacing[3] },
  unblock: { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400] },
});

interface SelectRowProps {
  label:    string;
  value:    string;
  options:  string[];
  onChange: (v: string) => void;
  // Optional display-only transform, e.g. prefixing a flag emoji onto a
  // language name. Kept separate from `value`/`options` on purpose — those
  // stay the exact strings stored in settingsStore, so an already-saved
  // preference (e.g. a user who picked "English" before this existed)
  // still matches an option and shows as selected.
  renderLabel?: (opt: string) => string;
}

function SelectRow({ label, value, options, onChange, renderLabel }: SelectRowProps) {
  const [open, setOpen] = useState(false);
  const display = (v: string) => (renderLabel ? renderLabel(v) : v);
  return (
    <View>
      <TouchableOpacity style={selStyles.row} onPress={() => setOpen(!open)} activeOpacity={0.75}>
        <Text style={selStyles.label}>{label}</Text>
        <View style={selStyles.valueRow}>
          <Text style={selStyles.value}>{display(value)}</Text>
          <Text style={[selStyles.chevron, open && { transform: [{ rotate: '90deg' }] }]}>›</Text>
        </View>
      </TouchableOpacity>

      {open && (
        <View style={selStyles.dropdown}>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[selStyles.option, opt === value && selStyles.optionActive]}
              onPress={() => { onChange(opt); setOpen(false); }}
              activeOpacity={0.7}
            >
              <Text style={[selStyles.optionText, opt === value && selStyles.optionActiveText]}>{display(opt)}</Text>
              {opt === value && <Text style={selStyles.check}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const selStyles = StyleSheet.create({
  row:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3] + 2 },
  label:           { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.primary },
  valueRow:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value:           { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  chevron:         { fontSize: 18, color: Colors.text.muted },
  dropdown:        { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, marginBottom: Spacing[2], overflow: 'hidden' },
  option:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  optionActive:    { backgroundColor: 'rgba(0,232,122,0.07)' },
  optionText:      { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  optionActiveText:{ color: Colors.emerald[400] },
  check:           { fontSize: Typography.size.sm, color: Colors.emerald[400] },
});

// ── Screen ────────────────────────────────────────────────────────────────────

interface SettingsProps {
  onBack?: () => void;
  onBypassApps?: () => void;    // per-app bypass: Android = installed apps, iOS = curated domain catalog
  onSmartConnect?: () => void;   // relocated AI / smart-connection controls
  onDiagnostics?: () => void;    // connection tests & server config
  onActivity?: () => void;       // activity & usage
}

export function SettingsScreen({ onBack, onSmartConnect, onDiagnostics, onActivity, onBypassApps }: SettingsProps) {
  const { t } = useT();
  const {
    protocol, dnsMode, language,
    autoConnect, biometricLock,
    smartMode, toggleSmartMode,
    updateChannel, setUpdateChannel,
    setProtocol, setDnsMode, setLanguage,
    toggleAutoConnect, toggleBiometricLock, setBiometricLock,
  } = useSettingsStore();
  const { clearImportedServers, loadBootstrapIfEmpty } = useServerStore();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'uptodate' | 'available' | 'downloading'>('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  // Block list (2026-07-24) — loaded once on mount; unblocking updates this
  // local copy directly rather than re-fetching, same "optimistic, server is
  // still the source of truth on next real load" pattern the rest of this
  // screen doesn't need but a list like this benefits from.
  const [blocked, setBlocked] = useState<Array<{ deviceId: string; userId: string; blockedAt: string }>>([]);
  const [blockedExpanded, setBlockedExpanded] = useState(false);
  useEffect(() => {
    if (!deviceId) return;
    listBlockedUsers(deviceId).then(setBlocked).catch(() => {});
  }, [deviceId]);

  // Account recovery (Khabat, 2026-07-29, after the device-recognition/
  // ANDROID_ID-instability finding): "premium sikkerhet: koble kontoen
  // til Telegram for enkel gjenoppretting." Auto Backup (native manifest
  // change, same session) covers a plain reinstall automatically — this
  // covers the cases it can't (a genuine ANDROID_ID change: different
  // Android user profile, factory reset, different Google account),
  // since a Telegram-linked identity survives all of those.
  //
  // Deliberately calls getSsoToken(deviceId, false) — NOT the Game tab's
  // forGame=true variant, which auto-provisions a device-only identity
  // and would always report "linked" even for an account that never
  // touched Telegram (see ssoService.ts's own header). This is the one
  // call in the codebase that reports genuine Telegram-link status.
  const [telegramLinked, setTelegramLinked] = useState<'checking' | 'linked' | 'unlinked'>('checking');
  const [showLinkTelegram, setShowLinkTelegram] = useState(false);
  useEffect(() => {
    if (!deviceId) return;
    getSsoToken(deviceId, false)
      .then((r) => setTelegramLinked(r.status === 'ok' && !!r.telegram_id ? 'linked' : 'unlinked'))
      .catch(() => setTelegramLinked('unlinked'));
  }, [deviceId]);

  const handleUnblock = (peerDeviceId: string) => {
    unblockUser(deviceId, peerDeviceId)
      .then(() => setBlocked((prev) => prev.filter((b) => b.deviceId !== peerDeviceId)))
      .catch((e: any) => Alert.alert('', String(e?.message ?? 'Could not unblock')));
  };

  // Uses the central checker: respects the selected channel, versionCode
  // gating, and — critically — resolves the APK for THIS device's ABI so
  // 32-bit phones are never handed the arm64 build.
  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const result = await checkForUpdate(undefined, updateChannel);
      if (!result) throw new Error('unreachable');
      setUpdateResult(result);
      setLatestVersion(result.latestVersion);
      setUpdateStatus(result.hasUpdate ? 'available' : 'uptodate');
    } catch {
      setUpdateStatus('idle');
      Alert.alert('Update check failed', 'Could not reach realgram.no. Try again later.');
    }
  };

  const handleOpenInBrowser = () => {
    if (!updateResult) return;
    openUpdateInBrowser(updateResult.apkUrl).catch((err: { message?: string }) => {
      Alert.alert(t('upd.downloadFailedTitle'), err?.message || t('upd.downloadFailedBody'));
    });
  };

  const handleDownloadUpdate = () => {
    if (!updateResult) return;
    // Khabat, 2026-07-30: "download-knappen gjorde ingenting" on 118 — the
    // native call doesn't resolve until DownloadManager's broadcast fires on
    // completion (a 60-90MB APK, easily minutes on a slow/VPN'd connection),
    // and until now nothing on screen changed between the tap and that
    // eventual resolve/reject. A silently-working multi-minute download reads
    // identically to a broken one with zero feedback. 'downloading' state
    // makes that wait visible instead of guessing whether anything happened.
    setUpdateStatus('downloading');
    downloadUpdate(updateResult.apkUrl, updateResult.latestVersion).catch(
      (err: { code?: string; message?: string }) => {
        setUpdateStatus('available');
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
      },
    );
  };

  const handleBiometricToggle = async () => {
    if (biometricLock) {
      // Turning off — always allowed
      toggleBiometricLock();
      return;
    }
    // Turning on — verify device support first. Use the detailed status so the
    // message matches reality (enroll vs. no hardware); availability now also
    // accepts the device PIN/pattern as a fallback (v0.9.36 #3).
    const status = await BiometricService.getStatus().catch(() => 'unknown' as const);
    if (status !== 'available') {
      const detail = await BiometricService.getStatusDetail().catch(() => ({} as any));
      const msg =
        status === 'none_enrolled'  ? 'No fingerprint, face, or screen lock is set up. Add one in your device settings, then try again.'
      : status === 'no_hardware'    ? 'This device has no biometric hardware.'
      : status === 'hw_unavailable' ? 'Biometric hardware is temporarily unavailable. Try again in a moment.'
      : status === 'update_required'? 'A security update is required before biometrics can be used.'
      : 'App lock is unavailable on this device. Make sure a fingerprint, face, or screen-lock PIN is set up.';
      // Append the raw status codes so issues can be diagnosed from a screenshot.
      const dbg = `\n\nDebug: status=${status}, strong=${detail.strong}, weak=${detail.weak}, cred=${detail.deviceCredential}, sdk=${detail.sdkInt}`;
      Alert.alert('App Lock Unavailable', msg + dbg, [{ text: 'OK' }]);
      return;
    }
    setBiometricLock(true);
  };

  function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={secStyles.section}>
        <Text style={secStyles.label}>{label}</Text>
        <GlassCard noPadding>
          <View style={secStyles.card}>{children}</View>
        </GlassCard>
      </View>
    );
  }

  function Divider() {
    return <View style={{ height: 1, backgroundColor: Colors.border.subtle }} />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screenHeader}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
              <Text style={styles.backBtnText}>‹</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.title}>{t('st.title')}</Text>
        </View>

        <Section label={t('st.connection')}>
          <SelectRow
            label={t('st.protocol')}
            value={protocol}
            options={['VLESS+Reality', 'VLESS', 'Reality', 'WebSocket', 'XHTTP', 'HTTPUpgrade']}
            onChange={setProtocol}
          />
          <Divider />
          <SelectRow
            label={t('st.dns')}
            value={dnsMode}
            options={['Cloudflare (DoH)', 'Google (DoH)', 'AdGuard (DoH)', 'Custom']}
            onChange={setDnsMode}
          />
          <Divider />
          <ToggleRow
            label={t('st.smartMode')}
            description={t('st.smartModeD')}
            value={smartMode}
            onChange={toggleSmartMode}
          />
          {onBypassApps && (
            <>
              <Divider />
              <TouchableOpacity style={selStyles.row} activeOpacity={0.7} onPress={onBypassApps}>
                <View>
                  <Text style={selStyles.label}>{t('st.bypassApps')}</Text>
                  <Text style={rowStyles.desc}>
                    {t(Platform.OS === 'ios' ? 'st.bypassAppsDIos' : 'st.bypassAppsD')}
                  </Text>
                </View>
                <Text style={selStyles.chevron}>›</Text>
              </TouchableOpacity>
            </>
          )}
          <Divider />
          <ToggleRow
            label={t('st.autoConnect')}
            description={t('st.autoConnectD')}
            value={autoConnect}
            onChange={toggleAutoConnect}
          />
        </Section>

        <Section label={t('st.appearance')}>
          <SelectRow
            label={t('st.language')}
            value={language}
            options={SUPPORTED_LANGUAGES.map((l) => l.nativeLabel)}
            onChange={setLanguage}
            renderLabel={(opt) => `${LANGUAGE_FLAGS[opt] ?? ''} ${opt}`.trim()}
          />
        </Section>

        <Section label={t('st.notifications')}>
          <ToggleRow
            label={t('st.biometric')}
            description={t('st.biometricD')}
            value={biometricLock}
            onChange={handleBiometricToggle}
          />
        </Section>

        <Section label={t('st.accountRecovery')}>
          <TouchableOpacity
            style={rowStyles.row}
            activeOpacity={telegramLinked === 'unlinked' ? 0.75 : 1}
            disabled={telegramLinked !== 'unlinked'}
            onPress={() => setShowLinkTelegram(true)}
          >
            <View style={rowStyles.left}>
              <Text style={rowStyles.label}>{t('st.telegramLink')}</Text>
              <Text style={rowStyles.desc}>
                {telegramLinked === 'linked' ? t('st.telegramLinkedD') : t('st.telegramLinkD')}
              </Text>
            </View>
            {telegramLinked === 'linked' ? (
              <Text style={{ color: Colors.emerald[400], fontSize: Typography.size.sm }}>✓ {t('st.telegramLinkedBadge')}</Text>
            ) : telegramLinked === 'unlinked' ? (
              <Text style={selStyles.chevron}>›</Text>
            ) : null}
          </TouchableOpacity>
        </Section>

        <Section label="Privacy">
          <TouchableOpacity
            style={rowStyles.row}
            activeOpacity={0.75}
            onPress={() => setBlockedExpanded((v) => !v)}
          >
            <View style={rowStyles.left}>
              <Text style={rowStyles.label}>Blocked users</Text>
              <Text style={rowStyles.desc}>
                {blocked.length === 0 ? 'No one blocked' : `${blocked.length} blocked`}
              </Text>
            </View>
            <Text style={{ color: Colors.text.muted, fontSize: Typography.size.base }}>
              {blockedExpanded ? '▾' : '▸'}
            </Text>
          </TouchableOpacity>
          {blockedExpanded && blocked.map((b) => (
            <View key={b.deviceId} style={blockedRowStyles.row}>
              <Text style={blockedRowStyles.name} numberOfLines={1}>{b.userId || b.deviceId}</Text>
              <TouchableOpacity onPress={() => handleUnblock(b.deviceId)} activeOpacity={0.75}>
                <Text style={blockedRowStyles.unblock}>Unblock</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Section>

        <Section label={t('st.diagnostics')}>
          {onSmartConnect && (
            <>
              <TouchableOpacity style={selStyles.row} activeOpacity={0.7} onPress={onSmartConnect}>
                <View>
                  <Text style={selStyles.label}>{t('set.smartConnect')}</Text>
                  <Text style={rowStyles.desc}>{t('set.smartConnectDesc')}</Text>
                </View>
                <Text style={selStyles.chevron}>›</Text>
              </TouchableOpacity>
              <Divider />
            </>
          )}
          {onActivity && (
            <>
              <TouchableOpacity style={selStyles.row} activeOpacity={0.7} onPress={onActivity}>
                <View>
                  <Text style={selStyles.label}>{t('set.activity')}</Text>
                </View>
                <Text style={selStyles.chevron}>›</Text>
              </TouchableOpacity>
              <Divider />
            </>
          )}
          {onDiagnostics && (
            <>
              <TouchableOpacity style={selStyles.row} activeOpacity={0.7} onPress={onDiagnostics}>
                <View>
                  <Text style={selStyles.label}>{t('set.diagnostics')}</Text>
                  <Text style={rowStyles.desc}>{t('set.diagnosticsDesc')}</Text>
                </View>
                <Text style={selStyles.chevron}>›</Text>
              </TouchableOpacity>
              <Divider />
            </>
          )}
          {/* Profile import/export removed: users must not be able to copy the
              config out to other clients (v2ray etc.) or side-load foreign
              profiles. Server selection comes only from the bootstrap catalog. */}
          <TouchableOpacity
            style={selStyles.row}
            activeOpacity={0.7}
            onPress={() => {
              Alert.alert(
                'Reset App Data',
                'Remove all imported server profiles and reset to the default starter profile?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: async () => {
                      clearImportedServers();
                      await loadBootstrapIfEmpty();
                      Alert.alert('Done', 'Server list reset to default.');
                    },
                  },
                ],
              );
            }}
          >
            <View>
              <Text style={[selStyles.label, { color: Colors.status.disconnected }]}>
                {t('st.reset')}
              </Text>
              <Text style={rowStyles.desc}>{t('st.resetD')}</Text>
            </View>
            <Text style={selStyles.chevron}>›</Text>
          </TouchableOpacity>
        </Section>

        <Section label={t('st.about')}>
          <TouchableOpacity style={selStyles.row} onPress={() => Linking.openURL(GITHUB_URL)} activeOpacity={0.7}>
            <Text style={selStyles.label}>GitHub</Text>
            <Text style={selStyles.value}>github.com/XS227/RealGram</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={selStyles.row} onPress={() => Linking.openURL(WEBSITE_URL)} activeOpacity={0.7}>
            <Text style={selStyles.label}>Website</Text>
            <Text style={selStyles.value}>realgram.no</Text>
          </TouchableOpacity>
        </Section>

        <Section label={t('st.updates')}>
          <View style={selStyles.row}>
            <View>
              <Text style={selStyles.label}>App version</Text>
              <Text style={rowStyles.desc}>v{APP_VERSION} · Build {APP_BUILD}</Text>
            </View>
            {Platform.OS === 'android' ? (
              <TouchableOpacity
                onPress={updateStatus === 'available' ? handleDownloadUpdate : handleCheckUpdate}
                style={[styles.updateBtn, (updateStatus === 'available' || updateStatus === 'downloading') && styles.updateBtnAvailable]}
                activeOpacity={0.75}
                disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              >
                <Text style={[styles.updateBtnText, (updateStatus === 'available' || updateStatus === 'downloading') && styles.updateBtnTextAvailable]}>
                  {updateStatus === 'checking'    ? 'Checking…'        :
                   updateStatus === 'downloading' ? 'Downloading…'     :
                   updateStatus === 'available'   ? `Update ${latestVersion}` :
                   updateStatus === 'uptodate'    ? 'Up to date ✓'    :
                   'Check update'}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={rowStyles.desc}>via TestFlight</Text>
            )}
          </View>
          {Platform.OS === 'android' && updateStatus === 'available' && (
            <View style={styles.updateBanner}>
              <Text style={styles.updateBannerText}>
                Version {latestVersion} is available. Tap "Update" to download.
              </Text>
            </View>
          )}
          {/* Khabat, 2026-08-02: hit a real silent hang testing build 133/134
              — the in-app download button stayed stuck on "Downloading…"
              with no error, no progress, and (until now) no way out short of
              force-closing the app: downloadUpdate()'s promise only settles
              on DownloadManager's own completion broadcast, which telemetry
              showed never arrives for roughly half of all real attempts.
              The native side now times out after 5min instead of hanging
              forever, but even that is a long silent wait -- this makes the
              browser fallback (a completely different download path) reachable
              immediately instead of only after an explicit failure Alert. */}
          {Platform.OS === 'android' && updateStatus === 'downloading' && (
            <TouchableOpacity onPress={handleOpenInBrowser} style={styles.updateBanner} activeOpacity={0.7}>
              <Text style={styles.updateBannerText}>{t('upd.openInBrowser')}</Text>
            </TouchableOpacity>
          )}
          {Platform.OS === 'android' && (
            <>
              <Divider />
              <SelectRow
                label={t('st.updateChannel')}
                value={updateChannel}
                options={['stable', 'beta', 'experimental']}
                onChange={(v: string) => setUpdateChannel(v as 'stable' | 'beta' | 'experimental')}
              />
            </>
          )}
          <Divider />
          <View style={selStyles.row}>
            <View style={{ gap: 3 }}>
              <Text style={selStyles.label}>Version debug</Text>
              <Text style={rowStyles.desc}>Manifest version: v{APP_VERSION} (Build {APP_BUILD})</Text>
              <Text style={rowStyles.desc}>JS bundle version: v{APP_VERSION} (Build {APP_BUILD})</Text>
            </View>
          </View>
        </Section>

        <View style={styles.about}>
          <Text style={styles.appName}>RealGram</Text>
          <Text style={styles.version}>v{APP_VERSION} · Build {APP_BUILD}</Text>
          <Text style={styles.legal}>© 2026 RealGram. {t('st.allRights')}</Text>
          <EcosystemFooter />
        </View>

        <View style={{ height: Spacing[12] }} />
      </ScrollView>

      <Modal visible={showLinkTelegram} animationType="slide" onRequestClose={() => setShowLinkTelegram(false)}>
        <RealGramLinkWebView
          deviceId={deviceId}
          onLinked={() => { setShowLinkTelegram(false); setTelegramLinked('linked'); }}
          onClose={() => setShowLinkTelegram(false)}
        />
      </Modal>
    </View>
  );
}

const secStyles = StyleSheet.create({
  section: { gap: Spacing[2] },
  label:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1.5, paddingHorizontal: Spacing[2] },
  card:    { paddingHorizontal: Spacing[4] },
});

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.base },
  scroll:  { flex: 1 },
  content: { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[5] },
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[2] },
  backBtn:      { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default },
  backBtnText:  { fontSize: 22, color: Colors.text.secondary, lineHeight: 26 },
  title:        { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  about:   { alignItems: 'center', gap: Spacing[1], paddingVertical: Spacing[4] },
  appName:    { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  version:    { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  legal:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, opacity: 0.6 },
  updateBtn:  { borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: 6 },
  updateBtnAvailable: { borderColor: Colors.emerald[400], backgroundColor: 'rgba(0,232,122,0.1)' },
  updateBtnText:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted },
  updateBtnTextAvailable: { color: Colors.emerald[400] },
  updateBanner:       { backgroundColor: 'rgba(0,232,122,0.07)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(0,232,122,0.2)', padding: Spacing[3] },
  updateBannerText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400], lineHeight: 18 },
});
