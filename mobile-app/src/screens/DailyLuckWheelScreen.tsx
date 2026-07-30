/**
 * DailyLuckWheelScreen — UI-only preview screen for the daily luck wheel
 * (Khabat, 2026-07-30). See DailyLuckWheel.tsx's own header for exactly
 * what is and isn't real here: the wheel spins, colors, and lands on a
 * real (locale-correct) prize name each time, and "already spun today" is
 * now genuinely persisted device-side — but nothing is wired to the real
 * economy yet (no server call, no actual grant of the prize landed on).
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { DailyLuckWheel } from '../components/DailyLuckWheel';
import { useT } from '../i18n';

interface Props {
  onBack: () => void;
}

export function DailyLuckWheelScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useT();

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
          <DailyLuckWheel />
        </GlassCard>

        <Text style={styles.previewNote}>{t('dailyluck.previewNote')}</Text>
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

  previewNote: {
    fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body,
    textAlign: 'center', fontStyle: 'italic', paddingHorizontal: Spacing[4],
    borderTopWidth: 1, borderTopColor: Colors.border.subtle, paddingTop: Spacing[3], marginTop: Spacing[2],
  },
});
