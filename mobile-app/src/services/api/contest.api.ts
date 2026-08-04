import { apiGet, apiPost } from './client';

/**
 * Pre-release 100-invite contest API ($100 USDT, manual-review payout —
 * see lib/contest.php on the backend for the full anti-fraud rationale).
 * Same shape convention as starlink.api.ts, since this reuses that file's
 * /v1 bearer-auth client and the two features share one invite-count
 * definition server-side (contest_active_invite_count()).
 */

export interface ContestStatus {
  invitesVerified: number;
  invitesRequired: number;
  walletConnected: boolean;
  walletAddress:   string | null;
  qualifies:       boolean;
  /** null = not yet claimed. */
  claimStatus:     'pending' | 'approved' | 'paid' | 'rejected' | null;
}

export interface ContestClaimResult {
  claimed: boolean;
  reason?: 'not_qualified';
  status:  ContestStatus;
}

export const ContestAPI = {
  status: (token: string) =>
    apiGet<ContestStatus>('/contest/status', token),

  connectWallet: (token: string, walletAddress: string, chain: string) =>
    apiPost<ContestStatus>('/contest/wallet-connect', { wallet_address: walletAddress, chain }, token),

  claim: (token: string) =>
    apiPost<ContestClaimResult>('/contest/claim', {}, token),
};
