/**
 * GameScreen — the Game tab's Shahnameh embed.
 *
 * All identity/gate/WebView logic lives in ShahnamehEmbed (extracted
 * 2026-07-19 so the Profile tab can reuse the exact same hardened embed —
 * see components/ShahnamehEmbed.tsx for the full contract/history). This
 * file only owns what's specific to the Game tab: kicking off Shahnameh's
 * tap-sync flush timer once deviceId is known.
 */

import React, { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { initZarSync } from '../services/zarSyncService';
import { ShahnamehEmbed } from '../components/ShahnamehEmbed';

export function GameScreen() {
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');

  // Server-synced ZAR (contract §8, REALGRAM_UNIFIED_PLATFORM.md §B):
  // starts Shahnameh's tap-sync flush timer once deviceId is known. Also
  // piggybacks tapAnalytics' own init (see zarSyncService.ts) — kept even
  // though the native tap-to-earn card is gone (2026-07-19 redesign), since
  // this is that system's only wiring point and taps now happen inside the
  // embedded Shahnameh page itself, which still goes through this same
  // buffered sync path server-side.
  useEffect(() => {
    if (deviceId) initZarSync(deviceId);
  }, [deviceId]);

  return <ShahnamehEmbed path="/" debugLabel="game" />;
}
