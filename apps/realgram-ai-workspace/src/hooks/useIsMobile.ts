import { useEffect, useState } from "react";

/** Single source of truth for where the mobile experience takes over. Above
 * this, the existing floating-panes desktop layout renders unchanged; at or
 * below it, App.tsx mounts an entirely separate component tree (src/components/mobile)
 * instead of trying to reflow the desktop DOM with media queries. */
export const MOBILE_BREAKPOINT = 900;

export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return isMobile;
}
