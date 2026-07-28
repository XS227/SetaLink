/**
 * Earn — daily check-in, social tasks, partner tasks, referral milestones
 * (`docs/realgram/TASK_SPLIT.md` A→B(125) roadmap: Earn).
 *
 * Unlike Heroes (A->B(135) — a real data-model mismatch between what's
 * browsable and what's purchasable), task/milestone/checkin-reward
 * DEFINITIONS here are read straight off `season2/earn.js` itself
 * (SOCIAL_TASKS/PARTNERS/MILESTONES/CHECKIN_REWARDS — small, static,
 * hardcoded client-side there too, not a separate fetched catalog), so
 * there's no disjoint-system risk: the `task_id`/`milestone` values below
 * are exactly what `/api/season2/earn/*` already expects, read from the
 * same source of truth the WebView version uses.
 *
 * Progress state (completed_tasks/milestones_claimed/verified_referral_
 * count/checkin_streak) already exists via realGramProfileService.ts's
 * contract §9 — reused here rather than a second call to
 * `/api/season2/user/me`. Only the 3 action endpoints (checkin/complete-
 * task/claim-milestone) are new, keyed on telegram_id per B->A(132).
 */

export interface EarnTask {
  id:          string;
  label:       string;
  sublabel:    string;
  icon:        string;
  url:         string;
  reward_real: number;
  reward_gems: number;
}

export const SOCIAL_TASKS: EarnTask[] = [
  { id: 'follow_tg_channel',  label: 'Follow Official Channel', sublabel: '@Shahnameh_news',       icon: '✈',  url: 'https://t.me/Shahnameh_news',                    reward_real: 2500, reward_gems: 0 },
  { id: 'join_tg_support',    label: 'Join Persian Community',  sublabel: '@shahnameh_persian',     icon: '✈',  url: 'https://t.me/shahnameh_persian',                 reward_real: 2500, reward_gems: 0 },
  { id: 'follow_x',           label: 'Follow on X',             sublabel: '@shahnamehgamefi',       icon: '𝕏',  url: 'https://x.com/shahnamehgamefi',                  reward_real: 3000, reward_gems: 0 },
  { id: 'follow_tiktok',      label: 'Follow REAL Page',        sublabel: '@shahnamehgamefi227',    icon: '♬',  url: 'https://www.tiktok.com/@shahnamehgamefi227',     reward_real: 2000, reward_gems: 0 },
  { id: 'subscribe_youtube',  label: 'Subscribe to Channel',    sublabel: '@shahnamehgamefi',       icon: '▶',  url: 'https://youtube.com/@shahnamehgamefi',           reward_real: 3000, reward_gems: 0 },
  { id: 'like_dyor',          label: 'Like the DApp on DYOR.io',sublabel: 'games/shahnameh',        icon: '👍', url: 'https://dyor.io/dapps/games/shahnameh',          reward_real: 3000, reward_gems: 0 },
];

export const PARTNER_TASKS: EarnTask[] = [
  { id: 'partner_tonkeeper', label: 'Tonkeeper Wallet',         sublabel: 'The leading TON wallet', icon: '💎', url: 'https://t.me/tonkeeper',        reward_real: 500, reward_gems: 0 },
  { id: 'partner_blum',      label: 'Blum',                     sublabel: 'Trade & earn on Blum',   icon: '🌸', url: 'https://t.me/BlumCryptoBot',    reward_real: 300, reward_gems: 2 },
  { id: 'partner_nft_real',  label: 'REAL NFT — Early Access',  sublabel: 'Claim your Shahnameh NFT slot', icon: '✦', url: 'https://t.me/shahnameh_bot', reward_real: 0,   reward_gems: 0 },
];

export interface Milestone {
  threshold: number;
  real:      number;
  gems:      number;
  label:     string;
}

export const MILESTONES: Milestone[] = [
  { threshold: 3,   real: 1000,  gems: 0, label: 'Invite 3 friends' },
  { threshold: 10,  real: 3000,  gems: 0, label: 'Invite 10 friends' },
  { threshold: 25,  real: 8000,  gems: 0, label: 'Invite 25 friends' },
  { threshold: 100, real: 25000, gems: 0, label: 'Invite 100 friends' },
];

export const CHECKIN_REWARDS: Array<{ real: number; gems: number }> = [
  { real: 500,  gems: 0 },
  { real: 1000, gems: 0 },
  { real: 1500, gems: 0 },
  { real: 2000, gems: 0 },
  { real: 2500, gems: 0 },
  { real: 3000, gems: 0 },
  { real: 3500, gems: 1 },
];

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';

async function post(path: string, body: Record<string, unknown>): Promise<any> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(tid);
    return await res.json();
  } catch {
    return null;
  }
}

export type CheckinResult =
  | { ok: true; streak: number; reward_real: number; reward_gems: number }
  | { ok: false; error: string };

export async function claimCheckin(telegramId: string): Promise<CheckinResult> {
  const data = await post('/api/season2/earn/checkin', { telegram_id: telegramId });
  if (data?.status === 1) {
    return { ok: true, streak: data.streak, reward_real: data.reward_real ?? 0, reward_gems: data.reward_gems ?? 0 };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

export type TaskResult = { ok: boolean; error?: string };

export async function completeTask(telegramId: string, taskId: string): Promise<TaskResult> {
  const data = await post('/api/season2/earn/complete-task', { telegram_id: telegramId, task_id: taskId });
  if (data?.status === 1) return { ok: true };
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

export type MilestoneResult = { ok: boolean; error?: string };

export async function claimMilestone(telegramId: string, threshold: number): Promise<MilestoneResult> {
  const data = await post('/api/season2/social/claim-milestone', { telegram_id: telegramId, milestone: threshold });
  if (data?.status === 1) return { ok: true };
  return { ok: false, error: String(data?.error ?? 'network_error') };
}
