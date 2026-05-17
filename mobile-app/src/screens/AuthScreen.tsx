import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n';

interface Props { onAuth: () => void; }

const INVITE_RE = /^[A-Z0-9-]{6,32}$/;

export function AuthScreen({ onAuth }: Props) {
  const { t } = useT();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loginWithInvite = useAuthStore((s) => s.loginWithInvite);

  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sanitized = useMemo(() => inviteCode.trim().toUpperCase(), [inviteCode]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      try {
        const parsed = new URL(url);
        const code = (parsed.searchParams.get('code') ?? '').toUpperCase();
        const parent = parsed.searchParams.get('ref');
        if (INVITE_RE.test(code)) {
          loginWithInvite({ inviteCode: code, referralParent: parent });
          onAuth();
        }
      } catch {}
    });
    return () => sub.remove();
  }, [loginWithInvite, onAuth]);

  if (isAuthenticated) return null;

  const submit = () => {
    if (!INVITE_RE.test(sanitized)) {
      setError(t('auth.invalidInvite'));
      return;
    }
    setError(null);
    loginWithInvite({ inviteCode: sanitized });
    onAuth();
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('auth.inviteOnlyTitle')}</Text>
      <Text style={styles.sub}>{t('auth.inviteOnlySub')}</Text>

      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={t('auth.invitePlaceholder')}
          placeholderTextColor={Colors.text.muted}
        />
      </View>

      {error && <Text style={styles.err}>{error}</Text>}

      <TouchableOpacity style={styles.cta} onPress={submit} activeOpacity={0.85}>
        <Text style={styles.ctaText}>{t('auth.enterWithInvite')}</Text>
      </TouchableOpacity>

      <Text style={styles.note}>{t('auth.privacyNote')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg.void, padding: Spacing[6], justifyContent: 'center', gap: Spacing[4] },
  title: { color: Colors.text.primary, fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading },
  sub: { color: Colors.text.secondary, fontSize: Typography.size.base, lineHeight: 22 },
  inputWrap: { borderWidth: 1, borderColor: Colors.border.default, borderRadius: Radius.md, backgroundColor: Colors.bg.surface },
  input: { color: Colors.text.primary, padding: Spacing[4], fontSize: Typography.size.base, letterSpacing: 1 },
  err: { color: Colors.status.disconnected, fontSize: Typography.size.sm },
  cta: { backgroundColor: Colors.emerald[400], padding: Spacing[4], borderRadius: Radius.md, alignItems: 'center' },
  ctaText: { color: Colors.text.inverse, fontFamily: Typography.family.heading },
  note: { color: Colors.text.muted, fontSize: Typography.size.xs },
});
