import { deriveReferralCode } from '../stores/authStore';

// Bug 3 regression: the app must share the backend `referral_code`, NOT the
// user_id suffix. The old code returned the suffix, which use-referral never
// matched, so every shared invite was rejected.
describe('referral code derivation (bug 3)', () => {
  it('returns the backend referral_code, ignoring the user_id suffix', () => {
    // user_id suffix is 62DAC5F0; the real referral_code is 4D2CA28.
    expect(deriveReferralCode('SL-227-62DAC5F0', '4D2CA28')).toBe('4D2CA28');
  });

  it('never returns the user_id suffix', () => {
    const out = deriveReferralCode('SL-227-62DAC5F0', '4D2CA28');
    expect(out).not.toBe('62DAC5F0');
  });

  it('uppercases the code', () => {
    expect(deriveReferralCode('SL-227-ABCDEF12', 'abc1234')).toBe('ABC1234');
  });

  it('is safe when referral_code is empty', () => {
    expect(deriveReferralCode('SL-227-ABCDEF12', '')).toBe('');
  });
});
