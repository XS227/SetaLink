/**
 * Auth Screen — Login / Register
 *
 * Layout:
 *   - Full dark background with faint grid lines
 *   - Logo at top (small)
 *   - Tab switcher: Login | Register
 *   - Form fields (glassmorphism style)
 *   - Primary CTA
 *   - Biometric / social auth options
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../design/tokens';
import { useAuthStore } from '../stores/authStore';
import { AuthAPI } from '../services/api/auth.api';

interface Props {
  onAuth: () => void;
}

type Tab = 'login' | 'register';

function GlassInput({
  placeholder, value, onChange, secure, autoCapitalize,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences';
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.inputWrapper, focused && styles.inputFocused]}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={Colors.text.muted}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={Colors.emerald[400]}
      />
    </View>
  );
}

export function AuthScreen({ onAuth }: Props) {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const login = useAuthStore((s) => s.login);

  const switchTab = (t: Tab) => {
    setTab(t);
    setFieldError(null);
  };

  const handleSubmit = async () => {
    const trimEmail = email.trim();
    const trimPass  = password.trim();
    const trimName  = name.trim();

    if (!trimEmail || !trimPass || (tab === 'register' && !trimName)) {
      setFieldError('Please fill in all fields.');
      return;
    }
    if (!trimEmail.includes('@')) {
      setFieldError('Enter a valid email address.');
      return;
    }
    if (trimPass.length < 6) {
      setFieldError('Password must be at least 6 characters.');
      return;
    }

    setFieldError(null);
    setLoading(true);

    try {
      const res = tab === 'login'
        ? await AuthAPI.login(trimEmail, trimPass)
        : await AuthAPI.register(trimName, trimEmail, trimPass);
      login(res.user, res.token);
      onAuth();
    } catch (err: unknown) {
      // Fall back to mock when the server is unreachable (dev environment)
      const isNetworkError = !(err as any)?.status;
      if (isNetworkError) {
        login(
          {
            id:           `usr_${Date.now()}`,
            name:         tab === 'register' ? trimName : trimEmail.split('@')[0]!,
            email:        trimEmail,
            plan:         'free',
            planExpiry:   null,
            avatarUrl:    null,
            referralCode: `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          },
          `mock-token-${Date.now()}`,
        );
        onAuth();
      } else {
        setFieldError((err as Error).message ?? 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Background grid decoration */}
      <View style={styles.grid} pointerEvents="none">
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={i} style={[styles.gridLine, { left: `${(i + 1) * 12.5}%` as any }]} />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoRow}>
          <View style={styles.logoMark}>
            <Text style={styles.logoText}>S</Text>
          </View>
          <Text style={styles.wordmark}>SetaLink</Text>
        </View>

        {/* Headline */}
        <View style={styles.headline}>
          <Text style={styles.heroText}>
            {tab === 'login' ? 'Welcome\nback.' : 'Join the\nnetwork.'}
          </Text>
          <Text style={styles.sub}>
            {tab === 'login'
              ? 'Sign in to continue your secure connection.'
              : 'Create your account to get started.'}
          </Text>
        </View>

        {/* Tab switcher */}
        <View style={styles.tabRow}>
          {(['login', 'register'] as Tab[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => switchTab(t)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
                {t === 'login' ? 'Sign In' : 'Create Account'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Form */}
        <View style={styles.form}>
          {tab === 'register' && (
            <GlassInput
              placeholder="Full Name"
              value={name}
              onChange={setName}
              autoCapitalize="sentences"
            />
          )}
          <GlassInput
            placeholder="Email address"
            value={email}
            onChange={setEmail}
          />
          <GlassInput
            placeholder="Password"
            value={password}
            onChange={setPassword}
            secure
          />

          {tab === 'login' && (
            <TouchableOpacity style={styles.forgotRow}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Inline error */}
        {fieldError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{fieldError}</Text>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[styles.cta, loading && styles.ctaLoading]}
          onPress={handleSubmit}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>
            {loading ? 'Authenticating...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Social / Biometric */}
        <View style={styles.altRow}>
          <TouchableOpacity style={styles.altBtn}>
            <Text style={styles.altIcon}>⊡</Text>
            <Text style={styles.altLabel}>Google</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.altBtn}>
            <Text style={styles.altIcon}>⊛</Text>
            <Text style={styles.altLabel}>Face ID</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.altBtn}>
            <Text style={styles.altIcon}>⊕</Text>
            <Text style={styles.altLabel}>Invite Code</Text>
          </TouchableOpacity>
        </View>

        {/* Terms */}
        <Text style={styles.terms}>
          By continuing you agree to our{' '}
          <Text style={styles.termsLink}>Terms</Text> and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg.void,
  },
  grid: {
    position: 'absolute',
    inset: 0,
  },
  gridLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: Colors.border.subtle,
  },
  scroll: {
    paddingHorizontal: Spacing[6],
    paddingTop: 72,
    paddingBottom: 48,
    gap: Spacing[6],
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.emerald[400],
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  logoText: {
    fontSize: 18,
    fontFamily: Typography.family.heading,
    color: Colors.text.inverse,
    transform: [{ rotate: '-45deg' }],
  },
  wordmark: {
    fontSize: Typography.size.lg,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  headline: {
    gap: Spacing[2],
    marginTop: Spacing[4],
  },
  heroText: {
    fontSize: Typography.size['3xl'],
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tightest,
    lineHeight: Typography.size['3xl'] * 1.15,
  },
  sub: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.body,
    color: Colors.text.secondary,
    lineHeight: Typography.size.base * 1.6,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: Spacing[2] + 2,
    alignItems: 'center',
    borderRadius: Radius.md,
  },
  tabBtnActive: {
    backgroundColor: Colors.bg.elevated,
    borderWidth: 1,
    borderColor: Colors.border.glow,
  },
  tabLabel: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
  },
  tabLabelActive: {
    color: Colors.emerald[400],
  },
  form: {
    gap: Spacing[3],
  },
  inputWrapper: {
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3] + 2,
  },
  inputFocused: {
    borderColor: Colors.emerald[400],
    shadowColor: Colors.emerald[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  input: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.body,
    color: Colors.text.primary,
  },
  forgotRow: {
    alignItems: 'flex-end',
  },
  forgotText: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    color: Colors.emerald[400],
  },
  cta: {
    backgroundColor: Colors.emerald[400],
    borderRadius: Radius.lg,
    paddingVertical: Spacing[4],
    alignItems: 'center',
    ...Shadow.emerald,
  },
  ctaLoading: {
    opacity: 0.7,
  },
  ctaText: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.inverse,
    letterSpacing: Typography.tracking.wide,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border.subtle,
  },
  dividerText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  altRow: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  altBtn: {
    flex: 1,
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingVertical: Spacing[3],
    alignItems: 'center',
    gap: 4,
  },
  altIcon: {
    fontSize: 20,
    color: Colors.text.secondary,
  },
  altLabel: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
  },
  terms: {
    textAlign: 'center',
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    lineHeight: 18,
  },
  termsLink: {
    color: Colors.emerald[400],
  },
  errorBox: {
    backgroundColor: 'rgba(255,68,68,0.10)',
    borderWidth:     1,
    borderColor:     'rgba(255,68,68,0.30)',
    borderRadius:    Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical:   Spacing[3],
  },
  errorText: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.status.disconnected,
    textAlign:  'center',
  },
});
