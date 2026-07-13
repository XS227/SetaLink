import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { useT } from '../i18n';
import { useIdentityStore } from '../stores/identityStore';
import { useAuthStore } from '../stores/authStore';
import {
  AVATAR_EMOJIS, AVATAR_COLORS, normalizeHandle, validateHandle,
} from '../utils/handle';
import { checkHandleAvailable, reserveHandle } from '../services/handleService';

type AvailState = 'idle' | 'checking' | 'free' | 'taken' | 'local';

interface Props {
  visible:  boolean;
  onClose:  () => void;
}

// Edit sheet for the identity layer (A-11): pick an emoji avatar + color,
// claim a unique @handle (live-validated + availability-checked, degrades to a
// local claim until B-14 is live), and set a display nickname.
export function EditIdentitySheet({ visible, onClose }: Props) {
  const { t } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const {
    handle, displayName, avatarEmoji, avatarColor,
    setHandle, setDisplayName, setAvatar,
  } = useIdentityStore();

  const [emoji, setEmoji]   = useState(avatarEmoji);
  const [color, setColor]   = useState(avatarColor);
  const [name, setName]     = useState(displayName);
  const [handleText, setHandleText] = useState(handle ?? '');
  const [avail, setAvail]   = useState<AvailState>('idle');
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local form when the sheet (re)opens.
  useEffect(() => {
    if (visible) {
      setEmoji(avatarEmoji); setColor(avatarColor);
      setName(displayName); setHandleText(handle ?? ''); setAvail('idle');
    }
  }, [visible]);  // eslint-disable-line react-hooks/exhaustive-deps

  const normalized = normalizeHandle(handleText);
  const errorKey   = validateHandle(normalized);
  const unchanged  = normalized === (handle ?? '');

  // Debounced availability check as the user types a valid, changed handle.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (errorKey || unchanged) { setAvail('idle'); return; }
    setAvail('checking');
    debounce.current = setTimeout(async () => {
      const r = await checkHandleAvailable(normalized);
      setAvail(r.source === 'local' ? 'local' : (r.available ? 'free' : 'taken'));
    }, 450);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [normalized, errorKey, unchanged]);

  const canSave = !errorKey && avail !== 'taken' && !saving;

  const availLabel = useMemo(() => {
    if (errorKey) return t(errorKey);
    switch (avail) {
      case 'checking': return t('id.checking');
      case 'free':     return t('id.free');
      case 'taken':    return t('id.taken');
      case 'local':    return t('id.freeLocal');
      default:         return '';
    }
  }, [errorKey, avail, t]);

  const availColor =
    errorKey || avail === 'taken' ? '#FF6B6B'
    : avail === 'free'            ? Colors.emerald[400]
    : Colors.text.secondary;

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    setAvatar(emoji, color);
    setDisplayName(name);
    if (!unchanged && !errorKey) {
      const r = await reserveHandle(normalized, deviceId);
      setHandle(normalized, r.source === 'backend' && r.available ? 'reserved' : 'local');
    }
    setSaving(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{t('id.editTitle')}</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Live preview */}
            <View style={styles.preview}>
              <View style={[styles.avatarRing, { borderColor: color, backgroundColor: color + '22' }]}>
                <Text style={styles.avatarEmoji}>{emoji}</Text>
              </View>
              <Text style={styles.previewName} numberOfLines={1}>
                {name || (normalized ? `@${normalized}` : t('id.you'))}
              </Text>
              {!!normalized && <Text style={styles.previewHandle}>@{normalized}</Text>}
            </View>

            {/* Avatar emoji */}
            <Text style={styles.section}>{t('id.avatar')}</Text>
            <View style={styles.emojiGrid}>
              {AVATAR_EMOJIS.map((e) => (
                <TouchableOpacity
                  key={e}
                  style={[styles.emojiCell, emoji === e && { borderColor: color, backgroundColor: color + '22' }]}
                  onPress={() => setEmoji(e)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.emojiCellText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Color */}
            <Text style={styles.section}>{t('id.color')}</Text>
            <View style={styles.colorRow}>
              {AVATAR_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]}
                  onPress={() => setColor(c)}
                  activeOpacity={0.7}
                />
              ))}
            </View>

            {/* Handle */}
            <Text style={styles.section}>{t('id.handle')}</Text>
            <View style={styles.handleField}>
              <Text style={styles.at}>@</Text>
              <TextInput
                style={styles.handleInput}
                value={handleText}
                onChangeText={setHandleText}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('id.handlePlaceholder')}
                placeholderTextColor={Colors.text.muted}
                maxLength={20}
              />
              {avail === 'checking' && <ActivityIndicator size="small" color={Colors.text.secondary} />}
            </View>
            {!!availLabel && <Text style={[styles.availText, { color: availColor }]}>{availLabel}</Text>}

            {/* Nickname */}
            <Text style={styles.section}>{t('id.nickname')}</Text>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder={t('id.nicknamePlaceholder')}
              placeholderTextColor={Colors.text.muted}
              maxLength={40}
            />

            <TouchableOpacity
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={onSave}
              disabled={!canSave}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={Colors.text.inverse} />
                : <Text style={styles.saveText}>{t('id.save')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>{t('id.cancel')}</Text>
            </TouchableOpacity>
            <View style={{ height: Spacing[4] }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(3,6,9,0.7)', justifyContent: 'flex-end' },
  sheet:        { maxHeight: '90%', backgroundColor: Colors.bg.elevated, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Layout.screenPadding, paddingTop: Spacing[2], paddingBottom: Spacing[2] },
  grabber:      { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border.default, marginBottom: Spacing[3] },
  title:        { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary, marginBottom: Spacing[3] },

  preview:      { alignItems: 'center', marginBottom: Spacing[4], gap: 4 },
  avatarRing:   { width: 76, height: 76, borderRadius: 38, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji:  { fontSize: 38 },
  previewName:  { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[1] },
  previewHandle:{ fontSize: Typography.size.sm, color: Colors.text.secondary },

  section:      { fontSize: Typography.size.xs, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 1, marginTop: Spacing[3], marginBottom: Spacing[2] },

  emojiGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  emojiCell:    { width: 48, height: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, backgroundColor: Colors.bg.surface, alignItems: 'center', justifyContent: 'center' },
  emojiCellText:{ fontSize: 24 },

  colorRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  colorDot:     { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive:{ borderColor: Colors.text.primary },

  handleField:  { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3] },
  at:           { fontSize: Typography.size.md, color: Colors.text.secondary },
  handleInput:  { flex: 1, color: Colors.text.primary, fontSize: Typography.size.md, paddingVertical: Spacing[3], paddingHorizontal: 4 },
  availText:    { fontSize: Typography.size.xs, marginTop: Spacing[1] },

  nameInput:    { backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, color: Colors.text.primary, fontSize: Typography.size.md, paddingVertical: Spacing[3], paddingHorizontal: Spacing[3] },

  saveBtn:      { backgroundColor: Colors.emerald[400], borderRadius: Radius.md, paddingVertical: Spacing[3], alignItems: 'center', marginTop: Spacing[4] },
  saveBtnDisabled:{ opacity: 0.4 },
  saveText:     { color: Colors.text.inverse, fontSize: Typography.size.md, fontFamily: Typography.family.heading },
  cancelBtn:    { alignItems: 'center', paddingVertical: Spacing[3], marginTop: Spacing[1] },
  cancelText:   { color: Colors.text.secondary, fontSize: Typography.size.sm },
});
