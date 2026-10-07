import { supabase } from '../lib/supabase';

export interface RiderPayoutProfileSummary {
  configured: boolean;
  payoutMethod: 'bank' | 'upi' | null;
  maskedDestination: string | null;
  updatedAt: string | null;
}

export interface RiderPayoutInput {
  payoutMethod: 'bank' | 'upi';
  accountHolder?: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
}

function getApiUrl() {
  const value = process.env.EXPO_PUBLIC_PAYMENT_API_URL?.trim();
  if (!value) throw new Error('Secure payout service is not configured.');
  return value.replace(/\/$/, '');
}

async function post(path: string, body: Record<string, string | undefined>) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Please log in to manage payout details.');
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Payout details could not be reached. Check your internet connection.');
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      && typeof payload.error === 'string'
      ? payload.error
      : 'Payout details could not be saved.';
    throw new Error(message);
  }
  if (typeof payload !== 'object' || payload === null) throw new Error('Payout service returned an invalid response.');
  return payload as Record<string, unknown>;
}

function parseSummary(payload: Record<string, unknown>): RiderPayoutProfileSummary {
  return {
    configured: payload.configured === true,
    payoutMethod: payload.payoutMethod === 'bank' || payload.payoutMethod === 'upi' ? payload.payoutMethod : null,
    maskedDestination: typeof payload.maskedDestination === 'string' ? payload.maskedDestination : null,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
}

export async function getRiderPayoutProfile() {
  return parseSummary(await post('/api/payout/profile/read', {}));
}

export async function saveRiderPayoutProfile(input: RiderPayoutInput) {
  const payload = await post('/api/payout/profile/save', {
    payoutMethod: input.payoutMethod,
    accountHolder: input.accountHolder,
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
    upiId: input.upiId,
  });
  return parseSummary(payload);
}
