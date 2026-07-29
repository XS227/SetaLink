/**
 * RealGramClanBrowseScreen — native Shahnameh guild directory (`docs/
 * realgram/TASK_SPLIT.md` A→B(125) roadmap: Clan/Guild). Distinct from
 * RealGramClanScreen (the Clan TAB, deliberately redesigned 2026-07-22
 * around RealGram's own community features, not a guild reskin) — this is
 * the actual `guild.html`-equivalent directory of Shahnameh clans.
 *
 * Now interactive (B->A(132)'s telegram_id bridge, wired through A->B(133)):
 * shows the caller's own clan if they have one, and lets them apply to
 * others otherwise — request shape matches `clan/apply` exactly as
 * `social.js` itself calls it.
 *
 * 2026-07-28 (Khabat: "clan siden også kan bygges på samme måte det var i
 * shahnameh, når jeg velger den ene clanen... også cta knapp for å bygge ny
 * clan" — build it the way Shahnameh had it: pick a clan to see detail,
 * plus a CTA to found a new one): cards used to apply directly inline with
 * no detail view — added a tap-to-detail sheet (same pattern as the Heroes
 * grid's certificate-style modal) and a create-clan flow
 * (`clanBrowseService.ts`'s new `createClan`/`checkClanNameAvailable`,
 * wrapping `/season2/clan/create` + `/clan/check-name`, both already live).
 * Khabat confirmed this ADDS to the Clan tab's 2026-07-22 RealGram-community
 * redesign rather than reversing it — RealGramClanScreen still owns
 * referrals/Starlink/data, this directory is reached from it, not replacing it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
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
  getClanDirectory, getMyClan, applyToClan, createClan, checkClanNameAvailable,
  validateClanNameLocally, CLAN_CREATE_COST, ClanListing, MyClan,
} from '../services/clanBrowseService';

interface Props {
  onBack: () => void;
  // Opens the real clan social hub (RealGramClanHomeScreen, 2026-07-29) —
  // "your clan" used to be a static summary card here, now hands off to
  // the member roster / treasury-contribute / chat-link screen.
  onOpenMyClan: () => void;
}

function applyErrorCopy(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'already_in_clan':       return t('clanbrowse.errAlreadyInClan');
    case 'cannot_apply_own_clan': return t('clanbrowse.errCannotApplyOwn');
    case 'clan_full':             return t('clanbrowse.errClanFull');
    case 'clan_not_found':        return t('clanbrowse.errClanNotFound');
    case 'network_error':         return t('clanbrowse.errNetwork');
    default:                      return '';
  }
}

function createErrorCopy(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'already_in_clan':       return t('clanbrowse.errAlreadyInClan');
    case 'name_too_short':        return t('clanbrowse.errNameTooShort');
    case 'name_too_long':         return t('clanbrowse.errNameTooLong');
    case 'name_invalid_chars':    return t('clanbrowse.errNameInvalidChars');
    case 'name_taken':            return t('clanbrowse.errNameTaken');
    case 'insufficient_balance':  return t('clanbrowse.errInsufficientBalance');
    case 'user_not_found':        return t('clanbrowse.errUserNotFound');
    case 'network_error':         return t('clanbrowse.errNetwork');
    default:                      return '';
  }
}

export function RealGramClanBrowseScreen({ onBack, onOpenMyClan }: Props) {
  const insets   = useSafeAreaInsets();
  const { t, isRTL } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const showToast = useToastStore((s) => s.show);

  const [clans, setClans]       = useState<ClanListing[] | null>(null);
  const [myClan, setMyClan]     = useState<MyClan | null>(null);
  const [telegramId, setTelegramId] = useState('');
  const [pendingId, setPendingId]   = useState<string | null>(null); // clan_id currently applying
  const [error, setError]       = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null); // detail sheet
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const tid = deviceId ? (await getSsoToken(deviceId, true)).telegram_id : '';
      setTelegramId(tid);
      const [directory, mine] = await Promise.all([getClanDirectory(tid), getMyClan(tid)]);
      if (directory.length === 0) { setError(t('clanbrowse.loadError')); return; }
      setClans(directory);
      setMyClan(mine);
    } catch {
      setError(t('clanbrowse.loadError'));
    }
  }, [deviceId, t]);

  useEffect(() => { load(); }, [load]);

  const handleApply = useCallback(async (clan: ClanListing) => {
    if (!telegramId) { showToast(t('clanbrowse.identifyError'), 'error'); return; }
    setPendingId(clan.clan_id);
    const result = await applyToClan(telegramId, clan.clan_id);
    setPendingId(null);
    if (result.ok) {
      showToast(t('clanbrowse.applicationSent').replace('{name}', clan.clan_name), 'success');
      setClans((prev) => prev?.map((c) => (c.clan_id === clan.clan_id ? { ...c, user_status: 'pending' } : c)) ?? prev);
    } else {
      showToast(applyErrorCopy(result.error, t) || t('clanbrowse.errApplyGeneric'), 'error');
    }
  }, [telegramId, showToast, t]);

  const handleCreated = useCallback(() => {
    setCreateOpen(false);
    showToast(t('clanbrowse.founded'), 'success');
    load(); // refresh directory + myClan so the new clan shows up immediately
  }, [showToast, load, t]);

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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={6} />
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBack, { top: insets.top + Spacing[3] }]}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
      </TouchableOpacity>
      {!clans ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : (
        <FlatList
          data={clans}
          keyExtractor={(c) => c.clan_id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <View style={styles.titleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pageTitle}>{t('clanbrowse.title')}</Text>
                  <Text style={styles.pageSub}>{t('clanbrowse.subtitle')}</Text>
                </View>
                {/* Khabat, 2026-07-28: "cta knapp for å bygge ny clan" —
                    hidden once already in one, since /clan/create rejects
                    that server-side anyway (already_in_clan). */}
                {!myClan && (
                  <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.createCta} activeOpacity={0.85}>
                    <Text style={styles.createCtaText}>{t('clanbrowse.foundCta')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {myClan ? (
                // 2026-07-29 (Khabat: "en social hub for medlemmer...
                // felles økonomi, oppdrag") — used to be a static summary,
                // now opens the real hub (RealGramClanHomeScreen): member
                // roster, a real treasury-contribute action, chat link.
                <TouchableOpacity onPress={onOpenMyClan} activeOpacity={0.85}>
                  <GlassCard style={styles.myClanCard} glowColor={Colors.gold[400]}>
                    <Text style={styles.cardLabel}>{t('clanbrowse.yourClan')}</Text>
                    <View style={styles.clanRow}>
                      {myClan.clan_photo ? (
                        <Image source={{ uri: myClan.clan_photo }} style={styles.clanPhoto} />
                      ) : (
                        <View style={[styles.clanPhoto, styles.avatarFallback]}>
                          <Text style={styles.avatarFallbackText}>{myClan.clan_name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.clanName} numberOfLines={1}>{myClan.clan_name}</Text>
                        <Text style={styles.clanMeta}>
                          {t('clanbrowse.myClanMeta').replace('{count}', String(myClan.member_count)).replace('{treasury}', myClan.treasury.toLocaleString())}
                        </Text>
                      </View>
                      <Text style={styles.myClanArrow}>{isRTL ? '‹' : '›'}</Text>
                    </View>
                  </GlassCard>
                </TouchableOpacity>
              ) : (
                <GlassCard style={styles.noteCard}>
                  <Text style={styles.noteText}>{t('clanbrowse.notInClanTapBelow')}</Text>
                </GlassCard>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <ClanCard clan={item} onPress={() => setSelectedId(item.clan_id)} />
          )}
        />
      )}

      {/* Detail sheet (Khabat: "når jeg velger den ene clanen... nok info og
          valg") — same pattern as Heroes' grid-card → modal. Apply lives
          here now instead of inline on the row. */}
      <Modal visible={selectedId !== null} animationType="slide" transparent onRequestClose={() => setSelectedId(null)}>
        {(() => {
          const clan = clans?.find((c) => c.clan_id === selectedId);
          if (!clan) return null;
          return (
            <View style={styles.sheetOverlay}>
              <TouchableOpacity style={styles.sheetBackdrop} onPress={() => setSelectedId(null)} activeOpacity={1} />
              <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing[5] }]}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <ClanDetail
                    clan={clan}
                    hasClan={!!myClan}
                    pending={pendingId === clan.clan_id}
                    onApply={() => handleApply(clan)}
                  />
                </ScrollView>
                <TouchableOpacity onPress={() => setSelectedId(null)} style={styles.sheetCloseBtn} activeOpacity={0.85}>
                  <Text style={styles.sheetCloseBtnText}>{t('clanbrowse.close')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}
      </Modal>

      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} onPress={() => setCreateOpen(false)} activeOpacity={1} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing[5] }]}>
            <CreateClanForm telegramId={telegramId} onCreated={handleCreated} onCancel={() => setCreateOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Compact row — photo, name, motto, member count. Tap opens ClanDetail. */
function ClanCard({ clan, onPress }: { clan: ClanListing; onPress: () => void }) {
  const { t } = useT();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <GlassCard style={styles.clanCard}>
        <View style={styles.clanRow}>
          {clan.clan_photo ? (
            <Image source={{ uri: clan.clan_photo }} style={styles.clanPhoto} />
          ) : (
            <View style={[styles.clanPhoto, styles.avatarFallback]}>
              <Text style={styles.avatarFallbackText}>{clan.clan_name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.clanName} numberOfLines={1}>{clan.clan_name}</Text>
            {!!clan.motto && <Text style={styles.clanMotto} numberOfLines={1}>"{clan.motto}"</Text>}
            <Text style={styles.clanMeta}>
              {t('clanbrowse.membersLedBy').replace('{count}', String(clan.member_count)).replace('{leader}', clan.leader_name || t('clanbrowse.unknownLeader'))}
            </Text>
          </View>
          {clan.user_status !== 'none' && <Text style={styles.statusTag}>{clan.user_status}</Text>}
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
}

/** Full detail shown in the tap-to-open sheet — photo, motto, leader,
    member count, total REAL earned, and the Apply action/status. */
function ClanDetail({
  clan, hasClan, pending, onApply,
}: { clan: ClanListing; hasClan: boolean; pending: boolean; onApply: () => void }) {
  const { t } = useT();
  const canApply = !hasClan && clan.user_status === 'none';
  return (
    <View style={{ gap: Spacing[3] }}>
      <View style={styles.detailPhotoWrap}>
        {clan.clan_photo ? (
          <Image source={{ uri: clan.clan_photo }} style={styles.detailPhoto} resizeMode="cover" />
        ) : (
          <View style={[styles.detailPhoto, styles.avatarFallback]}>
            <Text style={[styles.avatarFallbackText, { fontSize: 32 }]}>{clan.clan_name.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
      </View>
      <Text style={styles.detailName}>{clan.clan_name}</Text>
      {!!clan.motto && <Text style={styles.detailMotto}>"{clan.motto}"</Text>}
      <View style={styles.metaRow}>
        <Text style={styles.clanMeta}>{t('clanbrowse.ledBy').replace('{leader}', clan.leader_name || t('clanbrowse.unknownLeader'))}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.clanMeta}>{t('clanbrowse.membersShort').replace('{count}', String(clan.member_count))}</Text>
        <Text style={styles.clanMeta}>·</Text>
        <Text style={styles.clanMeta}>{t('clanbrowse.realEarned').replace('{amount}', clan.total_real_earned.toLocaleString())}</Text>
      </View>
      {canApply ? (
        <TouchableOpacity
          onPress={onApply}
          disabled={pending}
          style={[styles.actionBtn, pending && styles.actionBtnDisabled]}
          activeOpacity={0.85}
        >
          {pending
            ? <ActivityIndicator size="small" color={Colors.bg.void} />
            : <Text style={styles.actionBtnText}>{t('clanbrowse.applyToJoin')}</Text>}
        </TouchableOpacity>
      ) : clan.user_status !== 'none' ? (
        <View style={[styles.actionBtn, styles.actionBtnDisabled]}>
          <Text style={styles.actionBtnText}>{clan.user_status === 'member' ? t('clanbrowse.youAreMember') : clan.user_status}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Create-clan form — name (live availability check, debounced), motto,
    cost, submit. Server re-validates everything; this just gives faster
    feedback than waiting on a round trip for the common mistakes. */
function CreateClanForm({
  telegramId, onCreated, onCancel,
}: { telegramId: string; onCreated: () => void; onCancel: () => void }) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [checking, setChecking] = useState(false);
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const trimmed = name.trim();
    setNameAvailable(null);
    if (validateClanNameLocally(trimmed) !== null) return;
    setChecking(true);
    const timer = setTimeout(() => {
      checkClanNameAvailable(trimmed).then((available) => setNameAvailable(available)).finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [name]);

  const localError = validateClanNameLocally(name);
  const canSubmit = !submitting && !localError && nameAvailable === true;

  const handleSubmit = useCallback(async () => {
    if (!telegramId) { showToast(t('clanbrowse.identifyError'), 'error'); return; }
    setSubmitting(true);
    const result = await createClan(telegramId, name, motto);
    setSubmitting(false);
    if (result.ok) {
      onCreated();
    } else {
      showToast(createErrorCopy(result.error, t) || t('clanbrowse.errCreateGeneric'), 'error');
    }
  }, [telegramId, name, motto, showToast, onCreated, t]);

  return (
    <View style={{ gap: Spacing[3] }}>
      <Text style={styles.detailName}>{t('clanbrowse.foundClan')}</Text>
      <Text style={styles.clanMeta}>{t('clanbrowse.foundClanCost').replace('{cost}', CLAN_CREATE_COST.toLocaleString())}</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t('clanbrowse.namePlaceholder')}
        placeholderTextColor={Colors.text.muted}
        style={styles.formInput}
        maxLength={30}
        autoCapitalize="words"
      />
      {!!name.trim() && (
        <Text style={styles.formHint}>
          {localError === 'too_short' ? t('clanbrowse.hintTooShort')
            : localError === 'invalid_chars' ? t('clanbrowse.hintInvalidChars')
            : checking ? t('clanbrowse.hintChecking')
            : nameAvailable === true ? t('clanbrowse.hintAvailable')
            : nameAvailable === false ? t('clanbrowse.hintTaken')
            : ''}
        </Text>
      )}
      <TextInput
        value={motto}
        onChangeText={setMotto}
        placeholder={t('clanbrowse.mottoPlaceholder')}
        placeholderTextColor={Colors.text.muted}
        style={styles.formInput}
        maxLength={80}
      />
      <TouchableOpacity
        onPress={handleSubmit}
        disabled={!canSubmit}
        style={[styles.actionBtn, !canSubmit && styles.actionBtnDisabled]}
        activeOpacity={0.85}
      >
        {submitting
          ? <ActivityIndicator size="small" color={Colors.bg.void} />
          : <Text style={styles.actionBtnText}>{t('clanbrowse.foundClanAction').replace('{cost}', CLAN_CREATE_COST.toLocaleString())}</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={onCancel} style={styles.sheetCloseBtn} activeOpacity={0.85}>
        <Text style={styles.sheetCloseBtnText}>{t('common.cancel')}</Text>
      </TouchableOpacity>
    </View>
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

  titleRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3] },
  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[3] },

  createCta:     { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[3], marginTop: 2 },
  createCtaText: { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.bg.void },

  cardLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: Spacing[2] },
  myClanCard: { marginBottom: Spacing[4] },
  noteCard:   { marginBottom: Spacing[4] },
  noteText:   { fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body, lineHeight: 18 },

  clanCard: { gap: 0 },
  clanRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  clanPhoto: { width: 44, height: 44, borderRadius: 12 },
  avatarFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanName: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary },
  clanMotto: { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.body, marginTop: 2, fontStyle: 'italic' },
  clanMeta: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },
  myClanArrow: { fontSize: 20, color: Colors.gold[400] },

  statusTag: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase' },

  detailPhotoWrap: { width: '100%', height: 160, borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.bg.elevated },
  detailPhoto: { width: '100%', height: '100%' },
  detailName:  { fontSize: 20, fontFamily: Typography.family.heading, color: Colors.text.primary },
  detailMotto: { fontSize: 14, color: Colors.gold[400], fontFamily: Typography.family.body, fontStyle: 'italic' },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },

  actionBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,9,0.65)' },
  sheet: { maxHeight: '85%', backgroundColor: Colors.bg.base, borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'], padding: Spacing[5] },
  sheetCloseBtn: { marginTop: Spacing[3], alignItems: 'center', paddingVertical: Spacing[2] },
  sheetCloseBtnText: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.muted },

  formInput: {
    borderWidth: 1, borderColor: Colors.border.default, borderRadius: Radius.lg,
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[3], fontSize: 14,
    fontFamily: Typography.family.body, color: Colors.text.primary, backgroundColor: Colors.bg.elevated,
  },
  formHint: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: -Spacing[2] },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
