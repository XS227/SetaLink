// Some Android/Hermes runtimes ship a URLSearchParams that implements the
// constructor + toString() but throws "URLSearchParams.set is not
// implemented" for .set() (Khabat, 2026-07-19: confirmed root cause of the
// RealGram black-spinner via the on-device debug panel — the season2 URL
// was never built at all, before any WebView/network activity even
// started). Never call .set()/.append()/.delete() on URLSearchParams in
// this codebase; build query strings with this instead.
export function buildQueryString(
  params: Record<string, string | number | undefined | null>,
): string {
  return Object.entries(params)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}
