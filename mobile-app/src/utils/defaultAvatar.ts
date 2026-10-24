import type { ImageSourcePropType } from 'react-native';
import { hashString } from './handle';

// Default 3D portraits from the Gold After Dark illustration atlas
// (docs/design, web-preview/realgram/assets/people-and-stickers.png).
// King → one of the men, Queen → one of the women. Which one is fixed per
// device id, so people get variety but never see their own avatar change.
const KING:  ImageSourcePropType[] = [
  require('../assets/avatars/amir.png'),
  require('../assets/avatars/noah.png'),
];
const QUEEN: ImageSourcePropType[] = [
  require('../assets/avatars/sara.png'),
  require('../assets/avatars/mina.png'),
  require('../assets/avatars/leila.png'),
];

export type PersonaKey = 'king' | 'queen' | '' | null | undefined;

/** Portrait for a persona, or null when no persona was chosen. */
export function defaultPortrait(persona: PersonaKey, seedId: string): ImageSourcePropType | null {
  const pool = persona === 'king' ? KING : persona === 'queen' ? QUEEN : null;
  if (!pool) return null;
  return pool[hashString(seedId || 'realgram') % pool.length]!;
}
