import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';

// Remote config gates the whole card — swap it per test.
const mockGetCachedConfig = jest.fn();
jest.mock('../services/remoteConfigService', () => ({
  getCachedConfig: (...a: any[]) => mockGetCachedConfig(...a),
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

const flush = () => act(async () => { await Promise.resolve(); });

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
