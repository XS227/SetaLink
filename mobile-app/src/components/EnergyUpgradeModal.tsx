/**
 * EnergyUpgradeModal — paid stamina-pool upgrade tiers (Khabat, 2026-07-31:
 * "stamina ble fort tomt, gjør det om til 1k så kan de oppgradere det til
 * 2k, 3k, 5k osv, fibonaci sequensen her og. de må betale med ﷼").
 *
 * Sequential only (buy the next tier up, matches api.php's own
 * 'upgrade-energy-tier' server-side enforcement — can't skip or downgrade).
 * Prices come from lib/real_economy.php's ENERGY_TIERS — flagged there as a
 * proposed starting point, not a reviewed business decision; this modal
 * just displays whatever the server returns, never hardcodes a price.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { useToastStore } from '../stores/toastStore';
import { getEnergyTier, upgradeEnergyTier, EnergyTierDef } from '../services/entitlementService';

interface Props {
  visible: boolean;
  deviceId: string;
  onClose: () => void;
  /** Called with the new max pool size once an upgrade succeeds, so the
   *  caller can update useTapEnergy's live maxEnergy immediately instead of
   *  waiting for the next full re-fetch. */
  onUpgraded: (newTier: number, newPool: number) => void;
}

function formatPool(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
}

export function EnergyUpgradeModal({ visible, deviceId, onClose, onUpgraded }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [tiers, setTiers] = useState<EnergyTierDef[] | null>(null);
  const [currentTier, setCurrentTier] = useState(0);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    if (!visible || !deviceId) return;
    let cancelled = false;
    getEnergyTier(deviceId).then((res) => {
      if (cancelled) return;
      setTiers(res.tiers);
      setCurrentTier(res.tier);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, deviceId]);

  const nextTier = tiers ? currentTier + 1 : null;
  const nextDef = tiers && nextTier != null ? tiers[nextTier] : null;

  const handleBuy = async () => {
    if (!deviceId || nextTier == null || buying) return;
    setBuying(true);
    const clientRef = `energy-${deviceId}-${Date.now()}`;
    const result = await upgradeEnergyTier(deviceId, clientRef);
    setBuying(false);
    if (!result.ok) {
      showToast(
        result.error === 'insufficient_balance' ? t('stamina.upgradeInsufficientFunds') : t('stamina.upgradeFailed'),
        'error',
      );
      return;
    }
    setCurrentTier(result.tier);
    onUpgraded(result.tier, result.pool);
    showToast(t('stamina.upgradeSuccess').replace('{pool}', formatPool(result.pool)), 'success');
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <Text style={styles.title}>{t('stamina.upgradeTitle')}</Text>
          <Text style={styles.subtitle}>{t('stamina.upgradeSubtitle')}</Text>

          {!tiers ? (
            <ActivityIndicator size="small" color={Colors.gold[400]} style={{ marginVertical: Spacing[4] }} />
          ) : (
            <View style={styles.tierList}>
              {tiers.map((def, i) => {
                const owned = i <= currentTier;
                const isNext = i === nextTier;
                return (
                  <View key={i} style={[styles.tierRow, owned && styles.tierRowOwned, isNext && styles.tierRowNext]}>
                    <Text style={styles.tierPool}>{formatPool(def.pool)} ⚡</Text>
                    {owned ? (
                      <Text style={styles.tierOwned}>{i === currentTier ? t('stamina.current') : '✓'}</Text>
                    ) : (
                      <Text style={styles.tierCost}>﷼ {def.cost_real.toLocaleString()}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {nextDef && (
            <TouchableOpacity style={styles.buyBtn} activeOpacity={0.85} disabled={buying} onPress={handleBuy}>
              {buying
                ? <ActivityIndicator size="small" color={Colors.bg.void} />
                : <Text style={styles.buyBtnText}>
                    {t('stamina.upgradeBuy').replace('{pool}', formatPool(nextDef.pool)).replace('{cost}', `﷼ ${nextDef.cost_real.toLocaleString()}`)}
                  </Text>}
            </TouchableOpacity>
          )}
          {tiers && !nextDef && (
            <Text style={styles.maxedText}>{t('stamina.upgradeMaxed')}</Text>
          )}

          <TouchableOpacity style={styles.closeBtn} activeOpacity={0.75} onPress={onClose}>
            <Text style={styles.closeBtnText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </GlassCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing[4] },
  card: { width: '100%', maxWidth: 360, gap: Spacing[2] },
  title: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary, textAlign: 'center' },
  subtitle: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', marginBottom: Spacing[2] },

  tierList: { gap: Spacing[1] },
  tierRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: Spacing[2], paddingHorizontal: Spacing[3],
    borderRadius: Radius.md, backgroundColor: Colors.bg.elevated,
    borderWidth: 1, borderColor: Colors.border.default,
  },
  tierRowOwned: { opacity: 0.6 },
  tierRowNext: { opacity: 1, borderColor: Colors.gold[400] },
  tierPool: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.text.primary },
  tierCost: { fontSize: 13, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  tierOwned: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.status.connected },

  buyBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center', marginTop: Spacing[2] },
  buyBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },
  maxedText: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', marginTop: Spacing[2] },

  closeBtn: { alignItems: 'center', paddingVertical: Spacing[2], marginTop: Spacing[1] },
  closeBtnText: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted },
});
