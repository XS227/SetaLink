/**
 * Premium payments (USDT + REAL token) — typed client for the /v1/payments/* API.
 *
 * Backend is the single source of truth: prices come from the server, never hardcoded,
 * and payment status is server-decided (on-chain verified). See the PHP at
 * public/v1.php + lib/payments.php and docs/PREMIUM-REAL-PAYMENTS.md.
 *
 * NOTE (prepared, not yet wired): no screen imports this yet; navigation hook-up and
 * APK build happen in the dedicated mobile round.
 */

import { apiGet, apiPost } from './api/client';

export type PaymentMethod = 'REAL' | 'USDT';

export interface PremiumPackage {
  package_id: string;
  gb_amount: number;
  usdt_price: number;
  real_price: number;
  real_discount_percent: number;
  is_recommended: boolean;
  is_active: boolean;
  display_order: number;
}

export interface PackagesResponse {
  packages: PremiumPackage[];
  methods: { REAL: boolean; USDT: boolean };
  real: { discount_percent: number; token_address: string };
}

export interface PaymentIntent {
  payment_id: number;
  method: PaymentMethod;
  amount: number;
  amount_units: number;
  token_address: string;
  destination_wallet: string;
  memo: string;
  gb_amount: number;
  status: string;
  expires_at: string;
}

export type PaymentStatusValue =
  | 'pending' | 'confirmed' | 'expired' | 'rejected' | 'not_found' | 'error';

export interface PaymentStatus {
  status: PaymentStatusValue;
  gb_amount?: number;
  new_quota_total?: number | null;
  verified?: boolean;
  reason?: string;
}

const bearer = (deviceId: string): string => `device-${deviceId}`;

/** Public catalog — packages + REAL discount metadata. */
export function getPremiumPackages(): Promise<PackagesResponse> {
  return apiGet<PackagesResponse>('/payments/packages');
}

/** Create a server-priced payment intent for a package + method. */
export function createPaymentIntent(
  deviceId: string,
  packageId: string,
  method: PaymentMethod,
): Promise<PaymentIntent> {
  return apiPost<PaymentIntent>(
    '/payments/intent',
    { package_id: packageId, payment_method: method },
    bearer(deviceId),
  );
}

/** Poll payment status — server re-verifies on-chain; never trust client state. */
export function getPaymentStatus(deviceId: string, paymentId: number): Promise<PaymentStatus> {
  return apiGet<PaymentStatus>(`/payments/status?id=${paymentId}`, bearer(deviceId));
}

/** Build the Tonkeeper jetton-transfer deep link for an intent (REAL or USDT). */
export function tonkeeperLink(intent: PaymentIntent): string {
  return (
    `tonkeeper://transfer/${intent.destination_wallet}` +
    `?jetton=${intent.token_address}` +
    `&amount=${intent.amount_units}` +
    `&text=${encodeURIComponent(intent.memo)}`
  );
}
