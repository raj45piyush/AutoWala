import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, {
  Marker,
  Polyline,
  Region,
  UrlTile,
} from 'react-native-maps';

import type { Coordinates } from '../../services/locationService';
import { LOCATION_MAP_HEIGHT } from '../../services/mapConfig';
import type { LocationMapProps } from './LocationMap.types';

type RoutePosition = {
  latitude: number;
  longitude: number;
};

function isCoordinate(value: Coordinates | null | undefined): value is Coordinates {
  return Boolean(
    value &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude)
  );
}

function decodePolyline(encoded: string): RoutePosition[] {
  const points: RoutePosition[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return points;
}

function getInitialCoordinate(props: LocationMapProps): Coordinates | null {
  if (isCoordinate(props.pickup)) return props.pickup;
  if (isCoordinate(props.riderLocation)) return props.riderLocation;
  if (isCoordinate(props.passengerLocation)) return props.passengerLocation;
  if (isCoordinate(props.destination)) return props.destination;

  return null;
}

function MarkerLabel({
  label,
  type,
}: {
  label: string;
  type: 'pickup' | 'destination' | 'rider' | 'passenger';
}) {
  return (
    <View style={[styles.marker, styles[`marker_${type}`]]}>
      <Text style={styles.markerText}>{label}</Text>
    </View>
  );
}

export default function LocationMap({
  pickup,
  destination,
  riderLocation,
  passengerLocation,
  routePolyline,
}: LocationMapProps) {
  const initial = getInitialCoordinate({
    pickup,
    destination,
    riderLocation,
    passengerLocation,
    routePolyline,
  });

  const routeCoordinates = routePolyline
    ? decodePolyline(routePolyline)
    : [];

  const initialLatitude = initial?.latitude ?? 0;
  const initialLongitude = initial?.longitude ?? 0;
  const hasInitialCoordinate = initial !== null;
  const region = useMemo<Region>(() => ({
    latitude: initialLatitude,
    longitude: initialLongitude,
    latitudeDelta: hasInitialCoordinate ? 0.03 : 40,
    longitudeDelta: hasInitialCoordinate ? 0.03 : 40,
  }), [hasInitialCoordinate, initialLatitude, initialLongitude]);
  const mapRef = useRef<MapView>(null);
  const mapHasLayoutRef = useRef(false);
  const lastFitKeyRef = useRef<string | null>(null);
  const fitKey = [
    pickup?.latitude,
    pickup?.longitude,
    destination?.latitude,
    destination?.longitude,
    Boolean(isCoordinate(riderLocation)),
    Boolean(isCoordinate(passengerLocation)),
    routePolyline,
  ].join(':');

  const fitMapToCoordinates = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const coordinatesToFit = [
      pickup,
      destination,
      riderLocation,
      passengerLocation,
    ].filter(isCoordinate);
    const currentRouteCoordinates = routePolyline
      ? decodePolyline(routePolyline)
      : [];
    const fitCoordinates = currentRouteCoordinates.length > 1
      ? [...coordinatesToFit, ...currentRouteCoordinates]
      : coordinatesToFit;
    if (fitCoordinates.length === 0) return;

    const firstCoordinate = fitCoordinates[0];
    const hasDistinctCoordinates = fitCoordinates.some((coordinate) =>
      Math.abs(coordinate.latitude - firstCoordinate.latitude) > 0.000001
      || Math.abs(coordinate.longitude - firstCoordinate.longitude) > 0.000001
    );

    if (fitCoordinates.length > 1 && hasDistinctCoordinates) {
      map.fitToCoordinates(fitCoordinates, {
        edgePadding: { top: 32, right: 32, bottom: 32, left: 32 },
        animated: true,
      });
    } else {
      map.animateToRegion(region, 250);
    }
  }, [pickup, destination, riderLocation, passengerLocation, routePolyline, region]);

  const handleMapLayout = useCallback(() => {
    mapHasLayoutRef.current = true;
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;
    fitMapToCoordinates();
  }, [fitKey, fitMapToCoordinates]);

  useEffect(() => {
    if (!mapHasLayoutRef.current || lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;
    const timer = setTimeout(fitMapToCoordinates, 0);
    return () => clearTimeout(timer);
  }, [fitKey, fitMapToCoordinates]);

  if (!initial) {
    return (
      <View style={[styles.container, { height: LOCATION_MAP_HEIGHT }]}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            Choose your current location or a destination to show the map.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: LOCATION_MAP_HEIGHT }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton
        loadingEnabled
        moveOnMarkerPress={false}
        onLayout={handleMapLayout}
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
          zIndex={-1}
        />
        {routeCoordinates.length > 1 ? (
          <Polyline
            coordinates={routeCoordinates}
            strokeWidth={5}
            strokeColor="#2563EB"
          />
        ) : null}

        {isCoordinate(pickup) ? (
          <Marker
            coordinate={{
              latitude: pickup.latitude,
              longitude: pickup.longitude,
            }}
            title="Pickup"
          >
            <MarkerLabel label="P" type="pickup" />
          </Marker>
        ) : null}

        {isCoordinate(destination) ? (
          <Marker
            coordinate={{
              latitude: destination.latitude,
              longitude: destination.longitude,
            }}
            title="Destination"
          >
            <MarkerLabel label="D" type="destination" />
          </Marker>
        ) : null}

        {isCoordinate(riderLocation) ? (
          <Marker
            coordinate={{
              latitude: riderLocation.latitude,
              longitude: riderLocation.longitude,
            }}
            title="Rider"
          >
            <MarkerLabel label="R" type="rider" />
          </Marker>
        ) : null}

        {isCoordinate(passengerLocation) ? (
          <Marker
            coordinate={{
              latitude: passengerLocation.latitude,
              longitude: passengerLocation.longitude,
            }}
            title="Passenger"
          >
            <MarkerLabel label="P" type="passenger" />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 12,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#F3F4F6',
  },
  placeholderText: {
    textAlign: 'center',
    color: '#6B7280',
  },
  marker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  marker_pickup: {
    backgroundColor: '#16A34A',
  },
  marker_destination: {
    backgroundColor: '#DC2626',
  },
  marker_rider: {
    backgroundColor: '#2563EB',
  },
  marker_passenger: {
    backgroundColor: '#7C3AED',
  },
  markerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
