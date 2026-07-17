import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT, tagLabelKey } from '../i18n';

const REALINK_LOGO = require('../assets/logo_mark.png');

// Brand nodes render the Realink logo mark instead of a flag emoji. Keyed off
// the node id (Cloudflare-fronted stealth nodes are 'cf-*') so it works no
// matter what the catalog puts in the flag field — older app builds that lack
// this component simply show the catalog's fallback emoji.
export function isBrandNode(id: string | undefined): boolean {
  return !!id && id.startsWith('cf-');
}

/** Renders the Realink logo for brand nodes, otherwise the flag emoji. */
export function FlagGlyph({ flag, brand, size = 28 }: { flag: string; brand?: boolean; size?: number }) {
  if (brand) {
    return <Image source={REALINK_LOGO} style={{ width: size, height: size, resizeMode: 'contain' }} />;
  }
  return <Text style={{ fontSize: size }}>{flag}</Text>;
}

export interface Server {
  id: string;
  country: string;
  city: string;
  flag: string;
  ping: number;
  load: number;          // 0–100
  protocol: string;
  tags?: string[];       // 'Recommended' | 'Fastest' | 'Stealth' | 'Streaming' | 'Starlink' | 'Beta' | 'Premium' | 'Community' | 'Experimental' | 'Satellite'
  premium?: boolean;
  selected?: boolean;
  imported?: boolean;    // true for user-imported servers (shows delete action)
  /** Node type from the backend catalog (e.g. 'STARLINK'). Display hint only —
   *  the client always dials the same VLESS address/creds regardless. Mirrors
   *  ServerRecord in stores/serverStore.ts — keep both in sync. */
  nodeType?: string;
  /** Backend-flagged as a beta/testing node. */
  beta?: boolean;
}

interface Props {
  server: Server;
  onSelect: (server: Server) => void;
  onDelete?: (server: Server) => void;
  favorite?: boolean;
  onToggleFavorite?: (server: Server) => void;
}

function PingDot({ ping }: { ping: number }) {
  const color =
    ping === 0   ? Colors.text.muted :
    ping < 60    ? Colors.emerald[400] :
    ping < 120   ? '#FFB800' :
    Colors.status.disconnected;
  return <View style={[styles.pingDot, { backgroundColor: color }]} />;
}

function LoadBar({ load }: { load: number }) {
  const color =
    load < 40  ? Colors.emerald[400] :
    load < 70  ? '#FFB800' :
    Colors.status.disconnected;
  return (
    <View style={styles.loadTrack}>
      <View style={[styles.loadFill, { width: `${load}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function ServerRowComponent({ server, onSelect, onDelete, favorite, onToggleFavorite }: Props) {
  const { t } = useT();
  const pingLabel = server.ping === 0 ? '—' : `${server.ping}`;

  return (
    <TouchableOpacity
      style={[styles.row, server.selected && styles.selectedRow]}
      onPress={() => onSelect(server)}
      activeOpacity={0.7}
    >
      {/* Favorite star — display/sort hint only, never affects connectivity */}
      {onToggleFavorite && (
        <TouchableOpacity
          style={styles.favoriteBtn}
          onPress={() => onToggleFavorite(server)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.favoriteIcon, favorite && styles.favoriteIconActive]}>
            {favorite ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Flag + Country */}
      <View style={styles.left}>
        <View style={styles.flagBox}><FlagGlyph flag={server.flag} brand={isBrandNode(server.id)} size={28} /></View>
        <View style={styles.nameBlock}>
          <View style={styles.nameRow}>
            <Text style={[styles.country, server.selected && styles.selectedText]} numberOfLines={1}>
              {server.country}
            </Text>
            {server.imported && (
              <View style={styles.importedBadge}>
                <Text style={styles.importedBadgeText}>CUSTOM</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Metrics — ping is the headline number, everything else recedes */}
      <View style={styles.right}>
        <View style={styles.pingRow}>
          <PingDot ping={server.ping} />
          <Text style={styles.pingText}>{pingLabel}</Text>
          {server.ping !== 0 && <Text style={styles.pingUnit}>ms</Text>}
        </View>
        <LoadBar load={server.load} />
      </View>

      {/* Tags (built-in servers only) — dynamic: any tag the backend sends
          renders with a sensible default even if it's not in TAG_STYLES yet,
          so new badge types (see TAG_EMOJI) never need a client release. */}
      {server.tags && server.tags.length > 0 && !server.imported && (
        <View style={styles.tags}>
          {server.tags.map(tag => (
            <View key={tag} style={[styles.tag, TAG_STYLES[tag] || styles.tagDefault]}>
              <Text style={[styles.tagText, TAG_TEXT[tag] || {}]}>
                {TAG_EMOJI[tag] ? `${TAG_EMOJI[tag]} ` : ''}{t(tagLabelKey(tag)) || tag}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Selected indicator */}
      {server.selected && <View style={styles.selectedDot} />}

      {/* Delete button for imported servers */}
      {server.imported && onDelete && !server.selected && (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => onDelete(server)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

export const ServerRow = React.memo(ServerRowComponent, (prev, next) =>
  prev.server.id       === next.server.id       &&
  prev.server.selected === next.server.selected &&
  prev.server.ping     === next.server.ping     &&
  prev.server.load     === next.server.load     &&
  prev.server.imported === next.server.imported &&
  prev.favorite        === next.favorite
);

// Extensible tag → style/emoji maps. New badge types (Community, Experimental,
// Satellite, whatever comes next) just need one line added here — the render
// path above already handles any tag string, styled or not, so the backend
// can introduce new badges without a client release (item 7 of the ReaLink
// Next Build brief: "forbered dynamiske noder").
const TAG_STYLES: Record<string, object> = {
  Recommended:  { backgroundColor: 'rgba(0,232,122,0.12)', borderColor: Colors.border.glow },
  Fastest:      { backgroundColor: 'rgba(51,153,255,0.12)', borderColor: 'rgba(51,153,255,0.3)' },
  Stealth:      { backgroundColor: 'rgba(120,80,255,0.12)', borderColor: 'rgba(120,80,255,0.3)' },
  Streaming:    { backgroundColor: 'rgba(255,184,0,0.12)', borderColor: 'rgba(255,184,0,0.3)' },
  Starlink:     { backgroundColor: 'rgba(120,180,255,0.12)', borderColor: 'rgba(120,180,255,0.3)' },
  Beta:         { backgroundColor: 'rgba(255,140,60,0.12)', borderColor: 'rgba(255,140,60,0.3)' },
  Premium:      { backgroundColor: 'rgba(201,164,42,0.14)', borderColor: 'rgba(201,164,42,0.4)' },
  Community:    { backgroundColor: 'rgba(0,200,150,0.12)', borderColor: 'rgba(0,200,150,0.3)' },
  Experimental: { backgroundColor: 'rgba(255,100,100,0.12)', borderColor: 'rgba(255,100,100,0.3)' },
  Satellite:    { backgroundColor: 'rgba(120,180,255,0.12)', borderColor: 'rgba(120,180,255,0.3)' },
};

const TAG_TEXT: Record<string, object> = {
  Recommended:  { color: Colors.emerald[400] },
  Fastest:      { color: Colors.blue[400] },
  Stealth:      { color: '#9B77FF' },
  Streaming:    { color: '#FFB800' },
  Starlink:     { color: '#78B4FF' },
  Beta:         { color: '#FF8C3C' },
  Premium:      { color: '#C9A42A' },
  Community:    { color: '#00C896' },
  Experimental: { color: '#FF6464' },
  Satellite:    { color: '#78B4FF' },
};

const TAG_EMOJI: Record<string, string> = {
  Fastest: '🔥', Starlink: '⭐', Premium: '👑',
  Community: '🌍', Experimental: '🚀', Satellite: '🛰',
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    backgroundColor: Colors.bg.surface,
    marginBottom: Spacing[2],
    gap: Spacing[3],
  },
  selectedRow: {
    borderColor: Colors.border.active,
    backgroundColor: 'rgba(0,232,122,0.05)',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    flex: 1,
    minWidth: 0,
  },
  nameBlock: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], flexWrap: 'nowrap' },
  flag: { fontSize: 28 },
  flagBox: { width: 30, alignItems: 'center', justifyContent: 'center' },
  // Name is the primary read in the row now (city/protocol text dropped —
  // "mindre tekst, mer fokus på navn") — sized up one step from before.
  country: {
    fontSize: Typography.size.md,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    flexShrink: 1,
  },
  favoriteBtn: { paddingRight: 2 },
  favoriteIcon: { fontSize: 18, color: Colors.text.muted },
  favoriteIconActive: { color: '#FFB800' },
  selectedText: { color: Colors.emerald[400] },
  city: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    marginTop: 2,
  },
  importedBadge: {
    backgroundColor: 'rgba(120,80,255,0.12)',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(120,80,255,0.3)',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  importedBadgeText: {
    fontSize: 8,
    fontFamily: Typography.family.label,
    color: '#9B77FF',
    letterSpacing: 0.4,
  },
  right: { alignItems: 'flex-end', gap: 4 },
  pingRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pingDot: { width: 6, height: 6, borderRadius: 3, marginRight: 1 },
  // Ping is the headline metric now ("tydelig latency ... lett å lese") —
  // bumped a size and switched to the heading family so it reads at a glance.
  pingText: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
  },
  pingUnit: {
    fontSize: 10,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
  },
  loadTrack: {
    width: 48,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.border.default,
    overflow: 'hidden',
  },
  loadFill: { height: '100%', borderRadius: 2 },
  protocol: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tags: {
    position: 'absolute',
    top: -8,
    right: 12,
    flexDirection: 'row',
    gap: 4,
  },
  tag: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagDefault: {
    backgroundColor: Colors.bg.elevated,
    borderColor: Colors.border.default,
  },
  tagText: {
    fontSize: 9,
    fontFamily: Typography.family.label,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.text.secondary,
  },
  selectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.emerald[400],
    position: 'absolute',
    right: 14,
    top: '50%',
    marginTop: -4,
  },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,68,68,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  deleteBtnText: {
    fontSize: 11,
    color: Colors.status.disconnected,
    fontFamily: Typography.family.label,
  },
});
