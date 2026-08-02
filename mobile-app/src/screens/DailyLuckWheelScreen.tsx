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
import { SlotMachine } from '../components/SlotMachine';
import { FerdowsisScroll } from '../components/FerdowsisScroll';
import { RostamsTrials } from '../components/RostamsTrials';
import { SimorghsFeather } from '../components/SimorghsFeather';
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

        {/* Slot machine (Khabat, 2026-08-02: "en til casino type spill
            som lykkehjulet... spilleautomat") -- same screen as the luck
            wheel above, simplest and most discoverable placement, no new
            nav route needed. Genuinely different game underneath (costs
            a stake, can miss) so it gets its own title/subtitle rather
            than folding into the page header above, which is still
            specifically the luck wheel's own framing. */}
        <Text style={styles.pageTitle}>{t('slots.title')}</Text>
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <SlotMachine deviceId={deviceId} />
        </GlassCard>

        {/* Three more chance-to-win games (docs/NEW_GAMES_SPEC.md,
            Khabat 2026-08-02: "flere spill... som igjen kan både lære
            og la dem prøve sjansen å vinne noe") — same "own title,
            own card, same screen" placement as the slot machine above,
            each teaching real Shahnameh content instead of being pure
            chance. */}
        <Text style={styles.pageTitle}>{t('scroll.title')}</Text>
        <Text style={styles.pageSub}>{t('scroll.subtitle')}</Text>
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <FerdowsisScroll deviceId={deviceId} />
        </GlassCard>

        <Text style={styles.pageTitle}>{t('trials.title')}</Text>
        <Text style={styles.pageSub}>{t('trials.subtitle')}</Text>
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <RostamsTrials deviceId={deviceId} />
        </GlassCard>

        <Text style={styles.pageTitle}>{t('feather.title')}</Text>
        <Text style={styles.pageSub}>{t('feather.subtitle')}</Text>
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <SimorghsFeather deviceId={deviceId} />
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
