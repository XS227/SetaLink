import { parseDeepLink } from '../services/deepLinkService';

describe('parseDeepLink — link-real-account (A3/C3)', () => {
  it('parses a full REAL link proof on the setalink:// scheme', () => {
    const url = 'setalink://link-real-account?device_id=dev-1&account=real%3Akb&ts=1720000000&sig=abc123';
    expect(parseDeepLink(url)).toEqual({
      type: 'LINK_REAL', deviceId: 'dev-1', account: 'real:kb', ts: 1720000000, sig: 'abc123',
    });
  });

  it('rejects a proof missing the signature', () => {
    expect(parseDeepLink('setalink://link-real-account?account=real:kb&ts=1720000000')).toBeNull();
  });

  it('rejects a non-numeric ts', () => {
    expect(parseDeepLink('setalink://link-real-account?account=real:kb&ts=nope&sig=x')).toBeNull();
  });

  it('does NOT parse the realink:// scheme (app registers setalink://)', () => {
    // Agent B's Mini App originally guessed realink:// — this documents that
    // the parser only understands setalink://, so that scheme would no-op.
    expect(parseDeepLink('realink://link-real-account?account=real:kb&ts=1&sig=x')).toBeNull();
  });
});
