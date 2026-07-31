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
 *
 * 2026-07-31: took a `maxEnergy` param instead of a hardcoded constant —
 * energyTierService.ts's paid upgrade tiers (1k/2k/3k/5k/8k, ﷼) change the
 * pool size at runtime. Spend/regen stay ratio-based (3%/tap, 1%/tick,
 * same feel as the 2026-07-30 rebalance at every tier) rather than fixed
 * amounts, so a bigger pool doesn't accidentally drain faster or slower in
 * relative terms — a tier buys a longer session, not a different feel.
 */
const SPEND_RATIO = 0.03;
const REGEN_RATIO = 0.01;
const TICK_MS = 600;

export function useTapEnergy(maxEnergy: number) {
  const [energy, setEnergy] = useState(maxEnergy);
  const energyRef = useRef(maxEnergy);
  const maxRef = useRef(maxEnergy);

  // Tier upgrade changes maxEnergy at runtime — raise the ceiling without
  // resetting whatever energy the player currently has (a top-up-to-full
  // reset would be a stealth nerf for anyone who upgrades mid-session with
  // a partly-drained bar).
  useEffect(() => {
    maxRef.current = maxEnergy;
    if (energyRef.current > maxEnergy) {
      energyRef.current = maxEnergy;
      setEnergy(maxEnergy);
    }
  }, [maxEnergy]);

  useEffect(() => {
    const id = setInterval(() => {
      const max = maxRef.current;
      const regen = Math.max(1, Math.round(max * REGEN_RATIO));
      if (energyRef.current < max) {
        energyRef.current = Math.min(max, energyRef.current + regen);
        setEnergy(energyRef.current);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** Returns false (and spends nothing) when the pool is empty. */
  const spend = useCallback(() => {
    const cost = Math.max(1, Math.round(maxRef.current * SPEND_RATIO));
    if (energyRef.current < cost) return false;
    energyRef.current = Math.max(0, energyRef.current - cost);
    setEnergy(energyRef.current);
    return true;
  }, []);

  return { energy, maxEnergy, pct: maxEnergy > 0 ? energy / maxEnergy : 0, spend };
}
