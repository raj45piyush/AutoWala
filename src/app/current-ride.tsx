import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../components/AuthProvider';
import LocationMap from '../../components/maps/LocationMap';
import { getFriendlyAuthError } from '../../services/authService';
import { watchCurrentLocation } from '../../services/locationService';
import { getRoadRoute, type RoadRoute } from '../../services/routingService';
import {
  cancelRideRpc,
  clearPassengerBookingCode,
  completeRideRpc,
  getActiveRide,
  getLatestRideLocations,
  getPassengerBookingCode,
  regeneratePassengerBookingCode,
  getRideById,
  getRidePassengerInfo,
  getRideRiderInfo,
  getStatusDisplay,
  isActiveRideStatus,
  markPassengerPickedUpRpc,
  markRiderArrivedRpc,
  recordRideLocation,
  startRideRpc,
  updatePassengerLocation,
  updateRiderLocation,
} from '../../services/rideService';
import { subscribeToRideTracking } from '../../services/trackingService';
import type { Ride, RideLocation, RidePassengerInfo, RideRiderInfo } from '../../types/database';

function distanceMeters(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number }
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m away`;
  }
  return `${(meters / 1000).toFixed(1)} km away`;
}

export default function CurrentRideScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const [ride, setRide] = useState<Ride | null>(null);
  const [riderLocation, setRiderLocation] = useState<RideLocation | null>(null);
  const [passengerLocation, setPassengerLocation] = useState<RideLocation | null>(null);
  const [riderInfo, setRiderInfo] = useState<RideRiderInfo | null>(null);
  const [passengerInfo, setPassengerInfo] = useState<RidePassengerInfo | null>(null);
  const [isLoadingRide, setIsLoadingRide] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUpdatingRide, setIsUpdatingRide] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [pickupCode, setPickupCode] = useState('');
  const [passengerPickupCode, setPassengerPickupCode] = useState<string | null>(null);
  const [passengerPickupCodeRideId, setPassengerPickupCodeRideId] = useState<string | null>(null);
  const [passengerPickupCodeUnavailableRideId, setPassengerPickupCodeUnavailableRideId] = useState<string | null>(null);
  const [isRetryingPassengerPickupCode, setIsRetryingPassengerPickupCode] = useState(false);
  const [pickupRouteResult, setPickupRouteResult] = useState<{ key: string; route: RoadRoute } | null>(null);
  const [pickupRouteFailure, setPickupRouteFailure] = useState<{ key: string; message: string } | null>(null);
  const [tripMapRouteResult, setTripMapRouteResult] = useState<{ key: string; route: RoadRoute } | null>(null);
  const locationSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const isMountedRef = useRef(true);
  const riderLocationRef = useRef<RideLocation | null>(riderLocation);
  const passengerPickupCodeRequestRef = useRef(0);

  const isRider = account?.profile.role === 'rider';

  const clearPassengerPickupCodeState = useCallback(() => {
    passengerPickupCodeRequestRef.current += 1;
    setPassengerPickupCode(null);
    setPassengerPickupCodeRideId(null);
    setPassengerPickupCodeUnavailableRideId(null);
    setIsRetryingPassengerPickupCode(false);
  }, []);

  const fetchPassengerPickupCode = useCallback(async (rideId: string, requestId: number) => {
    try {
      let code = await getPassengerBookingCode(rideId);

      if (!code?.trim()) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        if (requestId !== passengerPickupCodeRequestRef.current) return;
        code = await getPassengerBookingCode(rideId);
      }

      if (!code?.trim()) {
        code = await regeneratePassengerBookingCode(rideId);
      }

      if (requestId !== passengerPickupCodeRequestRef.current) return;
      const normalizedCode = code?.trim() || null;
      setPassengerPickupCode(normalizedCode);
      setPassengerPickupCodeRideId(normalizedCode ? rideId : null);
      setPassengerPickupCodeUnavailableRideId(normalizedCode ? null : rideId);
    } catch (error) {
      console.error(
        'PASSENGER OTP ERROR:',
        error instanceof Error ? error.message : JSON.stringify(error)
      );
      if (requestId !== passengerPickupCodeRequestRef.current) return;
      setPassengerPickupCode(null);
      setPassengerPickupCodeRideId(null);
      setPassengerPickupCodeUnavailableRideId(rideId);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
    };
  }, []);

  useEffect(() => {
    riderLocationRef.current = riderLocation;
  }, [riderLocation]);

  useEffect(() => {
    if (isLoading) return;
    if (!account) {
      router.replace('/login');
    } else if (account.profile.role === 'admin') {
      router.replace('/admin');
    }
  }, [account, isLoading, router]);

  const loadRide = useCallback(async (rideId?: string) => {
    if (!account) return null;

    try {
      const nextRide = rideId
        ? await getRideById(rideId)
        : await getActiveRide(account.profile.role === 'rider' ? 'rider' : 'user');

      if (!isMountedRef.current) return nextRide;
      setPageError(null);
      if (!nextRide || nextRide.status !== 'arrived') {
        clearPassengerPickupCodeState();
      }
      if (nextRide && ['picked_up', 'in_progress', 'completed', 'cancelled'].includes(nextRide.status)) {
        void clearPassengerBookingCode(nextRide.id).catch(() => undefined);
      }
      setRide(nextRide);

      if (!nextRide) {
        setRiderInfo(null);
        setPassengerInfo(null);
        setRiderLocation(null);
        setPassengerLocation(null);
        return null;
      }

      const [riderResult, passengerResult, locationResult] = await Promise.allSettled([
        nextRide.rider_id ? getRideRiderInfo(nextRide.id) : Promise.resolve(null),
        account.profile.role === 'rider' ? getRidePassengerInfo(nextRide.id) : Promise.resolve(null),
        isActiveRideStatus(nextRide.status) ? getLatestRideLocations(nextRide.id) : Promise.resolve([]),
      ]);

      if (!isMountedRef.current) return nextRide;
      if (riderResult.status === 'fulfilled') setRiderInfo(riderResult.value);
      if (passengerResult.status === 'fulfilled') setPassengerInfo(passengerResult.value);
      if (locationResult.status === 'fulfilled') {
        const riderPoint = locationResult.value.find((location) => location.actor_id === nextRide.rider_id);
        const passengerPoint = locationResult.value.find((location) => location.actor_id === nextRide.passenger_id);
        setRiderLocation(riderPoint ?? null);
        setPassengerLocation(passengerPoint ?? null);
      }

      const failedDetails = [riderResult, passengerResult, locationResult]
        .find((result) => result.status === 'rejected');
      if (failedDetails?.status === 'rejected') {
        setTrackingError(getFriendlyAuthError(failedDetails.reason));
      } else {
        setTrackingError(null);
      }
      return nextRide;
    } catch (error) {
      if (isMountedRef.current) setPageError(getFriendlyAuthError(error));
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsLoadingRide(false);
        setIsRefreshing(false);
      }
    }
  }, [account, clearPassengerPickupCodeState]);

  useEffect(() => {
    if (!account || account.profile.role === 'admin') return;
    const timer = setTimeout(() => void loadRide(), 0);
    return () => clearTimeout(timer);
  }, [account, loadRide]);

  useEffect(() => {
    if (!ride?.id || isRider || ride.status !== 'arrived') {
      return;
    }

    const requestId = ++passengerPickupCodeRequestRef.current;
    void fetchPassengerPickupCode(ride.id, requestId);
    return () => {
      if (requestId === passengerPickupCodeRequestRef.current) {
        passengerPickupCodeRequestRef.current += 1;
      }
    };
  }, [fetchPassengerPickupCode, isRider, ride?.id, ride?.status]);

  const handleRetryPassengerPickupCode = async () => {
    if (!ride?.id || isRider || ride.status !== 'arrived') return;
    const requestId = ++passengerPickupCodeRequestRef.current;
    setPassengerPickupCode(null);
    setPassengerPickupCodeRideId(null);
    setPassengerPickupCodeUnavailableRideId(null);
    setIsRetryingPassengerPickupCode(true);
    await fetchPassengerPickupCode(ride.id, requestId);
    if (requestId === passengerPickupCodeRequestRef.current) {
      setIsRetryingPassengerPickupCode(false);
    }
  };

  useEffect(() => {
    if (!ride?.id || ride.status === 'completed' || ride.status === 'cancelled') {
      return;
    }

    return subscribeToRideTracking(
      ride.id,
      (nextRide) => {
        if (nextRide.status !== 'arrived') {
          clearPassengerPickupCodeState();
        }
        if (['picked_up', 'in_progress', 'completed', 'cancelled'].includes(nextRide.status)) {
          void clearPassengerBookingCode(nextRide.id).catch(() => undefined);
        }
        setRide(nextRide);
        if (!isActiveRideStatus(nextRide.status)) {
          setRiderLocation(null);
          setPassengerLocation(null);
        }
        if (nextRide.rider_id) {
          void getRideRiderInfo(nextRide.id)
            .then((info) => setRiderInfo(info))
            .catch((error: unknown) => setTrackingError(getFriendlyAuthError(error)));
        } else {
          setRiderInfo(null);
        }
      },
      (location) => {
        if (location.actor_id === ride.rider_id) {
          setRiderLocation(location);
        } else {
          setPassengerLocation(location);
        }
      },
      setRealtimeConnected
    );
  }, [clearPassengerPickupCodeState, ride]);

  // Keep a low-frequency REST fallback while Realtime reconnects or is unavailable.
  useEffect(() => {
    if (!ride?.id || ride.status === 'completed' || ride.status === 'cancelled'
      || realtimeConnected || isLoadingRide || isRefreshing) return;
    const fallback = setInterval(() => void loadRide(ride.id), 15000);
    return () => clearInterval(fallback);
  }, [isLoadingRide, isRefreshing, loadRide, realtimeConnected, ride?.id, ride?.status]);

  // Rider location tracking
  useEffect(() => {
    if (!isRider || !ride?.id || !isActiveRideStatus(ride.status)) {
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
      return;
    }

    let cancelled = false;
    let lastRecordedAt = 0;
    let lastCoordinates: { latitude: number; longitude: number } | null = null;
    let initialLocationSent = false;

    const sendLocation = async (coordinates: { latitude: number; longitude: number }, accuracy?: number | null) => {
      const [rideLocationResult, availabilityLocationResult] = await Promise.allSettled([
        recordRideLocation(ride.id, coordinates.latitude, coordinates.longitude, accuracy ?? null),
        updateRiderLocation(coordinates.latitude, coordinates.longitude),
      ]);

      if (cancelled) return;
      if (rideLocationResult.status === 'fulfilled') {
        console.log('[AutoWala rider] Live location update:', ride.id, coordinates.latitude, coordinates.longitude);
        setRiderLocation(rideLocationResult.value);
        setTrackingError(null);
      } else {
        console.error('[AutoWala rider] Failed to record ride location:', rideLocationResult.reason);
        setTrackingError(getFriendlyAuthError(rideLocationResult.reason));
      }
      if (availabilityLocationResult.status === 'rejected' && rideLocationResult.status === 'fulfilled') {
        setTrackingError('Ride tracking is active, but rider availability location could not be refreshed.');
      }
    };

    const subscriptionPromise = watchCurrentLocation(async (location) => {
      const coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      const now = Date.now();

      if (!initialLocationSent) {
        initialLocationSent = true;
        lastRecordedAt = now;
        lastCoordinates = coordinates;
        await sendLocation(coordinates, location.coords.accuracy);
        return;
      }

      const movedEnough = !lastCoordinates || distanceMeters(lastCoordinates, coordinates) >= 15;
      if (!movedEnough && now - lastRecordedAt < 8000) return;
      if (now - lastRecordedAt < 5000) return;

      lastRecordedAt = now;
      lastCoordinates = coordinates;
      await sendLocation(coordinates, location.coords.accuracy);
    }, (error) => {
      if (!cancelled) setTrackingError(error.message);
    });

    void subscriptionPromise.then((subscription) => {
      if (cancelled) {
        subscription.remove();
      } else {
        locationSubscriptionRef.current?.remove();
        locationSubscriptionRef.current = subscription;
      }
    }).catch((error: unknown) => {
      if (!cancelled) setTrackingError(getFriendlyAuthError(error));
    });

    return () => {
      cancelled = true;
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
    };
  }, [isRider, ride?.id, ride?.status]);

  // Passenger location tracking
  useEffect(() => {
    if (isRider || !ride?.id || !isActiveRideStatus(ride.status)) {
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
      return;
    }

    let cancelled = false;
    let lastRecordedAt = 0;
    let lastCoordinates: { latitude: number; longitude: number } | null = null;
    let initialLocationSent = false;

    const sendLocation = async (coordinates: { latitude: number; longitude: number }, accuracy?: number | null) => {
      const passengerLocationResult = await updatePassengerLocation(coordinates.latitude, coordinates.longitude);
      if (cancelled) return;
      setPassengerLocation(passengerLocationResult as RideLocation);
      setTrackingError(null);
    };

    const subscriptionPromise = watchCurrentLocation(async (location) => {
      const coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      const now = Date.now();

      if (!initialLocationSent) {
        initialLocationSent = true;
        lastRecordedAt = now;
        lastCoordinates = coordinates;
        await sendLocation(coordinates, location.coords.accuracy);
        return;
      }

      const movedEnough = !lastCoordinates || distanceMeters(lastCoordinates, coordinates) >= 15;
      if (!movedEnough && now - lastRecordedAt < 8000) return;
      if (now - lastRecordedAt < 5000) return;

      lastRecordedAt = now;
      lastCoordinates = coordinates;
      await sendLocation(coordinates, location.coords.accuracy);
    }, (error) => {
      if (!cancelled) setTrackingError(error.message);
    });

    void subscriptionPromise.then((subscription) => {
      if (cancelled) {
        subscription.remove();
      } else {
        locationSubscriptionRef.current?.remove();
        locationSubscriptionRef.current = subscription;
      }
    }).catch((error: unknown) => {
      if (!cancelled) setTrackingError(getFriendlyAuthError(error));
    });

    return () => {
      cancelled = true;
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
    };
  }, [isRider, ride?.id, ride?.status]);

  const riderRouteLatitudeBucket = riderLocation ? riderLocation.latitude.toFixed(3) : null;
  const riderRouteLongitudeBucket = riderLocation ? riderLocation.longitude.toFixed(3) : null;
  const pickupLatitude = ride?.pickup_latitude;
  const pickupLongitude = ride?.pickup_longitude;
  const tripMapPickupLatitude = ride?.pickup_latitude;
  const tripMapPickupLongitude = ride?.pickup_longitude;
  const tripMapDestinationLatitude = ride?.destination_latitude;
  const tripMapDestinationLongitude = ride?.destination_longitude;
  const pickupRouteKey = !isRider
    && ride?.status === 'accepted'
    && ride.pickup_latitude !== null
    && ride.pickup_longitude !== null
    && riderRouteLatitudeBucket !== null
    && riderRouteLongitudeBucket !== null
    ? `${ride.id}:${ride.pickup_latitude},${ride.pickup_longitude}:${riderRouteLatitudeBucket},${riderRouteLongitudeBucket}`
    : null;
  const pickupRoute = pickupRouteKey !== null && pickupRouteResult?.key === pickupRouteKey
    ? pickupRouteResult.route
    : null;
  const pickupRouteError = pickupRouteKey !== null && pickupRouteFailure?.key === pickupRouteKey
    ? pickupRouteFailure.message
    : '';
  const tripMapRouteKey = ride
    && ride.pickup_latitude !== null
    && ride.pickup_longitude !== null
    && ride.destination_latitude !== null
    && ride.destination_longitude !== null
    ? `${ride.id}:${ride.pickup_latitude},${ride.pickup_longitude}:${ride.destination_latitude},${ride.destination_longitude}`
    : null;
  const tripMapRoute = tripMapRouteKey !== null && tripMapRouteResult?.key === tripMapRouteKey
    ? tripMapRouteResult.route
    : null;

  useEffect(() => {
    let isCurrent = true;
    if (
      pickupRouteKey === null
      || pickupLatitude === null
      || pickupLatitude === undefined
      || pickupLongitude === null
      || pickupLongitude === undefined
    ) {
      return () => { isCurrent = false; };
    }

    const currentRiderLocation = riderLocationRef.current;
    if (!currentRiderLocation) return () => { isCurrent = false; };

    void getRoadRoute(
      currentRiderLocation.latitude,
      currentRiderLocation.longitude,
      pickupLatitude,
      pickupLongitude
    ).then((route) => {
      if (isCurrent) setPickupRouteResult({ key: pickupRouteKey, route });
    }).catch((error: unknown) => {
      if (isCurrent) setPickupRouteFailure({ key: pickupRouteKey, message: getFriendlyAuthError(error) });
    });

    return () => { isCurrent = false; };
  }, [pickupRouteKey, pickupLatitude, pickupLongitude]);

  useEffect(() => {
    let isCurrent = true;
    if (
      tripMapRouteKey === null
      || tripMapPickupLatitude === null
      || tripMapPickupLatitude === undefined
      || tripMapPickupLongitude === null
      || tripMapPickupLongitude === undefined
      || tripMapDestinationLatitude === null
      || tripMapDestinationLatitude === undefined
      || tripMapDestinationLongitude === null
      || tripMapDestinationLongitude === undefined
    ) return () => { isCurrent = false; };

    void getRoadRoute(
      tripMapPickupLatitude,
      tripMapPickupLongitude,
      tripMapDestinationLatitude,
      tripMapDestinationLongitude
    ).then((route) => {
      if (isCurrent) setTripMapRouteResult({ key: tripMapRouteKey, route });
    }).catch(() => {
      if (isCurrent) setTripMapRouteResult(null);
    });

    return () => { isCurrent = false; };
  }, [
    tripMapRouteKey,
    tripMapPickupLatitude,
    tripMapPickupLongitude,
    tripMapDestinationLatitude,
    tripMapDestinationLongitude,
  ]);

  // Direct distance remains useful for live proximity and tracking thresholds.
  const liveDistance = riderLocation && passengerLocation
    ? distanceMeters(
        { latitude: riderLocation.latitude, longitude: riderLocation.longitude },
        { latitude: passengerLocation.latitude, longitude: passengerLocation.longitude }
      )
    : null;
  const handleRefresh = () => {
    setIsRefreshing(true);
    void loadRide(ride?.id);
  };

  const handleCancel = async () => {
    if (!ride) return;
    setIsUpdatingRide(true);
    try {
      const cancelledRide = await cancelRideRpc(ride.id);
      if (cancelledRide) {
        clearPassengerPickupCodeState();
        void clearPassengerBookingCode(cancelledRide.id).catch(() => undefined);
        setRide(cancelledRide);
      }
      setRiderLocation(null);
      setPassengerLocation(null);
    } catch (error) {
      Alert.alert('Could Not Cancel', getFriendlyAuthError(error));
    } finally {
      setIsUpdatingRide(false);
    }
  };

  const handleRiderStatus = async () => {
    if (!ride) return;
    if (ride.status === 'arrived' && (!isRider || pickupCode.length !== 6)) return;
    setIsUpdatingRide(true);
    try {
      const nextRide = ride.status === 'accepted'
        ? await markRiderArrivedRpc(ride.id)
        : ride.status === 'arrived'
          ? await markPassengerPickedUpRpc(ride.id, pickupCode)
          : ride.status === 'picked_up'
            ? await startRideRpc(ride.id)
            : ride.status === 'in_progress'
              ? await completeRideRpc(ride.id)
              : null;
      if (nextRide) {
        if (nextRide.status !== 'arrived') {
          clearPassengerPickupCodeState();
        }
        if (['picked_up', 'in_progress', 'completed', 'cancelled'].includes(nextRide.status)) {
          void clearPassengerBookingCode(nextRide.id).catch(() => undefined);
        }
        setRide(nextRide);
        if (nextRide.status === 'picked_up') setPickupCode('');
        if (!isActiveRideStatus(nextRide.status)) {
          setRiderLocation(null);
          setPassengerLocation(null);
        }
      }
    } catch (error) {
      Alert.alert('Could Not Update Ride', getFriendlyAuthError(error));
    } finally {
      setIsUpdatingRide(false);
    }
  };

  if (isLoading || isLoadingRide) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading current ride...</Text>
      </SafeAreaView>
    );
  }

  const showMap = ride && (ride.pickup_latitude !== null || riderLocation || passengerLocation);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh} disabled={isRefreshing}>
            <Text style={styles.refreshText}>{isRefreshing ? 'Refreshing…' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>Current Ride</Text>

        {pageError ? <Text style={styles.errorText}>{pageError}</Text> : null}
        {!ride && pageError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Could not load your ride</Text>
            <Text style={styles.emptyText}>Your ride status could not be confirmed. Check your connection and retry.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRefresh} disabled={isRefreshing}>
              <Text style={styles.primaryButtonText}>{isRefreshing ? 'Checking…' : 'Retry'}</Text>
            </TouchableOpacity>
          </View>
        ) : !ride ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🛺</Text>
            <Text style={styles.emptyTitle}>No active ride</Text>
            <Text style={styles.emptyText}>Book a ride when you are ready to travel.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/book-ride')}>
              <Text style={styles.primaryButtonText}>Book Ride</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>Ride status</Text>
              <Text style={styles.statusValue}>{getStatusDisplay(ride.status, isRider).toUpperCase()}</Text>
              <Text style={styles.statusMessage}>
                {ride.status === 'requested' ? (isRider ? 'New ride request.' : 'Finding a nearby rider…') :
                  ride.status === 'accepted' ? (isRider ? 'Head to the pickup location.' : 'Your rider is on the way.') :
                    ride.status === 'arrived' ? (isRider ? 'Enter the passenger’s 6-digit pickup code to verify pickup and continue.' : 'Your rider has arrived. Share your pickup OTP so they can verify pickup.') :
                      ride.status === 'picked_up' ? (isRider ? 'Passenger picked up. Start the ride when ready.' : 'Pickup verified. Your rider will start the ride next.') :
                        ride.status === 'in_progress' ? (isRider ? 'Ride in progress to the destination.' : 'Ride in progress.') :
                          ride.status === 'completed' ? 'Ride completed.' : 'Ride cancelled.'}
              </Text>
              <Text style={styles.address}>Pickup: {ride.pickup_address}</Text>
              <Text style={styles.address}>Destination: {ride.destination_address}</Text>
              <Text style={styles.address}>Estimated distance: {ride.estimated_distance_km === null ? 'Not provided' : `${ride.estimated_distance_km.toFixed(1)} km`}</Text>
              <Text style={styles.address}>Fare: {ride.final_fare !== null ? `₹${ride.final_fare.toFixed(2)}` : ride.estimated_fare !== null ? `₹${ride.estimated_fare.toFixed(2)} estimated` : 'To be confirmed'}</Text>
              <Text style={styles.address}>Passengers: {ride.passenger_count}</Text>
              {isRider && passengerInfo ? (
                <Text style={styles.address}>Passenger: {passengerInfo.passenger_name}</Text>
              ) : null}
              {!isRider && ride.rider_id ? (
                <>
                  <Text style={styles.riderName}>{riderInfo?.rider_name ?? 'Assigned rider'}</Text>
                  <Text style={styles.address}>
                    {riderInfo
                      ? `${riderInfo.vehicle_type.toUpperCase()} · ${riderInfo.vehicle_number ?? 'Vehicle number unavailable'}`
                      : 'Loading rider and vehicle details…'}
                  </Text>
                  {riderInfo?.rider_rating !== null && riderInfo?.rider_rating !== undefined ? (
                    <Text style={styles.address}>★ {riderInfo.rider_rating.toFixed(1)} rider rating</Text>
                  ) : null}
                </>
              ) : null}
              {ride.status === 'arrived' && !isRider ? (
                <View style={styles.pickupCodeCard}>
                  <Text style={styles.pickupCodeTitle}>🔐 Pickup OTP</Text>
                  {passengerPickupCode && passengerPickupCodeRideId === ride.id ? (
                    <>
                      <Text style={styles.pickupCode}>{passengerPickupCode}</Text>
                      <Text style={styles.pickupCodeHelper}>Share this code only with your rider</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.pickupCodeUnavailable}>
                        {passengerPickupCodeUnavailableRideId === ride.id
                          ? 'We could not load your pickup OTP. Retry to fetch it again.'
                          : 'Loading your pickup OTP…'}
                      </Text>
                      <TouchableOpacity
                        style={[styles.pickupCodeRetry, isRetryingPassengerPickupCode && styles.disabledButton]}
                        onPress={() => void handleRetryPassengerPickupCode()}
                        disabled={isRetryingPassengerPickupCode}
                      >
                        <Text style={styles.pickupCodeRetryText}>
                          {isRetryingPassengerPickupCode ? 'Retrying…' : 'Retry OTP'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : null}
              {ride.status === 'arrived' && isRider ? (
                <View style={styles.pickupVerification}>
                  <Text style={styles.pickupPrompt}>Enter passenger pickup code</Text>
                  <TextInput
                    accessibilityLabel="Passenger pickup code"
                    style={styles.pickupInput}
                    value={pickupCode}
                    onChangeText={(value) => setPickupCode(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="6 digit code"
                    editable={!isUpdatingRide}
                  />
                  <TouchableOpacity
                    style={[styles.primaryButton, (isUpdatingRide || pickupCode.length !== 6) && styles.disabledButton]}
                    onPress={() => void handleRiderStatus()}
                    disabled={isUpdatingRide || pickupCode.length !== 6}
                  >
                    <Text style={styles.primaryButtonText}>{isUpdatingRide ? 'Verifying…' : 'Verify pickup code'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Live distance */}
              {liveDistance !== null && (
                <Text style={styles.distanceText}>
                  {isRider ? 'Passenger' : 'Rider'} is {formatDistance(liveDistance)}
                </Text>
              )}
              {!isRider && ride.status === 'accepted' && pickupRoute ? (
                <Text style={styles.distanceText}>
                  Rider is {formatDistance(pickupRoute.distanceKm * 1000)} by road · about {pickupRoute.durationMinutes} min away
                </Text>
              ) : null}
              {!isRider && ride.status === 'accepted' && riderLocation && !pickupRoute && !pickupRouteError ? (
                <Text style={styles.distanceText}>Calculating rider road distance and ETA…</Text>
              ) : null}
              {!isRider && ride.status === 'accepted' && pickupRouteError ? (
                <Text style={styles.trackingError}>Road ETA unavailable: {pickupRouteError}</Text>
              ) : null}

              <Text style={styles.connectionText}>
                {ride.status === 'completed' || ride.status === 'cancelled'
                  ? 'Ride updates ended'
                  : realtimeConnected ? 'Live updates connected' : 'Reconnecting · refresh checks for updates'}
              </Text>
            </View>

            {showMap && (
              <LocationMap
                pickup={ride.pickup_latitude !== null && ride.pickup_longitude !== null
                  ? { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude }
                  : null}
                destination={ride.destination_latitude !== null && ride.destination_longitude !== null
                  ? { latitude: ride.destination_latitude, longitude: ride.destination_longitude }
                  : null}
                riderLocation={isActiveRideStatus(ride.status) && riderLocation
                  ? { latitude: riderLocation.latitude, longitude: riderLocation.longitude }
                  : null}
                passengerLocation={isActiveRideStatus(ride.status) && passengerLocation
                  ? { latitude: passengerLocation.latitude, longitude: passengerLocation.longitude }
                  : null}
                routePolyline={tripMapRoute?.polyline ?? null}
              />
            )}

            <Text style={styles.mapCaption}>
              {isRider
                ? passengerLocation && isActiveRideStatus(ride.status)
                  ? `Passenger location updated ${new Date(passengerLocation.recorded_at).toLocaleTimeString()}`
                  : isActiveRideStatus(ride.status) ? 'Waiting for passenger location…' : 'Ride location sharing has stopped.'
                : riderLocation && isActiveRideStatus(ride.status)
                  ? `Rider location updated ${new Date(riderLocation.recorded_at).toLocaleTimeString()}`
                  : isActiveRideStatus(ride.status) ? 'Waiting for the rider\'s first live location.' : 'Ride location sharing has stopped.'}
            </Text>
            {trackingError ? <Text style={styles.trackingError}>{trackingError}</Text> : null}

            {isRider && ['accepted', 'picked_up', 'in_progress'].includes(ride.status) ? (
              <TouchableOpacity
                style={[styles.primaryButton, isUpdatingRide && styles.disabledButton]}
                onPress={() => void handleRiderStatus()}
                disabled={isUpdatingRide}
              >
                <Text style={styles.primaryButtonText}>
                  {isUpdatingRide
                    ? 'Updating…'
                    : ride.status === 'accepted'
                      ? 'Mark Rider Arrived'
                      : ride.status === 'picked_up'
                        ? 'Start Ride'
                        : 'Complete Ride'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {['requested', 'accepted', 'arrived'].includes(ride.status) ? (
              <TouchableOpacity
                style={[styles.cancelButton, isUpdatingRide && styles.disabledButton]}
                onPress={() => void handleCancel()}
                disabled={isUpdatingRide}
              >
                <Text style={styles.cancelText}>Cancel Ride</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#666', fontSize: 15 },
  container: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { padding: 20, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { alignSelf: 'flex-start', padding: 4 },
  backText: { color: '#2E7D32', fontSize: 16, fontWeight: '700' },
  refreshButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 },
  refreshText: { color: '#2E7D32', fontSize: 14, fontWeight: '700' },
  title: { color: '#1B1B1B', fontSize: 28, fontWeight: '800', marginTop: 15, marginBottom: 18 },
  emptyCard: { backgroundColor: '#FFF', borderRadius: 18, padding: 24, alignItems: 'center' },
  emptyIcon: { fontSize: 42 },
  emptyTitle: { color: '#222', fontSize: 20, fontWeight: '800', marginTop: 12 },
  emptyText: { color: '#777', fontSize: 14, textAlign: 'center', marginTop: 7 },
  statusCard: { backgroundColor: '#FFF', borderRadius: 18, padding: 18, marginBottom: 16 },
  statusLabel: { color: '#777', fontSize: 14 },
  statusValue: { color: '#2E7D32', fontSize: 23, fontWeight: '800', marginTop: 4 },
  statusMessage: { color: '#3B453C', fontSize: 15, lineHeight: 21, fontWeight: '600', marginTop: 8 },
  address: { color: '#555', fontSize: 15, marginTop: 10 },
  riderName: { color: '#222', fontSize: 18, fontWeight: '800', marginTop: 14 },
  pickupCodeCard: { backgroundColor: '#E8F5E9', borderRadius: 14, padding: 16, marginTop: 16, alignItems: 'center' },
  pickupCodeTitle: { color: '#245B28', fontSize: 16, fontWeight: '800' },
  pickupCode: { color: '#2E7D32', fontSize: 30, letterSpacing: 7, fontWeight: '900', marginTop: 8 },
  pickupCodeHelper: { color: '#3B453C', fontSize: 13, marginTop: 8, textAlign: 'center' },
  pickupCodeUnavailable: { color: '#4C5B4D', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  pickupCodeRetry: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 16, marginTop: 10, borderRadius: 10, backgroundColor: '#2E7D32' },
  pickupCodeRetryText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  pickupVerification: { marginTop: 16 },
  pickupPrompt: { color: '#333', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  pickupInput: { minHeight: 50, borderColor: '#DDE3DD', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 18, letterSpacing: 6, textAlign: 'center', marginBottom: 12 },
  distanceText: { color: '#2E7D32', fontSize: 16, fontWeight: '700', marginTop: 12 },
  arrivalText: { color: '#2E7D32', fontSize: 16, fontWeight: '800', marginTop: 12, backgroundColor: '#E8F5E9', padding: 8, borderRadius: 8 },
  connectionText: { color: '#557158', fontSize: 12, fontWeight: '600', marginTop: 14 },
  mapCaption: { color: '#667366', fontSize: 12, marginTop: 8, marginBottom: 4 },
  trackingError: { color: '#A25A00', backgroundColor: '#FFF4D6', borderRadius: 10, padding: 12, fontSize: 13, marginTop: 10 },
  errorText: { color: '#B3261E', backgroundColor: '#FDECEA', borderRadius: 12, padding: 14, marginBottom: 12 },
  primaryButton: { backgroundColor: '#2E7D32', borderRadius: 13, minHeight: 52, paddingHorizontal: 25, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
  cancelButton: { minHeight: 50, borderWidth: 1, borderColor: '#D8A6A3', borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  cancelText: { color: '#B3261E', fontSize: 15, fontWeight: '700' },
});
