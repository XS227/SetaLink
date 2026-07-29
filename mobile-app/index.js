// Polyfills for @tonconnect/sdk (2026-07-29, TON Connect wallet integration)
// — must run before any module imports the SDK, since it constructs crypto
// primitives (ed25519 keypairs, session encryption) at module load. Hermes
// (RN 0.75) already provides TextEncoder/TextDecoder natively, so those
// don't need polyfilling here.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
if (!global.Buffer) global.Buffer = Buffer;

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
