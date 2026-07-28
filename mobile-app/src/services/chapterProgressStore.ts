/**
 * Local per-chapter scene-read progress for the native chapter detail
 * screen (A→B(124)). Mirrors season2's own chapter.js, which persists
 * scene-read state in localStorage (`real_chapter_progress_${SLUG}`), not
 * server-side — scene unlocking is a client-only reading gate here too,
 * same behavior as the WebView version. Quiz/battle progress stays
 * server-side (season2/user/quiz/*) and out of scope for this screen.
 */

import { storage, syncGet } from '../storage/storage';

function key(slug: string): string {
  return `real_chapter_progress_v1_${slug}`;
}

export function getReadSceneIds(slug: string): Set<string> {
  const raw = syncGet(key(slug));
  if (!raw) return new Set();
  try { return new Set(JSON.parse(raw) as string[]); } catch { return new Set(); }
}

export function markSceneRead(slug: string, sceneId: string): Set<string> {
  const ids = getReadSceneIds(slug);
  ids.add(sceneId);
  storage.setItem(key(slug), JSON.stringify(Array.from(ids)));
  return ids;
}

/** Scene 1 is always open; scene N+1 unlocks once scene N has been read. */
export function isSceneUnlocked(order: number, readIds: Set<string>, scenes: { id: string; order: number }[]): boolean {
  if (order <= 1) return true;
  const prev = scenes.find((s) => s.order === order - 1);
  return !!prev && readIds.has(prev.id);
}
