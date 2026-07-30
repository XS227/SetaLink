import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useTapEnergy — stamina/cooldown for the Home tap coin (Khabat, 2026-07-30:
 * "det er glemt med power, stamina info fra shahnameh tap functions. det må
 * vi få lagt inn i realgram også. så det blir litt cool down på og mye
 * tapping"). Mirrors the mechanic already spec'd and shipped in the
 * Shahnameh web game's own tap screen (`docs/realgram/design/theme-package/
 * screens/01-home.html`'s energy bar JS): max pool 2000, -1 per tap, +1
 * regen every 300ms tick (~3.3/sec passive regen).
 *
 * Deliberately client-local, not server-synced — the Shahnameh backend's
 * `current_energy`/`energy_max` (Season2User schema, see docs/realgram/
 * TASK_SPLIT.md) belongs to the separate web game's own tap flow; wiring
 * Home's RealCoin to that same server field would need a new contract this
 * session didn't verify exists for the VPN-side tap. This is the same
 * mechanic, kept independent, so it never claims a server-authoritative
 * number it doesn't have.
 *
 * Khabat, 2026-07-30 (test-120): "stamina ser ut til å ikke bli mindre, jo
 * mer jeg tapper?" — real bug, not a perception thing: the original numbers
 * here (max 2000, -1/tap, +1 regen every 300ms) were copied straight from
 * the theme-package HTML mockup's own JS (`01-home.html`, verified — same
 * three numbers there), but that mockup was never played at a real human tap
 * cadence. Passive regen alone is +1 per 300ms ≈ 3.3/sec, which already
 * matches or beats any sustained manual tap rate, so net drain was ~zero (or
 * even net-positive on a slow tap cadence) for anyone tapping less than
 * ~3.3 times/sec — and at max 2000, a single tap moves the pct bar by 0.05%,
 * invisible either way. Rebalanced so a realistic tap burst visibly drains
 * the bar (a real "cooldown" instead of a number that never moves): smaller
 * pool so single-tap movement is visible, spend clearly above any plausible
 * passive-regen rate, slower regen so idle recovery takes a real pause
 * rather than out-regenerating the user's own thumb.
 */

const MAX_ENERGY = 100;
const SPEND_PER_TAP = 3;
const REGEN_PER_TICK = 1;
const TICK_MS = 600;

export function useTapEnergy() {
  const [energy, setEnergy] = useState(MAX_ENERGY);
  const energyRef = useRef(MAX_ENERGY);

  useEffect(() => {
    const id = setInterval(() => {
      if (energyRef.current < MAX_ENERGY) {
        energyRef.current = Math.min(MAX_ENERGY, energyRef.current + REGEN_PER_TICK);
        setEnergy(energyRef.current);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** Returns false (and spends nothing) when the pool is empty. */
  const spend = useCallback(() => {
    if (energyRef.current < SPEND_PER_TAP) return false;
    energyRef.current = Math.max(0, energyRef.current - SPEND_PER_TAP);
    setEnergy(energyRef.current);
    return true;
  }, []);

  return { energy, maxEnergy: MAX_ENERGY, pct: energy / MAX_ENERGY, spend };
}
