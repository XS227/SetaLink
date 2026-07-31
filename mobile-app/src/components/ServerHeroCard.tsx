/**
 * ServerHeroCard — compact grid tile for the Freedom (Servers) page (Khabat,
 * 2026-07-31: "jeg vil ha 3 vedsiden av hverandre som på hero page og
 * kortene der. la disse nodene dukke opp som hero kort på freedom siden").
 * Replaces ServerRow's full-width stacked-list layout with a 3-across grid,
 * same "individual hero nodes, not a settings list" intent ServerRow's own
 * rank badge already started (2026-07-30) — this finishes it.
 *
 * Starlink-aware: when `server.nodeType === 'STARLINK'`, renders the
 * "STARLINK" wordmark instead of `server.country` (Khabat: "ikke skriv
 * Norway på starlink noden... kan vise norsk flag men skriv STARLINK") and
 * a shinier gold/cyan treatment so it reads as a special/VIP card next to
 * plain nodes — the flag glyph is untouched (still shows 🇳🇴 or whatever
 * the catalog sends), only the text label changes.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { FlagGlyph, isBrandNode, Server } from './ServerRow';
import { useT, tagLabelKey } from '../i18n';

interface Props {
  server: Server & { nodeType?: string };
  onSelect: (server: Server) => void;
  rank?: number;
}

function PingDot({ ping }: { ping: number }) {
  const color =
    ping === 0 ? Colors.text.muted :
    ping < 60  ? Colors.status.connected :
    ping < 120 ? Colors.gold[400] :
    Colors.status.disconnected;
  return <View style={[styles.pingDot, { backgroundColor: color }]} />;
}

function ServerHeroCardComponent({ server, onSelect, rank }: Props) {
  const { t } = useT();
  const isStarlink = server.nodeType === 'STARLINK';
  const pingLabel = server.ping === 0 ? '—' : `${server.ping}ms`;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isStarlink && styles.cardStarlink,
        server.selected && styles.cardSelected,
      ]}
      onPress={() => onSelect(server)}
      activeOpacity={0.75}
    >
      {isStarlink && (
        <View style={styles.vipCorner}><Text style={styles.vipCornerText}>VIP</Text></View>
      )}
      {!isStarlink && !!rank && rank <= 3 && (
        <View style={styles.rankBadge}><Text style={styles.rankBadgeText}>{rank}</Text></View>
      )}

      <View style={styles.flagBox}>
        {isStarlink ? <Text style={styles.satIcon}>🛰️</Text> : <FlagGlyph flag={server.flag} brand={isBrandNode(server.id)} size={30} />}
      </View>

      <Text style={[styles.label, isStarlink && styles.labelStarlink]} numberOfLines={1}>
        {isStarlink ? 'STARLINK' : server.country}
      </Text>
      <Text style={styles.city} numberOfLines={1}>{isStarlink ? (server.city || t('sv.title')) : server.city}</Text>

      <View style={styles.pingRow}>
        <PingDot ping={server.ping} />
        <Text style={styles.pingText}>{pingLabel}</Text>
      </View>

      {server.tags && server.tags.length > 0 && !isStarlink && (
        <Text style={styles.tagText} numberOfLines={1}>{t(tagLabelKey(server.tags[0])) || server.tags[0]}</Text>
      )}

      {server.selected && <View style={styles.selectedDot} />}
    </TouchableOpacity>
  );
}

export const ServerHeroCard = React.memo(ServerHeroCardComponent, (prev, next) =>
  prev.server.id       === next.server.id &&
  prev.server.selected === next.server.selected &&
  prev.server.ping     === next.server.ping &&
  prev.rank             === next.rank
);

const styles = StyleSheet.create({
  card: {
    width: '31.5%',
    aspectRatio: 0.85,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    backgroundColor: Colors.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[2],
    gap: 3,
  },
  cardStarlink: {
    borderColor: 'rgba(51,211,255,0.4)',
    backgroundColor: '#0A1220',
    shadowColor: Colors.cyan[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  cardSelected: {
    borderColor: 'rgba(51,255,178,0.5)',
    backgroundColor: 'rgba(51,255,178,0.05)',
  },
  vipCorner: {
    position: 'absolute', top: 8, right: -22, zIndex: 3,
    backgroundColor: Colors.gold[400], transform: [{ rotate: '40deg' }],
    paddingHorizontal: 22, paddingVertical: 2,
  },
  vipCornerText: { fontSize: 8, fontFamily: Typography.family.heading, color: '#241605', letterSpacing: 0.8 },
  rankBadge: {
    position: 'absolute', top: 6, left: 6,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.gold[400],
  },
  rankBadgeText: { fontSize: 9, fontFamily: Typography.family.heading, color: '#2E1E00' },
  flagBox: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  satIcon: { fontSize: 26 },
  label: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary, textAlign: 'center' },
  labelStarlink: { color: Colors.cyan[300], letterSpacing: 0.5 },
  city: { fontSize: 10, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center' },
  pingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  pingDot: { width: 5, height: 5, borderRadius: 3 },
  pingText: { fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  tagText: { fontSize: 8, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', marginTop: 1 },
  selectedDot: {
    position: 'absolute', bottom: 6, right: 6,
    width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.status.connected,
  },
});
