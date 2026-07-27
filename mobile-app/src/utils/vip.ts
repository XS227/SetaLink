import type { MilestoneProgress } from '../services/entitlementService';

// Must match ProfileScreen.tsx's FALLBACK_MILESTONES 'vip' entry (21 invites)
// -- used only when the server hasn't returned milestone data yet.
const VIP_FALLBACK_COUNT = 21;

/**
 * Whether a user has reached the "vip" referral milestone (2026-07-20).
 * Server-driven when milestone data is available (checks the real
 * `rewardKey: 'vip'` entry, not just invite count, so admin-side milestone
 * changes don't need a client update); falls back to the same invite-count
 * threshold ProfileScreen.tsx's own fallback ladder uses otherwise.
 */
export function isVipUser(inviteCount: number, milestones: MilestoneProgress | null): boolean {
  if (milestones) return milestones.milestones.some((m) => m.rewardKey === 'vip' && m.reached);
  return inviteCount >= VIP_FALLBACK_COUNT;
}
