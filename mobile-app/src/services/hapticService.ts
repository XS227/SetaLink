// Haptic feedback wrapper — isolates react-native-haptic-feedback from callers.
// All methods are no-ops when the native module is not linked.

const OPTIONS = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

function trigger(type: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const HapticFeedback = require('react-native-haptic-feedback').default;
    HapticFeedback.trigger(type, OPTIONS);
  } catch {
    // Native module not linked — silently skip
  }
}

export const HapticService = {
  /** Heavy confirmation — VPN tunnel established */
  connect:    () => trigger('notificationSuccess'),

  /** Light tap — VPN tunnel closed cleanly */
  disconnect: () => trigger('impactLight'),

  /** Error vibration — connection failed */
  error:      () => trigger('notificationError'),

  /** Selection tick — server row tap */
  select:     () => trigger('selection'),

  /** Medium tap — toggle switches */
  toggle:     () => trigger('impactMedium'),
};
