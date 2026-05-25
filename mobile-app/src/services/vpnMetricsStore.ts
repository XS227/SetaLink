import { Platform } from 'react-native';
import { storage, syncGet } from '../storage/storage';

const KEY = 'vpn.metrics.events.v1';

export function appendMetric(event: Record<string, unknown>): void {
  try {
    const raw = syncGet(KEY);
    const prev = raw ? JSON.parse(raw) as Record<string, unknown>[] : [];
    const next = [...prev.slice(-499), { ...event, androidVersion: Platform.Version, os: Platform.OS }];
    storage.setItem(KEY, JSON.stringify(next));
  } catch {}
}
