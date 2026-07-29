/**
 * TonConnectCard — real TON wallet connection (Khabat, 2026-07-29: "start
 * med TON Connect først", see tonConnectService.ts's header for the full
 * scope/risk notes). Three states: not connected (Connect button), waiting
 * (QR code + "open in Tonkeeper" for same-device), connected (short
 * address + disconnect).
 *
 * Deliberately does NOT show an on-chain balance — no indexer/balance-read
 * integration exists yet (separate, later work), and §5.10's hard rule
 * (never show a simulated TON balance) applies just as much to "we could
 * probably fake this" as it did before wallet connection existed at all.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { useToastStore } from '../stores/toastStore';
import {
  restoreTonConnection, onTonConnectionChange, requestTonConnection, disconnectTonWallet,
  TonConnectedWallet,
} from '../services/tonConnectService';

type Phase = 'idle' | 'connecting' | 'connected';

export function TonConnectCard() {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);

  const [wallet, setWallet] = useState<TonConnectedWallet | null>(null);
  const [phase, setPhase]   = useState<Phase>('idle');
  const [link, setLink]     = useState('');

  useEffect(() => {
    restoreTonConnection().then((w) => {
      if (w) { setWallet(w); setPhase('connected'); }
    });
    const unsubscribe = onTonConnectionChange((w) => {
      setWallet(w);
      setPhase(w ? 'connected' : 'idle');
      if (w) setLink('');
    });
    return unsubscribe;
  }, []);

  const handleConnect = async () => {
    setPhase('connecting');
    const result = await requestTonConnection();
    if (result.ok) {
      setLink(result.universalLink);
    } else {
      setPhase('idle');
      showToast(t('wallet.tonConnectError'), 'error');
    }
  };

  const handleDisconnect = async () => {
    await disconnectTonWallet();
    setWallet(null);
    setPhase('idle');
  };

  return (
    <GlassCard style={styles.card}>
      <Text style={styles.cardTitle}>{t('wallet.tonTitle')}</Text>

      {phase === 'connected' && wallet ? (
        <View style={styles.connectedRow}>
          <View>
            <Text style={styles.connectedLabel}>{t('wallet.tonConnected')}</Text>
            <Text style={styles.address}>{wallet.addressFriendly}</Text>
            <Text style={styles.balancePlaceholder}>{t('wallet.tonBalanceComingSoon')}</Text>
          </View>
          <TouchableOpacity style={styles.disconnectBtn} activeOpacity={0.8} onPress={handleDisconnect}>
            <Text style={styles.disconnectBtnText}>{t('wallet.tonDisconnect')}</Text>
          </TouchableOpacity>
        </View>
      ) : phase === 'connecting' && link ? (
        <View style={styles.connectingWrap}>
          <View style={styles.qrWrap}>
            <QRCode value={link} size={160} backgroundColor={Colors.bg.surface} color={Colors.text.primary} />
          </View>
          <Text style={styles.hint}>{t('wallet.tonScanHint')}</Text>
          <TouchableOpacity
            style={styles.openBtn}
            activeOpacity={0.85}
            onPress={() => Linking.openURL(link).catch(() => {})}
          >
            <Text style={styles.openBtnText}>{t('wallet.tonOpenTonkeeper')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.connectBtn, phase === 'connecting' && styles.connectBtnDisabled]}
          activeOpacity={0.85}
          disabled={phase === 'connecting'}
          onPress={handleConnect}
        >
          <Text style={styles.connectBtnText}>
            {phase === 'connecting' ? t('wallet.tonConnecting') : t('wallet.tonConnect')}
          </Text>
        </TouchableOpacity>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card:      { padding: Spacing[4], gap: Spacing[2] },
  cardTitle: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },

  connectBtn: { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center', borderWidth: 1, borderColor: Colors.border.default, marginTop: Spacing[2] },
  connectBtnDisabled: { opacity: 0.6 },
  connectBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.gold[400] },

  connectingWrap: { alignItems: 'center', marginTop: Spacing[3], gap: Spacing[3] },
  qrWrap: { padding: Spacing[3], backgroundColor: Colors.bg.surface, borderRadius: Radius.lg },
  hint: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, textAlign: 'center' },
  openBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[5] },
  openBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },

  connectedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing[2] },
  connectedLabel: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.status.connected, textTransform: 'uppercase', letterSpacing: 0.4 },
  address: { fontSize: 14, fontFamily: Typography.family.mono, color: Colors.text.primary, marginTop: 2 },
  balancePlaceholder: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 4 },
  disconnectBtn: { paddingVertical: Spacing[2], paddingHorizontal: Spacing[3], borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default },
  disconnectBtnText: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted },
});
