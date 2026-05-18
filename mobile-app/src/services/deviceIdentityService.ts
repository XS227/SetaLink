import { storage } from '../storage/storage';

const DEVICE_ID_KEY = 'setalink_device_id_v1';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getOrCreateDeviceId(): string {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing && typeof existing === 'string') return existing;
  const id = generateUUID();
  storage.setItem(DEVICE_ID_KEY, id);
  return id;
}
