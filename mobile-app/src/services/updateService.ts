import { Linking } from 'react-native';
import { storage } from '../storage/storage';
import { APP_VERSION, APP_BUILD } from '../utils/version';

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
  channels?: {
    stable?: { version: string; apkUrl: string };
    beta?:   { version: string; apkUrl: string };
    hotfix?: { version: string; apkUrl: string };
  };
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

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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
export async function checkForUpdate(deviceCountry?: string, channel: 'stable' | 'beta' = 'stable'): Promise<UpdateCheckResult | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { signal: controller.signal });
    clearTimeout(tid);
    const info: VersionInfo = await res.json();

    // Pick target version from channel
    const channelInfo = channel === 'beta' ? info.channels?.beta : info.channels?.stable;
    const targetVersion = channelInfo?.version ?? info.version;
    const targetApkUrl  = channelInfo?.apkUrl  ?? info.apkUrl;

    const hasUpdate   = compareVersions(targetVersion, APP_VERSION) > 0;
    const inRollout   = isInRollout(info, deviceCountry);
    const forceUpdate = info.forceUpdate && compareVersions(APP_VERSION, info.minSupported ?? '0') < 0;

    // Cache result
    storage.setItem(CACHE_KEY, JSON.stringify({ result: { hasUpdate, forceUpdate, latestVersion: targetVersion, currentVersion: APP_VERSION, apkUrl: targetApkUrl, changelog: info.changelog ?? [], isInRollout: inRollout }, ts: Date.now() }));

    return { hasUpdate, forceUpdate, latestVersion: targetVersion, currentVersion: APP_VERSION, apkUrl: targetApkUrl, changelog: info.changelog ?? [], isInRollout: inRollout };
  } catch {
    // Serve cached
    const cached = storage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { result } = JSON.parse(cached) as { result: UpdateCheckResult; ts: number };
        return result;
      } catch {}
    }
    return null;
  }
}

/** Returns true if the user has snoozed this update in the last 24 hours. */
export function isUpdateSnoozed(): boolean {
  const ts = storage.getItem(SNOOZE_KEY);
  if (!ts) return false;
  return Date.now() - parseInt(ts, 10) < SNOOZE_TTL;
}

export function snoozeUpdate(): void {
  storage.setItem(SNOOZE_KEY, String(Date.now()));
}

/** Open the APK download URL in the system browser/download manager. */
export async function downloadUpdate(apkUrl: string): Promise<void> {
  await Linking.openURL(apkUrl);
}
