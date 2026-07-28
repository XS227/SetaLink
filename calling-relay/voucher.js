'use strict';
/**
 * Voucher signing/verification — the Node-side twin of shahnameh-backend's
 * lib/calling.php `call_sign_voucher()`/`call_verify_voucher()`. Same exact
 * scheme (HMAC-SHA256 over a base64url JSON payload, `body.sig` shape) so a
 * voucher minted by PHP verifies here without either side needing a shared
 * JWT library. Keep the two files in sync if this format changes.
 *
 * Zero npm dependencies (just Node's built-in `crypto`) — deliberate, so
 * this piece is testable on any box with plain `node`, same posture as the
 * shahnameh-backend `lib/*Parser.js` modules already are.
 */

const crypto = require('crypto');

function b64urlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64');
}

function signVoucher(secret, payload) {
  const body = { ...payload };
  if (!body.exp) body.exp = Math.floor(Date.now() / 1000) + 60;
  const bodyEnc = b64urlEncode(Buffer.from(JSON.stringify(body)));
  const sig = b64urlEncode(crypto.createHmac('sha256', secret).update(bodyEnc).digest());
  return `${bodyEnc}.${sig}`;
}

/** Returns the decoded payload if validly signed and not expired, null otherwise. */
function verifyVoucher(secret, voucher) {
  if (!secret || typeof voucher !== 'string') return null;
  const parts = voucher.split('.');
  if (parts.length !== 2) return null;
  const [bodyEnc, sig] = parts;
  const expected = b64urlEncode(crypto.createHmac('sha256', secret).update(bodyEnc).digest());
  // Constant-time compare, and both buffers must be equal length or
  // timingSafeEqual throws — treat a length mismatch as "not valid" rather
  // than letting the exception escape to the caller.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(bodyEnc).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { signVoucher, verifyVoucher };
