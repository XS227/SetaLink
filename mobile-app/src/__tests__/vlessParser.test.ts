import { parseVlessUri, parseUriList, isParseError } from '../services/vlessParser';

// Real-format Reality URI from 3X-UI (fields match setalink.no inbound)
const REALITY_URI =
  'vless://a1b2c3d4-e5f6-4000-8000-aabbccddeeff' +
  '@edge.setalink.no:8443' +
  '?encryption=none' +
  '&flow=xtls-rprx-vision' +
  '&security=reality' +
  '&sni=www.microsoft.com' +
  '&fp=chrome' +
  '&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU' +
  '&sid=7f81892e' +
  '&type=tcp' +
  '#EDGE-REALITY-DE';

const WS_TLS_URI =
  'vless://a1b2c3d4-e5f6-4000-8000-aabbccddeeff' +
  '@edge.setalink.no:443' +
  '?encryption=none' +
  '&security=tls' +
  '&sni=edge.setalink.no' +
  '&type=ws' +
  '&path=%2Fvpn' +
  '#EDGE-WS';

describe('parseVlessUri — Reality', () => {
  it('parses all Reality fields correctly', () => {
    const result = parseVlessUri(REALITY_URI);
    expect(isParseError(result)).toBe(false);
    if (isParseError(result)) return;

    expect(result.uuid).toBe('a1b2c3d4-e5f6-4000-8000-aabbccddeeff');
    expect(result.address).toBe('edge.setalink.no');
    expect(result.port).toBe(8443);
    expect(result.security).toBe('reality');
    expect(result.network).toBe('tcp');
    expect(result.flow).toBe('xtls-rprx-vision');
    expect(result.pbk).toBe('Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU');
    expect(result.sid).toBe('7f81892e');
    expect(result.fp).toBe('chrome');
    expect(result.sni).toBe('www.microsoft.com');
    expect(result.name).toBe('EDGE-REALITY-DE');
  });

  it('rejects Reality URI missing pbk', () => {
    const noPbk = REALITY_URI.replace('&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU', '');
    const result = parseVlessUri(noPbk);
    expect(isParseError(result)).toBe(true);
    if (isParseError(result)) {
      expect(result.error).toMatch(/pbk/i);
    }
  });
});

describe('parseVlessUri — WebSocket + TLS', () => {
  it('parses ws+tls fields', () => {
    const result = parseVlessUri(WS_TLS_URI);
    expect(isParseError(result)).toBe(false);
    if (isParseError(result)) return;

    expect(result.security).toBe('tls');
    expect(result.network).toBe('ws');
    expect(result.sni).toBe('edge.setalink.no');
    expect(result.path).toBe('/vpn');
    expect(result.port).toBe(443);
  });
});

describe('parseVlessUri — edge cases', () => {
  it('returns error for non-vless scheme', () => {
    const r = parseVlessUri('vmess://something');
    expect(isParseError(r)).toBe(true);
  });

  it('returns error for missing @', () => {
    const r = parseVlessUri('vless://uuid-without-at-sign');
    expect(isParseError(r)).toBe(true);
  });

  it('returns error for invalid UUID', () => {
    const r = parseVlessUri('vless://not-a-uuid@host:443?type=tcp&security=none');
    expect(isParseError(r)).toBe(true);
    if (isParseError(r)) expect(r.error).toMatch(/UUID/i);
  });

  it('handles URL-encoded path', () => {
    const uri =
      'vless://a1b2c3d4-e5f6-4000-8000-aabbccddeeff' +
      '@host:443?type=ws&security=tls&path=%2Fsome%2Fpath';
    const result = parseVlessUri(uri);
    expect(isParseError(result)).toBe(false);
    if (!isParseError(result)) expect(result.path).toBe('/some/path');
  });

  it('handles fragment with special chars in name', () => {
    const uri =
      'vless://a1b2c3d4-e5f6-4000-8000-aabbccddeeff' +
      '@host:443?type=tcp&security=none' +
      '#%F0%9F%87%A9%F0%9F%87%AA%20Germany%20-%20Frankfurt';
    const result = parseVlessUri(uri);
    expect(isParseError(result)).toBe(false);
    if (!isParseError(result)) expect(result.name).toContain('Germany');
  });

  it('defaults port to 443 when not specified', () => {
    const uri =
      'vless://a1b2c3d4-e5f6-4000-8000-aabbccddeeff' +
      '@host?type=tcp&security=none';
    const result = parseVlessUri(uri);
    if (!isParseError(result)) expect(result.port).toBe(443);
  });

  it('defaults fp to chrome for Reality when fp absent', () => {
    const noFp = REALITY_URI.replace('&fp=chrome', '');
    const result = parseVlessUri(noFp);
    if (!isParseError(result)) expect(result.fp).toBe('chrome');
  });
});

describe('parseUriList', () => {
  it('parses multiple URIs from newline-separated text', () => {
    const text = `${REALITY_URI}\n${WS_TLS_URI}\n`;
    const results = parseUriList(text);
    expect(results).toHaveLength(2);
    expect(results[0]!.security).toBe('reality');
    expect(results[1]!.security).toBe('tls');
  });

  it('skips blank lines and non-vless schemes', () => {
    const text = `\nvmess://something\n\n${REALITY_URI}\nss://something`;
    const results = parseUriList(text);
    expect(results).toHaveLength(1);
  });

  it('skips invalid URIs without throwing', () => {
    const text = `vless://invalid\n${REALITY_URI}`;
    expect(() => parseUriList(text)).not.toThrow();
    const results = parseUriList(text);
    expect(results).toHaveLength(1);
  });
});
