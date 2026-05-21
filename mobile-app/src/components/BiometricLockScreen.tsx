import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { BiometricService } from '../services/biometricService';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n';

interface Props {
  visible: boolean;
  onUnlock: () => void;
}

type Mode = 'bio' | 'pin-entry' | 'pin-create' | 'pin-confirm';

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export function BiometricLockScreen({ visible, onUnlock }: Props) {
  const { t } = useT();
  const pinCode  = useAuthStore((s) => s.pinCode);
  const storePin = useAuthStore((s) => s.setPin);
  const verify   = useAuthStore((s) => s.verifyPin);

  const [mode, setMode]         = useState<Mode>('bio');
  const [entered, setEntered]   = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const tryBiometric = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const available = await BiometricService.isAvailable();
      if (!available) {
        setMode(pinCode ? 'pin-entry' : 'pin-create');
        setLoading(false);
        return;
      }
      const success = await BiometricService.authenticate('SetaLink', t('lock.unlock'));
      if (success) { onUnlock(); return; }
      setMode(pinCode ? 'pin-entry' : 'pin-create');
    } catch (e: any) {
      if (e?.code !== 'USER_CANCELED') {
        setMode(pinCode ? 'pin-entry' : 'pin-create');
      }
    } finally {
      setLoading(false);
    }
  }, [pinCode, onUnlock, t]);

  useEffect(() => {
    if (visible) {
      setError(null);
      setEntered('');
      setFirstPin('');
      setMode('bio');
      tryBiometric();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDigit = (d: string) => {
    if (d === '⌫') {
      setEntered((p) => p.slice(0, -1));
      return;
    }
    if (!d) return;
    const next = entered + d;
    if (next.length > 4) return;
    setEntered(next);

    if (next.length < 4) return;

    setError(null);

    if (mode === 'pin-entry') {
      if (verify(next)) {
        onUnlock();
      } else {
        setError(t('lock.wrongPin'));
        setEntered('');
      }
    } else if (mode === 'pin-create') {
      setFirstPin(next);
      setEntered('');
      setMode('pin-confirm');
    } else if (mode === 'pin-confirm') {
      if (next === firstPin) {
        storePin(next);
        onUnlock();
      } else {
        setError(t('lock.pinMismatch'));
        setEntered('');
        setMode('pin-create');
        setFirstPin('');
      }
    }
  };

  if (!visible) return null;

  const isPinMode = mode === 'pin-entry' || mode === 'pin-create' || mode === 'pin-confirm';

  const modeTitle = mode === 'pin-entry'   ? t('lock.enterPin')
                  : mode === 'pin-create'  ? t('lock.createPin')
                  : mode === 'pin-confirm' ? t('lock.confirmPin')
                  : t('lock.locked');

  const modeHint = mode === 'pin-create'  ? t('lock.createPinHint')
                 : mode === 'pin-confirm' ? t('lock.confirmPinHint')
                 : mode === 'pin-entry'   ? t('lock.enterPinHint')
                 : '';

  return (
    <Modal visible={visible} transparent={false} animationType="fade" statusBarTranslucent>
      <View style={styles.container}>
        <View style={styles.lockOrb}>
          <Text style={styles.lockIcon}>🔒</Text>
        </View>
        <Text style={styles.title}>SetaLink</Text>
        <Text style={styles.subtitle}>{modeTitle}</Text>

        {modeHint ? <Text style={styles.hint}>{modeHint}</Text> : null}
        {error    ? <Text style={styles.errorText}>{error}</Text> : null}

        {isPinMode ? (
          <>
            {/* PIN dots */}
            <View style={styles.dotsRow}>
              {[0,1,2,3].map((i) => (
                <View
                  key={i}
                  style={[styles.dot, i < entered.length && styles.dotFilled]}
                />
              ))}
            </View>

            {/* Numpad */}
            <View style={styles.numpad}>
              {DIGITS.map((d, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.numKey, !d && d !== '0' && { opacity: 0 }]}
                  onPress={() => handleDigit(d)}
                  disabled={!d && d !== '0'}
                  activeOpacity={0.7}
                >
                  <Text style={styles.numKeyText}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Switch back to biometrics if was not the initial mode */}
            {mode === 'pin-entry' && (
              <TouchableOpacity style={styles.bioFallback} onPress={tryBiometric} disabled={loading}>
                <Text style={styles.bioFallbackText}>{t('lock.tryBio')}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          /* Biometric mode */
          <TouchableOpacity
            style={[styles.unlockBtn, loading && styles.unlockBtnLoading]}
            onPress={tryBiometric}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.unlockBtnText}>
              {loading ? t('lock.authenticating') : t('lock.unlock')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: Colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: Spacing[4] },
  lockOrb:          { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,232,122,0.08)', borderWidth: 2, borderColor: Colors.emerald[400], alignItems: 'center', justifyContent: 'center', marginBottom: Spacing[2] },
  lockIcon:         { fontSize: 36 },
  title:            { fontSize: 28, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: -0.5 },
  subtitle:         { fontSize: Typography.size.base, fontFamily: Typography.family.body, color: Colors.text.muted },
  hint:             { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', paddingHorizontal: 40 },
  errorText:        { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.status.disconnected, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },

  // PIN UI
  dotsRow:          { flexDirection: 'row', gap: Spacing[4], marginTop: Spacing[4] },
  dot:              { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: Colors.border.default, backgroundColor: 'transparent' },
  dotFilled:        { backgroundColor: Colors.emerald[400], borderColor: Colors.emerald[400] },
  numpad:           { flexDirection: 'row', flexWrap: 'wrap', width: 240, marginTop: Spacing[6], gap: 0 },
  numKey:           { width: 80, height: 72, alignItems: 'center', justifyContent: 'center' },
  numKeyText:       { fontSize: 24, fontFamily: Typography.family.heading, color: Colors.text.primary },
  bioFallback:      { marginTop: Spacing[2], paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  bioFallbackText:  { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.blue[400], letterSpacing: 0.2 },

  // Biometric UI
  unlockBtn:        { marginTop: Spacing[4], paddingHorizontal: 40, paddingVertical: Spacing[4], backgroundColor: Colors.emerald[400], borderRadius: Radius.lg, minWidth: 220, alignItems: 'center' },
  unlockBtnLoading: { opacity: 0.6 },
  unlockBtnText:    { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: 0.3 },
});
