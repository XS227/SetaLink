import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerHaptic } from "../services/haptics";

describe("triggerHaptic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error — jsdom doesn't define this by default; clean up whatever a test added.
    delete navigator.vibrate;
  });

  it("calls navigator.vibrate with the pattern for the given intensity", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    triggerHaptic("light");
    expect(vibrate).toHaveBeenCalledWith(8);

    triggerHaptic("medium");
    expect(vibrate).toHaveBeenCalledWith(18);

    triggerHaptic("success");
    expect(vibrate).toHaveBeenCalledWith([10, 40, 10]);

    triggerHaptic("warning");
    expect(vibrate).toHaveBeenCalledWith([16, 40, 16, 40, 16]);
  });

  it("defaults to light when no intensity is given", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    triggerHaptic();
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("does nothing when the Vibration API isn't available (e.g. iOS Safari)", () => {
    // @ts-expect-error — simulate a browser with no navigator.vibrate at all.
    delete navigator.vibrate;
    expect(() => triggerHaptic("light")).not.toThrow();
  });

  it("does nothing when the user prefers reduced motion", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    );

    triggerHaptic("light");
    expect(vibrate).not.toHaveBeenCalled();
  });
});
