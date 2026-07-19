import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';

// Remote config gates the whole card — swap it per test. getRemoteConfig is
// the async fetch the card now also awaits on mount (2026-07-19 fix: it must
// not rely solely on a cache some other screen may not have populated yet),
// so it defaults to resolving whatever getCachedConfig currently returns.
const mockGetCachedConfig = jest.fn();
const mockGetRemoteConfig = jest.fn((..._a: any[]) => Promise.resolve(mockGetCachedConfig()));
jest.mock('../services/remoteConfigService', () => ({
  getCachedConfig: (...a: any[]) => mockGetCachedConfig(...a),
  getRemoteConfig: (...a: any[]) => mockGetRemoteConfig(...a),
}));

const mockGetRealWallet   = jest.fn();
const mockRedeemRealSpend = jest.fn();
jest.mock('../services/realWalletService', () => ({
  getRealWallet:   (...a: any[]) => mockGetRealWallet(...a),
  redeemRealSpend: (...a: any[]) => mockRedeemRealSpend(...a),
}));

const mockToast = jest.fn();
jest.mock('../stores/toastStore', () => ({
  useToastStore: (sel: any) => sel({ show: mockToast }),
}));

jest.mock('../i18n', () => ({
  useT: () => ({ t: (k: string) => k, isRTL: false, lang: 'en' }),
}));

import { RealWalletCard } from '../components/RealWalletCard';

const RATES = { real_per_gb: 100, redeem_min_real: 50, redeem_daily_cap_bytes: 10 * 1073741824 };

const texts = (tree: renderer.ReactTestRenderer): string[] =>
  tree.root.findAllByType('Text' as any).flatMap((n) =>
    React.Children.toArray(n.props.children).filter((c) => typeof c === 'string'),
  ) as string[];

// Multiple ticks: mount effect awaits getRemoteConfig() → setEnabled() →
// re-render → second effect awaits getRealWallet() → setWallet().
const flush = () => act(async () => {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await Promise.resolve(); await Promise.resolve();
});

describe('RealWalletCard — remote-config gate + redeem flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
  });

  it('renders nothing when the remote-config flag is off', async () => {
    mockGetCachedConfig.mockReturnValue({ ecosystem: { wallet_enabled: false } });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<RealWalletCard deviceId="dev-1" />); });
    await flush();
    expect(tree.toJSON()).toBeNull();
    expect(mockGetRealWallet).not.toHaveBeenCalled();
  });

  it('shows the link CTA when no REAL account is linked', async () => {
    mockGetCachedConfig.mockReturnValue({ ecosystem: { wallet_enabled: true } });
    mockGetRealWallet.mockResolvedValue({
      linked_account: '', balance: null, rates: RATES, redeemed_today_bytes: 0,
    });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<RealWalletCard deviceId="dev-1" />); });
    await flush();
    expect(texts(tree)).toContain('wallet.linkBtn');
    expect(texts(tree)).not.toContain('wallet.redeem');
  });

  it('shows balance and redeems: 1 GB costs real_per_gb, quota refresh fires', async () => {
    mockGetCachedConfig.mockReturnValue({ ecosystem: { wallet_enabled: true } });
    mockGetRealWallet.mockResolvedValue({
      linked_account: 'real:kb', balance: 500, rates: RATES, redeemed_today_bytes: 0,
    });
    mockRedeemRealSpend.mockResolvedValue({
      status: 'credited', quota_bytes: 1073741824, new_total: 2147483648, balance: 400,
    });
    const onRedeemed = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<RealWalletCard deviceId="dev-1" onRedeemed={onRedeemed} />); });
    await flush();

    const redeemBtn = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === 'wallet.redeem',
    )[0];
    await act(async () => { redeemBtn.props.onPress(); });

    expect(mockRedeemRealSpend).toHaveBeenCalledWith('dev-1', 100, expect.any(String));
    expect(onRedeemed).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('wallet.success', 'success');
  });

  it('shows ZAR balance and conversion rate alongside REAL when the server sends them (B-23)', async () => {
    mockGetCachedConfig.mockReturnValue({ ecosystem: { wallet_enabled: true } });
    mockGetRealWallet.mockResolvedValue({
      linked_account: 'real:kb', balance: 500, zar: 1250, conversion_rate: 0.4,
      rates: RATES, redeemed_today_bytes: 0,
    });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<RealWalletCard deviceId="dev-1" />); });
    await flush();

    const all = texts(tree);
    expect(all.some((t) => t.includes('500') && t.includes('REAL'))).toBe(true);
    expect(all.some((t) => t.includes('1,250') && t.includes('ZAR'))).toBe(true);
    expect(all).toContain('wallet.conversionHint');
  });

  it('omits ZAR/conversion display when the server does not send them', async () => {
    mockGetCachedConfig.mockReturnValue({ ecosystem: { wallet_enabled: true } });
    mockGetRealWallet.mockResolvedValue({
      linked_account: 'real:kb', balance: 500, zar: null, conversion_rate: null,
      rates: RATES, redeemed_today_bytes: 0,
    });
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<RealWalletCard deviceId="dev-1" />); });
    await flush();

    const all = texts(tree);
    expect(all.some((t) => t.includes('ZAR'))).toBe(false);
    expect(all).not.toContain('wallet.conversionHint');
  });

  it('surfaces a structured denial from the panel as an error toast', async () => {
    mockGetCachedConfig.mockReturnValue({ ecosystem: { wallet_enabled: true } });
    mockGetRealWallet.mockResolvedValue({
      linked_account: 'real:kb', balance: 30, rates: RATES, redeemed_today_bytes: 0,
    });
    mockRedeemRealSpend.mockRejectedValue(new Error('insufficient_balance'));
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<RealWalletCard deviceId="dev-1" />); });
    await flush();

    const redeemBtn = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === 'wallet.redeem',
    )[0];
    await act(async () => { redeemBtn.props.onPress(); });

    expect(mockToast).toHaveBeenCalledWith('insufficient_balance', 'error');
  });
});
