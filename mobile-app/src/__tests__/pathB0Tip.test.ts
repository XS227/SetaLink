/**
 * Path B0 post-connect tip (A-7) — shown exactly once, localized.
 * Verifies the settings flag gate + the standalone tr() translator.
 */
import { useSettingsStore } from '../stores/settingsStore';
import { tr } from '../i18n';

describe('Path B0 tip — one-time flag', () => {
  beforeEach(() => {
    useSettingsStore.setState({ hasSeenTelegramTip: false, language: 'English' });
  });

  it('starts unseen and marks seen exactly once', () => {
    expect(useSettingsStore.getState().hasSeenTelegramTip).toBe(false);
    useSettingsStore.getState().markTelegramTipSeen();
    expect(useSettingsStore.getState().hasSeenTelegramTip).toBe(true);
    // idempotent — staying true, so the connect handler's guard fires once
    useSettingsStore.getState().markTelegramTipSeen();
    expect(useSettingsStore.getState().hasSeenTelegramTip).toBe(true);
  });

  it('tr() resolves the tip in English and Persian', () => {
    useSettingsStore.setState({ language: 'English' });
    expect(tr('tip.appsWork')).toContain('Telegram');
    useSettingsStore.setState({ language: 'فارسی' });
    const fa = tr('tip.appsWork');
    expect(fa).toContain('تلگرام');
    expect(fa).not.toBe('tip.appsWork'); // real translation, not the key fallback
  });

  it('tr() falls back to the key for an unknown string', () => {
    expect(tr('nonexistent.key.xyz')).toBe('nonexistent.key.xyz');
  });
});
