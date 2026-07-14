/**
 * TrustAiLinkScreen — link the user's REAL account to TrustAI (task B-9).
 *
 * B-9 shipped two session-protected TrustAI endpoints that only make sense
 * from a context holding a live TrustAI session cookie:
 *   POST /api/auth/sso-link.php  — link the current TrustAI session to the
 *                                  REAL account carried by our SSO token
 *   POST /api/auth/sso-login.php — sign in with just the SSO token, for
 *                                  accounts already linked
 * Neither is reachable from a plain RN fetch (no cookie jar shared with a
 * browser). So this screen loads trustai.no in a WebView — the user logs in
 * there exactly as on the web — and "Complete linking" runs the fetch
 * same-origin, inside the WebView's JS context, where the session cookie
 * naturally applies. The result comes back over the RN <-> WebView bridge.
 *
 * Reuses the same SSO token + fail-safe pattern as GameScreen (A-10):
 * unlinked (no REAL account on this device) -> prompt to link REAL first;
 * unavailable -> issuer not reachable, nothing to do here yet.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { getSsoToken } from '../services/ssoService';

const TRUSTAI_URL   = 'https://trustai.no/';
const LINK_URL_BASE = 'https://t.me/shahnameh_bot?start=linkvpn_';

type LinkState = 'idle' | 'linking' | 'linked' | 'error';

function buildLinkScript(token: string): string {
  // Runs same-origin inside the trustai.no WebView, so the session cookie
  // (if the user is logged in there) rides along automatically.
  return `(function() {
    fetch(${JSON.stringify(TRUSTAI_URL + 'api/auth/sso-link.php')}, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sso_token: ${JSON.stringify(token)} }),
    }).then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(data) {
        return { httpStatus: r.status, data: data };
      });
    }).then(function(res) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'trustai-link-result', ...res }));
    }).catch(function(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        kind: 'trustai-link-result', httpStatus: 0, data: { ok: false, error: String(e) },
      }));
    });
    true;
  })();`;
}

export function TrustAiLinkScreen({ onBack }: { onBack?: () => void }) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');

  const [ssoStatus, setSsoStatus] = useState<'loading' | 'ok' | 'unlinked' | 'unavailable'>('loading');
  const [linkState, setLinkState] = useState<LinkState>('idle');
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    if (!deviceId) { setSsoStatus('unavailable'); return; }
    getSsoToken(deviceId)
      .then((r) => setSsoStatus(r.status))
      .catch(() => setSsoStatus('unavailable'));
  }, [deviceId]);

  const completeLink = useCallback(() => {
    if (linkState === 'linking' || !deviceId) return;
    setLinkState('linking');
    // Fetch a fresh token rather than reusing whatever was loaded on mount —
    // the user may have spent a while logging into TrustAI and the token is
    // short-lived (~15 min per contract 6).
    getSsoToken(deviceId)
      .then((r) => {
        if (r.status !== 'ok' || !r.token) {
          setLinkState('error');
          showToast(t('trustai.genericError'), 'error');
          return;
        }
        webRef.current?.injectJavaScript(buildLinkScript(r.token));
      })
      .catch(() => {
        setLinkState('error');
        showToast(t('trustai.genericError'), 'error');
      });
  }, [deviceId, linkState, showToast, t]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (msg?.kind !== 'trustai-link-result') return;

    const data = msg.data ?? {};
    if (data.ok === true) {
      setLinkState('linked');
      showToast(t('trustai.success'), 'success');
    } else if (data.error === 'account_linked_elsewhere') {
      setLinkState('error');
      showToast(t('trustai.alreadyLinked'), 'error');
    } else {
      // Covers invalid/expired token and "not logged in yet" alike — the
      // contract doesn't distinguish the latter with its own code, and either
      // way the actionable next step for the user is the same.
      setLinkState('error');
      showToast(t('trustai.needLogin'), 'error');
    }
  }, [showToast, t]);

  const header = (
    <View style={styles.header}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.title}>{t('trustai.title')}</Text>
    </View>
  );

  if (ssoStatus === 'loading') {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}><ActivityIndicator color={Colors.gold[400]} /></View>
      </View>
    );
  }

  if (ssoStatus === 'unlinked') {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <Text style={styles.promptTitle}>{t('trustai.needRealTitle')}</Text>
          <Text style={styles.promptBody}>{t('trustai.needRealBody')}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => Linking.openURL(LINK_URL_BASE + encodeURIComponent(deviceId)).catch(() => {})}
          >
            <Text style={styles.primaryBtnText}>{t('trustai.linkRealBtn')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (ssoStatus === 'unavailable') {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <Text style={styles.promptBody}>{t('trustai.unavailable')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <Text style={styles.hint}>{t('trustai.hint')}</Text>
      <WebView
        ref={webRef}
        source={{ uri: TRUSTAI_URL }}
        style={styles.web}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}><ActivityIndicator color={Colors.gold[400]} /></View>
        )}
        onMessage={onMessage}
        originWhitelist={['https://*']}
      />
      <TouchableOpacity
        style={[styles.completeBtn, linkState === 'linking' && styles.completeBtnDim]}
        disabled={linkState === 'linking'}
        onPress={completeLink}
      >
        <Text style={styles.completeBtnText}>
          {linkState === 'linking' ? '…' : linkState === 'linked' ? t('trustai.linkedBtn') : t('trustai.completeBtn')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.bg?.base ?? '#03040a' },
  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing[4],
                     paddingTop: Spacing[6], paddingBottom: Spacing[3], gap: Spacing[3] },
  backBtn:         { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backBtnText:     { color: Colors.text.primary, fontSize: 30, marginTop: -4 },
  title:           { color: Colors.text.primary, fontSize: 18, fontFamily: Typography.family.heading },
  hint:            { color: Colors.text.secondary, fontSize: 12.5, paddingHorizontal: Spacing[4],
                     paddingBottom: Spacing[3], lineHeight: 18 },
  web:             { flex: 1, backgroundColor: 'transparent' },
  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing[6], gap: Spacing[4] },
  promptTitle:     { color: Colors.text.primary, fontSize: 18, fontFamily: Typography.family.heading, textAlign: 'center' },
  promptBody:      { color: Colors.text.secondary, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  primaryBtn:      { backgroundColor: Colors.gold[400], paddingHorizontal: Spacing[6], paddingVertical: 11,
                     borderRadius: Radius.md, marginTop: Spacing[3] },
  primaryBtnText:  { color: '#1A1405', fontSize: 14, fontFamily: Typography.family.heading },
  completeBtn:     { margin: Spacing[4], alignItems: 'center', paddingVertical: 12,
                     borderRadius: Radius.md, backgroundColor: Colors.gold[400] },
  completeBtnDim:  { opacity: 0.6 },
  completeBtnText: { color: '#1A1405', fontSize: 14, fontFamily: Typography.family.heading },
});
