export interface RoadRouteResponse {
  distanceKm: number;
  durationMinutes: number;
  polyline: string;
}

export interface RoadRouteCoordinates {
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
}

export function resolveRoutingApiUrl(value: string | undefined, isProduction?: boolean): string;

export function fetchRoadRoute(
  endpoint: string,
  accessToken: string,
  coordinates: RoadRouteCoordinates,
  fetchImplementation?: typeof fetch,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<RoadRouteResponse>;
