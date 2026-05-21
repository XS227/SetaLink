/**
 * Failure classifier — maps raw VPN/network errors to user-friendly categories.
 *
 * Rules:
 * - Normal users only see userMessage (gentle, non-technical)
 * - Admin/tester mode sees techReason + category
 * - The engine uses category + nextStep to decide which profile to try next
 */

export type FailureCategory =
  | 'dns-blocked'        // DNS resolution failed or blocked
  | 'tls-blocked'        // TLS handshake rejected
  | 'sni-blocked'        // SNI mismatch / DPI blocked on SNI
  | 'reality-failed'     // Reality protocol rejected
  | 'ws-path-blocked'    // WebSocket path blocked (/ws, /xhttp)
  | 'no-traffic'         // TCP ok but no internet (probe failed)
  | 'timeout'            // Connection timed out
  | 'server-unreachable' // Server IP not reachable
  | 'config-error'       // Bad config / parse error
  | 'quota-exhausted'    // User ran out of data
  | 'unknown';

export interface FailureAnalysis {
  category:    FailureCategory;
  userMessage: string;   // shown to non-technical users
  techReason:  string;   // full error, admin only
  nextStep:    'try-next-sni' | 'try-sni-spoof' | 'try-alt-sni' | 'try-xhttp'
             | 'try-ws' | 'try-emergency' | 'try-next-profile' | 'reload-bundle'
             | 'try-doh' | 'give-up';
  retryable:   boolean;
}

interface Pattern {
  keywords?: string[];
  regex?:    RegExp;
  result:    Omit<FailureAnalysis, 'techReason'>;
}

const PATTERNS: Pattern[] = [
  { keywords: ['quota', 'exhausted', 'quota_bytes', 'no data'],
    result: { category: 'quota-exhausted', userMessage: 'Data limit reached. Tap to upgrade.', nextStep: 'give-up', retryable: false } },
  { keywords: ['dns', 'resolve', 'nxdomain', 'no such host', 'lookup failed'],
    result: { category: 'dns-blocked', userMessage: 'Changing DNS route…', nextStep: 'try-doh', retryable: true } },
  { keywords: ['tls handshake', 'handshake failed', 'bad certificate', 'certificate verify'],
    result: { category: 'tls-blocked', userMessage: 'Trying stealth mode…', nextStep: 'try-sni-spoof', retryable: true } },
  { keywords: ['sni mismatch', 'ssl alert', 'unknown_ca'], regex: /sni.*(block|reject)/,
    result: { category: 'sni-blocked', userMessage: 'Switching encryption…', nextStep: 'try-alt-sni', retryable: true } },
  { keywords: ['reality', 'x25519', 'xtls', 'vision'],
    result: { category: 'reality-failed', userMessage: 'Trying alternate route…', nextStep: 'try-xhttp', retryable: true } },
  { keywords: ['/ws', '/xhttp', '/httpup', 'websocket', 'bad gateway', '502', '403 forbidden', 'path block'],
    result: { category: 'ws-path-blocked', userMessage: 'Finding open path…', nextStep: 'try-xhttp', retryable: true } },
  { keywords: ['tcp ok', 'no internet', 'probe failed', 'tcp-only', 'no http response', 'no route'],
    result: { category: 'no-traffic', userMessage: 'Verifying connection quality…', nextStep: 'try-next-profile', retryable: true } },
  { keywords: ['timeout', 'timed out', 'deadline exceeded', 'context deadline'],
    result: { category: 'timeout', userMessage: 'Optimizing route…', nextStep: 'try-next-sni', retryable: true } },
  { keywords: ['refused', 'unreachable', 'network error', 'no route to host', 'connection reset', 'econnrefused'],
    result: { category: 'server-unreachable', userMessage: 'Trying backup route…', nextStep: 'try-emergency', retryable: true } },
  { keywords: ['config', 'invalid json', 'parse error', 'invalid config', 'missing field'],
    result: { category: 'config-error', userMessage: 'Reloading configuration…', nextStep: 'reload-bundle', retryable: false } },
];

function matchesPattern(error: string, p: Pattern): boolean {
  const e = error.toLowerCase();
  if (p.regex && p.regex.test(e)) return true;
  if (p.keywords && p.keywords.some(k => e.includes(k))) return true;
  return false;
}

export function classifyFailure(error: string): FailureAnalysis {
  for (const p of PATTERNS) {
    if (matchesPattern(error, p)) {
      return { ...p.result, techReason: error };
    }
  }
  return {
    category: 'unknown',
    userMessage: 'Optimizing connection…',
    techReason: error,
    nextStep: 'try-next-profile',
    retryable: true,
  };
}

// Returns the animated status label shown below the connect button while connecting.
// Keeps technical detail hidden from normal users.
export function connectingPhaseLabel(
  profileLabel: string,
  phase: string,
  retryCount: number,
  profileIndex: number,
  profileCount: number,
): string {
  if (phase === 'retrying') return 'Refreshing routes…';
  if (retryCount > 2) return 'Finding best route for your network…';
  if (phase === 'probe-validated') return 'Connected with Stealth Mode.';

  const l = profileLabel.toLowerCase();

  // Resolve a short protocol name for progress display
  const proto = l.includes('emergency')  ? 'Emergency backup'
    : (l.includes('stealth') || l.includes('vercel') || l.includes('jsdelivr') || l.includes('hcaptcha')) ? 'Stealth CDN'
    : l.includes('reality')              ? 'Reality'
    : (l.includes('xhttp') || l.includes('splithttp')) ? 'XHTTP'
    : (l.includes('websocket') || l.includes('ws '))   ? 'WebSocket'
    : (l.includes('httpupgrade') || l.includes('httpup')) ? 'HTTPUpgrade'
    : null;

  // Show specific route progress when running through a profile list
  if (profileCount > 1 && profileIndex >= 0) {
    const n = profileIndex + 1;
    return proto
      ? `Testing route ${n} of ${profileCount} · ${proto}…`
      : `Testing route ${n} of ${profileCount}…`;
  }

  if (!proto) return 'Establishing secure tunnel…';
  if (proto === 'Emergency backup') return 'Trying backup connection…';
  if (proto === 'Stealth CDN') return 'Trying Stealth Mode…';
  if (proto === 'Reality')     return 'Trying stealth connection…';
  if (proto === 'XHTTP')       return 'Trying encrypted tunnel…';
  if (proto === 'WebSocket')   return 'Trying secure channel…';
  return `Trying ${proto}…`;
}

// Maps a failure category to the user-facing error displayed after all retries exhausted.
export function exhaustedMessage(categories: FailureCategory[]): string {
  if (categories.includes('quota-exhausted')) return 'Data limit reached. Tap to upgrade.';
  if (categories.includes('server-unreachable')) return 'Server unreachable. Check your internet.';
  if (categories.every(c => c === 'timeout')) return 'Connection timed out. Tap to retry.';
  return 'Could not connect. Tap to retry.';
}
