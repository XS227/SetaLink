/**
 * FerdowsiDeskCard — native "Ferdowsi's Desk" (Khabat, 2026-07-29: "...og
 * videre prosess på kapitelen skjer i realgram"). Mirrors chapter.js's own
 * `openDeskModal()`: a card/modal showing what Ferdowsi's life looked like
 * while writing this chapter (historical context, personal challenge, lore
 * impact), with a "mark as read" action — one of the battle panel's
 * requirements (`kind: "desk"`).
 *
 * Deliberately does NOT replicate chapter.js's "+50 XP for reading the
 * desk" — traced that reward: `RealPlayer.addResource("xp", 50)` is purely
 * client-side, and `/user/sync-balance` (the only endpoint that would
 * persist it) explicitly rejects a client-supplied `xp` field as an
 * anti-cheat guard. The web version's own reward never actually survives a
 * reload; not worth copying a reward that doesn't real-persist. What IS
 * real and copied here: `desk_read` itself, synced via
 * chapterProgressSyncService.ts same as everything else.
 */

import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { FerdowsiChronicle } from '../services/chapterCatalogService';

interface Props {
  chronicle: FerdowsiChronicle;
  read: boolean;
  onMarkRead: () => void;
}

function pick(chronicle: FerdowsiChronicle, field: 'historicalContext' | 'personalChallenge' | 'loreImpact', lang: string): string {
  const faKey = `${field}_fa` as const;
  const ruKey = `${field}_ru` as const;
  if (lang === 'fa' && chronicle[faKey]) return chronicle[faKey] as string;
  if (lang === 'ru' && chronicle[ruKey]) return chronicle[ruKey] as string;
  return chronicle[field];
}

export function FerdowsiDeskCard({ chronicle, read, onMarkRead }: Props) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} activeOpacity={0.85}>
        <GlassCard style={styles.card} glowColor={read ? Colors.gold[600] : Colors.gold[400]}>
          <View style={styles.row}>
            <Text style={styles.icon}>{read ? '✦' : '🪶'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>{t('chapterdetail.deskKicker')}</Text>
              <Text style={styles.title}>{t('chapterdetail.deskTitle')}</Text>
              <Text style={styles.meta}>{chronicle.year} · {t('chapterdetail.deskAgeTpl').replace('{age}', String(chronicle.age))}</Text>
            </View>
            {read && <Text style={styles.readBadge}>{t('chapterdetail.deskRead')}</Text>}
          </View>
        </GlassCard>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetKicker}>{t('chapterdetail.deskKicker')}</Text>
              <Text style={styles.sheetTitle}>{t('chapterdetail.deskTitle')}</Text>
              <Text style={styles.sheetMeta}>{chronicle.year} · {t('chapterdetail.deskAgeTpl').replace('{age}', String(chronicle.age))}</Text>

              <Text style={styles.sectionLabel}>{t('chapterdetail.deskHistorical')}</Text>
              <Text style={styles.sectionBody}>{pick(chronicle, 'historicalContext', lang)}</Text>

              <Text style={styles.sectionLabel}>{t('chapterdetail.deskChallenge')}</Text>
              <Text style={styles.sectionBody}>{pick(chronicle, 'personalChallenge', lang)}</Text>

              <Text style={styles.sectionLabel}>{t('chapterdetail.deskImpact')}</Text>
              <Text style={styles.sectionBody}>{pick(chronicle, 'loreImpact', lang)}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.readBtn, read && styles.readBtnDone]}
              activeOpacity={0.85}
              onPress={() => { if (!read) onMarkRead(); setOpen(false); }}
            >
              <Text style={styles.readBtnText}>{t(read ? 'chapterdetail.deskRead' : 'chapterdetail.deskMarkRead')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  icon: { fontSize: 22 },
  kicker: { fontSize: 10, fontFamily: Typography.family.label, color: Colors.gold[400], textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: 2 },
  meta: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },
  readBadge: { fontSize: 16 },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,9,0.65)' },
  sheet: { maxHeight: '80%', backgroundColor: Colors.bg.base, borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'], padding: Spacing[5] },
  sheetKicker: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.gold[400], textTransform: 'uppercase', letterSpacing: 0.6 },
  sheetTitle: { fontSize: 20, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[1] },
  sheetMeta: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[4] },

  sectionLabel: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: Spacing[4] },
  sectionBody: { fontSize: 13, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 20, marginTop: Spacing[2] },

  readBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], alignItems: 'center', marginTop: Spacing[4] },
  readBtnDone: { backgroundColor: Colors.bg.elevated },
  readBtnText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
