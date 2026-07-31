/**
 * PeerProfileSheet — a DM peer's public RealGram profile, opened by tapping
 * their avatar in InboxScreen's thread header (Khabat, 2026-07-29: "trykker
 * på profilbilde til sender... se deres realgram profil og offentlig
 * info"). Read-only, no actions.
 *
 * Khabat, 2026-07-31: "jeg trykker på 'vis profil' så ser jeg kun popup
 * profil. den skal vise deres spiller profil som blir opprettet for alle
 * brukere av realgram automatisk, sånn som min egen profil" — the identity-
 * only version this used to be (avatar/handle/persona) read as a stripped-
 * down stand-in for the real thing rather than "their profile." Now also
 * shows the same *player* stats her own Profile tab (RealGramProfileScreen)
 * does — level, chapter progress, clan — sourced from the same
 * get-peer-profile action, which now folds in a safe subset of Shahnameh's
 * profile summary (api.php, 2026-07-31). Deliberately still NOT the whole
 * summary: economy.real_balance/zar/gems and streaks/achievements/quests
 * are real currency/activity data, never exposed to a peer with no auth
 * check — see that action's own comment. A peer who's never set up a
 * profile still gets a real, honest state here (their user_id only), not
 * an error.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
              {(profile?.persona || typeof profile?.level === 'number') && (
                <Text style={styles.levelLine}>
                  {typeof profile?.level === 'number' ? t('inbox.peerLevelLine').replace('{level}', String(profile.level)) : ''}
                  {profile?.persona
                    ? `${typeof profile?.level === 'number' ? ' · ' : ''}${profile.persona === 'king' ? t('rgprofile.personaKing') : t('rgprofile.personaQueen')}`
                    : ''}
                </Text>
              )}

              {profile?.chapters && (
                <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardLabel}>{t('rgprofile.chapters')}</Text>
                    <Text style={styles.chapterCount}>{profile.chapters.completed}/{profile.chapters.total}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${profile.chapters.total > 0 ? (profile.chapters.completed / profile.chapters.total) * 100 : 0}%` as any },
                      ]}
                    />
                  </View>
                </GlassCard>
              )}

              {profile?.clan !== undefined && (
                <GlassCard style={styles.card}>
                  <Text style={styles.cardLabel}>{t('rgprofile.clan')}</Text>
                  {profile.clan ? (
                    <View style={styles.clanRow}>
                      {profile.clan.clan_photo ? (
                        <Image source={{ uri: profile.clan.clan_photo }} style={styles.clanPhoto} />
                      ) : (
                        <View style={[styles.clanPhoto, styles.clanPhotoFallback]}>
                          <Text style={styles.clanPhotoText}>{profile.clan.clan_name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.clanName} numberOfLines={1}>{profile.clan.clan_name}</Text>
                        <Text style={styles.clanMeta}>
                          {t('rgprofile.clanMembersRole').replace('{count}', String(profile.clan.member_count)).replace('{role}', profile.clan.role)}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>{t('rgprofile.notInClan')}</Text>
                  )}
                </GlassCard>
              )}

              {!hasHandle && !profile?.chapters && (
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
  levelLine: { fontSize: 13, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  card:   { width: '100%', marginTop: Spacing[3], gap: Spacing[1] },
  cardLabel: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 14, fontFamily: Typography.family.body, color: Colors.text.primary },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chapterCount: { fontSize: 12, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  progressTrack: {
    height: 6, borderRadius: Radius.full, backgroundColor: Colors.bg.elevated,
    overflow: 'hidden', marginTop: Spacing[1],
  },
  progressFill: { height: '100%', backgroundColor: Colors.gold[400], borderRadius: Radius.full },
  emptyText: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.muted },
  clanRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanPhoto: { width: 44, height: 44, borderRadius: Radius.md },
  clanPhotoFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  clanPhotoText: { fontSize: 18, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  clanName: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanMeta: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.secondary },
  emptyHint: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: Spacing[3], textAlign: 'center' },
  closeBtn:  { marginTop: Spacing[4], alignItems: 'center', paddingVertical: Spacing[2], width: '100%' },
  closeBtnText: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.muted },
});
