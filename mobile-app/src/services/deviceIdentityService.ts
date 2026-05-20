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

// Returns a stable device ID that survives app restarts, reconnects, and updates.
// Source priority: SharedPreferences (native) → MMKV mirror → random UUID fallback.
// Generated once only — never replaced after first creation.
export async function getStableDeviceId(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const mod = NativeModules?.XrayModule;
    if (mod?.getOrCreateStableDeviceId) {
      const nativeId: string = await mod.getOrCreateStableDeviceId();
      if (nativeId && nativeId.length > 4) {
        storage.setItem(STABLE_KEY, nativeId);
        return nativeId;
      }
    }
  } catch {}

  const existing = storage.getItem(STABLE_KEY);
  if (existing && typeof existing === 'string' && existing.length > 4) return existing;

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
