import { supabase } from '../lib/supabase';
import type { Complaint, Profile, Rider, RiderApprovalStatus, Ride } from '../types/database';

export interface AdminStats {
  users: number;
  riders: number;
  onlineRiders: number;
  pendingRiders: number;
  approvedRiders: number;
  rides: number;
  activeRides: number;
  completedRides: number;
  cancelledRides: number;
  payments: number;
  paidPayments: number;
  totalPaid: number;
  pendingPaymentAmount: number;
}

export interface AdminRiderRow {
  profile: Profile | null;
  rider: Rider;
}

interface AdminFinancialSummary {
  payments: number;
  paidPayments: number;
  totalPaid: number;
  pendingPaymentAmount: number;
}

async function countRows(table: string, filters: [string, string][] = []) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const { count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function countRowsIn(table: string, column: string, values: string[]) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in(column, values);
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function countPendingRiders() {
  const { count, error } = await supabase
    .from('riders')
    .select('*', { count: 'exact', head: true })
    .or('approval_status.eq.pending,approval_status.is.null');
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function countOnlineRiders() {
  const { count, error } = await supabase
    .from('riders')
    .select('user_id', { count: 'exact', head: true })
    .eq('is_online', true)
    .eq('approval_status', 'approved');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getAdminStats(): Promise<AdminStats> {
  const [users, riders, onlineRiders, pendingRiders, approvedRiders, rides, activeRides, completedRides, cancelledRides, financial] = await Promise.all([
    countRows('profiles', [['role', 'user']]),
    countRows('profiles', [['role', 'rider']]),
    countOnlineRiders(),
    countPendingRiders(),
    countRows('riders', [['approval_status', 'approved']]),
    countRows('rides'),
    countRowsIn('rides', 'status', ['requested', 'accepted', 'arrived', 'picked_up', 'in_progress']),
    countRows('rides', [['status', 'completed']]),
    countRows('rides', [['status', 'cancelled']]),
    getAdminFinancialSummary(),
  ]);

  return { users, riders, onlineRiders, pendingRiders, approvedRiders, rides, activeRides, completedRides, cancelledRides, ...financial };
}

async function getAdminFinancialSummary(): Promise<AdminFinancialSummary> {
  const { data, error } = await supabase.rpc('get_admin_financial_summary');
  if (error) {
    throw new Error(error.message);
  }

  const summary = data as AdminFinancialSummary;
  return {
    payments: Number(summary.payments ?? 0),
    paidPayments: Number(summary.paidPayments ?? 0),
    totalPaid: Number(summary.totalPaid ?? 0),
    pendingPaymentAmount: Number(summary.pendingPaymentAmount ?? 0),
  };
}

export async function getAdminProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Profile[];
}

export async function getAdminRiders(): Promise<AdminRiderRow[]> {
  const [{ data: riders, error: riderError }, { data: profiles, error: profileError }] = await Promise.all([
    supabase.from('riders').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('profiles').select('*').eq('role', 'rider').limit(500),
  ]);

  if (riderError) {
    throw new Error(riderError.message);
  }
  if (profileError) {
    throw new Error(profileError.message);
  }

  const riderRows = (riders ?? []) as Rider[];
  const profileRows = (profiles ?? []) as Profile[];
  return riderRows.map((rider) => ({
    rider,
    profile: profileRows.find((profile) => profile.id === rider.user_id) ?? null,
  }));
}

export async function getAdminUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Profile[];
}

export async function updateRiderApproval(userId: string, approvalStatus: RiderApprovalStatus) {
  const { data, error } = await supabase
    .from('riders')
    .update({ approval_status: approvalStatus, is_online: false })
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Rider;
}

export async function getAdminRides() {
  const { data, error } = await supabase.from('rides').select('id,passenger_id,rider_id,pickup_address,destination_address,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,passenger_count,vehicle_preference,estimated_distance_km,estimated_fare,final_fare,status,booking_code_expires_at,accepted_at,arrived_at,picked_up_at,in_progress_at,completed_at,cancelled_at,created_at,updated_at').order('created_at', { ascending: false }).limit(250);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Ride[];
}

export async function getAdminPayments() {
  const { data, error } = await supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(250);
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getAdminComplaints() {
  const { data, error } = await supabase.from('complaints').select('*').order('created_at', { ascending: false }).limit(250);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Complaint[];
}
