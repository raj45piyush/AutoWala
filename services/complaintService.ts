import { supabase } from '../lib/supabase';
import type { Complaint, ComplaintCategory } from '../types/database';

export async function submitComplaint(input: {
  rideId?: string | null;
  category: ComplaintCategory;
  description: string;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Please log in to contact support.');
  }

  const { data, error } = await supabase
    .from('complaints')
    .insert({ user_id: user.id, reporter_id: user.id, ride_id: input.rideId ?? null, category: input.category, description: input.description.trim() })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Complaint;
}

export async function getMyComplaints() {
  const { data, error } = await supabase.from('complaints').select('*').order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Complaint[];
}

export async function getAllComplaints() {
  const { data, error } = await supabase.from('complaints').select('*').order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Complaint[];
}

export async function updateComplaintStatus(
  complaintId: string,
  status: Complaint['status'],
  resolution?: string | null
) {
  const { data, error } = await supabase
    .from('complaints')
    .update({ status, resolution: resolution ?? null })
    .eq('id', complaintId)
    .select('*')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data as Complaint;
}
