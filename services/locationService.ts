import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { reverseGeocodePhoton } from './geocoding';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) return false;

  const coordinates = value as Partial<Coordinates>;
  return typeof coordinates.latitude === 'number' &&
    Number.isFinite(coordinates.latitude) &&
    coordinates.latitude >= -90 && coordinates.latitude <= 90 &&
    typeof coordinates.longitude === 'number' &&
    Number.isFinite(coordinates.longitude) &&
    coordinates.longitude >= -180 && coordinates.longitude <= 180;
}

export class LocationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationServiceError';
  }
}

function createBrowserLocation(position: GeolocationPosition): Location.LocationObject {
  return {
    timestamp: position.timestamp,
    coords: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      altitude: position.coords.altitude,
      accuracy: position.coords.accuracy,
      altitudeAccuracy: position.coords.altitudeAccuracy,
      heading: position.coords.heading,
      speed: position.coords.speed,
    },
  };
}

function getBrowserGeolocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new LocationServiceError('This browser does not support location. Try a recent browser or use the mobile app.');
  }
  return navigator.geolocation;
}

function describeBrowserLocationError(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Location permission was denied. Allow location access in your browser settings and try again.';
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return 'Your device could not determine its location. Check GPS or network location and try again.';
  }
  if (error.code === error.TIMEOUT) {
    return 'Finding your location took too long. Please try again.';
  }
  return 'Could not get your current location. Please try again.';
}

function getBrowserCurrentLocation() {
  const geolocation = getBrowserGeolocation();
  return new Promise<Location.LocationObject>((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => resolve(createBrowserLocation(position)),
      (error) => reject(new LocationServiceError(describeBrowserLocationError(error))),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 20000 }
    );
  });
}

async function ensureForegroundPermission() {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    throw new LocationServiceError('Location services are turned off. Please enable GPS and try again.');
  }

  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status === Location.PermissionStatus.GRANTED) {
    return;
  }

  const requestedPermission = await Location.requestForegroundPermissionsAsync();
  if (requestedPermission.status !== Location.PermissionStatus.GRANTED) {
    throw new LocationServiceError('Location permission is required to find nearby rides.');
  }
}

export async function getCurrentLocation() {
  if (Platform.OS === 'web') {
    return getBrowserCurrentLocation();
  }

  await ensureForegroundPermission();
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
}

export async function getCurrentCoordinates(): Promise<Coordinates> {
  const location = await getCurrentLocation();
  const coordinates = location?.coords;
  if (!isValidCoordinates(coordinates)) {
    throw new LocationServiceError('Unable to get a valid current location.');
  }

  return { latitude: coordinates.latitude, longitude: coordinates.longitude };
}

export async function getCurrentPickupLocation(): Promise<{ coordinates: Coordinates; address: string }> {
  const coordinates = await getCurrentCoordinates();
  const address = await reverseGeocodePhoton(coordinates);
  return { coordinates, address };
}

export async function watchCurrentLocation(
  onLocation: (location: Location.LocationObject) => void,
  onError?: (error: Error) => void
) {
  if (Platform.OS === 'web') {
    const geolocation = getBrowserGeolocation();
    const watchId = geolocation.watchPosition(
      (position) => onLocation(createBrowserLocation(position)),
      (error) => {
        const locationError = new LocationServiceError(describeBrowserLocationError(error));
        if (onError) {
          onError(locationError);
        } else if (process.env.NODE_ENV !== 'production') {
          console.error('[AutoWala location] Browser location watch failed', locationError.message);
        }
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 20000 }
    );
    return { remove: () => geolocation.clearWatch(watchId) };
  }

  await ensureForegroundPermission();
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 15,
      timeInterval: 7000,
    },
    onLocation,
    (reason) => {
      const locationError = new LocationServiceError(reason);
      if (onError) {
        onError(locationError);
      } else if (process.env.NODE_ENV !== 'production') {
        console.error('[AutoWala location] Native location watch failed', locationError.message);
      }
    }
  );
}
