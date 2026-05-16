import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, ScrollView, Platform, Animated,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';

const { width: W } = Dimensions.get('window');

interface Slide {
  icon:     string;
  title:    string;
  subtitle: string;
  accent:   string;
}

const SLIDES: Slide[] = [
  {
    icon:     '🛡',
    title:    'Bypass any\nrestriction.',
    subtitle: 'SetaLink uses next-gen VLESS+Reality protocols that are\nindistinguishable from normal HTTPS traffic.',
    accent:   Colors.emerald[400],
  },
  {
    icon:     '🤖',
    title:    'AI-powered\nrouting.',
    subtitle: 'Our Smart AI engine picks the fastest server and protocol\nautomatically — no configuration needed.',
    accent:   '#3399FF',
  },
  {
    icon:     '🔒',
    title:    'Zero logs,\never.',
    subtitle: 'We never store connection logs, IP addresses, or traffic data.\nYour privacy is the product.',
    accent:   '#B47AFF',
  },
];

interface Props {
  onFinish: () => void;
}

export function OnboardingScreen({ onFinish }: Props) {
  const [index, setIndex]   = useState(0);
  const scrollRef           = useRef<ScrollView>(null);
  const buttonScale         = useRef(new Animated.Value(1)).current;

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

  const isLast = index === SLIDES.length - 1;
  const slide  = SLIDES[index]!;

  return (
    <View style={styles.screen}>
      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={32}
        style={styles.pager}
      >
        {SLIDES.map((s, i) => (
          <View key={i} style={styles.slide}>
            {/* Large icon */}
            <View style={[styles.iconWrap, { borderColor: s.accent + '30', shadowColor: s.accent }]}>
              <Text style={styles.iconEmoji}>{s.icon}</Text>
              {/* Ambient glow ring */}
              <View style={[styles.glowRing, { borderColor: s.accent + '18' }]} />
            </View>

            <Text style={[styles.slideTitle, { color: Colors.text.primary }]}>{s.title}</Text>
            <Text style={styles.slideSubtitle}>{s.subtitle}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Bottom section */}
      <View style={styles.footer}>
        {/* Dots */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <View
                style={[
                  styles.dot,
                  i === index && { width: 24, backgroundColor: slide.accent },
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA */}
        <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%' }}>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: slide.accent }]}
            onPress={() => { isLast ? onFinish() : goTo(index + 1); }}
            onPressIn={pressIn}
            onPressOut={pressOut}
            activeOpacity={1}
          >
            <Text style={styles.ctaText}>
              {isLast ? 'Get Started' : 'Next'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Skip (hidden on last slide) */}
        {!isLast && (
          <TouchableOpacity onPress={onFinish} style={styles.skipBtn}>
            <Text style={styles.skipText}>Skip</Text>
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
  pager: {
    flex: 1,
  },
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
  iconEmoji: {
    fontSize: 72,
  },
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
    fontSize:   Typography.size.base,
    fontFamily: Typography.family.heading,
    color:      Colors.text.inverse,
    letterSpacing: Typography.tracking.wide,
  },
  skipBtn: {
    paddingVertical: Spacing[2],
  },
  skipText: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
  },
});
