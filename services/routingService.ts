import { supabase } from '../lib/supabase';

// This client calls AutoWala's authenticated routing proxy. ORS credentials and
// route calculations stay on the server; Expo receives only the public server URL.
export interface RoadRoute {
  distanceKm: number;
  durationMinutes: number;
  polyline: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function getRoutingApiUrl() {
  const value = process.env.EXPO_PUBLIC_ROUTING_API_URL?.trim();
  if (!value) {
    throw new Error('Road routing is not configured. Add EXPO_PUBLIC_ROUTING_API_URL to the mobile environment.');
  }
  return value.replace(/\/+$/, '');
}

const ROUTING_COMPUTE_PATH = '/api/routes/compute';

export async function getRoadRoute(
  pickupLatitude: number,
  pickupLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number
): Promise<RoadRoute> {
  if (
    !isValidCoordinate(pickupLatitude, pickupLongitude)
    || !isValidCoordinate(destinationLatitude, destinationLongitude)
  ) {
    throw new Error('Choose valid pickup and destination coordinates to calculate a road route.');
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('Please log in to calculate a road route.');
  }

  const endpoint = `${getRoutingApiUrl()}${ROUTING_COMPUTE_PATH}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude,
      }),
    });
  } catch (error) {
    console.error('[AutoWala routing] Fetch failed:', endpoint, error);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Road routing could not be reached: ${detail}`);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Road routing is temporarily unavailable. Please try again.';
    throw new Error(message);
  }

  if (
    !isRecord(payload)
    || typeof payload.distanceKm !== 'number'
    || !Number.isFinite(payload.distanceKm)
    || payload.distanceKm < 0
    || typeof payload.durationMinutes !== 'number'
    || !Number.isFinite(payload.durationMinutes)
    || payload.durationMinutes < 0
    || typeof payload.polyline !== 'string'
    || !payload.polyline
  ) {
    throw new Error('Road routing returned an invalid route. Please try again.');
  }

  return {
    distanceKm: payload.distanceKm,
    durationMinutes: payload.durationMinutes,
    polyline: payload.polyline,
  };
}
