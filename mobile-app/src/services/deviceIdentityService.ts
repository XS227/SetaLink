import { storage } from '../storage/storage';

const DEVICE_ID_KEY = 'setalink_device_id_v1';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Try to get the Android hardware ID for stable 1-device-per-account enforcement.
// Falls back to a generated UUID stored in MMKV (persists until app data cleared).
async function tryGetAndroidId(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const mod = NativeModules?.XrayModule;
    if (!mod?.getAndroidId) return null;
    const id: string = await mod.getAndroidId();
    return id && id.length > 4 ? `android-${id}` : null;
  } catch {
    return null;
  }
}

export function getOrCreateDeviceId(): string {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing && typeof existing === 'string') return existing;
  const id = generateUUID();
  storage.setItem(DEVICE_ID_KEY, id);
  return id;
}

// Call once at boot to enrich device ID with hardware identifier if available.
// Replaces the random UUID with an Android-ID-derived ID on first enrichment.
export async function enrichDeviceId(): Promise<string> {
  const current = getOrCreateDeviceId();
  // Already enriched with hardware ID
  if (current.startsWith('android-')) return current;
  const androidId = await tryGetAndroidId();
  if (androidId) {
    storage.setItem(DEVICE_ID_KEY, androidId);
    return androidId;
  }
  return current;
}
