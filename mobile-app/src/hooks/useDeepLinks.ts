import { useEffect } from 'react';
import { Linking } from 'react-native';
import { parseDeepLink, executeDeepLink } from '../services/deepLinkService';
import { Logger } from '../utils/logger';

// Mount once in the root navigator. Handles both cold-start and warm-start links.
export function useDeepLinks(navigation: any): void {
  useEffect(() => {
    // Cold-start: app launched via deep link
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      Logger.info('DeepLink', `Cold start: ${url}`);
      const action = parseDeepLink(url);
      if (action) executeDeepLink(action, navigation);
    }).catch(() => {});

    // Warm-start: link received while app is open
    const sub = Linking.addEventListener('url', ({ url }) => {
      Logger.info('DeepLink', `Warm: ${url}`);
      const action = parseDeepLink(url);
      if (action) executeDeepLink(action, navigation);
    });

    return () => sub.remove();
  }, []);
}
