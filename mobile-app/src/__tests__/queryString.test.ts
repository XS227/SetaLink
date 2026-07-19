import { buildQueryString } from '../utils/queryString';

describe('buildQueryString', () => {
  it('encodes and joins present values, in insertion order', () => {
    expect(buildQueryString({ src: 'realink', device_id: 'abc 123' }))
      .toBe('src=realink&device_id=abc%20123');
  });

  it('drops undefined, null, and empty-string values', () => {
    expect(buildQueryString({ a: '1', b: undefined, c: null, d: '' }))
      .toBe('a=1');
  });

  it('never calls URLSearchParams.set — the exact method this device throws on', () => {
    // Regression guard for the black-spinner root cause (Khabat, 2026-07-19):
    // this device's URLSearchParams implements the constructor + toString()
    // but throws "URLSearchParams.set is not implemented" for .set(). Prove
    // buildQueryString works even when .set() is broken.
    const OriginalUSP = (global as any).URLSearchParams;
    class ThrowingSetURLSearchParams extends OriginalUSP {
      set(): never { throw new Error('URLSearchParams.set is not implemented'); }
    }
    (global as any).URLSearchParams = ThrowingSetURLSearchParams;
    try {
      expect(() => buildQueryString({ src: 'realink', sso: 'token' })).not.toThrow();
      expect(buildQueryString({ src: 'realink', sso: 'token' })).toBe('src=realink&sso=token');
    } finally {
      (global as any).URLSearchParams = OriginalUSP;
    }
  });
});
