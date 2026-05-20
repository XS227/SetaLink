import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, Clipboard,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { useServerStore } from '../stores/serverStore';

interface Props {
  onBack: () => void;
}

export function ProfileImportScreen({ onBack }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [resultOk, setResultOk] = useState(false);

  const { importFromVless, servers, importedCreds, removeImportedServer } = useServerStore();

  const importedEntries = servers.filter((s) => importedCreds[s.id]);

  const handleImport = () => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('vless://'));

    if (lines.length === 0) {
      setResult('No vless:// links found. Paste one or more vless:// URIs.');
      setResultOk(false);
      return;
    }

    let imported = 0;
    let updated = 0;
    let errors = 0;
    const errMsgs: string[] = [];

    for (const line of lines) {
      const r = importFromVless(line);
      if (r.success) {
        if (r.updated) updated++;
        else imported++;
      } else {
        errors++;
        if (r.error) errMsgs.push(r.error);
      }
    }

    const parts: string[] = [];
    if (imported > 0) parts.push(`${imported} imported`);
    if (updated > 0)  parts.push(`${updated} updated`);
    if (errors > 0)   parts.push(`${errors} failed`);

    const summary = parts.join(', ');
    setResult(summary + (errMsgs.length ? `\n${errMsgs.slice(0, 3).join('\n')}` : ''));
    setResultOk(errors === 0 || imported > 0 || updated > 0);

    if (imported > 0 || updated > 0) setText('');
  };

  const handlePaste = async () => {
    try {
      const clip = await Clipboard.getString();
      if (clip) setText(clip);
    } catch {}
  };

  const handleExport = (serverId: string) => {
    const creds = importedCreds[serverId];
    const rec   = servers.find((s) => s.id === serverId);
    if (!creds || !rec) return;

    const flow = creds.flow ? `&flow=${encodeURIComponent(creds.flow)}` : '';
    const fp   = creds.fingerprint ? `&fp=${creds.fingerprint}` : '';
    const sid  = creds.shortId ? `&sid=${encodeURIComponent(creds.shortId)}` : '';
    const sni  = creds.sni ? `&sni=${encodeURIComponent(creds.sni)}` : '';
    const pbk  = creds.publicKey ? `&pbk=${encodeURIComponent(creds.publicKey)}` : '';
    const name = encodeURIComponent(rec.city || rec.country);

    const uri = `vless://${creds.uuid}@${creds.address}:${creds.port}?security=reality&encryption=none&type=tcp${pbk}${sid}${sni}${flow}${fp}#${name}`;

    Clipboard.setString(uri);
    Alert.alert('Copied', 'VLESS link copied to clipboard.');
  };

  const handleDelete = (serverId: string) => {
    Alert.alert('Remove profile', 'Remove this imported profile?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeImportedServer(serverId) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Profile Import</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Import section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PASTE VLESS LINKS</Text>
          <Text style={styles.sectionHint}>
            Paste one or more vless:// links. Each link on a new line.
          </Text>
          <TextInput
            style={styles.input}
            multiline
            numberOfLines={6}
            placeholder="vless://uuid@host:port?security=reality&pbk=...#name"
            placeholderTextColor={Colors.text.muted}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste} activeOpacity={0.8}>
              <Text style={styles.pasteBtnText}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.importBtn, !text.includes('vless://') && styles.importBtnDisabled]}
              onPress={handleImport}
              activeOpacity={0.8}
            >
              <Text style={styles.importBtnText}>Import</Text>
            </TouchableOpacity>
          </View>
          {result !== null && (
            <View style={[styles.resultBox, resultOk ? styles.resultOk : styles.resultErr]}>
              <Text style={[styles.resultText, resultOk ? styles.resultTextOk : styles.resultTextErr]}>
                {result}
              </Text>
            </View>
          )}
        </View>

        {/* Imported profiles */}
        {importedEntries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>IMPORTED PROFILES</Text>
            {importedEntries.map((s) => {
              const creds = importedCreds[s.id];
              return (
                <View key={s.id} style={styles.profileRow}>
                  <View style={styles.profileInfo}>
                    <Text style={styles.profileName}>{s.country} · {s.city}</Text>
                    <Text style={styles.profileSub}>
                      {creds?.address}:{creds?.port} · {s.protocol}
                    </Text>
                    {creds?.sni ? (
                      <Text style={styles.profileSni}>SNI: {creds.sni}</Text>
                    ) : null}
                  </View>
                  <View style={styles.profileActions}>
                    <TouchableOpacity
                      style={styles.copyBtn}
                      onPress={() => handleExport(s.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.copyBtnText}>Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDelete(s.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {importedEntries.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No imported profiles yet.</Text>
            <Text style={styles.emptyHint}>Paste a vless:// link from your VPN provider above.</Text>
          </View>
        )}

        <View style={{ height: Layout.bottomNavHeight }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:    { flex: 1, backgroundColor: Colors.bg.base },
  header:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Layout.statusBarHeight, paddingHorizontal: Layout.screenPadding,
    paddingBottom: Spacing[3],
    borderBottomWidth: 1, borderBottomColor: Colors.border.subtle,
  },
  backBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon:  { fontSize: 28, color: Colors.emerald[400], lineHeight: 32 },
  title:     { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  scroll:    { flex: 1 },
  content:   { paddingHorizontal: Layout.screenPadding, paddingTop: Spacing[5], gap: Spacing[5] },
  section:   { gap: Spacing[3] },
  sectionLabel: {
    fontSize: Typography.size.xs, fontFamily: Typography.family.label,
    color: Colors.text.muted, letterSpacing: 1, textTransform: 'uppercase',
  },
  sectionHint: {
    fontSize: Typography.size.xs, fontFamily: Typography.family.body,
    color: Colors.text.muted,
  },
  input:     {
    backgroundColor: Colors.bg.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border.default,
    padding: Spacing[3], fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono, color: Colors.text.primary,
    minHeight: 120, textAlignVertical: 'top',
  },
  btnRow:    { flexDirection: 'row', gap: Spacing[3] },
  pasteBtn:  {
    flex: 1, paddingVertical: Spacing[3], borderRadius: Radius.lg,
    backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default,
    alignItems: 'center',
  },
  pasteBtnText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  importBtn: {
    flex: 2, paddingVertical: Spacing[3], borderRadius: Radius.lg,
    backgroundColor: Colors.emerald[400], alignItems: 'center',
  },
  importBtnDisabled: { backgroundColor: Colors.bg.elevated, opacity: 0.5 },
  importBtnText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.bg.base },
  resultBox: { borderRadius: Radius.md, padding: Spacing[3], borderWidth: 1 },
  resultOk:  { backgroundColor: 'rgba(0,232,122,0.08)', borderColor: 'rgba(0,232,122,0.25)' },
  resultErr: { backgroundColor: 'rgba(255,80,80,0.08)', borderColor: 'rgba(255,80,80,0.25)' },
  resultText: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono },
  resultTextOk: { color: Colors.emerald[400] },
  resultTextErr: { color: Colors.status.disconnected },
  profileRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bg.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border.default,
    padding: Spacing[3], gap: Spacing[3],
  },
  profileInfo:    { flex: 1, gap: 2 },
  profileName:    { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary },
  profileSub:     { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  profileSni:     { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  profileActions: { flexDirection: 'row', gap: Spacing[2] },
  copyBtn:  {
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[1], borderRadius: Radius.full,
    backgroundColor: 'rgba(0,232,122,0.12)', borderWidth: 1, borderColor: 'rgba(0,232,122,0.3)',
  },
  copyBtnText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,80,80,0.1)', borderWidth: 1, borderColor: 'rgba(255,80,80,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: Typography.size.xs, color: Colors.status.disconnected },
  emptyState: { alignItems: 'center', paddingVertical: Spacing[8], gap: Spacing[2] },
  emptyText:  { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  emptyHint:  { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center' },
});
