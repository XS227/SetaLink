import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, ScrollView, Animated,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { useT, TKey } from '../i18n';
import { useIdentityStore } from '../stores/identityStore';
import { getStableDeviceId } from '../services/deviceIdentityService';
import { reserveHandle } from '../services/handleService';
import { suggestHandle } from '../utils/handle';

const { width: W } = Dimensions.get('window');

interface Props {
  onFinish: () => void;
}

// B-20: 6 vision slides ("the first VPN game" pitch) + a King/Queen persona
// pick, replacing the old 3 tech-feature slides. Persona stays editable
// later — not a one-time-only choice.
//
// 2026-07-24 (Khabat): dropped the nickname/handle-picking step — letting
// users choose their own profile ID was making onboarding look like it
// "didn't recognize" a returning device (same underlying issue as B-20's
// original re-prompt bug, A→B(95)). A handle still gets claimed — just
// silently, auto-suggested from the device id, no user-facing picker
// anywhere right now (the only other entry point, EditIdentitySheet, is
// already orphaned — its one caller was the old ProfileScreen.tsx, removed
// 2026-07-24 in the branding cleanup).
type VisionStep = { kind: 'vision'; icon: string; titleKey: TKey; subKey: TKey; accent: string };
type PersonaStep = { kind: 'persona' };
type Step = VisionStep | PersonaStep;

const VISION: VisionStep[] = [
  { kind: 'vision', icon: '🛡',  titleKey: 'ob.s1.title', subKey: 'ob.s1.sub', accent: Colors.emerald[400] },
  { kind: 'vision', icon: '🎮',  titleKey: 'ob.s2.title', subKey: 'ob.s2.sub', accent: Colors.gold[400] },
  { kind: 'vision', icon: '🎬',  titleKey: 'ob.s3.title', subKey: 'ob.s3.sub', accent: '#3399FF' },
  { kind: 'vision', icon: '🤝',  titleKey: 'ob.s4.title', subKey: 'ob.s4.sub', accent: '#C77DFF' },
  { kind: 'vision', icon: '🪪',  titleKey: 'ob.s5.title', subKey: 'ob.s5.sub', accent: Colors.emerald[400] },
  { kind: 'vision', icon: '🌐',  titleKey: 'ob.s6.title', subKey: 'ob.s6.sub', accent: Colors.gold[400] },
];

const STEPS: Step[] = [...VISION, { kind: 'persona' }];

export function OnboardingScreen({ onFinish }: Props) {
  const { t, isRTL } = useT();
  const [index, setIndex]   = useState(0);
  const scrollRef           = useRef<ScrollView>(null);
  const buttonScale         = useRef(new Animated.Value(1)).current;

  const persona       = useIdentityStore((s) => s.persona);
  const setPersona    = useIdentityStore((s) => s.setPersona);
  const seedFromId    = useIdentityStore((s) => s.seedFromId);
  const setHandleState = useIdentityStore((s) => s.setHandleState);
  const hasHandle     = useIdentityStore((s) => !!s.handle);

  // Silent handle claim — no UI, no user input. seedFromId is the store's
  // own idempotent seeding action (already existed, just never had a live
  // caller — its one previous caller, IdentityHeader.tsx, is orphaned,
  // see comment above STEPS) — it sets handle+avatar without marking
  // `customized`, unlike setHandle(), which is important: `customized`
  // gates other identity logic (e.g. whether the handle should ever be
  // treated as user-picked) and a silent auto-seed must never look like
  // an explicit user choice.
  useEffect(() => {
    if (hasHandle) return;
    getStableDeviceId()
      .then(async (id) => {
        seedFromId(id);
        try {
          const r = await reserveHandle(suggestHandle(id), id);
          setHandleState(r.source === 'backend' && r.available ? 'reserved' : 'local');
        } catch {
          // seedFromId above already set a local-state handle — fine as is.
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHandle]);

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * W, animated: true });
    setIndex(i);
  };

  const handleScroll = (e: any) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / W);
    if (page !== index) setIndex(page);
  };

  const pressIn  = () => Animated.spring(buttonScale, { toValue: 0.95, useNativeDriver: true, speed: 20 }).start();
  const pressOut = () => Animated.spring(buttonScale, { toValue: 1,    useNativeDriver: true, speed: 20 }).start();

  const isLast = index === STEPS.length - 1;
  const step   = STEPS[index]!;
  const accent = step.kind === 'vision' ? step.accent : Colors.gold[400];

  const handleNext = useCallback(() => {
    if (!isLast) { goTo(index + 1); return; }
    onFinish();
  }, [isLast, index, onFinish]);

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={32}
        style={styles.pager}
      >
        {STEPS.map((s, i) => (
          <View key={i} style={styles.slide}>
            {s.kind === 'vision' && (
              <>
                <View style={[styles.iconWrap, { borderColor: s.accent + '30', shadowColor: s.accent }]}>
                  <Text style={styles.iconEmoji}>{s.icon}</Text>
                  <View style={[styles.glowRing, { borderColor: s.accent + '18' }]} />
                </View>
                <Text style={[styles.slideTitle, { color: Colors.text.primary }, isRTL && styles.rtl]}>
                  {t(s.titleKey)}
                </Text>
                <Text style={[styles.slideSubtitle, isRTL && styles.rtl]}>{t(s.subKey)}</Text>
              </>
            )}

            {s.kind === 'persona' && (
              <>
                <Text style={styles.personaEmojiHero}>👑</Text>
                <Text style={[styles.slideTitle, { color: Colors.text.primary }, isRTL && styles.rtl]}>
                  {t('ob.persona.title')}
                </Text>
                <Text style={[styles.slideSubtitle, isRTL && styles.rtl]}>{t('ob.persona.sub')}</Text>
                <View style={styles.personaRow}>
                  <TouchableOpacity
                    style={[styles.personaChoice, persona === 'king' && styles.personaChoiceActive]}
                    onPress={() => setPersona('king')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.personaChoiceEmoji}>👑</Text>
                    <Text style={styles.personaChoiceLabel}>{t('ob.persona.king')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.personaChoice, persona === 'queen' && styles.personaChoiceActive]}
                    onPress={() => setPersona('queen')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.personaChoiceEmoji}>👸</Text>
                    <Text style={styles.personaChoiceLabel}>{t('ob.persona.queen')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <View
                style={[
                  styles.dot,
                  i === index && { width: 24, backgroundColor: accent },
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%' }}>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: accent }]}
            onPress={handleNext}
            onPressIn={pressIn}
            onPressOut={pressOut}
            activeOpacity={1}
          >
            <Text style={styles.ctaText}>{isLast ? t('ob.getStarted') : t('ob.next')}</Text>
          </TouchableOpacity>
        </Animated.View>

        {!isLast && (
          <TouchableOpacity onPress={onFinish} style={styles.skipBtn}>
            <Text style={styles.skipText}>{t('ob.skip')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: Colors.bg.void,
    paddingTop:      Layout.statusBarHeight,
  },
  pager:  { flex: 1 },
  slide: {
    width:          W,
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[8],
    gap:            Spacing[6],
  },
  iconWrap: {
    width:           160,
    height:          160,
    borderRadius:    80,
    borderWidth:     1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: Colors.bg.surface,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.4,
    shadowRadius:    40,
    elevation:       12,
    marginBottom:    Spacing[4],
  },
  glowRing: {
    position:     'absolute',
    width:         200,
    height:        200,
    borderRadius:  100,
    borderWidth:   1,
  },
  iconEmoji: { fontSize: 72 },
  personaEmojiHero: { fontSize: 56, marginBottom: -Spacing[2] },
  slideTitle: {
    fontSize:      Typography.size['3xl'],
    fontFamily:    Typography.family.heading,
    letterSpacing: Typography.tracking.tightest,
    lineHeight:    Typography.size['3xl'] * 1.15,
    textAlign:     'center',
  },
  slideSubtitle: {
    fontSize:   Typography.size.base,
    fontFamily: Typography.family.body,
    color:      Colors.text.secondary,
    textAlign:  'center',
    lineHeight: Typography.size.base * 1.65,
  },
  rtl: { writingDirection: 'rtl', textAlign: 'center' },

  personaRow:    { flexDirection: 'row', gap: Spacing[4], width: '100%' },
  personaChoice: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: Spacing[4], borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface },
  personaChoiceActive: { borderColor: Colors.gold[400], backgroundColor: Colors.gold[400] + '1A' },
  personaChoiceEmoji: { fontSize: 34 },
  personaChoiceLabel: { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },

  footer: {
    paddingHorizontal: Layout.screenPadding,
    paddingBottom:     Layout.bottomNavHeight,
    paddingTop:        Spacing[6],
    gap:               Spacing[4],
    alignItems:        'center',
  },
  dots: {
    flexDirection: 'row',
    gap:           Spacing[2],
    alignItems:    'center',
  },
  dot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: Colors.border.default,
  },
  cta: {
    width:           '100%',
    borderRadius:    Radius.lg,
    paddingVertical: Spacing[4],
    alignItems:      'center',
  },
  ctaText: {
    fontSize:      Typography.size.base,
    fontFamily:    Typography.family.heading,
    color:         Colors.text.inverse,
    letterSpacing: Typography.tracking.wide,
  },
  skipBtn:  { paddingVertical: Spacing[2] },
  skipText: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
  },
});
