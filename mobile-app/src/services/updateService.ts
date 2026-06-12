import { Linking } from 'react-native';
import { storage, syncGet } from '../storage/storage';
import { APP_VERSION, APP_BUILD, APP_BUILD_CODE } from '../utils/version';

export interface VersionInfo {
  version: string;
  versionCode: number;
  forceUpdate: boolean;
  minSupported: string;
  apkUrl: string;
  apkUrlFallback: string;
  changelog: string[];
  rollout?: {
    strategy?: string;
    countries?: string[];
    percent?: number;
    exclude_countries?: string[];
  };
  channels?: Record<string, { version: string; versionCode?: number; apkUrl: string } | undefined>;
}

export type UpdateChannel = 'stable' | 'beta' | 'experimental';

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
    const targetApkUrl  = channelInfo?.apkUrl  ?? info.apkUrl;
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

/**
 * Download the APK and open the installer. Prefers the in-app path
 * (DownloadManager + package-installer prompt — no browser round-trip);
 * falls back to the system browser when the native method is unavailable.
 */
export async function downloadUpdate(apkUrl: string, targetVersion?: string, targetCode?: number): Promise<void> {
  // Persist a pending-install marker; resolvePendingInstall() compares the
  // running build against it on next boot to detect failed installs.
  storage.setItem(PENDING_KEY, JSON.stringify({
    targetVersion: targetVersion ?? '',
    targetCode:    targetCode ?? 0,
    fromVersion:   APP_VERSION,
    fromCode:      APP_BUILD_CODE,
    ts:            Date.now(),
  }));
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../specs/NativeXrayModule').default;
    if (mod?.downloadAndInstallApk) {
      await mod.downloadAndInstallApk(apkUrl);
      return;
    }
  } catch {
    // native download failed — browser fallback below
  }
  await Linking.openURL(apkUrl);
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
