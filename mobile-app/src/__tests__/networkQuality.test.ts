import { qualityTier } from '../components/NetworkQualityDots';

describe('qualityTier — traffic-light network quality', () => {
  it('off when not connected', () => {
    expect(qualityTier(false, 0)).toBe('off');
    expect(qualityTier(false, 50)).toBe('off');
  });
  it('neutral (ok) when connected but no latency sample yet', () => {
    expect(qualityTier(true, 0)).toBe('ok');
  });
  it('strong on low latency', () => {
    expect(qualityTier(true, 40)).toBe('strong');
    expect(qualityTier(true, 89)).toBe('strong');
  });
  it('ok on medium latency', () => {
    expect(qualityTier(true, 90)).toBe('ok');
    expect(qualityTier(true, 249)).toBe('ok');
  });
  it('weak on high latency', () => {
    expect(qualityTier(true, 250)).toBe('weak');
    expect(qualityTier(true, 1200)).toBe('weak');
  });
});
