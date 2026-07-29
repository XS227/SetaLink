/**
 * PeerProfileSheet — a DM peer's public RealGram profile, opened by tapping
 * their avatar in InboxScreen's thread header (Khabat, 2026-07-29: "trykker
 * på profilbilde til sender... se deres realgram profil og offentlig
 * info"). Read-only, no actions — avatar/handle/persona only, the same
 * fields any REAL ecosystem app already shows for a linked identity
 * (ecosystemProfileService.ts's getPeerProfile, api.php's new
 * get-peer-profile action). A peer who's never set a public profile still
 * gets a real, honest state here (their user_id only), not an error.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { getPeerProfile, PeerProfile } from '../services/ecosystemProfileService';

interface Props {
  visible:      boolean;
  peerDeviceId: string;
  onClose:      () => void;
}

export function PeerProfileSheet({ visible, peerDeviceId, onClose }: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<PeerProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !peerDeviceId) return;
    setLoading(true);
    setProfile(null);
    getPeerProfile(peerDeviceId).then((p) => { setProfile(p); setLoading(false); });
  }, [visible, peerDeviceId]);

  const displayName = profile?.display_name || profile?.handle || profile?.user_id || '';
  const hasHandle    = !!(profile?.handle || profile?.display_name);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing[5] }]}>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={Colors.gold[400]} />
            </View>
          ) : (
            <>
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: profile?.avatar_color || Colors.bg.elevated },
                ]}
              >
                <Text style={styles.avatarText}>
                  {profile?.avatar_emoji || displayName.slice(0, 1).toUpperCase() || '?'}
                </Text>
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {displayName || t('inbox.peerProfileUnknown')}
              </Text>
              {hasHandle && profile?.handle && (
                <Text style={styles.handle}>@{profile.handle}</Text>
              )}
              {profile?.persona && (
                <GlassCard style={styles.card}>
                  <Text style={styles.cardLabel}>{t('inbox.peerProfilePersona')}</Text>
                  <Text style={styles.cardValue}>
                    {profile.persona === 'king' ? t('rgprofile.personaKing') : t('rgprofile.personaQueen')}
                  </Text>
                </GlassCard>
              )}
              {!hasHandle && (
                <Text style={styles.emptyHint}>{t('inbox.peerProfileEmpty')}</Text>
              )}
            </>
          )}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>{t('heroes.close')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:  { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,9,0.65)' },
  sheet: {
    backgroundColor: Colors.bg.base, borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'],
    padding: Spacing[5], alignItems: 'center', gap: Spacing[2],
  },
  loadingWrap: { paddingVertical: Spacing[8] },
  avatar: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.gold[400], marginBottom: Spacing[2],
  },
  avatarText: { fontSize: 28, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  name:   { fontSize: 18, fontFamily: Typography.family.heading, color: Colors.text.primary },
  handle: { fontSize: 13, fontFamily: Typography.family.mono, color: Colors.text.muted },
  card:   { width: '100%', marginTop: Spacing[3], gap: Spacing[1] },
  cardLabel: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 14, fontFamily: Typography.family.body, color: Colors.text.primary },
  emptyHint: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: Spacing[3], textAlign: 'center' },
  closeBtn:  { marginTop: Spacing[4], alignItems: 'center', paddingVertical: Spacing[2], width: '100%' },
  closeBtnText: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.muted },
});
