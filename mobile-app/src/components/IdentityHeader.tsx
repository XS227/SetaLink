import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';
import { useIdentityStore, displayLabel } from '../stores/identityStore';
import { EditIdentitySheet } from './EditIdentitySheet';
import { VipBadge } from './VipBadge';

interface Props {
  /** Device/user id used to seed a default avatar + handle on first run. */
  seedId:     string;
  /** Fallback identity string (SL-227-…) shown until a handle is set. */
  fallbackId: string;
  planLabel:  string;
  /** Reached the "vip" referral milestone (21 invites) — shows a gold badge
   *  next to the plan badge. Optional so every other IdentityHeader caller
   *  keeps working unchanged. */
  isVip?:     boolean;
}

// The profile's identity header (A-11): tappable emoji avatar + display name +
// @handle, replacing the old logo-ring + raw device-id header. Tapping it (or
// the "edit" affordance) opens the identity sheet.
export function IdentityHeader({ seedId, fallbackId, planLabel, isVip }: Props) {
  const { t } = useT();
  const { handle, handleState, displayName, avatarEmoji, avatarColor, seedFromId } =
    useIdentityStore();
  const [editing, setEditing] = useState(false);

  // Seed a stable default avatar/handle suggestion once we know the device id.
  useEffect(() => { if (seedId) seedFromId(seedId); }, [seedId, seedFromId]);

  const name    = displayLabel({ displayName, handle }) || fallbackId;
  const showHandle = !!handle;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.8}
        onPress={() => setEditing(true)}
      >
        <View style={[styles.avatarRing, { borderColor: avatarColor, backgroundColor: avatarColor + '22' }]}>
          <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
        </View>

        <View style={styles.names}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {showHandle && (
            <View style={styles.handleRow}>
              <Text style={styles.handle} numberOfLines={1}>@{handle}</Text>
              {handleState === 'reserved' && <Text style={styles.verified}>✓</Text>}
            </View>
          )}
          <View style={styles.badgeRow}>
            <View style={styles.planBadge}>
              <Text style={styles.planText}>{planLabel}</Text>
            </View>
            {isVip && <VipBadge compact />}
          </View>
        </View>

        <View style={styles.editBtn}>
          <Text style={styles.editIcon}>✎</Text>
        </View>
      </TouchableOpacity>

      <EditIdentitySheet visible={editing} onClose={() => setEditing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:        { marginTop: Spacing[1] },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  avatarRing:  { width: 64, height: 64, borderRadius: 32, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 32 },
  names:       { flex: 1, gap: 2 },
  name:        { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking?.tight ?? 0 },
  handleRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  handle:      { fontSize: Typography.size.sm, color: Colors.text.secondary },
  verified:    { fontSize: Typography.size.sm, color: Colors.emerald[400] },
  badgeRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  planBadge:   { alignSelf: 'flex-start', backgroundColor: Colors.bg.surface, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[2], paddingVertical: 2 },
  planText:    { fontSize: Typography.size.xs, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 1 },
  editBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  editIcon:    { fontSize: 16, color: Colors.text.secondary },
});
