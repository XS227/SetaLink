/**
 * StarlinkHeroCard — the featured/first item in the server list (ReaLink Next
 * Build, items 2/5/8). Looks nothing like a normal server row on purpose:
 * gold border, Starlink icon, Recommended + Premium badges, always first.
 *
 * Ships ahead of the real backend node existing. Phase 1's Starlink node
 * (lib/starlink.php, node_type STARLINK) is disabled by default and
 * allowlist-gated — most users' /v1/servers catalog won't include it yet. So
 * this card has three states instead of two:
 *
 *   1. No access (not Premium, < STARLINK_INVITE_THRESHOLD invites) — greyed
 *      out, shows both unlock paths as motivation.
 *   2. Access, but the catalog has no STARLINK-tagged server yet — "coming
 *      soon" placeholder. This is the expected state for virtually everyone
 *      right now, Premium or not, since the backend node is still test-gated.
 *   3. Access AND a real STARLINK server is in the catalog — fully live,
 *      selectable, shows real ping.
 *
 * When the backend node is enabled for a device, state 3 activates on its
 * own — no redesign, no new component, just `server` becoming non-null.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';
import type { Server } from './ServerRow';

const GOLD = '#C9A42A';

interface Props {
  /** The real backend-provided Starlink node, once/if it's in the catalog. */
  server?: Server;
  hasAccess: boolean;
  inviteCount: number;
  inviteThreshold: number;
  onSelect: (server: Server) => void;
  onUpgrade: () => void;
  onInvite: () => void;
}

export function StarlinkHeroCard({
  server, hasAccess, inviteCount, inviteThreshold, onSelect, onUpgrade, onInvite,
}: Props) {
  const { t } = useT();
  const isLive = hasAccess && !!server;
  const remaining = Math.max(0, inviteThreshold - inviteCount);

  const handlePress = () => {
    if (isLive && server) { onSelect(server); return; }
    // Locked or no live node yet — tapping the card itself defaults to the
    // Premium path (the single most direct unlock); the invite CTA below is
    // its own separate tap target for the alternative path.
    if (!hasAccess) onUpgrade();
  };

  return (
    <TouchableOpacity
      style={[styles.card, !hasAccess && styles.cardLocked]}
      onPress={handlePress}
      activeOpacity={0.85}
      disabled={isLive === false && hasAccess === true /* has access, no node yet — nothing to do */}
    >
      <View style={styles.headerRow}>
        <Text style={styles.starlinkIcon}>⭐</Text>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>{t('sl.title')}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{t('sl.subtitle')}</Text>
        </View>
        {server && (
          <View style={styles.pingBlock}>
            <Text style={styles.pingValue}>{server.ping === 0 ? '—' : server.ping}</Text>
            {server.ping !== 0 && <Text style={styles.pingUnit}>ms</Text>}
          </View>
        )}
      </View>

      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t('tag.recommended')}</Text>
        </View>
        <View style={[styles.badge, styles.premiumBadge]}>
          <Text style={[styles.badgeText, styles.premiumBadgeText]}>👑 {t('tag.premium')}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t('sl.dedicated')}</Text>
        </View>
      </View>

      {!hasAccess ? (
        <View style={styles.unlockRow}>
          <TouchableOpacity style={styles.unlockBtn} onPress={onUpgrade} activeOpacity={0.8}>
            <Text style={styles.unlockBtnText}>{t('sl.unlockPremium')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.unlockBtnSecondary} onPress={onInvite} activeOpacity={0.8}>
            <Text style={styles.unlockBtnSecondaryText}>
              {t('sl.inviteFriends').replace('{n}', String(remaining))}
            </Text>
          </TouchableOpacity>
        </View>
      ) : !server ? (
        <Text style={styles.comingSoon}>{t('sl.comingSoon')}</Text>
      ) : (
        <Text style={styles.poweredBy}>{t('sl.poweredBy')}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderColor: GOLD,
    backgroundColor: 'rgba(201,164,42,0.06)',
    padding: Spacing[4],
    gap: Spacing[3],
    marginBottom: Spacing[3],
  },
  cardLocked: {
    opacity: 0.55,
    borderColor: 'rgba(201,164,42,0.35)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  starlinkIcon: { fontSize: 30 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: GOLD },
  subtitle: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  pingBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  pingValue: { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pingUnit: { fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.muted },

  badgeRow: { flexDirection: 'row', gap: Spacing[2], flexWrap: 'wrap' },
  badge: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(201,164,42,0.35)',
    backgroundColor: 'rgba(201,164,42,0.1)',
    paddingHorizontal: Spacing[3],
    paddingVertical: 3,
  },
  badgeText: { fontSize: 10, fontFamily: Typography.family.label, color: GOLD, letterSpacing: 0.4, textTransform: 'uppercase' },
  premiumBadge: { backgroundColor: 'rgba(201,164,42,0.16)' },
  premiumBadgeText: { color: GOLD },

  unlockRow: { flexDirection: 'row', gap: Spacing[2] },
  unlockBtn: {
    flex: 1,
    borderRadius: Radius.md,
    backgroundColor: GOLD,
    paddingVertical: Spacing[2] + 2,
    alignItems: 'center',
  },
  unlockBtnText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: '#1A1400', letterSpacing: 0.3 },
  unlockBtnSecondary: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(201,164,42,0.4)',
    paddingVertical: Spacing[2] + 2,
    alignItems: 'center',
  },
  unlockBtnSecondaryText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: GOLD, letterSpacing: 0.3 },

  comingSoon: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, fontStyle: 'italic' },
  poweredBy: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: GOLD, letterSpacing: 0.5 },
});
