import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Coordinates } from '../../services/locationService';
import { LOCATION_MAP_HEIGHT } from '../../services/mapConfig';
import type { LocationMapProps } from './LocationMap.types';

type Point = Coordinates & { key: string };
type ScreenPoint = { x: number; y: number };

const MAX_ROUTE_POINTS = 120;
const MAP_PADDING = 28;

function isCoordinate(value: Coordinates | null | undefined): value is Coordinates {
  return Boolean(
    value &&
      Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
      Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180
  );
}

function readPolylineValue(encoded: string, startIndex: number): [number, number] | null {
  let index = startIndex;
  let result = 0;
  let shift = 0;
  let byte = 0;

  do {
    if (index >= encoded.length || shift > 30) return null;
    byte = encoded.charCodeAt(index++) - 63;
    if (byte < 0 || byte > 63) return null;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return [result & 1 ? ~(result >> 1) : result >> 1, index];
}

function decodePolyline(encoded: string | null | undefined): Coordinates[] {
  if (!encoded) return [];

  const points: Coordinates[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length && points.length < 2000) {
    const latitudeValue = readPolylineValue(encoded, index);
    if (!latitudeValue) return [];
    index = latitudeValue[1];

    const longitudeValue = readPolylineValue(encoded, index);
    if (!longitudeValue) return [];
    index = longitudeValue[1];

    latitude += latitudeValue[0];
    longitude += longitudeValue[0];
    const point = { latitude: latitude / 1e5, longitude: longitude / 1e5 };
    if (!isCoordinate(point)) return [];
    points.push(point);
  }

  return points;
}

function sampleRoute(points: Coordinates[]): Coordinates[] {
  if (points.length <= MAX_ROUTE_POINTS) return points;

  const step = (points.length - 1) / (MAX_ROUTE_POINTS - 1);
  return Array.from({ length: MAX_ROUTE_POINTS }, (_, index) => points[Math.round(index * step)]);
}

function LocationPin({ label, letter, color }: { label: string; letter: string; color: string }) {
  return (
    <View style={styles.pinContainer}>
      <View style={[styles.pin, { backgroundColor: color }]}>
        <Text style={styles.pinLetter}>{letter}</Text>
      </View>
      <View style={styles.pinLabel}>
        <Text style={styles.pinLabelText}>{label}</Text>
      </View>
    </View>
  );
}

function projectCoordinates(points: Coordinates[], width: number, height: number) {
  const safePoints = points.filter(isCoordinate);
  if (safePoints.length === 0 || width <= 0) return (_coordinate: Coordinates): ScreenPoint => ({ x: 0, y: 0 });

  const meanLatitude = safePoints.reduce((sum, point) => sum + point.latitude, 0) / safePoints.length;
  const longitudeScale = Math.max(Math.cos((meanLatitude * Math.PI) / 180), 0.01);
  const projected = safePoints.map((point) => ({
    x: point.longitude * longitudeScale,
    y: point.latitude,
  }));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const rangeX = maxX - minX || 0.001;
  const rangeY = maxY - minY || 0.001;
  const plotWidth = Math.max(width - MAP_PADDING * 2, 1);
  const plotHeight = Math.max(height - MAP_PADDING * 2, 1);

  return (coordinate: Coordinates): ScreenPoint => {
    const x = coordinate.longitude * longitudeScale;
    const y = coordinate.latitude;
    return {
      x: MAP_PADDING + ((x - minX) / rangeX) * plotWidth,
      y: MAP_PADDING + (1 - (y - minY) / rangeY) * plotHeight,
    };
  };
}

export default function LocationMap({
  pickup,
  destination,
  riderLocation,
  passengerLocation,
  routePolyline,
}: LocationMapProps) {
  const [width, setWidth] = useState(0);
  const routeCoordinates = decodePolyline(routePolyline);
  const routeToDraw = sampleRoute(routeCoordinates);
  const mapPoints: Point[] = [
    ...(isCoordinate(pickup) ? [{ ...pickup, key: 'pickup' }] : []),
    ...(isCoordinate(destination) ? [{ ...destination, key: 'destination' }] : []),
    ...(isCoordinate(riderLocation) ? [{ ...riderLocation, key: 'rider' }] : []),
    ...(isCoordinate(passengerLocation) ? [{ ...passengerLocation, key: 'passenger' }] : []),
    ...routeCoordinates.map((point, index) => ({ ...point, key: `route-${index}` })),
  ];
  const project = projectCoordinates(mapPoints, width, LOCATION_MAP_HEIGHT);
  const hasLocations = mapPoints.length > 0;

  const markers = [
    ...(isCoordinate(pickup) ? [{ coordinate: pickup, label: 'Pickup', letter: 'P', color: '#16803C', key: 'pickup' }] : []),
    ...(isCoordinate(destination) ? [{ coordinate: destination, label: 'Destination', letter: 'D', color: '#D13D3D', key: 'destination' }] : []),
    ...(isCoordinate(riderLocation) ? [{ coordinate: riderLocation, label: 'Rider', letter: 'R', color: '#2563EB', key: 'rider' }] : []),
    ...(isCoordinate(passengerLocation) ? [{ coordinate: passengerLocation, label: 'Passenger', letter: 'P', color: '#7C3AED', key: 'passenger' }] : []),
  ];

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (nextWidth !== width) setWidth(nextWidth);
      }}
    >
      <View pointerEvents="none" style={styles.parkOne} />
      <View pointerEvents="none" style={styles.parkTwo} />
      <View pointerEvents="none" style={[styles.street, styles.streetDiagonal]} />
      <View pointerEvents="none" style={[styles.street, styles.streetCross]} />
      <View pointerEvents="none" style={[styles.street, styles.streetVertical]} />

      {routeToDraw.length > 1 && width > 0 ? routeToDraw.slice(1).map((point, index) => {
        const start = project(routeToDraw[index]);
        const end = project(point);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (!Number.isFinite(length) || length < 1) return null;

        return (
          <View
            key={`route-segment-${index}`}
            pointerEvents="none"
            style={[
              styles.routeSegment,
              {
                left: (start.x + end.x - length) / 2,
                top: (start.y + end.y - 4) / 2,
                width: length,
                transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
              },
            ]}
          />
        );
      }) : null}

      {markers.map((marker) => {
        const position = project(marker.coordinate);
        return (
          <View
            key={marker.key}
            pointerEvents="none"
            style={[styles.markerPosition, { left: position.x - 36, top: position.y - 18 }]}
          >
            <LocationPin label={marker.label} letter={marker.letter} color={marker.color} />
          </View>
        );
      })}

      {!hasLocations ? (
        <View style={styles.emptyState} pointerEvents="none">
          <Text style={styles.emptyTitle}>Trip map</Text>
          <Text style={styles.emptyText}>Choose a pickup or destination to preview the trip.</Text>
        </View>
      ) : (
        <View style={styles.attribution} pointerEvents="none">
          <Text style={styles.attributionText}>
            {routeCoordinates.length > 1 ? 'OpenRouteService road route' : 'Location preview'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: LOCATION_MAP_HEIGHT,
    width: '100%',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#E8F0E6',
  },
  parkOne: {
    position: 'absolute',
    width: '38%',
    height: '28%',
    left: '-8%',
    top: '9%',
    borderRadius: 24,
    backgroundColor: '#D5E7D0',
    transform: [{ rotate: '-12deg' }],
  },
  parkTwo: {
    position: 'absolute',
    width: '32%',
    height: '34%',
    right: '-7%',
    bottom: '4%',
    borderRadius: 28,
    backgroundColor: '#D8E9D2',
    transform: [{ rotate: '14deg' }],
  },
  street: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderColor: '#DAE2D8',
    borderWidth: 1,
  },
  streetDiagonal: {
    width: '125%',
    height: 13,
    left: '-12%',
    top: '32%',
    transform: [{ rotate: '-13deg' }],
  },
  streetCross: {
    width: '130%',
    height: 10,
    left: '-14%',
    top: '70%',
    transform: [{ rotate: '11deg' }],
  },
  streetVertical: {
    width: '125%',
    height: 12,
    left: '39%',
    top: '35%',
    transform: [{ rotate: '76deg' }],
  },
  routeSegment: {
    position: 'absolute',
    height: 4,
    borderRadius: 3,
    backgroundColor: '#1769D2',
    zIndex: 2,
  },
  markerPosition: {
    position: 'absolute',
    zIndex: 3,
  },
  pinContainer: {
    width: 72,
    alignItems: 'center',
  },
  pin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 3,
  },
  pinLetter: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  pinLabel: {
    marginTop: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  pinLabelText: {
    color: '#243028',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyState: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#2B422E',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyText: {
    color: '#59675B',
    fontSize: 12,
    textAlign: 'center',
  },
  attribution: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    zIndex: 4,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  attributionText: {
    color: '#536254',
    fontSize: 9,
    fontWeight: '600',
  },
});
