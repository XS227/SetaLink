import type { StateStorage } from 'zustand/middleware';

// Lazily initialized MMKV-backed storage adapter for zustand persist.
// Falls back to a synchronous in-memory Map when react-native-mmkv native
// module is not linked (Jest, pre-build dev, Storybook).
// Swap: once the Android native module is linked, MMKV is used automatically.

let _storage: StateStorage | null = null;

function resolve(): StateStorage {
  if (_storage) return _storage;

  try {
    // Dynamic require so the import doesn't throw at module parse time
    // in environments without the native module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    const mmkv = new MMKV({ id: 'setalink-v1' });
    _storage = {
      getItem:    (key) => mmkv.getString(key) ?? null,
      setItem:    (key, value) => mmkv.set(key, value),
      removeItem: (key) => mmkv.delete(key),
    };
  } catch {
    const map = new Map<string, string>();
    _storage = {
      getItem:    (key) => map.get(key) ?? null,
      setItem:    (key, value) => { map.set(key, value); },
      removeItem: (key) => { map.delete(key); },
    };
  }

  return _storage;
}

export const storage: StateStorage = {
  getItem:    (key) => resolve().getItem(key),
  setItem:    (key, value) => resolve().setItem(key, value),
  removeItem: (key) => resolve().removeItem(key),
};
