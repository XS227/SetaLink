import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement matchMedia. Default to "no match" (desktop) so
// existing tests render the desktop tree unchanged; mobile tests override
// window.matchMedia per-test to exercise useIsMobile's mobile branch.
// jsdom also doesn't implement scrollTo — framer-motion's "auto" height
// measurement (the tasks/stepper accordions) probes for it and jsdom logs a
// noisy "not implemented" error to stderr otherwise. Harmless in a real
// browser; silenced here so it doesn't look like a test failure.
window.scrollTo = () => undefined;

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
