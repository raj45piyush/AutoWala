import { supabase } from '../lib/supabase';
import { fetchRoadRoute, resolveRoutingApiUrl } from './routingClient.mjs';

// This client calls AutoWala's authenticated routing proxy. ORS credentials and
// route calculations stay on the server; Expo receives only the public server URL.
export interface RoadRoute {
  distanceKm: number;
  durationMinutes: number;
  polyline: string;
}

function isValidCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

const ROUTING_COMPUTE_PATH = '/api/routes/compute';

export async function getRoadRoute(
  pickupLatitude: number,
  pickupLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number,
  signal?: AbortSignal
): Promise<RoadRoute> {
  if (
    !isValidCoordinate(pickupLatitude, pickupLongitude)
    || !isValidCoordinate(destinationLatitude, destinationLongitude)
  ) {
    throw new Error('Choose valid pickup and destination coordinates to calculate a road route.');
  }

  const endpoint = `${resolveRoutingApiUrl(
    process.env.EXPO_PUBLIC_ROUTING_API_URL,
    process.env.NODE_ENV === 'production'
  )}${ROUTING_COMPUTE_PATH}`;

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('Please log in to calculate a road route.');
  }

  return fetchRoadRoute(endpoint, data.session.access_token, {
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
  }, globalThis.fetch, undefined, signal);
}
