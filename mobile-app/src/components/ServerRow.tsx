import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';

export interface Server {
  id: string;
  country: string;
  city: string;
  flag: string;
  ping: number;
  load: number;          // 0–100
  protocol: string;
  tags?: string[];       // 'Recommended' | 'Fastest' | 'Stealth' | 'Streaming'
  premium?: boolean;
  selected?: boolean;
  imported?: boolean;    // true for user-imported servers (shows delete action)
}

interface Props {
  server: Server;
  onSelect: (server: Server) => void;
  onDelete?: (server: Server) => void;
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

function ServerRowComponent({ server, onSelect, onDelete }: Props) {
  const pingLabel = server.ping === 0 ? '—' : `${server.ping}ms`;

  return (
    <TouchableOpacity
      style={[styles.row, server.selected && styles.selectedRow]}
      onPress={() => onSelect(server)}
      activeOpacity={0.7}
    >
      {/* Flag + Country */}
      <View style={styles.left}>
        <Text style={styles.flag}>{server.flag}</Text>
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
          <Text style={styles.city} numberOfLines={1}>{server.city}</Text>
        </View>
      </View>

      {/* Metrics */}
      <View style={styles.right}>
        <View style={styles.pingRow}>
          <PingDot ping={server.ping} />
          <Text style={styles.pingText}>{pingLabel}</Text>
        </View>
        <LoadBar load={server.load} />
        <Text style={styles.protocol}>{server.protocol}</Text>
      </View>

      {/* Tags (built-in servers only) */}
      {server.tags && server.tags.length > 0 && !server.imported && (
        <View style={styles.tags}>
          {server.tags.map(tag => (
            <View key={tag} style={[styles.tag, TAG_STYLES[tag] || styles.tagDefault]}>
              <Text style={[styles.tagText, TAG_TEXT[tag] || {}]}>{tag}</Text>
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
  prev.server.imported === next.server.imported
);

const TAG_STYLES: Record<string, object> = {
  Recommended: { backgroundColor: 'rgba(0,232,122,0.12)', borderColor: Colors.border.glow },
  Fastest:     { backgroundColor: 'rgba(51,153,255,0.12)', borderColor: 'rgba(51,153,255,0.3)' },
  Stealth:     { backgroundColor: 'rgba(120,80,255,0.12)', borderColor: 'rgba(120,80,255,0.3)' },
  Streaming:   { backgroundColor: 'rgba(255,184,0,0.12)', borderColor: 'rgba(255,184,0,0.3)' },
};

const TAG_TEXT: Record<string, object> = {
  Recommended: { color: Colors.emerald[400] },
  Fastest:     { color: Colors.blue[400] },
  Stealth:     { color: '#9B77FF' },
  Streaming:   { color: '#FFB800' },
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
  country: {
    fontSize: Typography.size.base,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    flexShrink: 1,
  },
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
  pingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pingDot: { width: 6, height: 6, borderRadius: 3 },
  pingText: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.secondary,
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
