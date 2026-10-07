import { supabase } from '../lib/supabase';
import type { PayoutStatus, RiderEarning, RiderEarningsSummary } from '../types/database';

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Earnings data could not be read.');
  }
  return parsed;
}

export async function getRiderEarningsSummary(): Promise<RiderEarningsSummary> {
  const { data, error } = await supabase.rpc('get_rider_earnings_summary');
  if (error) throw new Error('Your earnings could not be loaded. Please try again.');
  if (typeof data !== 'object' || data === null) throw new Error('Earnings data could not be read.');
  const row = data as Record<string, unknown>;
  return {
    todayEarnings: asNumber(row.todayEarnings),
    weekEarnings: asNumber(row.weekEarnings),
    completedRides: asNumber(row.completedRides),
    todayCompletedRides: asNumber(row.todayCompletedRides),
    pendingPayout: asNumber(row.pendingPayout),
  };
}

export async function getAdminRiderEarnings(): Promise<RiderEarning[]> {
  const { data, error } = await supabase
    .from('ride_earnings')
    .select('id,ride_id,rider_id,gross_fare,platform_fee,tax_amount,rider_earning,payout_status,payout_reference,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error('Rider earnings could not be loaded. Please try again.');
  return (data ?? []) as RiderEarning[];
}

export async function setRideEarningPayoutStatus(
  rideId: string,
  status: PayoutStatus,
  reference?: string
): Promise<RiderEarning> {
  const { data, error } = await supabase.rpc('set_ride_earning_payout_status', {
    p_ride_id: rideId,
    p_status: status,
    p_reference: reference?.trim() || null,
  });
  if (error) throw new Error('Payout status could not be updated. Please try again.');
  return data as RiderEarning;
}
