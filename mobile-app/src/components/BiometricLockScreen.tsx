import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { BiometricService } from '../services/biometricService';

interface Props {
  visible: boolean;
  onUnlock: () => void;
}

export function BiometricLockScreen({ visible, onUnlock }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const handleAuthenticate = async () => {
    setError(null);
    setLoading(true);
    try {
      const available = await BiometricService.isAvailable();
      if (!available) {
        setUnavailable(true);
        setLoading(false);
        return;
      }
      const success = await BiometricService.authenticate('SetaLink', 'Unlock app');
      if (success) {
        onUnlock();
      }
    } catch (e: any) {
      if (e?.code !== 'USER_CANCELED') {
        setError(e?.message ?? 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setError(null);
      setUnavailable(false);
      // Auto-trigger biometric on show
      handleAuthenticate();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" statusBarTranslucent>
      <View style={styles.container}>
        <View style={styles.lockOrb}>
          <Text style={styles.lockIcon}>🔒</Text>
        </View>
        <Text style={styles.title}>SetaLink</Text>
        <Text style={styles.subtitle}>App is locked</Text>

        {unavailable ? (
          <Text style={styles.errorText}>
            Biometric authentication is not available on this device.{'\n'}
            Please check your device settings.
          </Text>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.unlockBtn, loading && styles.unlockBtnLoading]}
          onPress={handleAuthenticate}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.unlockBtnText}>
            {loading ? 'Authenticating…' : unavailable ? 'Unavailable' : 'Unlock with Biometrics'}
          </Text>
        </TouchableOpacity>
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
  errorText:        { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.status.disconnected, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
  unlockBtn:        { marginTop: Spacing[4], paddingHorizontal: 40, paddingVertical: Spacing[4], backgroundColor: Colors.emerald[400], borderRadius: Radius.lg, minWidth: 220, alignItems: 'center' },
  unlockBtnLoading: { opacity: 0.6 },
  unlockBtnText:    { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.inverse, letterSpacing: 0.3 },
});
