import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { trackEvent } from '../services/analytics';

interface Props  { children: React.ReactNode; fallbackLabel?: string }
interface State   { hasError: boolean; message: string; stack: string }

// TEMPORARY (Khabat, 2026-07-21, v0.9.80 startup-regression investigation):
// the real error/stack now always renders below the generic message — not
// gated behind __DEV__ — so a beta crash is diagnosable from a screenshot
// instead of a blank "Something went wrong". Revert to __DEV__-only once a
// real crash reporter (Sentry/Bugsnag) is wired up.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '', stack: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message, stack: error.stack ?? '' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
    // Best-effort remote visibility — trackEvent never throws, never blocks,
    // and doesn't need auth/device-id lookup, so it's safe to call from a
    // crash handler that must not itself be able to fail.
    try {
      trackEvent('JS_FATAL_ERROR', undefined, {
        message:         error.message,
        stack:           (error.stack ?? '').slice(0, 2000),
        componentStack:  (info.componentStack ?? '').slice(0, 2000),
      });
    } catch { /* never let crash reporting break the crash screen */ }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '', stack: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.icon}>⚠</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            {this.props.fallbackLabel ?? 'An unexpected error occurred.'}
          </Text>
          <Text style={styles.devMessage} numberOfLines={8} selectable>
            {this.state.message}
            {this.state.stack ? `\n\n${this.state.stack}` : ''}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={this.handleRetry} activeOpacity={0.8}>
            <Text style={styles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: Colors.bg.base,
    alignItems:      'center',
    justifyContent:  'center',
    padding:         Spacing[6],
  },
  card: {
    width:           '100%',
    backgroundColor: Colors.bg.surface,
    borderRadius:    Radius['2xl'],
    borderWidth:     1,
    borderColor:     Colors.border.default,
    padding:         Spacing[6],
    alignItems:      'center',
    gap:             Spacing[4],
  },
  icon: {
    fontSize: 40,
    color:    Colors.status.disconnected,
  },
  title: {
    fontSize:   Typography.size.xl,
    fontFamily: Typography.family.heading,
    color:      Colors.text.primary,
    textAlign:  'center',
  },
  subtitle: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.text.secondary,
    textAlign:  'center',
    lineHeight: 22,
  },
  devMessage: {
    fontSize:        Typography.size.xs,
    fontFamily:      Typography.family.mono,
    color:           Colors.text.muted,
    textAlign:       'left',
    backgroundColor: Colors.bg.void,
    padding:         Spacing[3],
    borderRadius:    Radius.md,
    width:           '100%',
  },
  btn: {
    backgroundColor: Colors.emerald[400],
    borderRadius:    Radius.lg,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[6],
    marginTop:       Spacing[2],
  },
  btnText: {
    fontSize:   Typography.size.base,
    fontFamily: Typography.family.heading,
    color:      Colors.text.inverse,
  },
});
