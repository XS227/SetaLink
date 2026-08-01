/**
 * DailyLuckWheelScreen — daily luck wheel (Khabat, 2026-07-30). Wired to
 * the real shahnameh-backend spin+grant endpoint 2026-08-01 — see
 * DailyLuckWheel.tsx's own header for the full history (started as a
 * UI-only prototype, server call landed once PR #3 shipped).
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { DailyLuckWheel } from '../components/DailyLuckWheel';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';

interface Props {
  onBack: () => void;
}

export function DailyLuckWheelScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={6} />
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBack, { top: insets.top + Spacing[3] }]}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>{t('dailyluck.title')}</Text>
        <Text style={styles.pageSub}>{t('dailyluck.subtitle')}</Text>

        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <DailyLuckWheel deviceId={deviceId} />
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.void },
  content: { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[3], alignItems: 'center' },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary, alignSelf: 'flex-start' },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[2], alignSelf: 'flex-start' },

  card: { width: '100%', alignItems: 'center', paddingVertical: Spacing[6] },
});
