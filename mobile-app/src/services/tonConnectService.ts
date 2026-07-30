/**
 * TON Connect wallet integration (Khabat, 2026-07-29: "start med TON
 * Connect først" — the safe, standard-SDK first increment of the NFT
 * fractional-ownership project scoped in `docs/realgram/TASK_SPLIT.md`
 * B→A(209). Read-only for now: lets a user connect a real TON wallet and
 * see its address. Does NOT sign or send any transaction — that's later
 * work, once an actual contract exists to call.
 *
 * Before this, the app's only TON surface was `paymentsApi.ts`'s
 * `tonkeeperLink()` — a one-way "open Tonkeeper with a prefilled jetton
 * transfer" deep link, no wallet session, no way to read a real balance.
 * This is a genuinely new capability, not an extension of that.
 *
 * Manifest hosted at `https://realgram.no/tonconnect-manifest.json`
 * (required by the TON Connect protocol so wallet apps can identify this
 * dApp) — added this session, live (this box serves realgram.no directly
 * from `/var/www/realgram`, confirmed via curl), but NOT pushed to GitHub
 * (the deploy key on this box is read-only for that repo) — someone with
 * write access should sync it into source control.
 *
 * UNVERIFIED end-to-end: this box has no way to run a real TON wallet
 * app or test the bridge handshake. `@tonconnect/sdk` + its two new
 * native-adjacent polyfill deps (`react-native-get-random-values`,
 * `buffer`, wired in `index.js`) have never been through this repo's CI —
 * flagging this as the one thing worth testing FIRST in the next build,
 * isolated if possible, since a broken polyfill could affect more than
 * just this screen.
 *
 * 2026-07-30: Khabat reported "prøvde koble til wallet men så skjer det
 * deprecated!" while testing connect. Traced why nobody could reproduce
 * or root-cause it (docs/realgram/TASK_SPLIT.md, the wallet-economy
 * thread): `onStatusChange()` takes an optional second `errorsHandler`
 * arg for exactly this — any `TonConnectError` the wallet/bridge sends
 * back during the handshake (wrong protocol version, rejected session,
 * anything) — and this file never wired it up. So whatever actually went
 * wrong on her end had zero trace anywhere: no console log, no toast
 * detail, no server-side telemetry, nothing. Same
 * instrumentation-first fix that already worked for the Live TV and SSO
 * black-spinner mysteries (see `liveTvService.ts`'s `reportFetchStage`/
 * `reportFetchFailure`) — added `reportTonStage`/`reportTonError` below,
 * wired into every stage of the connect flow including the
 * previously-silent `errorsHandler`. Doesn't fix a specific bug (still
 * don't know what she actually hit), but the next repro should land in
 * `app_events` as a `TON_CONNECT_ERROR` row with the real SDK error class
 * name + message, instead of needing another screenshot relay.
 */

import TonConnect, { Wallet, WalletInfoRemote, isWalletInfoRemote, TonConnectError } from '@tonconnect/sdk';
import { storage } from '../storage/storage';
import { trackEvent } from './analytics';
import { useAuthStore } from '../stores/authStore';

const MANIFEST_URL = 'https://realgram.no/tonconnect-manifest.json';
const PREFERRED_WALLET_APP_NAME = 'tonkeeper'; // already the app's one known TON wallet (paymentsApi.ts)

// Mirrors liveTvService.ts's reportFetchStage/reportFetchFailure — the one
// diagnostic pattern that's actually worked on this project without needing
// adb logcat access to a real device (never available here, confirmed
// repeatedly elsewhere in TASK_SPLIT.md).
function reportTonStage(stage: string, extra?: Record<string, unknown>): void {
  try {
    trackEvent('TON_CONNECT_STAGE', useAuthStore.getState().user?.deviceId, { stage, ...extra });
  } catch { /* diagnostics must never break the UI */ }
}

function reportTonError(reason: string, extra?: Record<string, unknown>): void {
  if (__DEV__) console.warn('[tonConnectService] error', reason, extra);
  try {
    trackEvent('TON_CONNECT_ERROR', useAuthStore.getState().user?.deviceId, { reason, ...extra });
  } catch { /* diagnostics must never break the UI */ }
}

function errInfo(e: unknown): { message: string; name: string } {
  const err = e as { message?: unknown; name?: unknown; constructor?: { name?: string } } | null;
  return {
    message: typeof err?.message === 'string' ? err.message : String(e),
    name: typeof err?.name === 'string' ? err.name : (err?.constructor?.name ?? 'Unknown'),
  };
}

// @tonconnect/sdk's IStorage wants Promise-returning methods; the app's own
// `storage` wrapper (MMKV-backed, falls back to an in-memory Map) is
// already synchronous — trivial wrap, not a real async boundary.
const tonConnectStorage = {
  getItem: async (key: string) => storage.getItem(key) as string | null,
  setItem: async (key: string, value: string) => { storage.setItem(key, value); },
  removeItem: async (key: string) => { storage.removeItem(key); },
};

let _connector: TonConnect | null = null;
function getConnector(): TonConnect {
  if (!_connector) {
    _connector = new TonConnect({ manifestUrl: MANIFEST_URL, storage: tonConnectStorage });
  }
  return _connector;
}

export interface TonConnectedWallet {
  address: string;      // raw address, e.g. "0:abc123..."
  addressFriendly: string; // same address, human-shortened for display
  chain: string;
  walletAppName: string;
}

function toConnectedWallet(wallet: Wallet): TonConnectedWallet {
  const address = wallet.account.address;
  const short = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return {
    address,
    addressFriendly: short,
    chain: wallet.account.chain,
    walletAppName: wallet.device.appName,
  };
}

/** Call once at app start (e.g. in a top-level effect) to rehydrate an
 *  existing session — mirrors every other service in this app that
 *  restores state on boot rather than forcing a fresh connect every time. */
export async function restoreTonConnection(): Promise<TonConnectedWallet | null> {
  try {
    const connector = getConnector();
    await connector.restoreConnection();
    return connector.connected && connector.wallet ? toConnectedWallet(connector.wallet) : null;
  } catch (e) {
    reportTonError('restore_failed', errInfo(e));
    return null;
  }
}

export function getCurrentTonWallet(): TonConnectedWallet | null {
  const connector = getConnector();
  return connector.connected && connector.wallet ? toConnectedWallet(connector.wallet) : null;
}

/** Fires whenever connect/disconnect happens (including a connect completed
 *  on a different device after scanning the QR this returns). Returns an
 *  unsubscribe function. */
export function onTonConnectionChange(callback: (wallet: TonConnectedWallet | null) => void): () => void {
  const connector = getConnector();
  return connector.onStatusChange(
    (wallet) => {
      if (wallet) reportTonStage('wallet_connected', { walletAppName: wallet.device.appName });
      callback(wallet ? toConnectedWallet(wallet) : null);
    },
    (err: TonConnectError) => {
      // Previously wired up with zero handler at all — any error the wallet/
      // bridge sent back during the handshake (wrong protocol version,
      // rejected session, anything) vanished with no trace whatsoever. This
      // is the most likely source of Khabat's unreproducible "deprecated"
      // report — see this file's header note.
      reportTonError('wallet_status_error', errInfo(err));
    },
  );
}

export type ConnectLinkResult =
  | { ok: true; universalLink: string }
  | { ok: false; error: string };

/** Fetches the real TON wallets registry and starts a connection request
 *  against the preferred wallet (Tonkeeper). Returns a universal link —
 *  the caller renders it as a QR code (cross-device) and/or opens it
 *  directly (same-device, if Tonkeeper is installed). The actual
 *  connection completion arrives asynchronously via onTonConnectionChange,
 *  not as this function's return value. */
export async function requestTonConnection(): Promise<ConnectLinkResult> {
  reportTonStage('dispatched');
  try {
    const connector = getConnector();
    const wallets = await connector.getWallets();
    const remoteWallets = wallets.filter(isWalletInfoRemote) as WalletInfoRemote[];
    reportTonStage('wallets_fetched', { count: remoteWallets.length });
    const preferred = remoteWallets.find((w) => w.appName.toLowerCase() === PREFERRED_WALLET_APP_NAME)
      ?? remoteWallets[0];
    if (!preferred) {
      reportTonError('no_wallets_available');
      return { ok: false, error: 'no_wallets_available' };
    }

    const universalLink = connector.connect({
      bridgeUrl: preferred.bridgeUrl,
      universalLink: preferred.universalLink,
    });
    reportTonStage('connect_link_generated', { walletAppName: preferred.appName });
    return { ok: true, universalLink };
  } catch (e) {
    reportTonError('connect_request_failed', errInfo(e));
    return { ok: false, error: 'connect_request_failed' };
  }
}

export async function disconnectTonWallet(): Promise<void> {
  try {
    await getConnector().disconnect();
  } catch { /* already disconnected or never connected — nothing to clean up */ }
}
