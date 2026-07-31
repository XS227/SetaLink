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
  farr:      number;
  label:     string;
}

// Khabat, 2026-07-31: "referal kan gå opp i fibonaci sequensen ... fra 1
// til 2, 3, 5, 8, 13 etc." — mirrors shahnameh-backend's routes/api/
// season2.js MILESTONE_REWARDS table EXACTLY (this repo's own header above
// says these values must match what the server actually pays out; the old
// table here (1000/3000/8000/25000, no gems) had drifted from the server's
// real amounts (500/2000/5000/15000 + gems) — found while making this
// change, fixed here too, not just the Fibonacci ask). Reward amounts are
// a proposed starting point, not a reviewed business decision — see that
// backend table's own comment.
export const MILESTONES: Milestone[] = [
  { threshold: 1,  real: 200,   gems: 0,  farr: 0, label: 'Invite 1 friend' },
  { threshold: 2,  real: 350,   gems: 0,  farr: 0, label: 'Invite 2 friends' },
  { threshold: 3,  real: 500,   gems: 1,  farr: 0, label: 'Invite 3 friends' },
  { threshold: 5,  real: 900,   gems: 1,  farr: 0, label: 'Invite 5 friends' },
  { threshold: 8,  real: 1500,  gems: 2,  farr: 0, label: 'Invite 8 friends' },
  { threshold: 13, real: 2500,  gems: 3,  farr: 0, label: 'Invite 13 friends' },
  { threshold: 21, real: 4000,  gems: 4,  farr: 1, label: 'Invite 21 friends' },
  { threshold: 34, real: 7000,  gems: 6,  farr: 1, label: 'Invite 34 friends' },
  { threshold: 55, real: 11000, gems: 8,  farr: 2, label: 'Invite 55 friends' },
  { threshold: 89, real: 18000, gems: 12, farr: 3, label: 'Invite 89 friends' },
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

/** Marks today's read/quiz/tap daily quest done (`/season2/user/update-quests`,
 *  real and already used by the WebView game's own home.js/chapter.js —
 *  see routes/api/season2.js on the backend). Khabat, 2026-07-31: "daily
 *  task blir ikke oppdatert, selv om jeg tappet og lest kapitler" — traced
 *  to this repo simply never calling this endpoint anywhere; the native
 *  read/quiz screens wrote to the separate ChapterProgress store (a real,
 *  working sync, just not the signal quest_read/quest_quiz are computed
 *  from) and never told this one. Fire-and-forget like every other
 *  earn-service call here — the quest pips are read-only display, nothing
 *  blocks on this succeeding. */
export async function updateDailyQuest(
  telegramId: string, quest: 'read' | 'quiz' | 'invite' | 'tap', tapCount?: number,
): Promise<void> {
  if (!telegramId) return;
  await post('/api/season2/user/update-quests', {
    telegram_id: telegramId, quest, ...(tapCount != null ? { tap_count: tapCount } : {}),
  });
}

export type MilestoneResult = { ok: boolean; error?: string };

export async function claimMilestone(telegramId: string, threshold: number): Promise<MilestoneResult> {
  const data = await post('/api/season2/social/claim-milestone', { telegram_id: telegramId, milestone: threshold });
  if (data?.status === 1) return { ok: true };
  return { ok: false, error: String(data?.error ?? 'network_error') };
}
