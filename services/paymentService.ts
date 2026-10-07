import { Platform } from 'react-native';

import { supabase } from '../lib/supabase';
import type { Payment, PaymentStatus } from '../types/database';

export interface PaymentOrder {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'INR';
}

export interface PaymentCustomer {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface PaymentVerificationResult {
  paymentId: string;
  rideId: string;
  status: 'paid';
  amount: number;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return 'Payment could not be completed.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Payment server returned an invalid ${field}.`);
  }
  return value;
}

function getPaymentApiUrl() {
  const value = process.env.EXPO_PUBLIC_PAYMENT_API_URL?.trim();
  if (!value) {
    throw new Error('Payment server is not configured. Add EXPO_PUBLIC_PAYMENT_API_URL to the mobile environment.');
  }
  return value.replace(/\/$/, '');
}

export function getConfiguredPaymentKey() {
  return process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID?.trim() ?? null;
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  if (!data.session?.access_token) {
    throw new Error('Please log in before starting a payment.');
  }
  return data.session.access_token;
}

async function postPaymentApi<T>(path: string, body: Record<string, unknown>) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${getPaymentApiUrl()}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Payment server request failed.';
    throw new Error(message);
  }

  return payload as T;
}

function parsePaymentOrder(payload: unknown): PaymentOrder {
  if (!isRecord(payload)) {
    throw new Error('Payment server returned an invalid order.');
  }

  const amount = payload.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    throw new Error('Payment server returned an invalid order amount.');
  }

  if (payload.currency !== 'INR') {
    throw new Error('Payment server returned an unsupported currency.');
  }

  return {
    paymentId: requireString(payload.paymentId, 'payment ID'),
    orderId: requireString(payload.orderId, 'order ID'),
    amount,
    currency: 'INR',
  };
}

export async function createRazorpayOrder(rideId: string, expectedFare: number) {
  const payload = await postPaymentApi<unknown>('/api/payments/orders', {
    rideId,
    amount: expectedFare,
  });
  return parsePaymentOrder(payload);
}

// Kept as a compatibility name for existing callers. It now creates a
// server-backed Razorpay order instead of directly inserting a payment row.
export async function createPendingPayment(rideId: string, expectedFare: number) {
  return createRazorpayOrder(rideId, expectedFare);
}

export async function verifyRazorpayPayment(input: {
  rideId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const payload = await postPaymentApi<unknown>('/api/payments/verify', input);
  if (!isRecord(payload) || payload.status !== 'paid') {
    throw new Error('Payment verification did not complete.');
  }

  return {
    paymentId: requireString(payload.paymentId, 'payment ID'),
    rideId: requireString(payload.rideId, 'ride ID'),
    status: 'paid' as const,
    amount: typeof payload.amount === 'number' ? payload.amount : 0,
  } satisfies PaymentVerificationResult;
}

export async function markRazorpayPaymentFailed(rideId: string, orderId: string, reason: string) {
  const payload = await postPaymentApi<unknown>('/api/payments/failed', {
    rideId,
    razorpayOrderId: orderId,
    reason: reason.slice(0, 200),
  });

  if (!isRecord(payload) || payload.status !== 'failed') {
    throw new Error('Payment failure could not be recorded.');
  }
}

export async function payForRide(input: {
  rideId: string;
  expectedFare: number;
  customer?: PaymentCustomer;
}) {
  if (Platform.OS === 'web') {
    throw new Error('Razorpay Checkout requires an Android or iOS development build.');
  }

  const key = getConfiguredPaymentKey();
  if (!key) {
    throw new Error('Razorpay is not configured. Add EXPO_PUBLIC_RAZORPAY_KEY_ID to the mobile environment.');
  }

  const order = await createRazorpayOrder(input.rideId, input.expectedFare);
  let checkoutResult: { razorpay_payment_id?: string; razorpay_order_id?: string; razorpay_signature?: string };

  try {
    const { default: RazorpayCheckout } = await import('react-native-razorpay');
    checkoutResult = await RazorpayCheckout.open({
      key,
      amount: order.amount,
      currency: order.currency,
      name: 'AutoWala',
      description: 'AutoWala ride fare',
      order_id: order.orderId,
      prefill: {
        name: input.customer?.name ?? undefined,
        email: input.customer?.email ?? undefined,
        contact: input.customer?.phone ?? undefined,
      },
      theme: { color: '#2E7D32' },
    });
  } catch (error) {
    await markRazorpayPaymentFailed(input.rideId, order.orderId, getErrorMessage(error)).catch(() => undefined);
    throw new Error(getErrorMessage(error));
  }

  if (!checkoutResult.razorpay_payment_id || !checkoutResult.razorpay_signature) {
    await markRazorpayPaymentFailed(input.rideId, order.orderId, 'Checkout did not return a complete payment response.').catch(() => undefined);
    throw new Error('Razorpay did not return a complete payment response.');
  }

  return verifyRazorpayPayment({
    rideId: input.rideId,
    razorpayOrderId: checkoutResult.razorpay_order_id ?? order.orderId,
    razorpayPaymentId: checkoutResult.razorpay_payment_id,
    razorpaySignature: checkoutResult.razorpay_signature,
  });
}

export async function getRidePayment(rideId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('ride_id', rideId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as Payment | null) ?? null;
}

export function isPaymentComplete(status: PaymentStatus) {
  return status === 'paid';
}
