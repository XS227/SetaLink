// Community rank progression: warrior → pahlavan (3 verified invites) → king (10).
// Rank counts TrustAI-verified invites (activeInviteCount), not raw invites.

import { getCommunityRank, getClanId, RANK_THRESHOLDS } from '../components/CommunityRankCard';

describe('getCommunityRank', () => {
  it('starts everyone as a warrior', () => {
    const r = getCommunityRank(0);
    expect(r.key).toBe('warrior');
    expect(r.next?.key).toBe('hero');
    expect(r.next?.needed).toBe(RANK_THRESHOLDS.hero);
    expect(r.progress).toBe(0);
  });

  it('promotes to pahlavan at the hero threshold', () => {
    expect(getCommunityRank(RANK_THRESHOLDS.hero - 1).key).toBe('warrior');
    const r = getCommunityRank(RANK_THRESHOLDS.hero);
    expect(r.key).toBe('hero');
    expect(r.next?.key).toBe('king');
    expect(r.next?.needed).toBe(RANK_THRESHOLDS.king - RANK_THRESHOLDS.hero);
  });

  it('crowns a king at the king threshold, with no further rank', () => {
    expect(getCommunityRank(RANK_THRESHOLDS.king - 1).key).toBe('hero');
    const r = getCommunityRank(RANK_THRESHOLDS.king);
    expect(r.key).toBe('king');
    expect(r.next).toBeNull();
    expect(r.progress).toBe(1);
    expect(getCommunityRank(999).key).toBe('king');
  });

  it('clamps negative counts to warrior at zero progress', () => {
    const r = getCommunityRank(-5);
    expect(r.key).toBe('warrior');
    expect(r.progress).toBe(0);
  });
});

describe('getClanId', () => {
  it('extracts the middle segment of SL-227-XXXXXXXX ids', () => {
    expect(getClanId('SL-227-62DAC5F0')).toBe('227');
  });
  it('returns empty for ids without a clan segment', () => {
    expect(getClanId('')).toBe('');
    expect(getClanId('anon_x1y2')).toBe('');
  });
});
