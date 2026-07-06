import { resolveNodeIdentity } from '../stores/serverStore';

// Build 77 — the server label must reflect the ACTUAL connected node, never a
// hardcoded "Germany · Hetzner" assumption (that lied after the Finland flip).
describe('resolveNodeIdentity — authoritative node labelling', () => {
  it('labels the Finland node from its real address', () => {
    const id = resolveNodeIdentity('65.109.183.7');
    expect(id.country).toBe('Finland');
    expect(id.flag).toBe('🇫🇮');
    expect(id.city).toContain('Helsinki');
  });

  it('labels the Germany node from its real address', () => {
    const id = resolveNodeIdentity('91.107.158.53');
    expect(id.country).toBe('Germany');
    expect(id.flag).toBe('🇩🇪');
  });

  it('NEVER labels the Finland address as Germany (the exact regression)', () => {
    expect(resolveNodeIdentity('65.109.183.7').country).not.toBe('Germany');
  });

  it('falls back to profile-provided identity for unknown addresses', () => {
    const id = resolveNodeIdentity('1.2.3.4', { country: 'Sweden', city: 'Sto' });
    expect(id.country).toBe('Sweden');
    expect(id.city).toBe('Sto');
  });

  it('never guesses a country for a fully unknown node', () => {
    const id = resolveNodeIdentity('9.9.9.9');
    expect(id.country).toBe('Realink Node');
    expect(id.city).toContain('9.9.9.9');
  });
});
