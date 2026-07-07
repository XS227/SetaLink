/**
 * Smart Mode / Iran Bypass — versioned bypass rule list.
 *
 * When Smart Mode is ON the VPN stays connected, but traffic to Iranian
 * destinations is routed DIRECT (outside the tunnel) by Xray routing rules,
 * so banks, Snapp, Digikala, government services and .ir sites keep working
 * without the user toggling the VPN off and on.
 *
 * This bundled list is the source of truth for the MVP. The structure is
 * designed to be remotely updateable later (backend endpoint /v1/routing-rules
 * serving the same shape + a higher version) WITHOUT an app release. Rules are
 * admin-curated only — user-submitted rules must never go live automatically.
 *
 * Rule types:
 *   domain_suffix — matches the domain and every subdomain (Xray 'domain:x').
 *   domain        — exact hostname only (Xray 'full:x').
 *   geosite/geoip — DISABLED until geosite.dat/geoip.dat ship with the app:
 *                   referencing them without the asset makes Xray FAIL TO
 *                   START, which would kill the whole tunnel. Do not enable.
 *   app_package   — Android-only: exclude an app from the VPN entirely
 *                   (handled by VpnService, not Xray).
 */

export const BYPASS_RULES_VERSION = 1;

export type BypassRuleType =
  | 'domain_suffix'
  | 'domain'
  | 'geosite'
  | 'geoip'
  | 'app_package';

export interface BypassRule {
  id:       string;
  type:     BypassRuleType;
  value:    string;
  platform: 'all' | 'android' | 'ios';
  enabled:  boolean;
  note?:    string;
}

export const DEFAULT_BYPASS_RULES: BypassRule[] = [
  // ── the big one: every .ir domain ─────────────────────────────────────────
  { id: 'ir-tld', type: 'domain_suffix', value: 'ir', platform: 'all', enabled: true,
    note: 'all .ir domains — banks, government, local services' },

  // ── geo rules: prepared but OFF until dat-files are bundled ──────────────
  { id: 'geoip-ir', type: 'geoip', value: 'ir', platform: 'all', enabled: false,
    note: 'requires geoip.dat in the Xray asset path — enabling without it prevents Xray from starting' },
  { id: 'geosite-ir', type: 'geosite', value: 'ir', platform: 'all', enabled: false,
    note: 'requires geosite.dat in the Xray asset path — enabling without it prevents Xray from starting' },

  // ── known Iranian services on non-.ir TLDs (or high-traffic .ir) ─────────
  { id: 'digikala',   type: 'domain_suffix', value: 'digikala.com',  platform: 'all', enabled: true, note: 'marketplace' },
  { id: 'snapp-ir',   type: 'domain_suffix', value: 'snapp.ir',      platform: 'all', enabled: true, note: 'ride hailing' },
  { id: 'snapp-taxi', type: 'domain_suffix', value: 'snapp.taxi',    platform: 'all', enabled: true, note: 'Snapp primary app domain' },
  { id: 'tapsi',      type: 'domain_suffix', value: 'tapsi.cab',     platform: 'all', enabled: true, note: 'ride hailing' },
  { id: 'cafebazaar', type: 'domain_suffix', value: 'cafebazaar.ir', platform: 'all', enabled: true, note: 'Iranian app store' },
  { id: 'divar',      type: 'domain_suffix', value: 'divar.ir',      platform: 'all', enabled: true, note: 'classifieds' },
  { id: 'sheypoor',   type: 'domain_suffix', value: 'sheypoor.com',  platform: 'all', enabled: true, note: 'classifieds' },

  // ── banking / payment ─────────────────────────────────────────────────────
  { id: 'bankmelli',  type: 'domain_suffix', value: 'bankmelli.ir',  platform: 'all', enabled: true, note: 'Bank Melli' },
  { id: 'bmi',        type: 'domain_suffix', value: 'bmi.ir',        platform: 'all', enabled: true, note: 'Bank Melli (bmi.ir)' },
  { id: 'mellat',     type: 'domain_suffix', value: 'mellatbank.ir', platform: 'all', enabled: true, note: 'Bank Mellat' },
  { id: 'sepah',      type: 'domain_suffix', value: 'banksepah.ir',  platform: 'all', enabled: true, note: 'Bank Sepah' },
  { id: 'bsi',        type: 'domain_suffix', value: 'bsi.ir',        platform: 'all', enabled: true, note: 'Bank Saderat' },
  { id: 'enbank',     type: 'domain_suffix', value: 'enbank.ir',     platform: 'all', enabled: true, note: 'EN Bank' },
  { id: 'saman',      type: 'domain_suffix', value: 'samanbank.ir',  platform: 'all', enabled: true, note: 'Saman Bank' },
  { id: 'sb24',       type: 'domain_suffix', value: 'sb24.ir',       platform: 'all', enabled: true, note: 'Saman internet bank' },
  { id: 'shaparak',   type: 'domain_suffix', value: 'shaparak.ir',   platform: 'all', enabled: true, note: 'national payment gateway — card payments break without this' },
  { id: 'mygov',      type: 'domain_suffix', value: 'my.gov.ir',     platform: 'all', enabled: true, note: 'government services portal' },
];

// Very defensive validation: a malformed rule (bad type in a future remote
// list, empty value, spaces, injection attempts) is silently skipped — a bad
// rule list must NEVER prevent the tunnel from starting (safety test case 9).
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

function isValidDomainRule(r: BypassRule): boolean {
  return (
    (r.type === 'domain_suffix' || r.type === 'domain') &&
    typeof r.value === 'string' &&
    r.value.length > 0 &&
    r.value.length < 254 &&
    DOMAIN_RE.test(r.value)
  );
}

/**
 * Xray routing-rule domain entries for the current platform.
 * Returns e.g. ['domain:ir', 'domain:digikala.com', …]. Never throws.
 */
export function getBypassDomains(
  platform: 'android' | 'ios',
  rules: BypassRule[] = DEFAULT_BYPASS_RULES,
): string[] {
  try {
    const out: string[] = [];
    for (const r of Array.isArray(rules) ? rules : []) {
      if (!r || r.enabled !== true) continue;
      if (r.platform !== 'all' && r.platform !== platform) continue;
      if (!isValidDomainRule(r)) continue; // geosite/geoip/app_package handled elsewhere
      out.push(r.type === 'domain' ? `full:${r.value}` : `domain:${r.value}`);
    }
    return out;
  } catch {
    return [];
  }
}

/** Count of active bypass rules — shown in Settings and diagnostics. */
export function getActiveBypassRuleCount(platform: 'android' | 'ios'): number {
  return getBypassDomains(platform).length;
}

// ── iOS per-app bypass (domain-based) ────────────────────────────────────────
// iOS cannot exclude apps from a consumer VPN (no VpnService.
// addDisallowedApplication equivalent in NetworkExtension), so the Android
// per-app picker is approximated with a curated app → domains catalog: the
// selected apps' domains are routed direct, exactly like Smart Mode rules.
// Covers the real use case (Iranian apps that block foreign VPN exits) without
// pretending to do true app-level split tunneling.

export interface BypassCatalogApp {
  id:      string;   // stable id persisted in settingsStore.bypassApps on iOS
  name:    string;   // display name (brand names, not localized)
  icon:    string;   // emoji glyph for the list row
  domains: string[]; // domain_suffix values routed direct when selected
}

export const IOS_APP_BYPASS_CATALOG: BypassCatalogApp[] = [
  { id: 'snapp',      name: 'Snapp',       icon: '🚕', domains: ['snapp.ir', 'snapp.taxi', 'snapp.site'] },
  { id: 'tapsi',      name: 'Tapsi',       icon: '🚖', domains: ['tapsi.cab', 'tapsi.ir'] },
  { id: 'digikala',   name: 'Digikala',    icon: '🛒', domains: ['digikala.com', 'digikala.ir', 'dkstatics.com'] },
  { id: 'divar',      name: 'Divar',       icon: '📦', domains: ['divar.ir'] },
  { id: 'sheypoor',   name: 'Sheypoor',    icon: '🏷️', domains: ['sheypoor.com'] },
  { id: 'rubika',     name: 'Rubika',      icon: '💬', domains: ['rubika.ir'] },
  { id: 'bale',       name: 'Bale',        icon: '💬', domains: ['bale.ai', 'balep.ir'] },
  { id: 'eitaa',      name: 'Eitaa',       icon: '💬', domains: ['eitaa.com', 'eitaa.ir'] },
  { id: 'aparat',     name: 'Aparat',      icon: '🎬', domains: ['aparat.com', 'aparat.ir'] },
  { id: 'filimo',     name: 'Filimo',      icon: '🎬', domains: ['filimo.com', 'filimo.ir'] },
  { id: 'cafebazaar', name: 'Cafe Bazaar', icon: '🏪', domains: ['cafebazaar.ir'] },
  { id: 'myket',      name: 'Myket',       icon: '🏪', domains: ['myket.ir'] },
  { id: 'banking',    name: 'Banking & payments', icon: '🏦',
    domains: ['shaparak.ir', 'bmi.ir', 'bankmelli.ir', 'mellatbank.ir', 'banksepah.ir',
              'bsi.ir', 'enbank.ir', 'samanbank.ir', 'sb24.ir', 'sep.ir', 'zarinpal.com'] },
  { id: 'gov',        name: 'Government (my.gov.ir)', icon: '🏛️', domains: ['gov.ir', 'sana.ir'] },
];

/**
 * Xray domain entries for the catalog apps the user selected on iOS.
 * Unknown ids and malformed domains are skipped — same safety contract as
 * getBypassDomains: bad input must never prevent the tunnel from starting.
 */
export function getAppBypassDomains(selectedIds: string[]): string[] {
  try {
    const out: string[] = [];
    for (const app of IOS_APP_BYPASS_CATALOG) {
      if (!Array.isArray(selectedIds) || !selectedIds.includes(app.id)) continue;
      for (const d of app.domains) {
        if (typeof d === 'string' && d.length > 0 && d.length < 254 && DOMAIN_RE.test(d)) {
          out.push(`domain:${d}`);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Domains for the app-bypass selection currently persisted in the settings
 * store — the value config-build call sites pass as extraBypassDomains.
 * Android returns []: there bypassApps holds package names that VpnService
 * excludes natively at TUN build, independent of any Xray routing. Reads
 * lazily and defensively (same pattern the call sites use for smartMode) so
 * a store hiccup can never prevent the tunnel from starting.
 */
export function getSelectedAppBypassDomains(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    if (Platform.OS !== 'ios') return [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useSettingsStore } = require('../stores/settingsStore') as typeof import('../stores/settingsStore');
    return getAppBypassDomains(useSettingsStore.getState().bypassApps);
  } catch {
    return [];
  }
}
