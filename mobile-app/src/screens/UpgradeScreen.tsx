import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';

const { width } = Dimensions.get('window');

interface Plan {
  id:       'free' | 'premium' | 'team';
  name:     string;
  price:    string;
  period:   string;
  color:    string;
  features: string[];
  cta:      string;
  badge?:   string;
}

const PLANS: Plan[] = [
  {
    id:      'free',
    name:    'Free',
    price:   '$0',
    period:  'forever',
    color:   Colors.text.muted,
    cta:     'Current plan',
    features: [
      '5 GB / month',
      'Standard servers only',
      'VLESS protocol',
      'Single device',
    ],
  },
  {
    id:      'premium',
    name:    'Premium',
    price:   '$7.99',
    period:  'per month',
    color:   Colors.emerald[400],
    cta:     'Start 7-day free trial',
    badge:   'Most popular',
    features: [
      'Unlimited bandwidth',
      'All 40+ premium servers',
      'VLESS + Reality + Stealth',
      '5 simultaneous devices',
      'Priority support',
      'Smart AI routing',
    ],
  },
  {
    id:      'team',
    name:    'Team',
    price:   '$4.99',
    period:  'per user / month',
    color:   '#B47AFF',
    cta:     'Contact sales',
    features: [
      'Everything in Premium',
      'Centralized billing',
      'Admin dashboard',
      'Dedicated account manager',
      'SLA 99.9%',
    ],
  },
];

const FEATURE_COMPARISON = [
  { label: 'Bandwidth',       free: '5 GB/mo',  premium: 'Unlimited', team: 'Unlimited' },
  { label: 'Servers',         free: '8 std',     premium: '40+ incl. premium', team: '40+' },
  { label: 'Protocols',       free: 'VLESS',     premium: 'VLESS · Reality · Stealth', team: 'All' },
  { label: 'Devices',         free: '1',         premium: '5',         team: 'Unlimited' },
  { label: 'AI routing',      free: '✕',         premium: '✓',         team: '✓' },
  { label: 'Kill switch',     free: '✓',         premium: '✓',         team: '✓' },
  { label: 'Custom DNS',      free: '✕',         premium: '✓',         team: '✓' },
  { label: 'Split tunneling', free: '✕',         premium: '✓',         team: '✓' },
];

interface Props {
  onBack: () => void;
}

export function UpgradeScreen({ onBack }: Props) {
  const [selected, setSelected] = useState<'premium' | 'team'>('premium');
  const [loading, setLoading]   = useState(false);

  const plan = PLANS.find((p) => p.id === selected)!;

  const handleSubscribe = () => {
    setLoading(true);
    // TODO: wire to In-App Purchase (react-native-iap) or Stripe
    setTimeout(() => {
      setLoading(false);
      onBack();
    }, 1500);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>Upgrade</Text>
            <Text style={styles.subtitle}>Unlock the full SetaLink experience</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Plan cards */}
        <View style={styles.planRow}>
          {PLANS.filter((p) => p.id !== 'free').map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[
                styles.planCard,
                selected === p.id && { borderColor: p.color, backgroundColor: p.color + '0A' },
              ]}
              onPress={() => setSelected(p.id as 'premium' | 'team')}
              activeOpacity={0.8}
            >
              {p.badge && (
                <View style={[styles.badge, { backgroundColor: p.color + '20', borderColor: p.color + '40' }]}>
                  <Text style={[styles.badgeText, { color: p.color }]}>{p.badge}</Text>
                </View>
              )}
              <Text style={[styles.planName, { color: p.color }]}>{p.name}</Text>
              <Text style={styles.planPrice}>{p.price}</Text>
              <Text style={styles.planPeriod}>{p.period}</Text>

              <View style={styles.planFeatures}>
                {p.features.map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <Text style={[styles.featureCheck, { color: p.color }]}>✓</Text>
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Feature comparison table */}
        <GlassCard noPadding>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCol, { flex: 2 }]}>Feature</Text>
            <Text style={styles.tableCol}>Free</Text>
            <Text style={[styles.tableCol, { color: Colors.emerald[400] }]}>Premium</Text>
          </View>
          {FEATURE_COMPARISON.map((row, i) => (
            <View
              key={row.label}
              style={[
                styles.tableRow,
                i < FEATURE_COMPARISON.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
              ]}
            >
              <Text style={[styles.tableCell, { flex: 2, color: Colors.text.primary }]}>{row.label}</Text>
              <Text style={[styles.tableCell, { color: Colors.text.muted }]}>{row.free}</Text>
              <Text style={[styles.tableCell, { color: Colors.emerald[400] }]}>{row.premium}</Text>
            </View>
          ))}
        </GlassCard>

        {/* Trust badges */}
        <View style={styles.trustRow}>
          {['No logs', '256-bit AES', 'Cancel anytime'].map((t) => (
            <View key={t} style={styles.trustBadge}>
              <Text style={styles.trustText}>{t}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: plan.color }, loading && { opacity: 0.7 }]}
          onPress={handleSubscribe}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>{loading ? 'Processing…' : plan.cta}</Text>
        </TouchableOpacity>
        <Text style={styles.ctaNote}>7-day free trial · Cancel anytime · No commitment</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: Colors.bg.base,
  },
  scroll:  { flex: 1 },
  content: {
    paddingTop:        Layout.statusBarHeight + Spacing[2],
    paddingHorizontal: Layout.screenPadding,
    gap:               Spacing[5],
  },
  header: {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: Colors.bg.surface,
    borderWidth:     1,
    borderColor:     Colors.border.default,
    alignItems:      'center',
    justifyContent:  'center',
  },
  backIcon: {
    fontSize:   24,
    color:      Colors.text.primary,
    marginTop:  -2,
  },
  headerCenter: {
    alignItems: 'center',
    gap:        2,
  },
  title: {
    fontSize:   Typography.size['2xl'],
    fontFamily: Typography.family.heading,
    color:      Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  subtitle: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
  },
  planRow: {
    flexDirection: 'row',
    gap:           Spacing[3],
  },
  planCard: {
    flex:            1,
    backgroundColor: Colors.bg.surface,
    borderRadius:    Radius['2xl'],
    borderWidth:     1,
    borderColor:     Colors.border.default,
    padding:         Spacing[4],
    gap:             Spacing[2],
  },
  badge: {
    alignSelf:    'flex-start',
    borderRadius: Radius.full,
    borderWidth:  1,
    paddingHorizontal: Spacing[2],
    paddingVertical:   2,
    marginBottom: 2,
  },
  badgeText: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.label,
    letterSpacing: 0.5,
  },
  planName: {
    fontSize:   Typography.size.base,
    fontFamily: Typography.family.heading,
  },
  planPrice: {
    fontSize:   Typography.size['2xl'],
    fontFamily: Typography.family.heading,
    color:      Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  planPeriod: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
    marginTop:  -4,
  },
  planFeatures: {
    gap:       Spacing[2],
    marginTop: Spacing[3],
  },
  featureRow: {
    flexDirection: 'row',
    gap:           Spacing[2],
    alignItems:    'flex-start',
  },
  featureCheck: {
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.heading,
    width:      14,
    flexShrink: 0,
  },
  featureText: {
    flex:       1,
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.body,
    color:      Colors.text.secondary,
    lineHeight: 18,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[4],
    paddingVertical:   Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.default,
  },
  tableCol: {
    flex:       1,
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.label,
    color:      Colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  tableRow: {
    flexDirection:     'row',
    paddingHorizontal: Spacing[4],
    paddingVertical:   Spacing[3],
  },
  tableCell: {
    flex:       1,
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.mono,
    color:      Colors.text.secondary,
    textAlign:  'center',
  },
  trustRow: {
    flexDirection:  'row',
    gap:            Spacing[3],
    justifyContent: 'center',
    flexWrap:       'wrap',
  },
  trustBadge: {
    backgroundColor: Colors.bg.surface,
    borderRadius:    Radius.full,
    borderWidth:     1,
    borderColor:     Colors.border.default,
    paddingHorizontal: Spacing[3],
    paddingVertical:   Spacing[2],
  },
  trustText: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.label,
    color:      Colors.text.muted,
    letterSpacing: 0.5,
  },
  footer: {
    position:          'absolute',
    bottom:            0,
    left:              0,
    right:             0,
    paddingHorizontal: Layout.screenPadding,
    paddingBottom:     Layout.bottomNavHeight,
    paddingTop:        Spacing[4],
    backgroundColor:   Colors.bg.base,
    borderTopWidth:    1,
    borderTopColor:    Colors.border.subtle,
    gap:               Spacing[2],
  },
  cta: {
    borderRadius:    Radius.lg,
    paddingVertical: Spacing[4],
    alignItems:      'center',
    ...Shadow.emerald,
  },
  ctaText: {
    fontSize:   Typography.size.base,
    fontFamily: Typography.family.heading,
    color:      Colors.text.inverse,
    letterSpacing: Typography.tracking.wide,
  },
  ctaNote: {
    fontSize:   Typography.size.xs,
    fontFamily: Typography.family.body,
    color:      Colors.text.muted,
    textAlign:  'center',
  },
});
