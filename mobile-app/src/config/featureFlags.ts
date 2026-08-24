// Centralized, cheap/reversible feature flags that more than one independent
// screen needs to agree on — kept here instead of duplicated local consts so
// they can't silently drift out of sync (found exactly that happening,
// 2026-07-29: AppNavigator.tsx's CallManager had its own CALLING_ENABLED, but
// InboxScreen.tsx's thread header computed `canCall` from plan/testMode only
// and never checked it, so the call button kept showing — and doing nothing
// but toast — while calling was supposedly off app-wide).

// Khabat, 2026-07-29: was disabled while the Profile flash/jam was
// investigated. Root cause found and fixed in (196) (useT()'s unmemoized
// `t`), unrelated to calling — CallManager is mounted at the AppNavigator
// root, not scoped to Profile. Left off past that fix landing (v0.9.108)
// since re-enabling wasn't part of the original ask — Khabat noticed the
// call button missing from v0.9.110 and flagged it, same "re-enable once
// cleared" call already made for Live TV in (199). Re-enabled.
//
// 2026-08-24: react-native-webrtc has no Windows implementation (confirmed,
// no plan to add one — github.com/react-native-webrtc/react-native-webrtc
// issue #952). RealGram for Windows is chat-only for this reason — excluded
// here, the single choke point both CallManager and InboxScreen's call
// button already read, rather than adding a Platform.OS check to each.
import { Platform } from 'react-native';
export const CALLING_ENABLED = true && Platform.OS !== 'windows';

// Screen sharing in RealGram calls -- Khabat's 2026-08-01 spec, §9: "ikke
// publiser direkte til alle brukere. Bygg først en intern testversjon."
// Unlike CALLING_ENABLED this isn't a build-time const -- it's remote-config
// gated (realtime_screen_sharing_enabled on the server) so it can go from
// "off for everyone" to "on for the internal test build's testers" without
// a new release, same rollout mechanism already proven for
// ecosystem.wallet_enabled (see RealWalletCard.tsx's own comment on why).
import { getCachedConfig } from '../services/remoteConfigService';

/** Synchronous snapshot of the last-fetched remote config -- same caveat as
 *  every other getCachedConfig() read in this app: reflects whichever
 *  getRemoteConfig() call last completed, not necessarily "right now".
 *  Default OFF (undefined/false) until the server flips it. */
export function isScreenShareEnabled(): boolean {
  return getCachedConfig()?.realtime_screen_sharing_enabled === true;
}
