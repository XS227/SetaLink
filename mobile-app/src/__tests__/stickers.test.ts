import { parseSticker, stickerToken, previewBody, STICKER_IDS } from '../utils/stickers';

describe('stickers', () => {
  it('round-trips every sticker token', () => {
    for (const id of STICKER_IDS) expect(parseSticker(stickerToken(id))).toBe(id);
  });
  it('ignores unknown ids and text around the token', () => {
    expect(parseSticker('[sticker:dragon]')).toBeNull();
    expect(parseSticker('look [sticker:sun]')).toBeNull();
    expect(parseSticker('hello')).toBeNull();
  });
  it('labels stickers in previews', () => {
    expect(previewBody('[sticker:sun]', 'Sticker')).toBe('🖼 Sticker');
    expect(previewBody('hi', 'Sticker')).toBe('hi');
  });
});
