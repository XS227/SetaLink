import type { ImageSourcePropType } from 'react-native';

// 3D stickers from the Gold After Dark atlas. A sticker travels as a plain DM
// whose whole body is the token `[sticker:<id>]`, so no new message type or
// server field is needed; clients that predate this just show the token text.
export const STICKERS: Record<string, ImageSourcePropType> = {
  popcorn:    require('../assets/stickers/popcorn.png'),
  headphones: require('../assets/stickers/headphones.png'),
  heartcat:   require('../assets/stickers/heartcat.png'),
  sun:        require('../assets/stickers/sun.png'),
};

export const STICKER_IDS = Object.keys(STICKERS);

const TOKEN = /^\[sticker:([a-z0-9_-]{1,32})\]$/;

export function stickerToken(id: string): string {
  return `[sticker:${id}]`;
}

/** The sticker id when the whole message is a known sticker token, else null. */
export function parseSticker(body: string): string | null {
  const m = TOKEN.exec(body.trim());
  return m && STICKERS[m[1]!] ? m[1]! : null;
}

/** Inbox preview text for a message body (stickers read as a short label). */
export function previewBody(body: string, stickerLabel: string): string {
  return parseSticker(body) ? `🖼 ${stickerLabel}` : body;
}
