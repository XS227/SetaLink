import { isUpdateAvailable, compareVersions } from '../services/updateService';

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
