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

/* Daily luck wheel — server-authoritative draw+grant (shahnameh-backend
 * POST /season2/user/luck-spin, one per UTC day per account). The wheel
 * animates to whatever prize key this returns; it never picks locally. */
export type LuckSpinResult =
  | { ok: true; prize: string; amount: number }
  | { ok: false; error: string };

export async function spinLuckWheel(telegramId: string): Promise<LuckSpinResult> {
  if (!telegramId) return { ok: false, error: 'unlinked' };
  const data = await post('/api/season2/user/luck-spin', { telegram_id: telegramId });
  if (data?.status === 1 && typeof data.prize === 'string') {
    return { ok: true, prize: data.prize, amount: Number(data.amount) || 0 };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

/* Slot machine — server-authoritative stake+draw (shahnameh-backend
 * POST /season2/user/slot-spin). Khabat, 2026-08-02: "en til casino
 * type spill som lykkehjulet... spilleautomat." Different economic
 * shape from the luck wheel above — costs a stake (player's choice of
 * currency), no daily limit, can genuinely miss. The reels animate to
 * whatever symbol/outcome this returns; they never pick locally, same
 * discipline as the luck wheel — see this session's own investigation
 * into why that matters (the "wheel landed on ﷼ but I got ZAR" report
 * turned out to be a real, if unreproduced, risk class worth avoiding
 * by construction here from the start). */
export type SlotStakeCurrency = 'zar' | 'real';

export type SlotSpinResult =
  | {
    ok: true; win: boolean; symbol: string; amount: number; staked: number;
    newZar: number; newGems: number; newFarr: number; newRealBalance: number;
  }
  | { ok: false; error: string };

export async function spinSlotMachine(telegramId: string, stakeCurrency: SlotStakeCurrency): Promise<SlotSpinResult> {
  if (!telegramId) return { ok: false, error: 'unlinked' };
  const data = await post('/api/season2/user/slot-spin', { telegram_id: telegramId, stake_currency: stakeCurrency });
  if (data?.status === 1 && typeof data.symbol === 'string') {
    return {
      ok: true,
      win: !!data.win,
      symbol: data.symbol,
      amount: Number(data.amount) || 0,
      staked: Number(data.staked) || 0,
      newZar: Number(data.new_zar) || 0,
      newGems: Number(data.new_gems) || 0,
      newFarr: Number(data.new_farr) || 0,
      newRealBalance: Number(data.new_real_balance) || 0,
    };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

/* Ferdowsi's Scroll — knowledge wheel (shahnameh-backend POST /season2/
 * user/scroll-spin + /scroll-answer, docs/NEW_GAMES_SPEC.md Game 1).
 * Two-call split, not one: the wheel has to visually land on a segment
 * (the question) before the player answers, so `spinScrollWheel` only
 * returns the question + a short-lived `spin_token` — `answerScroll`
 * grades it server-side and returns the reward. Same reason the token
 * exists as luck-spin/slot-spin's single-call atomic grant doesn't need
 * one: the correct answer must never sit in a response the client
 * already has before the player commits to a guess. */
export type ScrollSpinResult =
  | { ok: true; spinToken: string; questionId: string; question: string; answers: string[]; difficulty: string }
  | { ok: false; error: string };

export async function spinScrollWheel(telegramId: string): Promise<ScrollSpinResult> {
  if (!telegramId) return { ok: false, error: 'unlinked' };
  const data = await post('/api/season2/user/scroll-spin', { telegram_id: telegramId });
  if (data?.status === 1 && typeof data.spin_token === 'string') {
    return {
      ok: true,
      spinToken: data.spin_token,
      questionId: data.id,
      question: data.question,
      answers: Array.isArray(data.answers) ? data.answers : [],
      difficulty: data.difficulty,
    };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

export type ScrollAnswerResult =
  | {
    ok: true; correct: boolean; correctAnswer: number; explanation: string;
    amountCurrency: string; amount: number; newZar: number; newGems: number; newFarr: number; newRealBalance: number;
  }
  | { ok: false; error: string };

export async function answerScroll(telegramId: string, spinToken: string, answerIndex: number): Promise<ScrollAnswerResult> {
  if (!telegramId) return { ok: false, error: 'unlinked' };
  const data = await post('/api/season2/user/scroll-answer', {
    telegram_id: telegramId, spin_token: spinToken, answer_index: answerIndex,
  });
  if (data?.status === 1) {
    return {
      ok: true,
      correct: !!data.correct,
      correctAnswer: Number(data.correct_answer) || 0,
      explanation: String(data.explanation || ''),
      amountCurrency: String(data.amount_currency || 'zar'),
      amount: Number(data.amount) || 0,
      newZar: Number(data.new_zar) || 0,
      newGems: Number(data.new_gems) || 0,
      newFarr: Number(data.new_farr) || 0,
      newRealBalance: Number(data.new_real_balance) || 0,
    };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

/* Rostam's Seven Trials — pay-to-play memory/sequencing game
 * (shahnameh-backend POST /season2/user/trials-start + /trials-submit,
 * docs/NEW_GAMES_SPEC.md Game 2). Same two-call reasoning as the scroll
 * above: the correct order can't ride in the same response as the
 * shuffled tiles, or there's nothing to actually guess. `tiles` are
 * real heroes.json slugs (not a secret — same public catalog the Heroes
 * screen already shows), only the ORDER is what's being graded. */
export type TrialsStakeCurrency = 'zar' | 'real';

export type TrialsStartResult =
  | { ok: true; sessionToken: string; tiles: string[]; staked: number }
  | { ok: false; error: string };

export async function startTrials(telegramId: string, stakeCurrency: TrialsStakeCurrency): Promise<TrialsStartResult> {
  if (!telegramId) return { ok: false, error: 'unlinked' };
  const data = await post('/api/season2/user/trials-start', { telegram_id: telegramId, stake_currency: stakeCurrency });
  if (data?.status === 1 && Array.isArray(data.tiles)) {
    return { ok: true, sessionToken: data.session_token, tiles: data.tiles, staked: Number(data.staked) || 0 };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

export type TrialsTier = 'miss' | 'partial' | 'full';

export type TrialsSubmitResult =
  | {
    ok: true; matches: number; tier: TrialsTier; win: boolean; correctOrder: string[];
    amountCurrency: string | null; amount: number; newZar: number; newGems: number; newFarr: number; newRealBalance: number;
  }
  | { ok: false; error: string };

export async function submitTrials(telegramId: string, sessionToken: string, order: string[]): Promise<TrialsSubmitResult> {
  if (!telegramId) return { ok: false, error: 'unlinked' };
  const data = await post('/api/season2/user/trials-submit', { telegram_id: telegramId, session_token: sessionToken, order });
  if (data?.status === 1) {
    return {
      ok: true,
      matches: Number(data.matches) || 0,
      tier: (data.tier as TrialsTier) || 'miss',
      win: !!data.win,
      correctOrder: Array.isArray(data.correct_order) ? data.correct_order : [],
      amountCurrency: data.amount_currency ?? null,
      amount: Number(data.amount) || 0,
      newZar: Number(data.new_zar) || 0,
      newGems: Number(data.new_gems) || 0,
      newFarr: Number(data.new_farr) || 0,
      newRealBalance: Number(data.new_real_balance) || 0,
    };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

/* Simorgh's Feather — collectible pull (shahnameh-backend POST /season2/
 * user/feather-pull, docs/NEW_GAMES_SPEC.md Game 3). Single call, same
 * atomic shape as luck-spin/slot-spin -- nothing here needs hiding
 * between draw and reveal, the pull IS the reveal. */
export type FeatherPullResult =
  | {
    ok: true; chapterSlug: string; title: string; flavorText: string; imageUrl: string;
    rarity: string; duplicate: boolean; amountCurrency: string | null; amount: number;
    newZar: number; newGems: number; newRealBalance: number; collectionTotal: number;
  }
  | { ok: false; error: string };

export async function pullFeather(telegramId: string): Promise<FeatherPullResult> {
  if (!telegramId) return { ok: false, error: 'unlinked' };
  const data = await post('/api/season2/user/feather-pull', { telegram_id: telegramId });
  if (data?.status === 1 && typeof data.chapter_slug === 'string') {
    return {
      ok: true,
      chapterSlug: data.chapter_slug,
      title: String(data.title || ''),
      flavorText: String(data.flavor_text || ''),
      // Absolutized against SHAHNAMEH_ORIGIN -- same convention
      // heroCatalogService.ts/chapterCatalogService.ts already use for
      // this backend's relative image_url paths.
      imageUrl: data.image_url ? (String(data.image_url).startsWith('http') ? data.image_url : `${SHAHNAMEH_ORIGIN}${data.image_url}`) : '',
      rarity: String(data.rarity || 'common'),
      duplicate: !!data.duplicate,
      amountCurrency: data.amount_currency ?? null,
      amount: Number(data.amount) || 0,
      newZar: Number(data.new_zar) || 0,
      newGems: Number(data.new_gems) || 0,
      newRealBalance: Number(data.new_real_balance) || 0,
      collectionTotal: Number(data.collection_total) || 0,
    };
  }
  return { ok: false, error: String(data?.error ?? 'network_error') };
}

export type MilestoneResult = { ok: boolean; error?: string };

export async function claimMilestone(telegramId: string, threshold: number): Promise<MilestoneResult> {
  const data = await post('/api/season2/social/claim-milestone', { telegram_id: telegramId, milestone: threshold });
  if (data?.status === 1) return { ok: true };
  return { ok: false, error: String(data?.error ?? 'network_error') };
}
