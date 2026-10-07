export type AppRole = 'user' | 'rider' | 'admin';

export type RiderApprovalStatus = 'pending' | 'approved' | 'rejected' | 'blocked';

export type VehicleType = 'auto' | 'toto';

export type VehiclePreference = VehicleType | 'any';

export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arrived'
  | 'picked_up'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type RideRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export type ComplaintCategory = 'ride' | 'payment' | 'rider' | 'other';

export type ComplaintStatus = 'open' | 'in_review' | 'resolved' | 'closed';

export type NotificationKind =
  | 'ride_request'
  | 'ride_accepted'
  | 'rider_arrived'
  | 'passenger_picked_up'
  | 'ride_in_progress'
  | 'ride_completed'
  | 'ride_cancelled'
  | 'payment_status'
  | 'rider_approval';

export interface Profile {
  id: string;
  full_name: string;
  age: number | null;
  phone: string | null;
  email: string | null;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface Rider {
  user_id: string;
  vehicle_type: VehicleType;
  vehicle_number: string | null;
  vehicle_details: string | null;
  licence_number: string | null;
  id_proof_type: string | null;
  approval_status: RiderApprovalStatus | null;
  is_online: boolean;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Ride {
  id: string;
  passenger_id: string;
  rider_id: string | null;
  pickup_address: string;
  destination_address: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  passenger_count: number;
  vehicle_preference: VehiclePreference;
  estimated_distance_km: number | null;
  estimated_fare: number | null;
  fare_config_snapshot?: Record<string, number> | null;
  final_fare: number | null;
  status: RideStatus;
  booking_code_expires_at: string | null;
  accepted_at: string | null;
  arrived_at: string | null;
  picked_up_at: string | null;
  in_progress_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RideRequest {
  id: string;
  ride_id: string;
  rider_id: string;
  status: RideRequestStatus;
  distance_km: number | null;
  sent_at: string;
  responded_at: string | null;
}

export interface RiderRideRequest {
  request: RideRequest;
  ride: Ride;
  passenger_name: string | null;
}

export interface RideLocation {
  id: string;
  ride_id: string;
  actor_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
}

export interface Rating {
  id: string;
  ride_id: string;
  rater_id: string;
  ratee_id: string;
  stars: number;
  review: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  ride_id: string;
  user_id: string;
  payment_status: PaymentStatus;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  transaction_reference: string | null;
  // Compatibility fields retained for the existing admin/payment UI.
  payer_id: string;
  amount: number;
  provider: string | null;
  provider_payment_id: string | null;
  status: PaymentStatus;
  created_at: string;
  updated_at: string;
}

export interface Complaint {
  id: string;
  ride_id: string | null;
  reporter_id: string;
  category: ComplaintCategory;
  description: string;
  status: ComplaintStatus;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NearbyRider {
  user_id: string;
  full_name: string;
  vehicle_type: VehicleType;
  vehicle_number: string | null;
  distance_km: number;
}

export interface RideRiderInfo {
  rider_id: string;
  rider_name: string;
  vehicle_type: VehicleType;
  vehicle_number: string | null;
  rider_rating: number | null;
}

export interface RidePassenger {
  id: string;
  ride_id: string;
  passenger_id: string;
  status: 'waiting' | 'picked_up' | 'completed' | 'cancelled';
  joined_at: string;
  picked_up_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface RiderEarning {
  id: string;
  ride_id: string;
  rider_id: string;
  gross_fare: number;
  platform_fee: number;
  tax_amount: number;
  rider_earning: number;
  payout_status: PayoutStatus;
  payout_reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiderEarningsSummary {
  todayEarnings: number;
  weekEarnings: number;
  completedRides: number;
  todayCompletedRides: number;
  pendingPayout: number;
}

export interface RidePassengerInfo {
  passenger_id: string;
  passenger_name: string;
  passenger_phone: string | null;
}

export interface RidePassengerWithDetails {
  passenger_id: string;
  passenger_name: string;
  passenger_phone: string | null;
  status: string;
  joined_at: string;
  picked_up_at: string | null;
}
