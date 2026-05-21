// Deep link parser for the setalink:// URL scheme.
// Future: register in AndroidManifest.xml intent-filter and Info.plist CFBundleURLTypes.
//
// Supported URLs:
//   setalink://connect?server=<serverId>
//   setalink://disconnect
//   setalink://tab/<home|servers|ai|activity|profile>
//   setalink://settings
//   setalink://referral?code=<referralCode>

export type DeepLinkAction =
  | { type: 'CONNECT';    serverId: string }
  | { type: 'DISCONNECT'                  }
  | { type: 'NAVIGATE';  tab: string      }
  | { type: 'SETTINGS'                    }
  | { type: 'REFERRAL';  code: string     };

/** Parses a setalink:// URL into a typed action. Returns null for unknown URLs. */
export function parseDeepLink(url: string): DeepLinkAction | null {
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
      navigation?.navigate?.('Main');
      setTimeout(() => navigation?.navigate?.('Main', { screen: 'Profile' }), 300);
      break;
    }
  }
}
