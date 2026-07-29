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
export const CALLING_ENABLED = true;
