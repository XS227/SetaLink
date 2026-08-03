/**
 * Vibration API wrapper for mobile tap feedback. This is the only
 * cross-browser haptics primitive the web has — no vendor prefix, no
 * permission prompt, just `navigator.vibrate`. It's Android-only in
 * practice (iOS Safari has never implemented it); calls silently no-op
 * everywhere else, so this is safe to sprinkle across every mobile
 * component without a platform check at each call site.
 *
 * Also respects `prefers-reduced-motion` — a user who's told the OS they
 * don't want motion effects almost certainly doesn't want buzzing either,
 * and every other animation in this app already honors that signal.
 */
export type HapticIntensity = "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticIntensity, number | number[]> = {
  light: 8,
  medium: 18,
  success: [10, 40, 10],
  warning: [16, 40, 16, 40, 16],
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function triggerHaptic(intensity: HapticIntensity = "light"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (prefersReducedMotion()) return;
  navigator.vibrate(PATTERNS[intensity]);
}
