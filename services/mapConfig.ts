export const OPENSTREETMAP_TILE_URL =
  process.env.EXPO_PUBLIC_OSM_TILE_URL?.trim() ||
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OPENSTREETMAP_TILE_ATTRIBUTION =
  process.env.EXPO_PUBLIC_OSM_TILE_ATTRIBUTION?.trim() ||
  '&copy; OpenStreetMap contributors';

export const LOCATION_MAP_HEIGHT = 280;
