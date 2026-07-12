// Identity layer (A-11) — @handle rules + avatar palette.
//
// A handle is the user's unique, addressable id ("@aria_71") used for
// friend-add and message addressing. It is deliberately Telegram/Insta-shaped
// (lowercase, no spaces) so it is easy to type and share, but the ownership
// rails are our own (ecosystem SSO, later B-14 handle-lookup). Everything here
// is local-first: validation runs on-device, and reservation degrades to a
// local claim when the backend endpoint isn't live yet.

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

// i18n key returned by validateHandle — '' means valid.
export type HandleErrorKey =
  | ''
  | 'id.errShort'
  | 'id.errLong'
  | 'id.errStart'
  | 'id.errChars';

/** Lowercase, strip a leading @, collapse whitespace to nothing. */
export function normalizeHandle(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Validate a *normalized* handle. Rules: 3–20 chars, a–z/0–9/underscore,
 * must start with a letter (so it never collides with a numeric id and reads
 * as a name). Returns an i18n key, '' when valid.
 */
export function validateHandle(handle: string): HandleErrorKey {
  const h = handle;
  if (h.length < HANDLE_MIN) return 'id.errShort';
  if (h.length > HANDLE_MAX) return 'id.errLong';
  if (!/^[a-z]/.test(h))     return 'id.errStart';
  if (!/^[a-z0-9_]+$/.test(h)) return 'id.errChars';
  return '';
}

// Avatar = one emoji on a colored ring (no photo-upload backend needed yet;
// this is deliberately the v1 "changeable profile picture"). The set is broad
// enough to feel personal without a media pipeline.
export const AVATAR_EMOJIS: string[] = [
  '🦊', '🐼', '🦁', '🐬', '🦅', '🐺', '🦉', '🐝',
  '🌙', '⚡', '🔥', '🌊', '🍀', '🌸', '🎧', '🎮',
  '🚀', '💎', '👑', '🎭', '🛡️', '🗿', '🌵', '🍉',
];

// Ring/background colors — drawn from the design tokens so avatars sit in the
// same palette as the rest of the app.
export const AVATAR_COLORS: string[] = [
  '#00E87A', // emerald
  '#3399FF', // blue
  '#D4AF37', // gold
  '#FF6B6B', // coral
  '#B980FF', // violet
  '#FF9F43', // amber
  '#2BD9C9', // teal
  '#F368E0', // pink
];

/** Cheap deterministic hash so a device gets a stable default avatar. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic default avatar for a device/user id (before the user picks). */
export function avatarForId(id: string): { emoji: string; color: string } {
  const n = hashString(id || 'setalink');
  return {
    emoji: AVATAR_EMOJIS[n % AVATAR_EMOJIS.length],
    color: AVATAR_COLORS[(n >> 5) % AVATAR_COLORS.length],
  };
}

/** Suggest a starting handle from a device/user id, always valid. */
export function suggestHandle(id: string): string {
  const suffix = (id || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-4) || '0000';
  return normalizeHandle(`real_${suffix}`);
}
