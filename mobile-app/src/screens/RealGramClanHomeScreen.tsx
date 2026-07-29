/**
 * RealGramClanHomeScreen — the real clan "social hub" (Khabat, 2026-07-29:
 * "en social hub for medlemmer av den klanen. en felles økonomi, oppdrag
 * osv... slik det er tenkt i Shahnameh"). Reached by tapping "your clan"
 * in RealGramClanBrowseScreen, which used to be a single static summary
 * card (name/photo/member count/treasury as plain text) — not tappable,
 * no roster, no way to actually touch the treasury.
 *
 * Everything here is real, wired to endpoints that already existed
 * server-side (`routes/api/season2.js`'s `/clan/members`, `/clan/contribute`,
 * `/clan/set-telegram-link`) but were never called from the mobile client
 * before today:
 * - Member roster — real Season2User data (level/xp/leader flag).
 * - Treasury — a real balance + a real "Contribute" action (atomic
 *   server-side decrement from the caller's own REAL, min 100), not just
 *   a number. `total_zar_per_hour` (every member's owned-hero income,
 *   summed server-side in `/clan/my-clan` already) is the actual "shared
 *   economy" figure — surfaced here for the first time.
 * - Community link — the backend's only real "clan chat/feed" mechanism
 *   is `telegram_group_link` (leader-set, validated as a t.me URL): hands
 *   off to a real Telegram group rather than a native reimplementation
 *   that would need new message-persistence infra to actually work.
 *
 * Deliberately NOT included: a quest system. No quest data model exists
 * anywhere server-side for clans (checked shahnameh-backend directly,
 * `model/clan.js` has no such field) — same conclusion Agent A already
 * reached in `TASK_SPLIT.md` A→B(200): needs Khabat to define what
 * "oppdrag" should mechanically mean before either side writes a schema,
 * not something to invent blind.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Linking, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { getSsoToken } from '../services/ssoService';
import {
  getMyClan, getClanMembers, contributeToClan, setClanTelegramLink,
  MyClan, ClanMember, CLAN_CONTRIBUTE_MIN,
} from '../services/clanBrowseService';

interface Props {
  onBack: () => void;
}

function contributeErrorCopy(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'minimum_100':          return t('clanhome.errMinContribute');
    case 'insufficient_balance': return t('clanhome.errInsufficientBalance');
    case 'not_in_clan':          return t('clanbrowse.errClanNotFound');
    case 'network_error':        return t('clanbrowse.errNetwork');
    default:                     return t('clanbrowse.errApplyGeneric');
  }
}

export function RealGramClanHomeScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const deviceId  = useAuthStore((s) => s.user?.deviceId ?? '');
  const showToast = useToastStore((s) => s.show);

  const [telegramId, setTelegramId] = useState('');
  const [clan, setClan]       = useState<MyClan | null>(null);
  const [members, setMembers] = useState<ClanMember[]>([]);
  const [error, setError]     = useState('');
  const [loaded, setLoaded]   = useState(false);

  const [contributeOpen, setContributeOpen]   = useState(false);
  const [contributeAmount, setContributeAmount] = useState('');
  const [contributing, setContributing]       = useState(false);

  const [linkEditOpen, setLinkEditOpen] = useState(false);
  const [linkDraft, setLinkDraft]       = useState('');
  const [savingLink, setSavingLink]     = useState(false);

  const load = useCallback(async () => {
    try {
      const tid = deviceId ? (await getSsoToken(deviceId, true)).telegram_id : '';
      setTelegramId(tid);
      const [myClan, roster] = await Promise.all([getMyClan(tid), getClanMembers(tid)]);
      if (!myClan) { setError(t('clanhome.notInClan')); setLoaded(true); return; }
      setClan(myClan);
      setMembers(roster);
      setLoaded(true);
    } catch {
      setError(t('clanbrowse.loadError'));
      setLoaded(true);
    }
  }, [deviceId, t]);

  useEffect(() => { load(); }, [load]);

  const isLeader = members.find((m) => m.telegram_id === telegramId)?.is_leader ?? false;

  const handleContribute = useCallback(async () => {
    const amount = parseInt(contributeAmount, 10);
    if (!isFinite(amount) || amount < CLAN_CONTRIBUTE_MIN) {
      showToast(t('clanhome.errMinContribute'), 'error');
      return;
    }
    setContributing(true);
    const result = await contributeToClan(telegramId, amount);
    setContributing(false);
    if (result.ok) {
      showToast(t('clanhome.contributed').replace('{amount}', result.contributed.toLocaleString()), 'success');
      setContributeOpen(false);
      setContributeAmount('');
      setClan((c) => c ? { ...c, treasury: c.treasury + result.contributed } : c);
    } else {
      showToast(contributeErrorCopy(result.error, t), 'error');
    }
  }, [contributeAmount, telegramId, showToast, t]);

  const handleSaveLink = useCallback(async () => {
    setSavingLink(true);
    const result = await setClanTelegramLink(telegramId, linkDraft);
    setSavingLink(false);
    if (result.ok) {
      showToast(t('clanhome.linkSaved'), 'success');
      setLinkEditOpen(false);
      setClan((c) => c ? { ...c, telegram_group_link: result.link } : c);
    } else {
      showToast(result.error === 'invalid_link' ? t('clanhome.errInvalidLink') : t('clanbrowse.errApplyGeneric'), 'error');
    }
  }, [linkDraft, telegramId, showToast, t]);

  if (error) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={onBack} style={styles.backBtnFallback} activeOpacity={0.8}>
          <Text style={styles.backBtnFallbackText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!loaded || !clan) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.gold[400]} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={8} />
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBack, { top: insets.top + Spacing[3] }]}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={styles.backIcon}>‹</Text>
      </TouchableOpacity>

      <FlatList
        data={members}
        keyExtractor={(m) => m.telegram_id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View style={styles.heroRow}>
              {clan.clan_photo ? (
                <Image source={{ uri: clan.clan_photo }} style={styles.clanPhoto} />
              ) : (
                <View style={[styles.clanPhoto, styles.clanPhotoFallback]}>
                  <Text style={styles.clanPhotoFallbackText}>{clan.clan_name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.clanName} numberOfLines={1}>{clan.clan_name}</Text>
                {!!clan.motto && <Text style={styles.clanMotto} numberOfLines={2}>{clan.motto}</Text>}
              </View>
            </View>

            {/* Treasury — real balance + a real contribute action, not a
                display-only number. */}
            <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
              <Text style={styles.cardLabel}>{t('clanhome.treasury')}</Text>
              <View style={styles.treasuryRow}>
                <Text style={styles.treasuryValue}>💎 {clan.treasury.toLocaleString()}</Text>
                <TouchableOpacity style={styles.contributeBtn} activeOpacity={0.85} onPress={() => setContributeOpen(true)}>
                  <Text style={styles.contributeBtnText}>{t('clanhome.contribute')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.economyLine}>
                🪙 {t('clanhome.combinedIncome').replace('{rate}', clan.total_zar_per_hour.toLocaleString())}
              </Text>
            </GlassCard>

            {/* Community link — the real "clan chat/feed" surrogate. */}
            <GlassCard style={styles.card}>
              <Text style={styles.cardLabel}>{t('clanhome.community')}</Text>
              {clan.telegram_group_link ? (
                <TouchableOpacity
                  style={styles.linkBtn}
                  activeOpacity={0.85}
                  onPress={() => Linking.openURL(clan.telegram_group_link)}
                >
                  <Text style={styles.linkBtnText}>{t('clanhome.joinChat')}</Text>
                </TouchableOpacity>
              ) : isLeader ? (
                <TouchableOpacity
                  style={styles.linkBtn}
                  activeOpacity={0.85}
                  onPress={() => { setLinkDraft(''); setLinkEditOpen(true); }}
                >
                  <Text style={styles.linkBtnText}>{t('clanhome.setChatLink')}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.emptyText}>{t('clanhome.noChatLink')}</Text>
              )}
              {clan.telegram_group_link && isLeader && (
                <TouchableOpacity style={styles.editLinkRow} activeOpacity={0.7} onPress={() => { setLinkDraft(clan.telegram_group_link); setLinkEditOpen(true); }}>
                  <Text style={styles.editLinkText}>{t('clanhome.editChatLink')}</Text>
                </TouchableOpacity>
              )}
            </GlassCard>

            <Text style={styles.sectionLabel}>{t('clanhome.members').replace('{count}', String(members.length))}</Text>
          </View>
        }
        renderItem={({ item }) => <MemberRow member={item} />}
      />

      {/* Contribute sheet */}
      <Modal visible={contributeOpen} transparent animationType="fade" onRequestClose={() => setContributeOpen(false)}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setContributeOpen(false)} />
          <View style={styles.sheetCard}>
            <Text style={styles.sheetTitle}>{t('clanhome.contribute')}</Text>
            <Text style={styles.sheetSub}>{t('clanhome.contributeHint').replace('{min}', String(CLAN_CONTRIBUTE_MIN))}</Text>
            <TextInput
              style={styles.sheetInput}
              value={contributeAmount}
              onChangeText={setContributeAmount}
              placeholder="500"
              placeholderTextColor={Colors.text.muted}
              keyboardType="number-pad"
            />
            <TouchableOpacity
              style={[styles.sheetActionBtn, contributing && styles.sheetActionBtnDisabled]}
              activeOpacity={0.85}
              disabled={contributing}
              onPress={handleContribute}
            >
              {contributing
                ? <ActivityIndicator size="small" color={Colors.bg.void} />
                : <Text style={styles.sheetActionBtnText}>{t('clanhome.confirmContribute')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Set/edit Telegram link sheet (leader only) */}
      <Modal visible={linkEditOpen} transparent animationType="fade" onRequestClose={() => setLinkEditOpen(false)}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setLinkEditOpen(false)} />
          <View style={styles.sheetCard}>
            <Text style={styles.sheetTitle}>{t('clanhome.setChatLink')}</Text>
            <TextInput
              style={styles.sheetInput}
              value={linkDraft}
              onChangeText={setLinkDraft}
              placeholder="https://t.me/..."
              placeholderTextColor={Colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.sheetActionBtn, savingLink && styles.sheetActionBtnDisabled]}
              activeOpacity={0.85}
              disabled={savingLink}
              onPress={handleSaveLink}
            >
              {savingLink
                ? <ActivityIndicator size="small" color={Colors.bg.void} />
                : <Text style={styles.sheetActionBtnText}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MemberRow({ member }: { member: ClanMember }) {
  const { t } = useT();
  return (
    <GlassCard style={styles.memberCard} noPadding>
      <View style={styles.memberRow}>
        {member.profile_pic ? (
          <Image source={{ uri: member.profile_pic }} style={styles.memberAvatar} />
        ) : (
          <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
            <Text style={styles.memberAvatarText}>{(member.first_name || '?').slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.memberNameRow}>
            <Text style={styles.memberName} numberOfLines={1}>{member.first_name || t('clanhome.memberFallbackName')}</Text>
            {member.is_leader && <Text style={styles.leaderCrown}>👑</Text>}
          </View>
          <Text style={styles.memberMeta}>
            {t('clanhome.memberLevelXp').replace('{level}', String(member.level)).replace('{xp}', member.xp.toLocaleString())}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[4] },
  content:  { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[3] },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[4] },
  clanPhoto: { width: 64, height: 64, borderRadius: 16, borderWidth: 2, borderColor: Colors.gold[400] },
  clanPhotoFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  clanPhotoFallbackText: { fontSize: 24, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  clanName:  { fontSize: 20, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanMotto: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },

  card:      { gap: Spacing[2] },
  cardLabel: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },

  treasuryRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  treasuryValue: { fontSize: 20, fontFamily: Typography.family.heading, color: Colors.text.primary },
  contributeBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[4] },
  contributeBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },
  economyLine: { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.mono },

  linkBtn: { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center', borderWidth: 1, borderColor: Colors.border.default },
  linkBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  editLinkRow: { alignItems: 'center', marginTop: Spacing[1] },
  editLinkText: { fontSize: 11, fontFamily: Typography.family.body, color: Colors.text.muted },
  emptyText: { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body },

  sectionLabel: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[2] },

  memberCard: { padding: Spacing[3] },
  memberRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  memberAvatar: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[1] },
  memberName: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary, flexShrink: 1 },
  leaderCrown: { fontSize: 12 },
  memberMeta: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },

  sheetOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(3,6,9,0.72)', padding: Spacing[6] },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject },
  sheetCard: { width: '100%', maxWidth: 340, backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, padding: Spacing[5], gap: Spacing[3] },
  sheetTitle: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  sheetSub:   { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body },
  sheetInput: { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Spacing[3], color: Colors.text.primary, fontFamily: Typography.family.body, fontSize: 14 },
  sheetActionBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  sheetActionBtnDisabled: { opacity: 0.5 },
  sheetActionBtnText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
