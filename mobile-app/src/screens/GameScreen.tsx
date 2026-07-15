/**
 * GameScreen — the Shahnameh game (and future REAL apps) embedded in-app.
 *
 * The game is a hosted web app (Next.js), loaded in a WebView so it stays
 * remote (no APK bloat) but feels native. On open we fetch an ecosystem SSO
 * token (contract 6) and pass it into the game URL so the user is signed in
 * without a separate login. Fail-safe:
 *   ok        → game loads authenticated as the linked REAL account
 *   unlinked  → link CTA (opens the existing account-link flow), plus a
 *               "Play as guest" escape into the game
 *   unavailable → guest game (issuer not live yet)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { getSsoToken, buildGameUrl, SsoResult } from '../services/ssoService';

const LINK_URL_BASE = 'https://t.me/shahnameh_bot?start=linkvpn_';

export function GameScreen({ onBack }: { onBack?: () => void }) {
  const { t } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');

  const [sso, setSso]       = useState<SsoResult | null>(null);
  const [loading, setLoad]  = useState(true);
  const [guest, setGuest]   = useState(false);   // user chose to skip linking

  const load = useCallback(() => {
    if (!deviceId) { setLoad(false); return; }
    setLoad(true);
    getSsoToken(deviceId)
      .then(setSso)
      .catch(() => setSso({ status: 'unavailable', token: '', expires_in: 0, account: '',
                            game_url: 'https://shahnameh.setaei.com', sso_enabled: true }))
      .finally(() => setLoad(false));
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  const header = (
    <View style={styles.header}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.title}>{t('game.title')}</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}><ActivityIndicator color={Colors.gold[400]} /></View>
      </View>
    );
  }

  // Not linked and hasn't chosen guest → prompt to link (the earn loop needs a
  // REAL account). Guest still gets in, but earning attributes to nothing.
  if (sso?.status === 'unlinked' && !guest) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <Text style={styles.promptTitle}>{t('game.linkTitle')}</Text>
          <Text style={styles.promptBody}>{t('game.linkBody')}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => Linking.openURL(LINK_URL_BASE + encodeURIComponent(deviceId)).catch(() => {})}
          >
            <Text style={styles.primaryBtnText}>{t('game.linkBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.guestBtn} onPress={() => setGuest(true)}>
            <Text style={styles.guestBtnText}>{t('game.playGuest')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const url = buildGameUrl(
    sso ?? { status: 'unavailable', token: '', expires_in: 0, account: '',
             game_url: 'https://shahnameh.setaei.com', sso_enabled: true },
    deviceId,
  );

  return (
    <View style={styles.container}>
      {header}
      <WebView
        source={{ uri: url }}
        style={styles.web}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}><ActivityIndicator color={Colors.gold[400]} /></View>
        )}
        // The game is trusted first-party; keep the WebView scoped to it.
        allowsBackForwardNavigationGestures
        originWhitelist={['https://*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Colors.bg?.base ?? '#03040a' },
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing[4],
                    paddingTop: Spacing[6], paddingBottom: Spacing[3], gap: Spacing[3] },
  backBtn:        { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backBtnText:    { color: Colors.text.primary, fontSize: 30, marginTop: -4 },
  title:          { color: Colors.text.primary, fontSize: 18, fontFamily: Typography.family.heading },
  web:            { flex: 1, backgroundColor: 'transparent' },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing[6], gap: Spacing[4] },
  promptTitle:    { color: Colors.text.primary, fontSize: 18, fontFamily: Typography.family.heading, textAlign: 'center' },
  promptBody:     { color: Colors.text.secondary, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  primaryBtn:     { backgroundColor: Colors.gold[400], paddingHorizontal: Spacing[6], paddingVertical: 11,
                    borderRadius: Radius.md, marginTop: Spacing[3] },
  primaryBtnText: { color: '#1A1405', fontSize: 14, fontFamily: Typography.family.heading },
  guestBtn:       { paddingVertical: 8 },
  guestBtnText:   { color: Colors.text.secondary, fontSize: 13, textDecorationLine: 'underline' },
});
