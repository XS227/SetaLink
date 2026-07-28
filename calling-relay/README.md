# calling-relay

Stateless WebRTC signaling relay for RealGram audio calling. Holds no
database — `lib/calling.php` (in the SetaLink PHP backend) is the source of
truth for whether a call is allowed to exist; this process only routes
signaling messages between two voucher-authenticated sockets.

## Status (2026-07-28)

- `voucher.js` — done, tested (`test-voucher.js`, 10/10 passing, including a
  fixture verifying a real PHP-signed voucher decodes correctly here).
- `presence.js` — done, tested (`test-presence.js`, 15/15 passing).
- `server.js` — written, **not yet run**. Needs `npm install` (this box
  can't run installs/builds per house rules — hand off to Khabat, or run on
  `fi-hel` once that's accessible). `node --check` passes (syntax only,
  doesn't resolve `require('ws')`).

## Running

```
npm install
CALLING_RELAY_SECRET=<same value as SetaLink's calling.relay_secret setting> \
CALLING_RELAY_INTERNAL_SECRET=<random, only shared with the PHP side> \
CALLING_RELAY_PORT=8095 \
CALLING_RELAY_INTERNAL_PORT=8096 \
npm start
```

`CALLING_RELAY_PORT` is the one nginx should reverse-proxy to (public
`wss://` path). `CALLING_RELAY_INTERNAL_PORT` must never be nginx-proxied —
it's how PHP pushes `call:incoming` to an already-connected device and is
protected only by `CALLING_RELAY_INTERNAL_SECRET`, not a voucher.

Both secrets need to land in SetaLink's `calling` service-config row (see
`call_service_config()` in `lib/calling.php`) so PHP mints vouchers the
relay will actually accept.

## Why two secrets

- `CALLING_RELAY_SECRET` signs/verifies per-connection **vouchers**
  (presence tokens, caller/callee call vouchers) — these are handed to the
  mobile app and travel over the public WS connection.
- `CALLING_RELAY_INTERNAL_SECRET` guards the internal push hook that only
  PHP calls, on a port that's never exposed publicly. Keeping it separate
  means a leaked voucher secret (e.g. via a compromised app binary, since
  vouchers are inherently client-visible) doesn't also grant push access.
