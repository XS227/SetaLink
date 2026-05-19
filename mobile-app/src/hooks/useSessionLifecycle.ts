import { useVpnStore } from '../stores/vpnStore';

// Traffic byte accumulation is now handled by the global poller in MainTabs
// (AppNavigator) via native getStats(), which updates vpnStore.sessionBytes.
// This hook is kept as a no-op to preserve the import in HomeScreen.
export function useSessionLifecycle(): void {
  // Intentionally empty — do not remove import from HomeScreen.
  void useVpnStore; // reference to prevent tree-shaking warnings
}
