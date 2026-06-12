import {
  isUpdateAvailable, compareVersions,
  pickApkUrlForAbi, effectiveUrlSet,
} from '../services/updateService';
import type { VersionInfo, ChannelInfo } from '../services/updateService';

// Bug 1 regression: after installing 0.9.27 (versionCode 37), the checker must
// NOT keep offering 0.9.27. The old code compared a semver string that was stuck
// at 0.9.25 in the JS bundle, so it always reported an update.
describe('OTA update decision (bug 1)', () => {
  it('offers no update when installed build == published build', () => {
    expect(isUpdateAvailable({
      targetCode: 37, targetVersion: '0.9.27', installedCode: 37, installedVersion: '0.9.27',
    })).toBe(false);
  });

  it('offers an update when published build is newer', () => {
    expect(isUpdateAvailable({
      targetCode: 38, targetVersion: '0.9.28', installedCode: 37, installedVersion: '0.9.27',
    })).toBe(true);
  });

  it('does not offer a downgrade', () => {
    expect(isUpdateAvailable({
      targetCode: 36, targetVersion: '0.9.26', installedCode: 37, installedVersion: '0.9.27',
    })).toBe(false);
  });

  it('reproduces the old false-positive scenario but resolves it via versionCode', () => {
    // Old bug: JS bundle reported 0.9.25 while the APK was really 0.9.26/36.
    // With versionCode gating, an installed 36 vs published 36 = no update.
    expect(isUpdateAvailable({
      targetCode: 36, targetVersion: '0.9.26', installedCode: 36, installedVersion: '0.9.25',
    })).toBe(false);
  });

  it('falls back to semver when no versionCode is published', () => {
    expect(isUpdateAvailable({
      targetVersion: '0.9.28', installedCode: 37, installedVersion: '0.9.27',
    })).toBe(true);
    expect(isUpdateAvailable({
      targetVersion: '0.9.27', installedCode: 37, installedVersion: '0.9.27',
    })).toBe(false);
  });

  it('compareVersions handles multi-part versions', () => {
    expect(compareVersions('0.9.27', '0.9.27')).toBe(0);
    expect(compareVersions('0.9.28', '0.9.27')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.27')).toBeGreaterThan(0);
  });
});

// OTA must serve each architecture its own APK. Serving the default (arm64)
// build to an armeabi-v7a-only phone fails with "App not installed" — the
// v0.9.28 Samsung J8 incident, on the update path.
describe('ABI-aware OTA APK selection', () => {
  const URLS = {
    apkUrl:          'https://x/setalink-v1.apk',
    apkUrlArm32:     'https://x/setalink-v1-arm32.apk',
    apkUrlUniversal: 'https://x/setalink-v1-universal.apk',
  };

  it('arm64 device gets the arm64 build', () => {
    expect(pickApkUrlForAbi(URLS, 'arm64-v8a,armeabi-v7a,armeabi')).toBe(URLS.apkUrl);
  });

  it('32-bit-only device gets the arm32 build, never the arm64 default', () => {
    expect(pickApkUrlForAbi(URLS, 'armeabi-v7a,armeabi')).toBe(URLS.apkUrlArm32);
  });

  it('32-bit device falls back to universal when no arm32 build is published', () => {
    expect(pickApkUrlForAbi({ ...URLS, apkUrlArm32: undefined }, 'armeabi-v7a'))
      .toBe(URLS.apkUrlUniversal);
  });

  it('unknown ABI prefers the universal build (installs anywhere)', () => {
    expect(pickApkUrlForAbi(URLS, '')).toBe(URLS.apkUrlUniversal);
    expect(pickApkUrlForAbi(URLS, 'x86_64')).toBe(URLS.apkUrlUniversal);
  });

  it('only the default URL published → everyone gets it (no better option)', () => {
    const only = { apkUrl: URLS.apkUrl };
    expect(pickApkUrlForAbi(only, 'armeabi-v7a')).toBe(URLS.apkUrl);
    expect(pickApkUrlForAbi(only, '')).toBe(URLS.apkUrl);
  });

  const INFO = {
    version: '1.0.0', versionCode: 40, forceUpdate: false, minSupported: '0.9.7',
    apkUrl: URLS.apkUrl, apkUrlFallback: '', apkUrlArm32: URLS.apkUrlArm32,
    apkUrlUniversal: URLS.apkUrlUniversal, changelog: [],
  } as VersionInfo;

  it('channel with its own ABI URLs uses them', () => {
    const beta: ChannelInfo = {
      version: '1.1.0-beta', apkUrl: 'https://x/beta.apk', apkUrlArm32: 'https://x/beta-arm32.apk',
    };
    const set = effectiveUrlSet(INFO, beta);
    expect(pickApkUrlForAbi(set, 'armeabi-v7a')).toBe('https://x/beta-arm32.apk');
  });

  it('channel mirroring the top-level release inherits top-level ABI URLs', () => {
    // e.g. "experimental" pointing at the same APK as the main release
    const exp: ChannelInfo = { version: '1.0.0', apkUrl: URLS.apkUrl };
    const set = effectiveUrlSet(INFO, exp);
    expect(pickApkUrlForAbi(set, 'armeabi-v7a')).toBe(URLS.apkUrlArm32);
  });

  it('channel on a DIFFERENT release never inherits top-level ABI URLs (version mix)', () => {
    const beta: ChannelInfo = { version: '1.1.0-beta', apkUrl: 'https://x/beta.apk' };
    const set = effectiveUrlSet(INFO, beta);
    // No arm32 build exists for this beta — must NOT hand out v1.0.0-arm32
    expect(pickApkUrlForAbi(set, 'armeabi-v7a')).toBe('https://x/beta.apk');
  });

  it('no channel entry at all → top-level URL set', () => {
    const set = effectiveUrlSet(INFO, undefined);
    expect(pickApkUrlForAbi(set, 'arm64-v8a')).toBe(URLS.apkUrl);
    expect(pickApkUrlForAbi(set, 'armeabi-v7a')).toBe(URLS.apkUrlArm32);
  });
});
