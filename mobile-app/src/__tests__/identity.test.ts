import {
  normalizeHandle, validateHandle, suggestHandle, avatarForId,
  AVATAR_EMOJIS, AVATAR_COLORS, HANDLE_MIN, HANDLE_MAX,
} from '../utils/handle';
import { useIdentityStore, displayLabel } from '../stores/identityStore';

describe('handle normalization', () => {
  it('strips @, lowercases, removes whitespace', () => {
    expect(normalizeHandle('  @Aria Khan ')).toBe('ariakhan');
    expect(normalizeHandle('@@BOB')).toBe('bob');
  });
});

describe('handle validation', () => {
  it('accepts a valid handle', () => {
    expect(validateHandle('aria_71')).toBe('');
    expect(validateHandle('abc')).toBe('');
  });
  it('rejects too short / too long', () => {
    expect(validateHandle('ab')).toBe('id.errShort');
    expect(validateHandle('a'.repeat(HANDLE_MAX + 1))).toBe('id.errLong');
  });
  it('must start with a letter', () => {
    expect(validateHandle('1abc')).toBe('id.errStart');
    expect(validateHandle('_abc')).toBe('id.errStart');
  });
  it('rejects illegal characters', () => {
    expect(validateHandle('ab-cd')).toBe('id.errChars');
    expect(validateHandle('ab.cd')).toBe('id.errChars');
  });
  it('boundary length is valid', () => {
    expect(validateHandle('a' + 'b'.repeat(HANDLE_MIN - 1))).toBe('');
  });
});

describe('defaults', () => {
  it('suggestHandle is always valid', () => {
    for (const id of ['sl-abc12345', 'dev_xyz', '', 'SL-227-6888F163']) {
      expect(validateHandle(suggestHandle(id))).toBe('');
    }
  });
  it('avatarForId is deterministic and in-palette', () => {
    const a = avatarForId('sl-abc12345');
    const b = avatarForId('sl-abc12345');
    expect(a).toEqual(b);
    expect(AVATAR_EMOJIS).toContain(a.emoji);
    expect(AVATAR_COLORS).toContain(a.color);
  });
});

describe('identity store', () => {
  beforeEach(() => useIdentityStore.getState().reset());

  it('seeds defaults once and never clobbers a custom choice', () => {
    const s = useIdentityStore.getState();
    s.seedFromId('sl-227-6888f163');
    const seeded = useIdentityStore.getState().handle;
    expect(validateHandle(seeded!)).toBe('');

    useIdentityStore.getState().setHandle('customname');
    useIdentityStore.getState().seedFromId('sl-other');   // must not overwrite
    expect(useIdentityStore.getState().handle).toBe('customname');
    expect(useIdentityStore.getState().customized).toBe(true);
  });

  it('displayLabel prefers nickname, then @handle', () => {
    expect(displayLabel({ displayName: 'Aria', handle: 'aria_71' })).toBe('Aria');
    expect(displayLabel({ displayName: '', handle: 'aria_71' })).toBe('@aria_71');
    expect(displayLabel({ displayName: '', handle: null })).toBe('');
  });
});
