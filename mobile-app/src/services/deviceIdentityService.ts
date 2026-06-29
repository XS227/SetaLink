import { storage } from '../storage/storage';

const STABLE_KEY = 'setalink_stable_device_id';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Persist the canonical device ID returned by the backend (deduplication).
export async function saveStableDeviceId(deviceId: string): Promise<void> {
  storage.setItem(STABLE_KEY, deviceId);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    await NativeModules?.XrayModule?.saveStableDeviceId?.(deviceId);
  } catch {}
}

// Returns a stable device ID that survives app restarts, OTA updates, and
// TestFlight reinstalls.
// Source priority: Keychain (via native) → MMKV mirror → random UUID fallback.
// Migration: if MMKV already has an ID from a pre-Keychain build, we write it
// to Keychain before calling getOrCreateStableDeviceId so the native side finds
// it and returns it unchanged rather than generating a new UUID.
export async function getStableDeviceId(): Promise<string> {
  const mmkvId = storage.getItem(STABLE_KEY);
  const hasMmkv = typeof mmkvId === 'string' && (mmkvId as string).length > 4;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const mod = NativeModules?.XrayModule;
    if (mod?.getOrCreateStableDeviceId) {
      // Seed Keychain with the MMKV value so the first run after an OTA upgrade
      // from a pre-Keychain build doesn't generate a new ID.
      if (hasMmkv && mod?.saveStableDeviceId) {
        try { await mod.saveStableDeviceId(mmkvId as string); } catch {}
      }
      const nativeId: string = await mod.getOrCreateStableDeviceId();
      if (nativeId && nativeId.length > 4) {
        storage.setItem(STABLE_KEY, nativeId);
        return nativeId;
      }
    }
  } catch {}

  if (hasMmkv) return mmkvId as string;

  const id = `sl-${generateUUID()}`;
  storage.setItem(STABLE_KEY, id);
  return id;
}

// Returns hardware fingerprint metadata for registration.
export async function getDeviceFingerprint(): Promise<Record<string, string | number>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const mod = NativeModules?.XrayModule;
    if (mod?.getDeviceFingerprint) return await mod.getDeviceFingerprint();
    if (mod?.getDeviceInfo)        return await mod.getDeviceInfo();
  } catch {}
  return {};
}

// Legacy sync read — returns the MMKV mirror (populated after first async call).
export function getOrCreateDeviceId(): string {
  const v = storage.getItem(STABLE_KEY);
  if (v && typeof v === 'string' && v.length > 4) return v;
  const id = `sl-${generateUUID()}`;
  storage.setItem(STABLE_KEY, id);
  return id;
}

// Legacy async compat — delegates to getStableDeviceId.
export async function enrichDeviceId(): Promise<string> {
  return getStableDeviceId();
}
