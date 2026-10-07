import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
import {
  calculateFareBreakdown,
  DEFAULT_FARE_CONFIG,
  getFareConfig,
  type FareConfig,
  type FareBreakdown,
} from '../../services/fareService';
import { reverseGeocodePhoton, searchPhotonPlaces, type LocationSuggestion } from '../../services/geocoding';
import { getCurrentCoordinates, type Coordinates } from '../../services/locationService';
import { getRoadRoute, type RoadRoute } from '../../services/routingService';
import {
  cancelRide,
  createRide,
  findNearbyRiders,
  getActiveRide,
  sendRideRequest,
} from '../../services/rideService';
import type { NearbyRider, Ride, VehiclePreference } from '../../types/database';

const vehicleOptions: VehiclePreference[] = ['auto', 'toto', 'any'];
const radiusOptions = [2, 5, 10, 20, 50];

function formatDistance(distanceKm: number) {
  return distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`;
}

function formatMoney(value: number) {
  return `₹${value.toFixed(2)}`;
}

function FareQuoteRows({ breakdown, config }: { breakdown: FareBreakdown; config: FareConfig }) {
  return (
    <View style={styles.fareBreakdown}>
      <FareLine label="Distance" value={`${breakdown.distanceKm.toFixed(1)} km`} />
      <FareLine label="Rate" value={`${formatMoney(config.perKmRate)} / km`} />
      <FareLine label="Distance fare" value={formatMoney(breakdown.distanceFare)} />
      <FareLine label="Base fare" value={formatMoney(breakdown.baseFare)} />
      <FareLine label="Platform fee" value={formatMoney(breakdown.platformFee)} />
      <FareLine label="Tax" value={formatMoney(breakdown.tax)} />
      <FareLine label="Minimum fare" value={formatMoney(breakdown.minimumFare)} />
      <View style={styles.fareTotalLine}>
        <Text style={styles.fareTotalLabel}>Estimated total</Text>
        <Text style={styles.fareTotalValue}>{formatMoney(breakdown.totalFare)}</Text>
      </View>
    </View>
  );
}

function FareLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fareLine}>
      <Text style={styles.fareLineLabel}>{label}</Text>
      <Text style={styles.fareLineValue}>{value}</Text>
    </View>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function BookRideScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const isMountedRef = useRef(true);
  const [pickup, setPickup] = useState('');
  const [pickupCoordinates, setPickupCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [destination, setDestination] = useState('');
  const [selectedDestination, setSelectedDestination] = useState<LocationSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [placesError, setPlacesError] = useState('');
  const [showNoSuggestions, setShowNoSuggestions] = useState(false);
  const [passengers, setPassengers] = useState('1');
  const [vehiclePreference, setVehiclePreference] = useState<VehiclePreference>('any');
  const [radiusKm, setRadiusKm] = useState(10);
  const [isLocating, setIsLocating] = useState(false);
  const [isResolvingPickupAddress, setIsResolvingPickupAddress] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isRequestingFor, setIsRequestingFor] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [nearbyRiders, setNearbyRiders] = useState<NearbyRider[]>([]);
  const [searchError, setSearchError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [requestedRideId, setRequestedRideId] = useState<string | null>(null);
  const [fareConfig, setFareConfig] = useState<FareConfig>(DEFAULT_FARE_CONFIG);
  const [fareConfigLoaded, setFareConfigLoaded] = useState(false);
  const [fareConfigError, setFareConfigError] = useState('');
  const [roadRouteResult, setRoadRouteResult] = useState<{ key: string; route: RoadRoute } | null>(null);
  const [routeFailure, setRouteFailure] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!account) {
      router.replace('/login');
    } else if (account.profile.role === 'admin') {
      router.replace('/admin');
    } else if (account.profile.role === 'rider') {
      router.replace('/rider-home');
    }
  }, [account, isLoading, router]);

  useEffect(() => {
    let current = true;
    void getFareConfig().then((config) => {
      if (current) {
        setFareConfig(config);
        setFareConfigError('');
      }
    }).catch((error) => {
      if (current) {
        setFareConfigError(getErrorMessage(error, 'Fare settings could not be loaded.'));
      }
    }).finally(() => {
      if (current) setFareConfigLoaded(true);
    });
    return () => { current = false; };
  }, []);

  const selectedRouteKey = pickupCoordinates && selectedDestination
    ? `${pickupCoordinates.latitude},${pickupCoordinates.longitude}:${selectedDestination.coordinates.latitude},${selectedDestination.coordinates.longitude}`
    : null;
  const currentRoadRoute = selectedRouteKey !== null && roadRouteResult?.key === selectedRouteKey
    ? roadRouteResult.route
    : null;
  const routeError = selectedRouteKey !== null && routeFailure?.key === selectedRouteKey ? routeFailure.message : '';
  const isRouting = selectedRouteKey !== null && currentRoadRoute === null && !routeError;

  useEffect(() => {
    let isCurrent = true;
    if (!pickupCoordinates || !selectedDestination || !selectedRouteKey) return () => { isCurrent = false; };

    void getRoadRoute(
      pickupCoordinates.latitude,
      pickupCoordinates.longitude,
      selectedDestination.coordinates.latitude,
      selectedDestination.coordinates.longitude
    ).then((route) => {
      if (isCurrent) {
        setRoadRouteResult({ key: selectedRouteKey, route });
      }
    }).catch((error: unknown) => {
      if (isCurrent) {
        setRouteFailure({
          key: selectedRouteKey,
          message: getErrorMessage(error, 'Could not calculate the road route. Please try again.'),
        });
      }
    });

    return () => { isCurrent = false; };
  }, [pickupCoordinates, selectedDestination, selectedRouteKey]);

  const estimatedDistanceKm = currentRoadRoute?.distanceKm ?? null;
  const fareBreakdown: FareBreakdown | null = useMemo(() =>
    estimatedDistanceKm === null ? null : calculateFareBreakdown(estimatedDistanceKm, fareConfig),
  [estimatedDistanceKm, fareConfig]);
  const estimatedFare = fareBreakdown?.totalFare ?? null;

  useEffect(() => {
    const query = destination.trim();
    if (selectedDestination || query.length < 3) {
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;
    const timeout = setTimeout(async () => {
      setIsSuggesting(true);
      setShowNoSuggestions(false);
      setPlacesError('');
      try {
        const results = await searchPhotonPlaces(query, pickupCoordinates, controller.signal);
        if (!isCurrent) return;
        setSuggestions(results);
        setShowNoSuggestions(results.length === 0);
      } catch (error) {
        if (!isCurrent || controller.signal.aborted) return;
        setSuggestions([]);
        setPlacesError(getErrorMessage(error, 'Location search failed. Please try again.'));
      } finally {
        if (isCurrent) setIsSuggesting(false);
      }
    }, 600);

    return () => {
      isCurrent = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [destination, selectedDestination, pickupCoordinates]);

  const clearSearchResults = () => {
    setHasSearched(false);
    setNearbyRiders([]);
    setSearchError('');
    setRequestMessage('');
  };

  const handlePickupTextChange = (text: string) => {
    setPickup(text);
    setPickupCoordinates(null);
    setLocationError('Choose “Use my current location” again to attach GPS coordinates to this pickup.');
    clearSearchResults();
  };

  const handleDestinationTextChange = (text: string) => {
    setDestination(text);
    setSelectedDestination(null);
    setSuggestions([]);
    setIsSuggesting(false);
    setPlacesError('');
    setShowNoSuggestions(false);
    clearSearchResults();
  };

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    setLocationError('');
    setRequestMessage('');
    try {
      const coordinates: Coordinates = await getCurrentCoordinates();
      if (!isMountedRef.current) return;

      setPickupCoordinates(coordinates);
      setPickup('Current Location');
      clearSearchResults();
      setIsLocating(false);
      setIsResolvingPickupAddress(true);

      let address = '';
      try {
        address = await reverseGeocodePhoton(coordinates);
      } catch {
        // A valid GPS coordinate is still usable when address lookup is unavailable.
      }
      if (!isMountedRef.current) return;

      if (address.trim()) {
        setPickup(address.trim());
        setLocationError('');
      } else {
        setPickup('Current Location');
        setLocationError('Pickup address unavailable. Using Current Location.');
      }
    } catch {
      if (isMountedRef.current) {
        setLocationError('Unable to get your current location. Please enable location permission and try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLocating(false);
        setIsResolvingPickupAddress(false);
      }
    }
  };

  const handleSelectDestination = (suggestion: LocationSuggestion) => {
    setSelectedDestination(suggestion);
    setDestination(suggestion.address);
    setSuggestions([]);
    setIsSuggesting(false);
    setPlacesError('');
    clearSearchResults();
  };

  const handleSearchNearbyRiders = async () => {
    const passengerCount = Number(passengers);
    if (
      !pickupCoordinates ||
      !Number.isFinite(pickupCoordinates.latitude) ||
      pickupCoordinates.latitude < -90 || pickupCoordinates.latitude > 90 ||
      !Number.isFinite(pickupCoordinates.longitude) ||
      pickupCoordinates.longitude < -180 || pickupCoordinates.longitude > 180
    ) {
      setSearchError('Use your current location so we can search nearby riders.');
      return;
    }
    if (!selectedDestination || !destination.trim()) {
      setSearchError('Search for a destination and select one of the location suggestions.');
      return;
    }
    if (!fareConfigLoaded || fareConfigError || estimatedFare === null || isRouting || routeError) {
      setSearchError(fareConfigError || routeError || 'Wait for a road route and fare quote before requesting a ride.');
      return;
    }
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 8) {
      setSearchError('Enter a passenger count between 1 and 8.');
      return;
    }
    if (!vehicleOptions.includes(vehiclePreference)) {
      setSearchError('Choose Auto, Toto, or Any as the vehicle preference.');
      return;
    }

    setIsSearching(true);
    setHasSearched(false);
    setNearbyRiders([]);
    setSearchError('');
    setRequestMessage('');
    try {
      const riders = await findNearbyRiders(
        pickupCoordinates.latitude,
        pickupCoordinates.longitude,
        vehiclePreference,
        radiusKm
      );
      setNearbyRiders(riders);
      setHasSearched(true);
    } catch (error) {
      setSearchError(getErrorMessage(error, 'Nearby rider search failed. Please try again.'));
    } finally {
      setIsSearching(false);
    }
  };

  const handleRequestRide = async () => {
    if (!pickupCoordinates || !selectedDestination) {
      setSearchError('Please choose a pickup and destination again before requesting a ride.');
      return;
    }
    if (!fareConfigLoaded || fareConfigError || estimatedFare === null || isRouting || routeError || nearbyRiders.length === 0) {
      setSearchError(fareConfigError || routeError || 'Confirm a road route and valid fare and search for an available rider before booking.');
      return;
    }
    const passengerCount = Number(passengers);
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 8) {
      setSearchError('Enter a passenger count between 1 and 8.');
      return;
    }

    setIsRequestingFor('dispatch');
    setSearchError('');
    setRequestMessage('');
    let ride: Ride | null = null;
    let newlyCreatedRideId: string | null = null;
    let requestStage = 'checking_active_ride';
    try {
      const activeRide = await getActiveRide('user');
      if (activeRide && ['requested', 'accepted', 'arrived', 'picked_up', 'in_progress'].includes(activeRide.status)) {
        setRequestedRideId(activeRide.id);
        setRequestMessage('You already have an active ride. Complete or cancel your current ride before booking another ride.');
        return;
      }

      requestStage = 'creating_ride';
      ride = await createRide({
        pickupAddress: pickup,
        destinationAddress: selectedDestination.address,
        pickupCoordinates,
        destinationCoordinates: selectedDestination.coordinates,
        passengerCount,
        vehiclePreference,
        estimatedFare,
        estimatedDistanceKm,
      });
      newlyCreatedRideId = ride.id;
      if (__DEV__) {
        console.info('[AutoWala ride request]', {
          stage: 'ride_created',
          rideId: ride.id,
          passengerId: ride.passenger_id,
          status: ride.status,
        });
      }

      requestStage = 'sending_request';
      const dispatchTargets = nearbyRiders;
      if (dispatchTargets.length === 0) {
        setRequestedRideId(ride.id);
        setRequestMessage('Your ride request is already with nearby riders. Check its status in Current Ride.');
        return;
      }
      const dispatchResults = await Promise.allSettled(dispatchTargets.map((candidate) =>
        sendRideRequest(ride!.id, candidate.user_id, candidate.distance_km, radiusKm)
      ));
      const sentCount = dispatchResults.filter((result) => result.status === 'fulfilled').length;
      if (sentCount === 0) {
        const failed = dispatchResults.find((result) => result.status === 'rejected');
        throw failed?.status === 'rejected' ? failed.reason : new Error('No rider request could be sent.');
      }
      const request = dispatchResults.find((result) => result.status === 'fulfilled');
      if (__DEV__) {
        console.info('[AutoWala ride request]', {
          stage: 'request_created',
          rideId: ride.id,
          passengerId: ride.passenger_id,
          riderId: request?.status === 'fulfilled' ? request.value.rider_id : dispatchTargets[0]?.user_id,
          status: request?.status === 'fulfilled' ? request.value.status : 'pending',
          ridersNotified: sentCount,
        });
      }
      setRequestedRideId(ride.id);
      setRequestMessage(`Searching for nearby riders. Your request was sent to ${sentCount} rider${sentCount === 1 ? '' : 's'}.`);
    } catch (error) {
      if (__DEV__) {
        console.warn('[AutoWala ride request]', {
          stage: `${requestStage}_failed`,
          rideId: ride?.id ?? newlyCreatedRideId,
          passengerId: ride?.passenger_id ?? account?.user.id ?? null,
          riderId: nearbyRiders[0]?.user_id ?? null,
          status: ride?.status ?? 'not_created',
        });
      }
      if (newlyCreatedRideId) await cancelRide(newlyCreatedRideId).catch(() => undefined);
      const message = getErrorMessage(error, 'Could not send the ride request. Please search again.');
      if (message.toLowerCase().includes('already have an active ride')) {
        const activeRide = await getActiveRide('user').catch(() => null);
        setRequestedRideId(activeRide?.id ?? 'active-ride');
        setRequestMessage('You already have an active ride. Complete or cancel your current ride before booking another ride.');
      } else {
        setSearchError(message);
      }
    } finally {
      setIsRequestingFor(null);
    }
  };

  if (isLoading || !account || account.profile.role !== 'user') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>

            <Text style={styles.title}>Book an Auto/Toto</Text>
            <Text style={styles.subtitle}>Choose your pickup and destination to find a nearby rider.</Text>

            <View style={styles.formCard}>
              <Text style={styles.label}>Pickup location</Text>
              <TextInput
                style={styles.input}
                placeholder="Use your current location"
                placeholderTextColor="#999"
                value={pickup}
                onChangeText={handlePickupTextChange}
                editable={!isLocating}
                accessibilityLabel="Pickup address"
              />
              <TouchableOpacity
                style={styles.locationButton}
                onPress={() => void handleUseCurrentLocation()}
                disabled={isLocating || isResolvingPickupAddress}
                accessibilityRole="button"
              >
                {isLocating || isResolvingPickupAddress
                  ? <ActivityIndicator size="small" color="#2E7D32" />
                  : <Text style={styles.locationIcon}>📍</Text>}
                <Text style={styles.locationButtonText}>
                  {isLocating
                    ? 'Finding your location…'
                    : isResolvingPickupAddress
                      ? 'Resolving pickup address…'
                      : 'Use my current location'}
                </Text>
              </TouchableOpacity>
              {pickupCoordinates ? <Text style={styles.selectedHint}>✓ GPS pickup selected</Text> : null}
              {locationError ? <Text accessibilityRole="alert" style={styles.errorText}>{locationError}</Text> : null}

              <Text style={styles.label}>Where do you want to go?</Text>
              <TextInput
                style={styles.input}
                placeholder="Search a village, town, landmark…"
                placeholderTextColor="#999"
                value={destination}
                onChangeText={handleDestinationTextChange}
                autoCapitalize="words"
                autoCorrect={false}
                accessibilityLabel="Destination search"
              />
              {selectedDestination ? <Text style={styles.selectedHint}>✓ Destination selected</Text> : null}

              {isSuggesting ? (
                <View style={styles.suggestionStatus}>
                  <ActivityIndicator size="small" color="#2E7D32" />
                  <Text style={styles.statusText}>Searching nearby places…</Text>
                </View>
              ) : null}
              {placesError ? <Text accessibilityRole="alert" style={styles.errorText}>{placesError}</Text> : null}
              {showNoSuggestions && !placesError ? <Text style={styles.emptyHint}>Location not found. Try a nearby town or landmark name.</Text> : null}
              {suggestions.length > 0 ? (
                <View style={styles.suggestionsCard}>
                  {suggestions.map((suggestion) => (
                    <TouchableOpacity
                      key={suggestion.id}
                      style={styles.suggestionRow}
                      onPress={() => handleSelectDestination(suggestion)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.suggestionPin}>⌖</Text>
                      <View style={styles.suggestionCopy}>
                        <Text style={styles.suggestionMain} numberOfLines={1}>{suggestion.name}</Text>
                        <Text style={styles.suggestionSecondary} numberOfLines={2}>{suggestion.address}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  <Text style={styles.photonAttribution}>Search powered by Photon</Text>
                </View>
              ) : null}

              <View style={styles.mapSection}>
                <Text style={styles.label}>Your trip map</Text>
                <LocationMap
                  pickup={pickupCoordinates}
                  destination={selectedDestination?.coordinates ?? null}
                  routePolyline={currentRoadRoute?.polyline ?? null}
                />
                <Text style={styles.mapHint}>
                  {isRouting ? 'Calculating road route…' : currentRoadRoute ? `Road route · about ${currentRoadRoute.durationMinutes} min` : 'Green is pickup · orange is destination'}
                </Text>
              </View>

              <Text style={styles.label}>Number of passengers</Text>
              <TextInput
                style={styles.input}
                placeholder="1"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                value={passengers}
                onChangeText={(value) => {
                  setPassengers(value.replace(/\D/g, '').slice(0, 1));
                  clearSearchResults();
                }}
                maxLength={1}
              />
              <Text style={styles.helperText}>Choose from 1 to 8 passengers.</Text>

              <Text style={styles.label}>Vehicle preference</Text>
              <View style={styles.optionsRow}>
                {vehicleOptions.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.option, vehiclePreference === option && styles.selectedOption]}
                    onPress={() => {
                      setVehiclePreference(option);
                      clearSearchResults();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: vehiclePreference === option }}
                  >
                    <Text style={[styles.optionText, vehiclePreference === option && styles.selectedOptionText]}>
                      {option === 'any' ? 'Any' : option[0].toUpperCase() + option.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Search within</Text>
              <View style={styles.optionsRow}>
                {radiusOptions.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.radiusOption, radiusKm === option && styles.selectedOption]}
                    onPress={() => {
                      setRadiusKm(option);
                      clearSearchResults();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: radiusKm === option }}
                  >
                    <Text style={[styles.radiusText, radiusKm === option && styles.selectedOptionText]}>{option} km</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Road trip distance</Text>
              <Text style={styles.readOnlyValue}>
                {isRouting ? 'Calculating road distance…' : estimatedDistanceKm === null ? 'Choose pickup and destination' : `${estimatedDistanceKm.toFixed(1)} km · about ${currentRoadRoute?.durationMinutes ?? 0} min`}
              </Text>
              {routeError ? <Text accessibilityRole="alert" style={styles.errorText}>{routeError}</Text> : null}
              <Text style={styles.fareNote}>Fare uses road distance. Travel time can change with traffic.</Text>
              <View style={styles.fareCard}>
                <Text style={styles.fareLabel}>Ride fare</Text>
                {!fareConfigLoaded ? <Text style={styles.fareNote}>Loading current fare settings…</Text> : null}
                {fareConfigLoaded && fareBreakdown ? <FareQuoteRows breakdown={fareBreakdown} config={fareConfig} /> : null}
                {fareConfigLoaded && !fareBreakdown ? <Text style={styles.fareNote}>{isRouting ? 'Calculating route before quoting the fare…' : routeError ? 'A road route is required to quote the fare.' : 'Choose a pickup and destination to see your estimate.'}</Text> : null}
                {fareConfigError ? <Text accessibilityRole="alert" style={styles.errorText}>{fareConfigError}</Text> : null}
              </View>

              {searchError ? <Text accessibilityRole="alert" style={styles.errorBanner}>{searchError}</Text> : null}
              <TouchableOpacity
                style={[styles.primaryButton, (isSearching || isLocating || isRequestingFor !== null || !fareConfigLoaded || estimatedFare === null || !!fareConfigError) && styles.disabledButton]}
                onPress={() => void handleSearchNearbyRiders()}
                disabled={isSearching || isLocating || isRequestingFor !== null || !fareConfigLoaded || estimatedFare === null || !!fareConfigError}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                {isSearching ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryButtonText}>Search Nearby Riders</Text>}
              </TouchableOpacity>
            </View>

            {hasSearched ? (
              <View style={styles.resultsSection}>
                <View style={styles.resultsHeader}>
                  <View style={styles.resultsHeadingCopy}>
                    <Text style={styles.resultsTitle}>Nearby Riders</Text>
                    <Text style={styles.resultsSubtitle}>{vehiclePreference === 'any' ? 'Auto and Toto' : vehiclePreference.toUpperCase()} · within {radiusKm} km · requests go to nearby riders</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.searchAgainButton}
                    onPress={() => void handleSearchNearbyRiders()}
                    disabled={isSearching || requestedRideId !== null}
                  >
                    <Text style={styles.searchAgainText}>{isSearching ? 'Searching…' : 'Search Again'}</Text>
                  </TouchableOpacity>
                </View>

                {nearbyRiders.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyIcon}>🛺</Text>
                    <Text style={styles.emptyTitle}>No nearby riders found.</Text>
                    <Text style={styles.emptyCopy}>Try a larger search radius or another vehicle preference.</Text>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => void handleSearchNearbyRiders()} disabled={isSearching}>
                      <Text style={styles.secondaryButtonText}>Search Again</Text>
                    </TouchableOpacity>
                  </View>
                ) : nearbyRiders.map((rider) => (
                  <View style={styles.riderCard} key={rider.user_id}>
                    <View style={styles.riderTopRow}>
                      <View style={styles.vehicleIconWrap}><Text style={styles.vehicleIcon}>🛺</Text></View>
                      <View style={styles.riderIdentity}>
                        <Text style={styles.riderName}>{rider.full_name || 'AutoWala Rider'}</Text>
                        <Text style={styles.vehicleType}>{rider.vehicle_type.toUpperCase()}</Text>
                      </View>
                      <View style={styles.distanceBadge}>
                        <Text style={styles.distanceValue}>{formatDistance(rider.distance_km)}</Text>
                        <Text style={styles.distanceLabel}>away</Text>
                      </View>
                    </View>
                    <View style={styles.vehicleDetails}>
                      <Text style={styles.vehicleNumberLabel}>Vehicle number</Text>
                      <Text style={styles.vehicleNumber}>{rider.vehicle_number || 'Not provided'}</Text>
                    </View>
                  </View>
                ))}

                {nearbyRiders.length > 0 && requestedRideId === null ? (
                  <View style={styles.confirmFareCard}>
                    <Text style={styles.confirmFareTitle}>Confirm your fare</Text>
                    <Text style={styles.confirmFareCopy}>The first nearby rider to accept will be assigned to your booking.</Text>
                    {fareBreakdown ? <FareQuoteRows breakdown={fareBreakdown} config={fareConfig} /> : null}
                    <TouchableOpacity
                      style={[styles.primaryButton, isRequestingFor !== null && styles.disabledButton]}
                      onPress={() => void handleRequestRide()}
                      disabled={isRequestingFor !== null || !fareBreakdown}
                      accessibilityRole="button"
                    >
                      {isRequestingFor !== null
                        ? <ActivityIndicator color="#FFF" />
                        : <Text style={styles.primaryButtonText}>Confirm & Request Ride</Text>}
                    </TouchableOpacity>
                  </View>
                ) : null}

                {requestMessage ? (
                  <View style={styles.successBanner}>
                    <Text style={styles.successText}>{requestMessage}</Text>
                    <TouchableOpacity onPress={() => router.push('/current-ride')} style={styles.currentRideButton}>
                      <Text style={styles.currentRideButtonText}>View Current Ride</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#666', fontSize: 15 },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48 },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 4 },
  backText: { color: '#2E7D32', fontSize: 16, fontWeight: '700' },
  title: { color: '#1B1B1B', fontSize: 27, fontWeight: '800', marginTop: 12 },
  subtitle: { color: '#777', fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 20 },
  formCard: { backgroundColor: '#FFF', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#EEF0EF' },
  label: { color: '#333', fontSize: 15, fontWeight: '700', marginBottom: 7, marginTop: 15 },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#DDE3DD', borderRadius: 12, paddingHorizontal: 15, color: '#222', fontSize: 15, backgroundColor: '#FFF' },
  readOnlyValue: { minHeight: 48, borderWidth: 1, borderColor: '#DDE3DD', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 14, color: '#222', fontSize: 14, backgroundColor: '#F6F8F6' },
  locationButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 10 },
  locationIcon: { fontSize: 17 },
  locationButtonText: { color: '#2E7D32', fontSize: 14, fontWeight: '700' },
  selectedHint: { color: '#28783B', fontSize: 12, fontWeight: '600', marginTop: 3 },
  helperText: { color: '#777', fontSize: 12, marginTop: 5 },
  errorText: { color: '#B3261E', fontSize: 13, lineHeight: 18, marginTop: 6 },
  suggestionStatus: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12 },
  statusText: { color: '#666', fontSize: 13 },
  emptyHint: { color: '#777', fontSize: 13, paddingVertical: 10 },
  suggestionsCard: { marginTop: 8, borderWidth: 1, borderColor: '#E1E5E1', borderRadius: 12, overflow: 'hidden', backgroundColor: '#FFF' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E8EBE8', gap: 11 },
  suggestionPin: { color: '#737A73', fontSize: 21, width: 22, textAlign: 'center' },
  suggestionCopy: { flex: 1 },
  suggestionMain: { color: '#242824', fontWeight: '700', fontSize: 14 },
  suggestionSecondary: { color: '#707770', fontSize: 12, lineHeight: 17, marginTop: 2 },
  photonAttribution: { textAlign: 'right', color: '#647064', fontSize: 11, paddingHorizontal: 11, paddingVertical: 7 },
  mapSection: { marginTop: 8 },
  mapHint: { color: '#707770', fontSize: 12, marginTop: 7 },
  optionsRow: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, borderWidth: 1, borderColor: '#D5D5D5', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  radiusOption: { flex: 1, borderWidth: 1, borderColor: '#D5D5D5', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  selectedOption: { backgroundColor: '#E8F5E9', borderColor: '#2E7D32' },
  optionText: { color: '#555', fontWeight: '700', fontSize: 14 },
  radiusText: { color: '#555', fontWeight: '700', fontSize: 12 },
  selectedOptionText: { color: '#2E7D32' },
  fareCard: { backgroundColor: '#F1F8F2', borderRadius: 14, padding: 15, marginTop: 20 },
  fareLabel: { color: '#557158', fontSize: 14 },
  fareValue: { color: '#2E7D32', fontSize: 22, fontWeight: '800', marginTop: 4 },
  fareNote: { color: '#777', fontSize: 12, marginTop: 4 },
  fareBreakdown: { marginTop: 12 },
  fareLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  fareLineLabel: { color: '#667066', fontSize: 13 },
  fareLineValue: { color: '#333B33', fontSize: 13, fontWeight: '600' },
  fareTotalLine: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D5E4D7', paddingTop: 10, marginTop: 5 },
  fareTotalLabel: { color: '#263B29', fontSize: 15, fontWeight: '800' },
  fareTotalValue: { color: '#2E7D32', fontSize: 17, fontWeight: '900' },
  errorBanner: { color: '#9F1D17', backgroundColor: '#FFF0EE', borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19, marginTop: 16 },
  primaryButton: { minHeight: 55, borderRadius: 14, backgroundColor: '#2E7D32', alignItems: 'center', justifyContent: 'center', marginTop: 22, paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  disabledButton: { opacity: 0.65 },
  resultsSection: { marginTop: 24 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 },
  resultsHeadingCopy: { flex: 1 },
  resultsTitle: { color: '#202520', fontSize: 22, fontWeight: '800' },
  resultsSubtitle: { color: '#737A73', fontSize: 13, marginTop: 3 },
  searchAgainButton: { borderWidth: 1, borderColor: '#2E7D32', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 10 },
  searchAgainText: { color: '#2E7D32', fontSize: 13, fontWeight: '700' },
  emptyCard: { alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#E8ECE8', padding: 24 },
  emptyIcon: { fontSize: 33 },
  emptyTitle: { color: '#303630', fontSize: 17, fontWeight: '800', marginTop: 10 },
  emptyCopy: { color: '#707770', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 5 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#E8F5E9', marginTop: 15 },
  secondaryButtonText: { color: '#2E7D32', fontWeight: '700' },
  riderCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E8ECE8', marginBottom: 12, shadowColor: '#1C3320', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  riderTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  vehicleIconWrap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F7F0', borderRadius: 14 },
  vehicleIcon: { fontSize: 25 },
  riderIdentity: { flex: 1 },
  riderName: { color: '#252A25', fontSize: 16, fontWeight: '800' },
  vehicleType: { color: '#2E7D32', fontSize: 12, fontWeight: '800', marginTop: 3, letterSpacing: 0.5 },
  distanceBadge: { alignItems: 'flex-end' },
  distanceValue: { color: '#252A25', fontSize: 16, fontWeight: '800' },
  distanceLabel: { color: '#7B817B', fontSize: 11, marginTop: 1 },
  vehicleDetails: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, marginTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E6EAE6' },
  vehicleNumberLabel: { color: '#747A74', fontSize: 13 },
  vehicleNumber: { color: '#333933', fontSize: 14, fontWeight: '700' },
  confirmFareCard: { backgroundColor: '#F1F8F2', borderRadius: 16, borderWidth: 1, borderColor: '#DCEBDD', padding: 16, marginTop: 4 },
  confirmFareTitle: { color: '#1F3B24', fontSize: 18, fontWeight: '800' },
  confirmFareCopy: { color: '#667066', fontSize: 13, lineHeight: 19, marginTop: 5 },
  successBanner: { backgroundColor: '#EAF6EC', borderRadius: 12, padding: 14, marginTop: 4 },
  successText: { color: '#245A2D', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  currentRideButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 8 },
  currentRideButtonText: { color: '#2E7D32', fontWeight: '800' },
});
