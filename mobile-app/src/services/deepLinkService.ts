// Deep link parser for the setalink:// scheme AND https://setalink.no App Links.
//
// Supported URLs:
//   setalink://connect?server=<serverId>
//   setalink://disconnect
//   setalink://tab/<home|servers|ai|activity|profile>
//   setalink://settings
//   setalink://referral?code=<referralCode>
//   setalink://link-real-account?device_id=<d>&account=<a>&ts=<t>&sig=<s>
//     (REAL wallet link proof minted by the Shahnameh Mini App — A3/C3)
//   https://setalink.no/?ref=<code>          (website / Telegram invite links)
//   https://setalink.no/?start=<code>        (Telegram bot start param)
//   https://setalink.no/invite/<code>

export type DeepLinkAction =
  | { type: 'CONNECT';    serverId: string }
  | { type: 'DISCONNECT'                  }
  | { type: 'NAVIGATE';  tab: string      }
  | { type: 'SETTINGS'                    }
  | { type: 'REFERRAL';  code: string     }
  | { type: 'LINK_REAL'; deviceId: string; account: string; ts: number; sig: string };

const REF_CODE_RE = /^[A-Z0-9]{4,20}$/i;

/** Parses a deep link URL into a typed action. Returns null for unknown URLs. */
export function parseDeepLink(url: string): DeepLinkAction | null {
  // https App Links: invite/referral entry points from website and Telegram.
  if (url.startsWith('https://setalink.no') || url.startsWith('http://setalink.no')) {
    const m = url.match(/[?&](?:ref|start)=([^&#]+)/)
           ?? url.match(/\/invite\/([^/?#]+)/);
    const code = m ? decodeURIComponent(m[1]!) : '';
    if (REF_CODE_RE.test(code)) return { type: 'REFERRAL', code: code.toUpperCase() };
    return { type: 'NAVIGATE', tab: 'home' };  // plain website link — just open the app
  }

  if (!url.startsWith('setalink://')) return null;

  const withoutScheme = url.slice('setalink://'.length);
  const [path, queryStr] = withoutScheme.split('?');
  const params = new Map<string, string>();

  if (queryStr) {
    queryStr.split('&').forEach((pair) => {
      const [key, val] = pair.split('=');
      if (key) params.set(key, decodeURIComponent(val ?? ''));
    });
  }

  switch (path) {
    case 'connect':
      return params.has('server')
        ? { type: 'CONNECT', serverId: params.get('server')! }
        : null;

    case 'disconnect':
      return { type: 'DISCONNECT' };

    case 'settings':
      return { type: 'SETTINGS' };

    case 'referral':
      return params.has('code')
        ? { type: 'REFERRAL', code: params.get('code')! }
        : null;

    case 'link-real-account': {
      const account = params.get('account') ?? '';
      const ts      = parseInt(params.get('ts') ?? '', 10);
      const sig     = params.get('sig') ?? '';
      // device_id is carried so the app can confirm the proof was minted for
      // THIS device (defence against a proof minted for someone else); the
      // app posts its own deviceId regardless. All fields required.
      if (!account || !sig || !Number.isFinite(ts)) return null;
      return {
        type: 'LINK_REAL',
        deviceId: params.get('device_id') ?? '',
        account, ts, sig,
      };
    }

    default:
      if (path?.startsWith('tab/')) {
        return { type: 'NAVIGATE', tab: path.slice(4) };
      }
      return null;
  }
}

/** Executes a parsed deep link action against the current app state. */
export function executeDeepLink(action: DeepLinkAction, navigation: any): void {
  switch (action.type) {
    case 'CONNECT': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useServerStore } = require('../stores/serverStore');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useVpnStore }    = require('../stores/vpnStore');
      useServerStore.getState().selectServer(action.serverId);
      useVpnStore.getState().connect();
      navigation?.navigate?.('Main');
      break;
    }

    case 'DISCONNECT': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useVpnStore } = require('../stores/vpnStore');
      useVpnStore.getState().disconnect();
      break;
    }

    case 'NAVIGATE':
      navigation?.navigate?.('Main');
      break;

    case 'SETTINGS':
      navigation?.navigate?.('Settings');
      break;

    case 'REFERRAL': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useSettingsStore } = require('../stores/settingsStore');
      if (useSettingsStore.getState().setPendingReferralCode) {
        useSettingsStore.getState().setPendingReferralCode(action.code);
      }
      // Auto-claim immediately when the device is already registered; the
      // pending code stays stored as a fallback for pre-registration links
      // (claimed by claimPendingReferral() right after auto-register).
      claimPendingReferral().catch(() => {});
      navigation?.navigate?.('Main');
      setTimeout(() => navigation?.navigate?.('Main', { screen: 'Profile' }), 300);
      break;
    }

    case 'LINK_REAL': {
      // Bind the device to a REAL account using the proof the Shahnameh Mini
      // App minted (A3/C3). We post OUR own deviceId — the proof's device_id
      // must match it, or the panel rejects the (device_id|account|ts) HMAC.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useAuthStore } = require('../stores/authStore');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { linkRealAccount } = require('./realWalletService');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useToastStore } = require('../stores/toastStore');
      const deviceId = useAuthStore.getState().user?.deviceId;
      if (deviceId) {
        // If the proof names a device, it must be this one.
        if (action.deviceId && action.deviceId !== deviceId) {
          useToastStore.getState().show('This link was issued for a different device', 'error');
        } else {
          linkRealAccount(deviceId, action.account, action.ts, action.sig)
            .then(() => useToastStore.getState().show('REAL account linked 🎉', 'success'))
            .catch((e: unknown) =>
              useToastStore.getState().show(e instanceof Error ? e.message : 'Link failed', 'error'));
        }
      }
      navigation?.navigate?.('Main');
      setTimeout(() => navigation?.navigate?.('Main', { screen: 'Profile' }), 300);
      break;
    }
  }
}

/**
 * Claims the stored pending referral code against the backend, exactly once.
 * Safe to call any time: no-ops when there is no code or no registered device;
 * clears the code on success or on a permanent rejection (already used /
 * invalid / own code), keeps it for transient network errors so a later call
 * can retry. Returns true when a bonus was credited.
 */
export async function claimPendingReferral(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useSettingsStore } = require('../stores/settingsStore');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useAuthStore } = require('../stores/authStore');

  const code = useSettingsStore.getState().pendingReferralCode;
  const user = useAuthStore.getState().user;
  if (!code || !user?.deviceId) return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useReferral } = require('./entitlementService');
    const result = await useReferral(user.deviceId, code);
    // Code is consumed either way (granted or held) — never retry it.
    useSettingsStore.getState().setPendingReferralCode(null);
    const held = result.status === 'pending_review';
    if (!held && (result.bonus_bytes ?? 0) > 0) {
      useAuthStore.getState().addBonusBytes?.(result.bonus_bytes);
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useToastStore } = require('../stores/toastStore');
      useToastStore.getState().show(
        held ? 'Invite received — bonus pending review' : 'Invite accepted — +1 GB added 🎉',
        held ? 'info' : 'success',
      );
    } catch {}
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Permanent rejections — drop the code so we never spam the backend.
    if (/already used|invalid|own referral|not found/i.test(msg)) {
      useSettingsStore.getState().setPendingReferralCode(null);
    }
    return false;
  }
}
