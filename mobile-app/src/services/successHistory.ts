/**
 * Persistent profile success history — backed by MMKV.
 * Records which profiles connected successfully, their latency, and timestamp.
 * Used by autoConnector to sort profiles by historical success rate.
 */

import { storage, syncGet } from '../storage/storage';

const HISTORY_KEY = 'profile_success_history_v2';
const MAX_RECORDS = 200;

export interface ProfileRecord {
  successCount: number;
  failCount:    number;
  lastSuccess:  number; // ms timestamp
  lastFailure:  number;
  latencySum:   number;
  sni:          string;
  protocol:     string;
}

type HistoryMap = Record<string, ProfileRecord>;

function loadHistory(): HistoryMap {
  try {
    const raw = syncGet(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as HistoryMap;
  } catch {}
  return {};
}

function saveHistory(h: HistoryMap): void {
  try { storage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}

export function recordSuccess(profileId: string, latencyMs: number, sni: string, protocol: string): void {
  const h = loadHistory();
  const rec = h[profileId] ?? { successCount: 0, failCount: 0, lastSuccess: 0, lastFailure: 0, latencySum: 0, sni, protocol };
  rec.successCount++;
  rec.lastSuccess = Date.now();
  rec.latencySum += latencyMs;
  rec.sni = sni;
  rec.protocol = protocol;
  h[profileId] = rec;
  // Prune if too large
  const keys = Object.keys(h);
  if (keys.length > MAX_RECORDS) {
    const oldest = keys.sort((a, b) => (h[a]!.lastSuccess || 0) - (h[b]!.lastSuccess || 0));
    delete h[oldest[0]!];
  }
  saveHistory(h);
}

export function recordFailure(profileId: string, sni: string, protocol: string): void {
  const h = loadHistory();
  const rec = h[profileId] ?? { successCount: 0, failCount: 0, lastSuccess: 0, lastFailure: 0, latencySum: 0, sni, protocol };
  rec.failCount++;
  rec.lastFailure = Date.now();
  h[profileId] = rec;
  saveHistory(h);
}

export function getSuccessRate(profileId: string): number {
  const h = loadHistory();
  const rec = h[profileId];
  if (!rec) return 0.5; // neutral for untested profiles
  const total = rec.successCount + rec.failCount;
  if (total === 0) return 0.5;
  return rec.successCount / total;
}

export function getAvgLatency(profileId: string): number {
  const h = loadHistory();
  const rec = h[profileId];
  if (!rec || rec.successCount === 0) return 99_999;
  return rec.latencySum / rec.successCount;
}

/** Sort a list of profileIds: highest success rate first, then lowest latency. */
export function sortByHistory(profileIds: string[]): string[] {
  return [...profileIds].sort((a, b) => {
    const rateA = getSuccessRate(a);
    const rateB = getSuccessRate(b);
    if (Math.abs(rateA - rateB) > 0.1) return rateB - rateA; // prefer higher rate
    return getAvgLatency(a) - getAvgLatency(b); // tiebreak by latency
  });
}

export function getTopProfiles(n = 3): Array<{ id: string; sni: string; protocol: string; rate: number }> {
  const h = loadHistory();
  return Object.entries(h)
    .filter(([, r]) => r.successCount > 0)
    .map(([id, r]) => ({
      id, sni: r.sni, protocol: r.protocol,
      rate: r.successCount / (r.successCount + r.failCount),
    }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, n);
}

export function clearHistory(): void {
  storage.removeItem(HISTORY_KEY);
}
