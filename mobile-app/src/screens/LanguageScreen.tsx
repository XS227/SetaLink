import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { useSettingsStore } from '../stores/settingsStore';
import { SUPPORTED_LANGUAGES, type Lang } from '../i18n';

interface Props {
  onSelect: () => void;
}

export function LanguageScreen({ onSelect }: Props) {
  const { language, setLanguage, completeLanguageSelection } = useSettingsStore();
  const currentLang: Lang = language === 'فارسی' ? 'fa' : 'en';

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSelect = (code: Lang) => {
    setLanguage(code === 'fa' ? 'فارسی' : 'English');
  };

  const handleContinue = () => {
    completeLanguageSelection();
    onSelect();
  };

  const label = currentLang === 'fa'
    ? { title: 'زبان خود را انتخاب کنید', subtitle: 'می‌توانید این را بعداً در تنظیمات تغییر دهید', continue: 'ادامه' }
    : { title: 'Choose your language',    subtitle: 'You can change this later in Settings',         continue: 'Continue' };

  return (
    <View style={styles.screen}>
      {/* Logo / globe */}
      <Animated.View style={[styles.top, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.globe}>
          <Text style={styles.globeEmoji}>🌐</Text>
        </View>
        <Text style={[styles.title, currentLang === 'fa' && styles.rtlText]}>{label.title}</Text>
        <Text style={[styles.subtitle, currentLang === 'fa' && styles.rtlText]}>{label.subtitle}</Text>
      </Animated.View>

      {/* Language options */}
      <Animated.View style={[styles.options, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {SUPPORTED_LANGUAGES.map((lang) => {
          const isSelected = lang.code === currentLang;
          return (
            <TouchableOpacity
              key={lang.code}
              style={[styles.option, isSelected && styles.optionActive]}
              onPress={() => handleSelect(lang.code)}
              activeOpacity={0.75}
            >
              <View style={styles.optionLeft}>
                <Text style={styles.optionFlag}>
                  {lang.code === 'en' ? '🇬🇧' : '🇮🇷'}
                </Text>
                <View>
                  <Text style={[styles.optionNative, isSelected && styles.optionActiveText]}>
                    {lang.nativeLabel}
                  </Text>
                  <Text style={styles.optionLabel}>{lang.label}</Text>
                </View>
              </View>
              <View style={[styles.radio, isSelected && styles.radioActive]}>
                {isSelected && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </Animated.View>

      {/* Continue button */}
      <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={handleContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>{label.continue}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: Colors.bg.void,
    paddingTop:      Layout.statusBarHeight + Spacing[8],
    paddingHorizontal: Layout.screenPadding,
    justifyContent:  'center',
  },
  top: {
    alignItems: 'center',
    gap:        Spacing[4],
    marginBottom: Spacing[10],
  },
  globe: {
    width:           100,
    height:          100,
    borderRadius:    50,
    backgroundColor: Colors.bg.surface,
    borderWidth:     1,
    borderColor:     Colors.border.glow,
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     Colors.emerald[400],
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.3,
    shadowRadius:    20,
    elevation:       8,
  },
  globeEmoji: { fontSize: 48 },
  title: {
    fontSize:      Typography.size['2xl'],
    fontFamily:    Typography.family.heading,
    color:         Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
    textAlign:     'center',
  },
  subtitle: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
    textAlign:  'center',
    lineHeight: Typography.size.sm * 1.6,
  },
  rtlText: {
    textAlign:        'center',
    writingDirection: 'rtl',
  },
  options: {
    gap: Spacing[3],
  },
  option: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.bg.surface,
    borderRadius:    Radius.xl,
    borderWidth:     1,
    borderColor:     Colors.border.default,
    padding:         Spacing[5],
  },
  optionActive: {
    borderColor:     Colors.border.glow,
    backgroundColor: 'rgba(0,232,122,0.05)',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing[4],
  },
  optionFlag:        { fontSize: 32 },
  optionNative: {
    fontSize:   Typography.size.base,
    fontFamily: Typography.family.heading,
    color:      Colors.text.primary,
  },
  optionActiveText:  { color: Colors.emerald[400] },
  optionLabel: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
    marginTop:  2,
  },
  radio: {
    width:        22,
    height:       22,
    borderRadius: 11,
    borderWidth:  2,
    borderColor:  Colors.border.default,
    alignItems:   'center',
    justifyContent: 'center',
  },
  radioActive:  { borderColor: Colors.emerald[400] },
  radioInner: {
    width:        10,
    height:       10,
    borderRadius: 5,
    backgroundColor: Colors.emerald[400],
  },
  footer: {
    marginTop: Spacing[10],
  },
  continueBtn: {
    backgroundColor: Colors.emerald[400],
    borderRadius:    Radius.lg,
    paddingVertical: Spacing[4],
    alignItems:      'center',
    shadowColor:     Colors.emerald[400],
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.5,
    shadowRadius:    12,
    elevation:       8,
  },
  continueBtnText: {
    fontSize:      Typography.size.base,
    fontFamily:    Typography.family.heading,
    color:         Colors.text.inverse,
    letterSpacing: Typography.tracking.wide,
  },
});
