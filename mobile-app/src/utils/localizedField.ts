/**
 * Picks a localized value from Shahnameh's own content convention
 * (`field`/`field_fa`/`field_ru` — no `field_zh`, that language has no
 * translated story content at the source, falls back to English same as
 * everywhere else `t()` falls back).
 *
 * Deliberately NOT baked into the cached fetch result — chapterCatalogService
 * / chapterLoreService cache the raw multi-language object and this picks at
 * render time, so a language switch shows immediately without invalidating
 * the cache or re-fetching.
 */
export function localizedField(base: string, fa: string | undefined, ru: string | undefined, lang: string): string {
  if (lang === 'fa' && fa) return fa;
  if (lang === 'ru' && ru) return ru;
  return base;
}
