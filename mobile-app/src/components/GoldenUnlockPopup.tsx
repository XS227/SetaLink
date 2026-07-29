/**
 * GoldenUnlockPopup — "Card X is now available for mining/upgrading!"
 * (Khabat, 2026-07-29: "når en er ferdig med det han skal på hver kapitel
 * så kommer en golden popup opp at kort x er nå tilgjengelig for
 * mining/oppgradering"). Fires when reading a chapter scene unlocks a
 * character/place card per that scene's `unlock_via` gate (see
 * chapterLoreService.ts's `cardsUnlockedBySceneRead()` — same unlock
 * mechanism chapter.js's own `paintBattle()` already uses for boss-fight
 * gating, just not previously surfaced to the player as a moment of its
 * own on the native side).
 *
 * Internally queues one card at a time — a single scene can gate more than
 * one card's `unlock_via`, though rare in the source data.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Shadow, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { localizedField } from '../utils/localizedField';
import type { ChapterCardRef } from '../services/chapterLoreService';

interface Props {
  card: ChapterCardRef | null;
  onViewCard: (slug: string) => void;
  onDismiss: () => void;
}

export function GoldenUnlockPopup({ card, onViewCard, onDismiss }: Props) {
  const { t, lang } = useT();
  const scale   = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!card) return;
    scale.setValue(0.85);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 60 }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [card, scale, opacity]);

  if (!card) return null;
  const name = localizedField(card.name, card.name_fa, card.name_ru, lang);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onDismiss} />
        <Animated.View style={[styles.card, { transform: [{ scale }], opacity }]}>
          <Text style={styles.sparkle}>✨</Text>
          <Text style={styles.headline}>{t('chapterdetail.cardUnlocked')}</Text>
          {!!card.image && (
            <View style={styles.imageWrap}>
              <Image source={{ uri: card.image }} style={styles.image} resizeMode="contain" />
            </View>
          )}
          <Text style={styles.cardName}>{name}</Text>
          <Text style={styles.subtext}>{t('chapterdetail.cardUnlockedSub')}</Text>
          <TouchableOpacity style={styles.viewBtn} activeOpacity={0.85} onPress={() => onViewCard(card.slug)}>
            <Text style={styles.viewBtnText}>{t('chapterdetail.viewCard')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dismissBtn} activeOpacity={0.7} onPress={onDismiss}>
            <Text style={styles.dismissBtnText}>{t('chapterdetail.dismissUnlock')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(3,6,9,0.78)', padding: Spacing[6] },
  card: {
    width: '100%', maxWidth: 340, alignItems: 'center',
    backgroundColor: Colors.bg.surface, borderRadius: Radius['2xl'],
    borderWidth: 1.5, borderColor: Colors.gold[400],
    paddingVertical: Spacing[6], paddingHorizontal: Spacing[5],
    shadowColor: Colors.gold[400], shadowOpacity: 0.35, shadowRadius: 28, shadowOffset: { width: 0, height: 0 },
    ...Shadow.card,
  },
  sparkle: { fontSize: 28, marginBottom: Spacing[1] },
  headline: {
    fontSize: 13, fontFamily: Typography.family.label, color: Colors.gold[400],
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[4],
  },
  imageWrap: {
    width: 140, height: 140, borderRadius: Radius.xl, overflow: 'hidden',
    backgroundColor: 'rgba(212,175,55,0.08)', marginBottom: Spacing[4],
  },
  image: { width: '100%', height: '100%' },
  cardName: { fontSize: 20, fontFamily: Typography.family.heading, color: Colors.text.primary, textAlign: 'center' },
  subtext: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.secondary, textAlign: 'center', marginTop: Spacing[2], lineHeight: 19 },
  viewBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[8], marginTop: Spacing[5] },
  viewBtnText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
  dismissBtn: { marginTop: Spacing[3], paddingVertical: Spacing[2] },
  dismissBtnText: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted },
});
