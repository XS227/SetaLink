// Polyfills for @tonconnect/sdk (2026-07-29, TON Connect wallet integration)
// — must run before any module imports the SDK, since it constructs crypto
// primitives (ed25519 keypairs, session encryption) at module load. Hermes
// (RN 0.75) already provides TextEncoder/TextDecoder natively, so those
// don't need polyfilling here.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
if (!global.Buffer) global.Buffer = Buffer;
// Khabat, 2026-07-31: "det gikk ikke å koble til min tonkeeper" — root
// cause found live in app_events (TON_CONNECT_ERROR, both her 07-30 and
// 07-31 attempts): "URL.protocol is not implemented". RN/Hermes ships a
// `URL` global that exists but only implements a fraction of the real
// spec — @tonconnect/sdk builds/parses bridge URLs and hits exactly the
// unimplemented part. Needs the same "polyfill before the SDK ever loads"
// treatment as the crypto polyfills above; react-native-url-polyfill/auto
// replaces global.URL/URLSearchParams with a real implementation as a
// side effect of being imported, so it only needs to run first, not be
// referenced directly.
import 'react-native-url-polyfill/auto';

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
