import type { Coordinates } from './locationService';

export const PHOTON_BASE_URL =
  process.env.EXPO_PUBLIC_PHOTON_BASE_URL?.trim().replace(/\/+$/, '') ||
  'https://photon.komoot.io';

export interface LocationSuggestion {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
}

const PHOTON_REQUEST_TIMEOUT_MS = 12_000;

interface PhotonProperties {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  osm_type?: string;
  osm_id?: number | string;
}

interface PhotonFeature {
  type: 'Feature';
  geometry?: {
    type: 'Point';
    coordinates: [longitude: number, latitude: number];
  };
  properties?: PhotonProperties;
}

interface PhotonFeatureCollection {
  type: 'FeatureCollection';
  features?: PhotonFeature[];
}

function text(value: string | undefined) {
  return value?.trim() || '';
}

function getStreet(properties: PhotonProperties) {
  return [text(properties.housenumber), text(properties.street)].filter(Boolean).join(' ');
}

function uniqueParts(parts: string[]) {
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
}

function formatPhotonAddress(properties?: PhotonProperties) {
  if (!properties) return '';

  const street = getStreet(properties);
  return uniqueParts([
    text(properties.name),
    street,
    text(properties.district),
    text(properties.city),
    text(properties.county),
    text(properties.state),
    text(properties.postcode),
    text(properties.country),
  ]).join(', ');
}

function toLocationSuggestion(feature: PhotonFeature, index: number): LocationSuggestion | null {
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  if (
    typeof latitude !== 'number' || !Number.isFinite(latitude) ||
    typeof longitude !== 'number' || !Number.isFinite(longitude)
  ) return null;

  const properties = feature.properties ?? {};
  const street = getStreet(properties);
  const name = text(properties.name) || street || text(properties.city) || text(properties.county) || 'Location';
  const address = formatPhotonAddress(properties) || name;
  const osmId = properties.osm_type && properties.osm_id
    ? `${properties.osm_type}-${properties.osm_id}`
    : `${latitude.toFixed(6)}-${longitude.toFixed(6)}`;

  return {
    id: `${osmId}-${index}`,
    name,
    address,
    coordinates: { latitude, longitude },
  };
}

function createPhotonUrl(path: '/api/' | '/reverse', params: URLSearchParams) {
  return `${PHOTON_BASE_URL}${path}?${params.toString()}`;
}

async function fetchPhoton(url: string, signal?: AbortSignal): Promise<PhotonFeatureCollection> {
  let response: Response;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PHOTON_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
    if (signal?.aborted && error instanceof Error && error.name === 'AbortError') throw error;
    if (timedOut) throw new Error('Location request timed out. Check your connection and try again.');
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Location search is unavailable. Check your connection and try again.');
  }

  if (!response.ok) {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Photon] Location request failed (HTTP ${response.status}).`);
    }
    throw new Error('Location search is temporarily unavailable. Please try again.');
  }

  try {
    return await response.json() as PhotonFeatureCollection;
  } catch {
    if (timedOut) {
      throw new Error('Location request timed out. Check your connection and try again.');
    }
    throw new Error('Location search returned an unreadable response. Please try again.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function searchPhotonPlaces(
  query: string,
  bias?: Coordinates | null,
  signal?: AbortSignal
): Promise<LocationSuggestion[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 3) return [];

  const params = new URLSearchParams({
    q: trimmedQuery,
    limit: '5',
    lang: 'en',
    countrycode: 'in',
  });
  if (bias && Number.isFinite(bias.latitude) && Number.isFinite(bias.longitude)) {
    params.set('lat', String(bias.latitude));
    params.set('lon', String(bias.longitude));
    params.set('zoom', '14');
  }

  const result = await fetchPhoton(createPhotonUrl('/api/', params), signal);
  return (result.features ?? [])
    .slice(0, 5)
    .map(toLocationSuggestion)
    .filter((location): location is LocationSuggestion => location !== null);
}

export async function reverseGeocodePhoton(
  coordinates: Coordinates,
  signal?: AbortSignal
): Promise<string> {
  if (
    !Number.isFinite(coordinates.latitude) ||
    !Number.isFinite(coordinates.longitude) ||
    coordinates.latitude < -90 || coordinates.latitude > 90 ||
    coordinates.longitude < -180 || coordinates.longitude > 180
  ) {
    throw new Error('A valid location is required to find an address.');
  }

  const params = new URLSearchParams({
    lat: String(coordinates.latitude),
    lon: String(coordinates.longitude),
    lang: 'en',
    limit: '1',
  });
  const result = await fetchPhoton(createPhotonUrl('/reverse', params), signal);
  const feature = result.features?.[0];
  return formatPhotonAddress(feature?.properties);
}
