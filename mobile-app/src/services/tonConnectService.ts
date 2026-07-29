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
 */

import TonConnect, { Wallet, WalletInfoRemote, isWalletInfoRemote } from '@tonconnect/sdk';
import { storage } from '../storage/storage';

const MANIFEST_URL = 'https://realgram.no/tonconnect-manifest.json';
const PREFERRED_WALLET_APP_NAME = 'tonkeeper'; // already the app's one known TON wallet (paymentsApi.ts)

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
  } catch {
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
  return connector.onStatusChange((wallet) => {
    callback(wallet ? toConnectedWallet(wallet) : null);
  });
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
  try {
    const connector = getConnector();
    const wallets = await connector.getWallets();
    const remoteWallets = wallets.filter(isWalletInfoRemote) as WalletInfoRemote[];
    const preferred = remoteWallets.find((w) => w.appName.toLowerCase() === PREFERRED_WALLET_APP_NAME)
      ?? remoteWallets[0];
    if (!preferred) return { ok: false, error: 'no_wallets_available' };

    const universalLink = connector.connect({
      bridgeUrl: preferred.bridgeUrl,
      universalLink: preferred.universalLink,
    });
    return { ok: true, universalLink };
  } catch {
    return { ok: false, error: 'connect_request_failed' };
  }
}

export async function disconnectTonWallet(): Promise<void> {
  try {
    await getConnector().disconnect();
  } catch { /* already disconnected or never connected — nothing to clean up */ }
}
