import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { isValidCoordinatePair } from './riderApproval.mjs';
import type {
  NearbyRider,
  Ride,
  RideLocation,
  RidePassenger,
  RidePassengerInfo,
  RidePassengerWithDetails,
  RideRequest,
  RideRiderInfo,
  RiderRideRequest,
  RideStatus,
  VehiclePreference,
} from '../types/database';

export interface CreateRideInput {
  pickupAddress: string;
  destinationAddress: string;
  passengerCount: number;
  vehiclePreference: VehiclePreference;
  pickupCoordinates: { latitude: number; longitude: number };
  destinationCoordinates: { latitude: number; longitude: number };
  estimatedFare?: number | null;
  estimatedDistanceKm?: number | null;
}

const RIDE_PUBLIC_COLUMNS = 'id,passenger_id,rider_id,pickup_address,destination_address,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,passenger_count,vehicle_preference,estimated_distance_km,estimated_fare,final_fare,status,booking_code_expires_at,accepted_at,arrived_at,picked_up_at,in_progress_at,completed_at,cancelled_at,created_at,updated_at';

function getFriendlyRideError(error: unknown) {
  const errorRecord = typeof error === 'object' && error !== null
    ? error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
    : null;
  const message = error instanceof Error
    ? error.message
    : typeof errorRecord?.message === 'string'
      ? errorRecord.message
      : '';
  const normalized = message.toLowerCase();
  if (__DEV__ && message) {
    console.error('[AutoWala ride backend error]', {
      message,
      code: errorRecord?.code,
      details: errorRecord?.details,
      hint: errorRecord?.hint,
    });
  }
  if (__DEV__ && message) return message;
  if (normalized.includes('invalid pickup code')) return 'Invalid pickup code. Check the code and try again.';
  if (normalized.includes('expired or locked') || normalized.includes('code expired')) return 'This pickup code has expired. Contact support for help.';
  if (normalized.includes('already accepted') || normalized.includes('already been accepted') || normalized.includes('already accepted by another rider')) return 'Ride already accepted by another rider.';
  if (normalized.includes('already have an active ride')) return 'You already have an active ride. Finish or cancel it before booking another.';
  if (normalized.includes('rider is not available for this request')) return 'Nearby riders are no longer available. Search again to refresh the rider list.';
  if (normalized.includes('ride is no longer requesting riders')) return 'This ride is no longer accepting requests. Check Current Ride for its latest status.';
  if (normalized.includes('authentication required')) return 'Your session expired. Please log in again.';
  if (normalized.includes('ride not found')) return 'Could not find this ride request. Refresh and try again.';
  if (normalized.includes('not approved') || normalized.includes('approved online rider')) return 'Your rider account must be approved and online to accept rides.';
  if (normalized.includes('invalid input value for enum') || normalized.includes('ride_status')) return 'Ride updates are temporarily unavailable. Please try again shortly.';
  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('timeout')) return 'Connection lost. Check your internet and try again.';
  return 'The ride could not be updated. Please try again.';
}

function isValidCoordinates(coordinates: { latitude: number; longitude: number }) {
  return Number.isFinite(coordinates.latitude)
    && Number.isFinite(coordinates.longitude)
    && coordinates.latitude >= -90
    && coordinates.latitude <= 90
    && coordinates.longitude >= -180
    && coordinates.longitude <= 180;
}

function getRideFromRpc(data: unknown): Ride {
  const payload = Array.isArray(data) ? data[0] : data;
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('The ride update could not be confirmed. Please refresh and try again.');
  }
  const ride = 'ride' in payload ? payload.ride : payload;
  if (typeof ride !== 'object' || ride === null || !('id' in ride) || !('status' in ride)) {
    throw new Error('The ride update could not be confirmed. Please refresh and try again.');
  }
  return ride as Ride;
}

async function requireUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  if (!user) {
    throw new Error('Please log in to continue.');
  }

  return user.id;
}

export async function createRide(input: CreateRideInput) {
  const pickupAddress = input.pickupAddress.trim() || 'Current location (GPS)';
  if (!input.destinationAddress.trim()) {
    throw new Error('Choose a destination.');
  }
  if (!isValidCoordinates(input.pickupCoordinates) || !isValidCoordinates(input.destinationCoordinates)) {
    throw new Error('Choose a valid pickup and destination from the location results.');
  }
  if (!Number.isInteger(input.passengerCount) || input.passengerCount < 1 || input.passengerCount > 8) {
    throw new Error('Passenger count must be between 1 and 8.');
  }
  if (!['auto', 'toto', 'any'].includes(input.vehiclePreference)) {
    throw new Error('Choose Auto, Toto, or Any as the vehicle preference.');
  }

  const { data, error } = await supabase.rpc('create_ride_with_code', {
    p_pickup_address: pickupAddress,
    p_destination_address: input.destinationAddress.trim(),
    p_passenger_count: input.passengerCount,
    p_vehicle_preference: input.vehiclePreference,
    p_pickup_latitude: input.pickupCoordinates.latitude,
    p_pickup_longitude: input.pickupCoordinates.longitude,
    p_destination_latitude: input.destinationCoordinates.latitude,
    p_destination_longitude: input.destinationCoordinates.longitude,
    p_estimated_fare: input.estimatedFare ?? null,
    p_estimated_distance_km: input.estimatedDistanceKm ?? null,
  });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }
  const result = data as { ride: Ride; booking_code: string };
  const ride = { ...result.ride, booking_code: result.booking_code } as Ride & { booking_code: string };
  try {
    await savePassengerBookingCode(ride.id, result.booking_code);
  } catch {
    let cancellationFailed = false;
    try {
      const { error: cancelError } = await supabase.rpc('cancel_ride_rpc', { p_ride_id: ride.id });
      cancellationFailed = cancelError !== null;
    } catch {
      // Keep the storage failure message; cancellation remains best effort.
      cancellationFailed = true;
    }
    throw new Error(cancellationFailed
      ? 'The pickup code could not be saved securely, and cancellation could not be confirmed. Check Current Ride before requesting again.'
      : 'The pickup code could not be saved securely. The ride request was cancelled; please try again.');
  }
  return ride;
}

const bookingCodeStorageKey = (rideId: string) => {
  const safeRideId = rideId.trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return `autowala.ride.${safeRideId}.pickup-code`;
};

async function savePassengerBookingCode(rideId: string, code: string) {
  const key = bookingCodeStorageKey(rideId);
  return Platform.OS === 'web'
    ? AsyncStorage.setItem(key, code)
    : SecureStore.setItemAsync(key, code);
}

export async function getPassengerBookingCode(rideId: string) {
  const key = bookingCodeStorageKey(rideId);
  return (Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)).catch(() => null);
}

export async function clearPassengerBookingCode(rideId: string) {
  const key = bookingCodeStorageKey(rideId);
  return (Platform.OS === 'web' ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key));
}

function getOtpErrorFields(error: unknown) {
  if (typeof error !== 'object' || error === null) return { message: String(error) };
  const value = error as Record<string, unknown>;
  return {
    message: value.message ?? null,
    code: value.code ?? null,
    details: value.details ?? null,
    hint: value.hint ?? null,
  };
}

function getOtpResponseShape(data: unknown) {
  const firstRow = Array.isArray(data) ? data[0] : data;
  const bookingCode = typeof firstRow === 'string'
    ? firstRow
    : typeof firstRow === 'object' && firstRow !== null && 'booking_code' in firstRow
      ? firstRow.booking_code
      : null;

  return {
    type: data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data,
    rowCount: Array.isArray(data) ? data.length : null,
    keys: typeof firstRow === 'object' && firstRow !== null ? Object.keys(firstRow) : [],
    bookingCodeType: typeof bookingCode,
    bookingCodeIsSixDigits: typeof bookingCode === 'string' && /^\d{6}$/.test(bookingCode),
  };
}

export async function regeneratePassengerBookingCode(rideId: string) {
  try {
    const [{ data: authData, error: authError }, { data: rideData, error: rideError }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('rides').select('id, passenger_id, status').eq('id', rideId).maybeSingle(),
    ]);
    const userId = authData.user?.id ?? null;
    console.info('[AutoWala OTP] RPC request context', {
      rpc: 'regenerate_pickup_code',
      parameter: 'p_ride_id',
      rideId,
      authenticatedUserId: userId,
      authError: authError ? getOtpErrorFields(authError) : null,
      ride: rideData ? {
        id: rideData.id,
        passengerId: rideData.passenger_id,
        status: rideData.status,
        currentUserIsPassenger: rideData.passenger_id === userId,
      } : null,
      rideReadError: rideError ? getOtpErrorFields(rideError) : null,
    });
  } catch (diagnosticError) {
    console.warn('[AutoWala OTP] Could not collect RPC request context', getOtpErrorFields(diagnosticError));
  }

  const { data, error } = await supabase.rpc('regenerate_pickup_code', {
    p_ride_id: rideId,
  });

  console.info('[AutoWala OTP] RPC response shape', {
    rpc: 'regenerate_pickup_code',
    rideId,
    ...getOtpResponseShape(data),
  });

  if (error) {
    console.error('[AutoWala OTP] Supabase RPC error', {
      rpc: 'regenerate_pickup_code',
      parameter: 'p_ride_id',
      rideId,
      ...getOtpErrorFields(error),
    });
    throw new Error(error.message || 'Pickup OTP regeneration failed.');
  }

  const payload: unknown = Array.isArray(data) ? data[0] : data;
  const bookingCode = typeof payload === 'string'
    ? payload
    : typeof payload === 'object' && payload !== null && 'booking_code' in payload
      ? payload.booking_code
      : null;

  if (typeof bookingCode !== 'string' || !/^\d{6}$/.test(bookingCode)) {
    throw new Error('The pickup OTP could not be generated. Please try again.');
  }

  await savePassengerBookingCode(rideId, bookingCode);
  return bookingCode;
}

export async function findNearbyRiders(
  latitude: number,
  longitude: number,
  vehiclePreference: VehiclePreference = 'any',
  radiusKm = 10
) {
  if (!isValidCoordinates({ latitude, longitude })) {
    throw new Error('A valid pickup location is required to search nearby riders.');
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 50) {
    throw new Error('Choose a search radius between 1 and 50 km.');
  }

  const { data, error } = await supabase.rpc('find_nearby_riders', {
    p_latitude: latitude,
    p_longitude: longitude,
    p_radius_km: radiusKm,
    p_vehicle_preference: vehiclePreference,
  });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return ((data ?? []) as Array<{
    rider_id: string;
    full_name: string;
    vehicle_type: string;
    vehicle_number: string | null;
    distance_km: number;
  }>).map((rider) => ({
    user_id: rider.rider_id,
    full_name: rider.full_name,
    vehicle_type: rider.vehicle_type as NearbyRider['vehicle_type'],
    vehicle_number: rider.vehicle_number,
    distance_km: rider.distance_km,
  }));
}

export async function sendRideRequest(
  rideId: string,
  riderId: string,
  distanceKm: number | null = null,
  radiusKm = 10
) {
  const { data, error } = await supabase.rpc('send_ride_request', {
    p_ride_id: rideId,
    p_rider_id: riderId,
    p_distance_km: distanceKm,
    p_radius_km: radiusKm,
  });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  const request = data as RideRequest | null;
  if (
    !request?.id ||
    request.ride_id !== rideId ||
    request.rider_id !== riderId ||
    request.status !== 'pending'
  ) {
    throw new Error('The rider request could not be confirmed. Please refresh and try again.');
  }

  return request;
}

export async function requestNearbyRiders(
  rideId: string,
  latitude: number,
  longitude: number,
  radiusKm = 10
) {
  const riders = await findNearbyRiders(latitude, longitude, 'any', radiusKm);
  const results = await Promise.allSettled(
    riders.map((rider) => sendRideRequest(rideId, rider.user_id, rider.distance_km, radiusKm))
  );
  const requests = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

  if (riders.length > 0 && requests.length === 0) {
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    throw new Error('No rider request could be sent.');
  }

  return { riders, requests };
}

export async function acceptRideRpc(rideId: string) {
  const { data, error } = await supabase.rpc('accept_ride', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }
  return getRideFromRpc(data);
}

export async function rejectRide(rideId: string) {
  const { data, error } = await supabase.rpc('reject_ride', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return data as RideRequest;
}

export async function cancelRide(rideId: string) {
  return cancelRideRpc(rideId);
}

export async function getRideHistory(role: 'user' | 'rider') {
  const userId = await requireUserId();
  const column = role === 'rider' ? 'rider_id' : 'passenger_id';
  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_PUBLIC_COLUMNS)
    .eq(column, userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return (data ?? []) as Ride[];
}

export async function getActiveRide(role: 'user' | 'rider') {
  const userId = await requireUserId();
  const column = role === 'rider' ? 'rider_id' : 'passenger_id';
  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_PUBLIC_COLUMNS)
    .eq(column, userId)
    .in('status', ['requested', 'accepted', 'arrived', 'picked_up', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  if (data) return data as Ride;
  const { data: latestRide, error: latestError } = await supabase
    .from('rides')
    .select(RIDE_PUBLIC_COLUMNS)
    .eq(column, userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(getFriendlyRideError(latestError));
  return (latestRide as Ride | null) ?? null;
}

export async function getRideById(rideId: string) {
  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_PUBLIC_COLUMNS)
    .eq('id', rideId)
    .maybeSingle();

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return (data as Ride | null) ?? null;
}

export async function getRiderRideRequests() {
  const riderId = await requireUserId();
  const { data, error } = await supabase
    .from('ride_requests')
    .select('*')
    .eq('rider_id', riderId)
    .eq('status', 'pending')
    .order('sent_at', { ascending: false });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return (data ?? []) as RideRequest[];
}

export async function getRideRequestsForRide(rideId: string) {
  const { data, error } = await supabase
    .from('ride_requests')
    .select('rider_id, status')
    .eq('ride_id', rideId);

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return (data ?? []) as Array<Pick<RideRequest, 'rider_id' | 'status'>>;
}

export async function getRiderRideRequestsWithRides(): Promise<RiderRideRequest[]> {
  const requests = await getRiderRideRequests();
  if (requests.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_PUBLIC_COLUMNS)
    .in('id', requests.map((request) => request.ride_id))
    .eq('status', 'requested')
    .is('rider_id', null);

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  const rides = (data ?? []) as Ride[];
  const availableRequests = requests.filter((request) =>
    rides.some((ride) => ride.id === request.ride_id && ride.status === 'requested' && ride.rider_id === null)
  );
  const enriched = await Promise.all(availableRequests.map(async (request) => {
    const ride = rides.find((candidate) => candidate.id === request.ride_id);
    if (!ride) return null;
    const passenger = await getRidePassengerInfo(ride.id).catch(() => null);
    return { request, ride, passenger_name: passenger?.passenger_name ?? null };
  }));
  return enriched.filter((entry): entry is RiderRideRequest => entry !== null);
}

export async function setRiderOnline(isOnline: boolean) {
  const { data, error } = await supabase.rpc('set_rider_online', {
    p_is_online: isOnline,
  });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return data as import('../types/database').Rider;
}

export async function updateRiderLocation(latitude: number, longitude: number) {
  if (!isValidCoordinatePair(latitude, longitude)) {
    throw new Error('A valid GPS coordinate pair is required to share rider location.');
  }

  const { data, error } = await supabase.rpc('update_rider_location', {
    p_latitude: latitude,
    p_longitude: longitude,
  });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return data as import('../types/database').Rider;
}

export async function updatePassengerLocation(latitude: number, longitude: number) {
  const { data, error } = await supabase.rpc('update_passenger_location', {
    p_latitude: latitude,
    p_longitude: longitude,
  });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return data as RideLocation;
}

export async function recordRideLocation(
  rideId: string,
  latitude: number,
  longitude: number,
  accuracy?: number | null
) {
  const { data, error } = await supabase.rpc('record_ride_location', {
    p_ride_id: rideId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy: accuracy ?? null,
  });

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return data as RideLocation;
}

export async function getLatestRideLocations(rideId: string) {
  const { data, error } = await supabase
    .from('ride_locations')
    .select('*')
    .eq('ride_id', rideId)
    .order('recorded_at', { ascending: false })
    .limit(2);

  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return (data ?? []) as RideLocation[];
}

export async function getRideRiderInfo(rideId: string) {
  const { data, error } = await supabase.rpc('get_ride_rider_info', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return ((data ?? [])[0] as RideRiderInfo | undefined) ?? null;
}

export async function getRidePassengerInfo(rideId: string) {
  const { data, error } = await supabase.rpc('get_ride_passenger_info', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return ((data ?? [])[0] as RidePassengerInfo | undefined) ?? null;
}

export async function getRidePassengers(rideId: string) {
  const { data, error } = await supabase.rpc('get_ride_passengers', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }

  return (data ?? []) as RidePassengerWithDetails[];
}

export async function markRiderArrivedRpc(rideId: string) {
  const { data, error } = await supabase.rpc('mark_rider_arrived', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }
  return getRideFromRpc(data);
}

export async function markPassengerPickedUpRpc(rideId: string, pickupCode: string) {
  return verifyPickupCodeRpc(rideId, pickupCode);
}

export async function verifyPickupCodeRpc(rideId: string, pickupCode: string) {
  const { data, error } = await supabase.rpc('verify_pickup_code', {
    p_ride_id: rideId,
    p_code: pickupCode,
  });
  if (error) throw new Error(getFriendlyRideError(error));
  const result = data as { error?: string; ride?: Ride };
  if (result.error) throw new Error(getFriendlyRideError(new Error(result.error)));
  if (!result.ride) throw new Error('Pickup verification failed. Please try again.');
  return result.ride;
}

export async function startRideRpc(rideId: string) {
  const { data, error } = await supabase.rpc('start_ride_rpc', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }
  return getRideFromRpc(data);
}

export async function completeRideRpc(rideId: string) {
  const { data, error } = await supabase.rpc('complete_ride_rpc', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }
  return getRideFromRpc(data);
}

export async function cancelRideRpc(rideId: string) {
  const { data, error } = await supabase.rpc('cancel_ride_rpc', { p_ride_id: rideId });
  if (error) {
    throw new Error(getFriendlyRideError(error));
  }
  return getRideFromRpc(data);
}

export function isActiveRideStatus(status: RideStatus) {
  return ['accepted', 'arrived', 'picked_up', 'in_progress'].includes(status);
}

export function isLocationTrackingStatus(status: RideStatus) {
  return ['accepted', 'arrived', 'picked_up', 'in_progress'].includes(status);
}

export function getStatusDisplay(status: RideStatus, isRider: boolean): string {
  switch (status) {
    case 'requested':
      return isRider ? 'New Request' : 'Finding Rider';
    case 'accepted':
      return isRider ? 'Going to Pickup' : 'Rider Assigned';
    case 'arrived':
      return isRider ? 'Waiting for Passenger' : 'Rider Arrived';
    case 'picked_up':
      return isRider ? 'Passenger Picked Up' : 'Pickup Verified';
    case 'in_progress':
      return isRider ? 'Ride In Progress' : 'On the Way';
    case 'completed':
      return isRider ? 'Completed' : 'Ride Completed';
    case 'cancelled':
      return isRider ? 'Cancelled' : 'Ride Cancelled';
    default:
      return status;
  }
}
