import { Linking } from 'react-native';
import { storage, syncGet } from '../storage/storage';
import { APP_VERSION, APP_BUILD, APP_BUILD_CODE } from '../utils/version';
import { trackEvent } from './analytics';
import { useAuthStore } from '../stores/authStore';

export interface ChannelInfo {
  version: string;
  versionCode?: number;
  apkUrl: string;
  apkUrlArm32?: string;
  apkUrlUniversal?: string;
}

export interface VersionInfo {
  version: string;
  versionCode: number;
  forceUpdate: boolean;
  minSupported: string;
  apkUrl: string;            // arm64 build (the default)
  apkUrlFallback: string;
  apkUrlArm32?: string;      // 32-bit build for pre-2018 devices
  apkUrlUniversal?: string;  // both ABIs, larger
  changelog: string[];
  rollout?: {
    strategy?: string;
    countries?: string[];
    percent?: number;
    exclude_countries?: string[];
  };
  channels?: Record<string, ChannelInfo | undefined>;
}

export type UpdateChannel = 'stable' | 'beta' | 'experimental';

// ── ABI-aware APK selection ───────────────────────────────────────────────────
// The default apkUrl is the arm64 build; serving it to a 32-bit device fails
// with "App not installed" (the v0.9.28 Samsung J8 incident — but on the OTA
// path). Each architecture must get its own package.

export interface AbiUrlSet {
  apkUrl: string;
  apkUrlArm32?: string;
  apkUrlUniversal?: string;
}

/**
 * Picks the APK URL matching the device ABI list (Build.SUPPORTED_ABIS,
 * comma-joined, most-preferred first).
 *   arm64-capable      → arm64 build
 *   32-bit-only ARM    → arm32 build, else universal, else arm64 (will fail,
 *                        but it is the only URL published — better than none)
 *   unknown/x86/other  → universal when available, else default
 */
export function pickApkUrlForAbi(urls: AbiUrlSet, abi: string): string {
  const a = (abi || '').toLowerCase();
  if (a.includes('arm64-v8a')) return urls.apkUrl;
  if (a.includes('armeabi'))   return urls.apkUrlArm32 ?? urls.apkUrlUniversal ?? urls.apkUrl;
  return urls.apkUrlUniversal ?? urls.apkUrl;
}

/**
 * Effective URL set for a channel. Channel-level ABI URLs win; when the
 * channel has none but its apkUrl is the same release as the top level
 * (e.g. stable/experimental mirroring the main release), the top-level ABI
 * URLs apply. Otherwise only the channel's own apkUrl is safe to use —
 * mixing top-level ABI URLs from a different version would install a
 * mismatched build.
 */
export function effectiveUrlSet(info: VersionInfo, channelInfo?: ChannelInfo): AbiUrlSet {
  if (!channelInfo) {
    return { apkUrl: info.apkUrl, apkUrlArm32: info.apkUrlArm32, apkUrlUniversal: info.apkUrlUniversal };
  }
  const sameRelease = channelInfo.apkUrl === info.apkUrl;
  return {
    apkUrl:          channelInfo.apkUrl,
    apkUrlArm32:     channelInfo.apkUrlArm32     ?? (sameRelease ? info.apkUrlArm32     : undefined),
    apkUrlUniversal: channelInfo.apkUrlUniversal ?? (sameRelease ? info.apkUrlUniversal : undefined),
  };
}

// Device ABI string (e.g. "arm64-v8a,armeabi-v7a,armeabi"), cached after the
// first native fingerprint call. Empty string when native is unavailable —
// pickApkUrlForAbi then prefers the universal build, which installs anywhere.
let _cachedAbi: string | null = null;

export async function getDeviceAbi(): Promise<string> {
  if (_cachedAbi !== null) return _cachedAbi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDeviceFingerprint } = require('./deviceIdentityService');
    const fp = await getDeviceFingerprint();
    _cachedAbi = String(fp?.abi ?? '');
  } catch {
    _cachedAbi = '';
  }
  return _cachedAbi;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  forceUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  apkUrl: string;
  changelog: string[];
  isInRollout: boolean;
}

const VERSION_URL = 'https://setalink.no/download/version.json';
const CACHE_KEY   = 'update_check_v1';
const SNOOZE_KEY  = 'update_snoozed_v1';
const SNOOZE_TTL  = 24 * 60 * 60 * 1000; // 24 hours

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The single source of truth for "is there an update?". versionCode (build
 * number) is the authoritative gate because it is monotonic and matches the
 * installed APK exactly — so a build that is already installed can never be
 * offered again. Falls back to semver only when no versionCode is published.
 */
export function isUpdateAvailable(opts: {
  targetCode?: number;
  targetVersion: string;
  installedCode: number;
  installedVersion: string;
}): boolean {
  const { targetCode, targetVersion, installedCode, installedVersion } = opts;
  if (typeof targetCode === 'number' && targetCode > 0) {
    return targetCode > installedCode;
  }
  return compareVersions(targetVersion, installedVersion) > 0;
}

/** Decides if this device is in the rollout group. Uses consistent hash of APP_BUILD. */
function isInRollout(info: VersionInfo, deviceCountry?: string): boolean {
  const r = info.rollout;
  if (!r) return true;

  if (r.exclude_countries && deviceCountry && r.exclude_countries.includes(deviceCountry.toUpperCase())) return false;
  if (r.countries && r.countries.length > 0) {
    if (deviceCountry && r.countries.includes(deviceCountry.toUpperCase())) return true;
    if (!deviceCountry) return true; // can't filter, include
    if (r.strategy === 'all') return true;
    return false;
  }

  const pct = r.percent ?? 100;
  if (pct >= 100) return true;
  const hash = parseInt(APP_BUILD, 10) % 100;
  return hash < pct;
}

/** Check for available update. Returns null on network failure. */
export async function checkForUpdate(deviceCountry?: string, channel: UpdateChannel = 'stable'): Promise<UpdateCheckResult | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { signal: controller.signal });
    clearTimeout(tid);
    const info: VersionInfo = await res.json();

    // Pick target version from channel; unknown channels fall back to stable,
    // then to the top-level fields.
    const channelInfo = info.channels?.[channel] ?? info.channels?.stable;
    const targetVersion = channelInfo?.version ?? info.version;
    // Resolve the APK for THIS device's architecture — arm32 phones must
    // never be offered the arm64 build.
    const abi           = await getDeviceAbi();
    const targetApkUrl  = pickApkUrlForAbi(effectiveUrlSet(info, channelInfo), abi);
    // versionCode is the authoritative gate (see isUpdateAvailable).
    const targetCode    = channelInfo?.versionCode ?? info.versionCode;

    const hasUpdate   = isUpdateAvailable({
      targetCode, targetVersion, installedCode: APP_BUILD_CODE, installedVersion: APP_VERSION,
    });
    const inRollout   = isInRollout(info, deviceCountry);
    const forceUpdate = info.forceUpdate && compareVersions(APP_VERSION, info.minSupported ?? '0') < 0;
    setVpnUpdateBlocked(forceUpdate);

    // Cache result
    storage.setItem(CACHE_KEY, JSON.stringify({ result: { hasUpdate, forceUpdate, latestVersion: targetVersion, currentVersion: APP_VERSION, apkUrl: targetApkUrl, changelog: info.changelog ?? [], isInRollout: inRollout }, ts: Date.now() }));

    return { hasUpdate, forceUpdate, latestVersion: targetVersion, currentVersion: APP_VERSION, apkUrl: targetApkUrl, changelog: info.changelog ?? [], isInRollout: inRollout };
  } catch {
    // Serve cached
    const cached = syncGet(CACHE_KEY);
    if (cached) {
      try {
        const { result } = JSON.parse(cached) as { result: UpdateCheckResult; ts: number };
        return result;
      } catch {}
    }
    return null;
  }
}

// ── Forced-update VPN gate ────────────────────────────────────────────────────
// When appVersion < minSupported (forceUpdate), connecting is blocked until the
// user installs the update. Persisted so the block survives app restarts and
// offline launches; cleared automatically once a non-forced check succeeds.

const VPN_BLOCK_KEY = 'update_vpn_blocked_v1';

export function setVpnUpdateBlocked(blocked: boolean): void {
  if (blocked) storage.setItem(VPN_BLOCK_KEY, '1');
  else         storage.removeItem(VPN_BLOCK_KEY);
}

export function isVpnUpdateBlocked(): boolean {
  return syncGet(VPN_BLOCK_KEY) === '1';
}

/** Returns true if the user has snoozed this update in the last 24 hours. */
export function isUpdateSnoozed(): boolean {
  const ts = syncGet(SNOOZE_KEY);
  if (!ts) return false;
  return Date.now() - parseInt(ts, 10) < SNOOZE_TTL;
}

export function snoozeUpdate(): void {
  storage.setItem(SNOOZE_KEY, String(Date.now()));
}

// ── OTA step logging ──────────────────────────────────────────────────────────
// The OTA download path is the one place we MUST be able to diagnose from the
// field, so these logs are unconditional (not gated by __DEV__ like Logger) —
// they surface under the ReactNativeJS tag in `adb logcat` on release builds.
// Khabat, 2026-07-30: "download-knappen gjorde ingenting" on 118 — adb logcat
// has never actually been available to pull these from a real device on this
// project (same gap ssoService.ts and liveTvService.ts hit), so console.log
// alone was never going to diagnose a field report. Also routing every step
// through the same trackEvent()/app_events pipe those two files already use
// means the *next* "did nothing" report is answerable from server-side
// queries instead of needing another live round-trip.
// eslint-disable-next-line no-console
function otaLog(step: string, detail?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[RealGram:OTA] ${step}`, detail ?? '');
  try {
    // String(detail) on an object (e.g. the {code, message} caught below)
    // stringifies to the useless literal "[object Object]" — every native
    // install exception logged that instead of the actual error. Only plain
    // strings/numbers pass through String(); everything else gets
    // JSON.stringify'd so the real code/message survive into telemetry.
    let detailStr: string | undefined;
    if (detail !== undefined) {
      if (typeof detail === 'string' || typeof detail === 'number') {
        detailStr = String(detail);
      } else {
        try { detailStr = JSON.stringify(detail); } catch { detailStr = String(detail); }
      }
      detailStr = detailStr.slice(0, 300);
    }
    trackEvent('OTA_DOWNLOAD_STAGE', useAuthStore.getState().user?.deviceId, { step, detail: detailStr });
  } catch { /* diagnostics must never break the UI */ }
}

/**
 * Explicit "Open in browser" action. Opens the SAME ABI-resolved apkUrl that
 * checkForUpdate() picked for this device (never a hardcoded setalink-latest),
 * so a 32-bit phone still gets the arm32 build. Logs every outcome; throws on
 * failure so the caller can surface it.
 */
export async function openUpdateInBrowser(apkUrl: string): Promise<void> {
  otaLog('OTA_BROWSER_FALLBACK_PRESSED', apkUrl);
  if (!apkUrl) {
    otaLog('OTA_BROWSER_FALLBACK_FAILED', 'empty apkUrl');
    throw new Error('No download URL available for this device.');
  }
  try {
    await Linking.openURL(apkUrl);
    otaLog('OTA_BROWSER_FALLBACK_OPENED', apkUrl);
  } catch (e: unknown) {
    const message = (e as { message?: string })?.message ?? 'Could not open browser';
    otaLog('OTA_BROWSER_FALLBACK_FAILED', message);
    throw Object.assign(new Error(message), { code: 'BROWSER_OPEN_FAILED' });
  }
}

export type DownloadOutcome =
  | { method: 'native'; ok: true }
  | { method: 'browser'; ok: true }
  | { method: 'native' | 'browser'; ok: false; code: string; message: string };

/**
 * Download the APK and open the installer. Prefers the in-app path
 * (DownloadManager + package-installer prompt — no browser round-trip);
 * falls back to the system browser when the native method is unavailable.
 *
 * Throws on failure so the caller can surface it — do NOT wrap the call in
 * `.catch(() => {})`, that is exactly what hid the original "Download does
 * nothing" bug. The native side rejects with a coded error
 * (INSTALL_PERMISSION_REQUIRED / APK_DOWNLOAD_FAILED / APK_INSTALL_FAILED / …).
 */
export async function downloadUpdate(apkUrl: string, targetVersion?: string, targetCode?: number): Promise<DownloadOutcome> {
  otaLog('button pressed', { apkUrl, targetVersion, targetCode });
  if (!apkUrl) {
    otaLog('aborted: empty apkUrl');
    throw new Error('No download URL available for this device.');
  }
  otaLog('url resolved', apkUrl);

  // Persist a pending-install marker; resolvePendingInstall() compares the
  // running build against it on next boot to detect failed installs.
  storage.setItem(PENDING_KEY, JSON.stringify({
    targetVersion: targetVersion ?? '',
    targetCode:    targetCode ?? 0,
    fromVersion:   APP_VERSION,
    fromCode:      APP_BUILD_CODE,
    ts:            Date.now(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let mod: { downloadAndInstallApk?: (url: string) => Promise<unknown> } | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../specs/NativeXrayModule').default;
  } catch (e) {
    otaLog('native module require failed', String(e));
  }

  if (mod?.downloadAndInstallApk) {
    otaLog('native path: calling downloadAndInstallApk');
    try {
      await mod.downloadAndInstallApk(apkUrl);
      otaLog('native path: installer launched / download enqueued');
      return { method: 'native', ok: true };
    } catch (e: unknown) {
      // e.code is set by the native promise.reject(code, message)
      const code    = (e as { code?: string })?.code ?? 'NATIVE_DOWNLOAD_ERROR';
      const message = (e as { message?: string })?.message ?? 'Download failed';
      otaLog('native path: exception', { code, message });
      // Permission gate is recoverable — the native side has already opened
      // the "Install unknown apps" settings screen; tell the caller so it can
      // ask the user to grant it and tap Download again.
      throw Object.assign(new Error(message), { code, method: 'native' });
    }
  }

  // Native method absent (pre-0.9.29 build) → system browser download.
  otaLog('native method unavailable — falling back to browser', apkUrl);
  try {
    await Linking.openURL(apkUrl);
    otaLog('browser path: opened');
    return { method: 'browser', ok: true };
  } catch (e: unknown) {
    const message = (e as { message?: string })?.message ?? 'Could not open browser';
    otaLog('browser path: exception', message);
    throw Object.assign(new Error(message), { code: 'BROWSER_OPEN_FAILED', method: 'browser' });
  }
}

const PENDING_KEY = 'update_pending_install_v1';
// Give the user time to actually run the installer before judging the outcome.
const PENDING_MIN_AGE = 10 * 60 * 1000; // 10 minutes
const PENDING_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // discard stale markers after 7 days

export interface PendingInstallOutcome {
  outcome: 'install_success' | 'install_failure';
  targetVersion: string;
  fromVersion: string;
}

/**
 * Checks the pending-install marker left by downloadUpdate(). Returns the
 * outcome exactly once (marker is cleared), or null when there is nothing
 * conclusive to report yet.
 */
export function resolvePendingInstall(): PendingInstallOutcome | null {
  const raw = syncGet(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { targetVersion: string; targetCode: number; fromVersion: string; ts: number };
    const updated = p.targetCode > 0
      ? APP_BUILD_CODE >= p.targetCode
      : compareVersions(APP_VERSION, p.targetVersion || '0') >= 0;
    if (updated) {
      storage.removeItem(PENDING_KEY);
      return { outcome: 'install_success', targetVersion: p.targetVersion, fromVersion: p.fromVersion };
    }
    const age = Date.now() - p.ts;
    if (age < PENDING_MIN_AGE) return null;     // installer may still be running
    storage.removeItem(PENDING_KEY);
    if (age > PENDING_MAX_AGE) return null;     // too old to be meaningful
    return { outcome: 'install_failure', targetVersion: p.targetVersion, fromVersion: p.fromVersion };
  } catch {
    storage.removeItem(PENDING_KEY);
    return null;
  }
}
