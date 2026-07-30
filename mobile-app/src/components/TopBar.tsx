/**
 * TopBar — avatar only, the single entry point into Profile/Settings/
 * Chats/Clan/Dashboard via a tap-to-open menu (Khabat, 2026-07-29: "gjør om
 * profil bilde slik at når jeg trykker på den skal den fungere som et
 * slags burger meny").
 *
 * The standalone inbox envelope + unread-count badge that used to sit next
 * to the avatar is gone (same request: "viser fortsatt at jeg har 4
 * uleste meldinger. det er feil. ta bort ikonet" — the badge count was
 * stale/wrong, and Inbox is reachable from the menu below now anyway, so
 * removing it rather than chasing the staleness bug is the actual fix
 * asked for). If unread state needs a visible cue again later, that's a
 * real "why is inboxStore/dmStore read-state stale" investigation, not a
 * styling change — not done here.
 *
 * Power button moved into the VPN card on HomeScreen (B-16 declutter intent,
 * finally completed).
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Modal, Pressable, Dimensions,
} from 'react-native';
import { Colors, Layout, Radius, Shadow, Spacing, Typography } from '../design/tokens';
import { useIdentityStore }   from '../stores/identityStore';
import { useProfilePicStore } from '../stores/profilePicStore';
import { useT } from '../i18n';

const MENU_WIDTH = 200;
// Fallback anchor before/without a real measurement — every host screen
// (Wallet/SmartAI/Servers/Activity/Inbox/Home/RealGramProfile/RealGramHome
// via its own floating wrapper) pads its header the same way, so this
// lands close enough even if measureInWindow's callback never resolves
// (jest's RN mock doesn't invoke it; real devices always do and refine it).
// Opening the menu is never gated on the native call succeeding.
const FALLBACK_MENU_POS = { top: Layout.statusBarHeight + Spacing[2] + 48, right: Layout.screenPadding };

interface MenuItem { key: string; icon: string; labelKey: 'nav.profile' | 'st.title' | 'nav.chats' | 'nav.clan'; tab: string }

// Khabat, 2026-07-30: Chats/Clan moved here from the footer (BottomNav.tsx's
// own comment has the full reasoning) — same 'inbox' tab value as before for
// Chats (still routes to the Stack-pushed 'Inbox' screen, distinct from the
// tab-bar 'Chats' route), just relabelled to match what left the footer.
// The separate "Dashboard" item (→ 'ShahnamehHome') was dropped the same
// session (Khabat: "min profil er min dashboard") — it pointed at the exact
// same RealGramHomeScreen already reachable via BottomNav's 'game' tab, so
// it was a second path to a destination that already has one, not a
// distinct screen.
const MENU_ITEMS: MenuItem[] = [
  { key: 'profile',   icon: '👤', labelKey: 'nav.profile',       tab: 'profile' },
  { key: 'settings',  icon: '⚙',  labelKey: 'st.title',          tab: 'settings' },
  { key: 'inbox',     icon: '✉',  labelKey: 'nav.chats',         tab: 'inbox' },
  { key: 'clan',      icon: '👥', labelKey: 'nav.clan',          tab: 'clan' },
];

export function TopBar({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { t } = useT();
  const avatarEmoji    = useIdentityStore((s) => s.avatarEmoji);
  const avatarColor    = useIdentityStore((s) => s.avatarColor);
  const profilePicUrl  = useProfilePicStore((s) => s.url);

  const avatarRef = useRef<View>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos]   = useState(FALLBACK_MENU_POS);

  const openMenu = () => {
    setMenuOpen(true);
    setMenuPos(FALLBACK_MENU_POS);
    avatarRef.current?.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get('window').width;
      setMenuPos({ top: y + height + 6, right: screenWidth - (x + width) });
    });
  };

  const handleSelect = (tab: string) => {
    setMenuOpen(false);
    onNavigate(tab);
  };

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        ref={avatarRef}
        style={[styles.avatarChip, { borderColor: avatarColor, backgroundColor: avatarColor + '33' }]}
        onPress={openMenu}
        hitSlop={10}
        accessibilityLabel={t('nav.profile')}
      >
        {profilePicUrl ? (
          <Image source={{ uri: profilePicUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
        )}
      </TouchableOpacity>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, { top: menuPos.top, right: menuPos.right }]}>
            {MENU_ITEMS.map((item, i) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.menuRow, i < MENU_ITEMS.length - 1 && styles.menuRowDivider]}
                onPress={() => handleSelect(item.tab)}
                activeOpacity={0.7}
              >
                <Text style={styles.menuIcon}>{item.icon}</Text>
                <Text style={styles.menuLabel}>{t(item.labelKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar:        { flexDirection: 'row', alignItems: 'center' },
  avatarChip: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarEmoji:{ fontSize: 18 },
  avatarImage:{ width: '100%', height: '100%', borderRadius: 21 },

  menu: {
    position: 'absolute', width: MENU_WIDTH,
    backgroundColor: Colors.bg.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border.default,
    overflow: 'hidden', ...Shadow.card,
  },
  menuRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[3], paddingHorizontal: Spacing[4] },
  menuRowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.border.default },
  menuIcon:       { fontSize: 16, width: 20, textAlign: 'center', color: Colors.gold[400] },
  menuLabel:      { fontSize: 14, fontFamily: Typography.family.body, color: Colors.text.primary },
});
