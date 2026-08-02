/**
 * SimorghsFeather — collectible pull, server-authoritative
 * (shahnameh-backend POST /season2/user/feather-pull). Per
 * docs/NEW_GAMES_SPEC.md Game 3 (Khabat, 2026-08-02). Pull a feather for
 * a small zar cost, reveal one of 50 chapter cards (real title + summary
 * from chapters.json) with a rarity tier -- a duplicate pull pays a
 * currency consolation instead of a dead pull. The "did you get them
 * all" collection meta is the retention layer this session's market
 * research flagged as what separates hybrid-casual games that keep
 * growing revenue from ones that flatten out.
 *
 * Same discipline as every other chance game here: single call, server
 * decides the card+rarity+payout before this component does anything,
 * the reveal animation is cosmetic only.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { pullFeather } from '../services/earnService';
import { getSsoToken } from '../services/ssoService';
import { useToastStore } from '../stores/toastStore';

const PULL_COST_ZAR = 50;

// Same rarity color language DailyLuckWheel.tsx's own PRIZES already
// borrows from Colors.rarity -- one system for "how special is this,"
// not a new palette per feature.
const RARITY_COLOR: Record<string, string> = {
  common: Colors.rarity.common,
  rare: Colors.rarity.rare,
  epic: Colors.rarity.epic,
  mythic: Colors.rarity.mythic,
};

interface Card {
  title: string;
  flavorText: string;
  imageUrl: string;
  rarity: string;
  duplicate: boolean;
  amountCurrency: string | null;
  amount: number;
  collectionTotal: number;
}

interface Props {
  deviceId: string;
}

export function SimorghsFeather({ deviceId }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [pulling, setPulling] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const telegramIdRef = useRef<string | null>(null);

  const handlePull = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    setCard(null);
    if (!telegramIdRef.current && deviceId) {
      try {
        const r = await getSsoToken(deviceId, true);
        telegramIdRef.current = r.telegram_id || null;
      } catch { /* handled below via null check */ }
    }
    const telegramId = telegramIdRef.current;
    if (!telegramId) {
      setPulling(false);
      showToast(t('feather.error'), 'error');
      return;
    }
    const res = await pullFeather(telegramId);
    setPulling(false);
    if (!res.ok) {
      showToast(res.error === 'insufficient_balance' ? t('feather.insufficientBalance') : t('feather.error'), 'error');
      return;
    }
    setCard({
      title: res.title, flavorText: res.flavorText, imageUrl: res.imageUrl, rarity: res.rarity,
      duplicate: res.duplicate, amountCurrency: res.amountCurrency, amount: res.amount,
      collectionTotal: res.collectionTotal,
    });
  }, [pulling, deviceId, showToast, t]);

  return (
    <View style={styles.wrap}>
      {card ? (
        <View style={[styles.cardWrap, { borderColor: RARITY_COLOR[card.rarity] || Colors.rarity.common }]}>
          {card.imageUrl ? (
            <Image source={{ uri: card.imageUrl }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardImage, styles.cardImageFallback]}>
              <Text style={styles.cardImageFallbackText}>﷼</Text>
            </View>
          )}
          <Text style={[styles.rarityLabel, { color: RARITY_COLOR[card.rarity] || Colors.rarity.common }]}>
            {t(`feather.rarity${card.rarity}` as 'feather.raritycommon')}
          </Text>
          <Text style={styles.cardTitle}>{card.title}</Text>
          <Text style={styles.cardFlavor} numberOfLines={3}>{card.flavorText}</Text>
          {card.duplicate ? (
            <Text style={styles.duplicateText}>
              {t('feather.duplicate')} +{card.amount} {t(`feather.currency${card.amountCurrency}` as 'feather.currencyzar')}
            </Text>
          ) : (
            <Text style={styles.newCardText}>{t('feather.newCard')}</Text>
          )}
          <Text style={styles.collectionText}>{t('feather.collectionProgress').replace('{n}', String(card.collectionTotal)).replace('{total}', '50')}</Text>
        </View>
      ) : (
        <View style={styles.placeholderWrap}>
          <Text style={styles.placeholderIcon}>🪶</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.pullBtn, pulling && styles.pullBtnDisabled]}
        activeOpacity={0.85}
        disabled={pulling}
        onPress={handlePull}
        accessibilityRole="button"
      >
        <Text style={styles.pullBtnText}>
          {pulling ? t('feather.pulling') : `🪙 ${PULL_COST_ZAR} · ${t('feather.pull')}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing[4], width: '100%' },

  placeholderWrap: {
    width: 140, height: 180, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.lg, backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default,
  },
  placeholderIcon: { fontSize: 40 },

  cardWrap: {
    width: '100%', padding: Spacing[4], borderRadius: Radius.lg, borderWidth: 2,
    backgroundColor: Colors.bg.elevated, alignItems: 'center', gap: Spacing[1],
  },
  cardImage: { width: 120, height: 120, borderRadius: Radius.md, marginBottom: Spacing[2] },
  cardImageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.void },
  cardImageFallbackText: { fontSize: 40, color: Colors.gold[400] },

  rarityLabel: { fontSize: Typography.size.xs, fontFamily: Typography.family.heading, textTransform: 'uppercase', letterSpacing: 1 },
  cardTitle: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.text.primary, textAlign: 'center' },
  cardFlavor: { fontSize: Typography.size.xs, color: Colors.text.muted, fontFamily: Typography.family.body, textAlign: 'center' },

  duplicateText: { fontSize: Typography.size.sm, color: Colors.text.secondary, fontFamily: Typography.family.body, marginTop: Spacing[1] },
  newCardText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.gold[400], marginTop: Spacing[1] },
  collectionText: { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: Spacing[1] },

  pullBtn: { paddingHorizontal: Spacing[8], paddingVertical: Spacing[3], borderRadius: Radius.full, backgroundColor: Colors.gold[400] },
  pullBtnDisabled: { opacity: 0.5 },
  pullBtnText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: '#0B0F14' },
});
