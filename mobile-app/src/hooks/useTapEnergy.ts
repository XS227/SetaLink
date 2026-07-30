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
 */

const MAX_ENERGY = 2000;
const SPEND_PER_TAP = 1;
const REGEN_PER_TICK = 1;
const TICK_MS = 300;

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
