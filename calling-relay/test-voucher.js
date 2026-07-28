'use strict';
/**
 * Plain node+assert tests for voucher.js, matching the shahnameh-backend
 * lib/*Parser.js test convention (test-m3u-parser.js, test-live-tv-health.js).
 * Run with: node calling-relay/test-voucher.js
 */

const assert = require('assert');
const { signVoucher, verifyVoucher } = require('./voucher.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

check('round-trips a payload', () => {
  const v = signVoucher('s3cret', { role: 'caller', call_id: 'abc', device_id: 'dev-1' });
  const decoded = verifyVoucher('s3cret', v);
  assert.ok(decoded);
  assert.strictEqual(decoded.role, 'caller');
  assert.strictEqual(decoded.call_id, 'abc');
  assert.strictEqual(decoded.device_id, 'dev-1');
});

check('defaults exp to now+60s when not supplied', () => {
  const before = Math.floor(Date.now() / 1000);
  const v = signVoucher('s3cret', { role: 'callee', call_id: 'x', device_id: 'y' });
  const decoded = verifyVoucher('s3cret', v);
  assert.ok(decoded.exp >= before + 59 && decoded.exp <= before + 61);
});

check('rejects a tampered body', () => {
  const v = signVoucher('s3cret', { role: 'caller', call_id: 'abc', device_id: 'dev-1' });
  const [body, sig] = v.split('.');
  const decodedBody = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  decodedBody.device_id = 'dev-attacker';
  const tamperedBody = Buffer.from(JSON.stringify(decodedBody)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(verifyVoucher('s3cret', `${tamperedBody}.${sig}`), null);
});

check('rejects a tampered signature', () => {
  const v = signVoucher('s3cret', { role: 'caller', call_id: 'abc', device_id: 'dev-1' });
  const [body] = v.split('.');
  assert.strictEqual(verifyVoucher('s3cret', `${body}.notarealsignature`), null);
});

check('rejects the wrong secret', () => {
  const v = signVoucher('s3cret', { role: 'caller', call_id: 'abc', device_id: 'dev-1' });
  assert.strictEqual(verifyVoucher('wrong-secret', v), null);
});

check('rejects an expired voucher', () => {
  const v = signVoucher('s3cret', { role: 'caller', call_id: 'abc', device_id: 'dev-1', exp: Math.floor(Date.now() / 1000) - 5 });
  assert.strictEqual(verifyVoucher('s3cret', v), null);
});

check('rejects malformed voucher strings', () => {
  assert.strictEqual(verifyVoucher('s3cret', ''), null);
  assert.strictEqual(verifyVoucher('s3cret', 'no-dot-here'), null);
  assert.strictEqual(verifyVoucher('s3cret', 'a.b.c'), null);
  assert.strictEqual(verifyVoucher('s3cret', null), null);
  assert.strictEqual(verifyVoucher('s3cret', undefined), null);
});

check('rejects an empty secret', () => {
  const v = signVoucher('s3cret', { role: 'caller', call_id: 'abc', device_id: 'dev-1' });
  assert.strictEqual(verifyVoucher('', v), null);
});

check('rejects non-JSON body even with a valid-looking signature', () => {
  const crypto = require('crypto');
  const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = b64url(Buffer.from('not json'));
  const sig = b64url(crypto.createHmac('sha256', 's3cret').update(body).digest());
  assert.strictEqual(verifyVoucher('s3cret', `${body}.${sig}`), null);
});

check('cross-language fixture: verifies a voucher signed by PHP call_sign_voucher()', () => {
  // Generated once via: php -r 'require "lib/calling.php"; echo call_sign_voucher("fixture-secret", ["role"=>"caller","call_id"=>"fixture-call","device_id"=>"fixture-dev","exp"=>2000000000]);'
  // Regenerate this fixture if either side's encoding scheme ever changes.
  const phpVoucher = 'eyJyb2xlIjoiY2FsbGVyIiwiY2FsbF9pZCI6ImZpeHR1cmUtY2FsbCIsImRldmljZV9pZCI6ImZpeHR1cmUtZGV2IiwiZXhwIjoyMDAwMDAwMDAwfQ.C11V902kinqntzGzKICNsYL3rpfx0j-hTly2cqSZlI4';
  const decoded = verifyVoucher('fixture-secret', phpVoucher);
  assert.ok(decoded, 'PHP-signed voucher must verify in Node');
  assert.strictEqual(decoded.role, 'caller');
  assert.strictEqual(decoded.call_id, 'fixture-call');
  assert.strictEqual(decoded.device_id, 'fixture-dev');
});

console.log(`\n${passed} test(s) passed`);
