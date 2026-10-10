import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../components/AuthProvider';
import { supabase } from '../../lib/supabase';
import { getRiderEarningsSummary } from '../../services/earningsService';
import { getFriendlyAuthError } from '../../services/authService';
import { getCurrentCoordinates, watchCurrentLocation } from '../../services/locationService';
import { isValidCoordinatePair } from '../../services/riderApproval.mjs';
import {
  acceptRideRpc,
  getRiderRideRequestsWithRides,
  rejectRide,
  setRiderOnline,
  updateRiderLocation,
} from '../../services/rideService';
import type { RiderEarningsSummary, RiderRideRequest } from '../../types/database';

export default function RiderHomeScreen() {
  const router = useRouter();
  const { account, isLoading, logout, refreshAccount } = useAuth();
  const [requests, setRequests] = useState<RiderRideRequest[]>([]);
  const [earningsSummary, setEarningsSummary] = useState<RiderEarningsSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const locationSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const requestRefreshRef = useRef(0);
  const riderId = account?.profile.role === 'rider' ? account.rider?.user_id ?? null : null;
  const riderIsOnline = account?.profile.role === 'rider' && account.rider?.is_online === true;
  const riderApprovalStatus = account?.profile.role === 'rider' ? account.rider?.approval_status ?? null : null;


  useEffect(() => {
    if (isLoading) return;
    if (!account) {
      router.replace('/rider-login');
    } else if (account.profile.role === 'admin') {
      router.replace('/admin');
    } else if (account.profile.role === 'user') {
      router.replace('/user-home');
    }
  }, [account, isLoading, router]);

  const refreshRequests = useCallback(async () => {
    const requestId = ++requestRefreshRef.current;
    setIsRefreshing(true);
    try {
      const [nextRequests, nextEarnings] = await Promise.all([
        getRiderRideRequestsWithRides(),
        getRiderEarningsSummary(),
      ]);
      if (requestId !== requestRefreshRef.current) return;
      setRequests(nextRequests);
      setEarningsSummary(nextEarnings);
    } catch (error) {
      if (requestId === requestRefreshRef.current) {
        Alert.alert('Could Not Load Rides', getFriendlyAuthError(error));
      }
    } finally {
      if (requestId === requestRefreshRef.current) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!riderId) return;
    const refreshTimer = setTimeout(() => void refreshRequests(), 0);
    return () => clearTimeout(refreshTimer);
  }, [refreshRequests, riderId]);

  useEffect(() => {
    if (!riderId || !riderIsOnline) return;
    const fallback = setInterval(() => void refreshRequests(), 20000);
    return () => clearInterval(fallback);
  }, [refreshRequests, riderId, riderIsOnline]);

  useEffect(() => {
    if (!riderId || (riderApprovalStatus !== 'pending' && riderApprovalStatus !== null)) return;
    const refreshTimer = setInterval(() => void refreshAccount(), 15000);
    return () => clearInterval(refreshTimer);
  }, [refreshAccount, riderApprovalStatus, riderId]);

  useEffect(() => {
    if (!riderId) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshRequests();
      }, 100);
    };
    const channel = supabase
      .channel(`rider-requests-${riderId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ride_requests', filter: `rider_id=eq.${riderId}`,
      }, (payload) => {
        const updatedRequest = payload.new as { id?: string; status?: string };
        if (updatedRequest.id && updatedRequest.status !== 'pending') {
          setRequests((current) => current.filter((request) => request.request.id !== updatedRequest.id));
        }
        scheduleRefresh();
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'rides',
      }, scheduleRefresh)
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [refreshRequests, riderId]);

  useEffect(() => {
    if (!riderId || !riderIsOnline) {
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
      return;
    }

    let cancelled = false;
    const subscriptionPromise = watchCurrentLocation(async (location) => {
      try {
        await updateRiderLocation(location.coords.latitude, location.coords.longitude);
      } catch {
        // A transient network error must not end an otherwise active location watch.
      }
    });

    void subscriptionPromise.then((subscription) => {
      if (cancelled) {
        subscription.remove();
        return;
      }
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = subscription;
    }).catch(async (error) => {
      if (cancelled) return;
      Alert.alert('Location Sharing Stopped', getFriendlyAuthError(error));
      try {
        await setRiderOnline(false);
        await refreshAccount();
      } catch {
        // Keep the location error visible; the rider can retry from the online control.
      }
    });

    return () => {
      cancelled = true;
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
    };
  }, [refreshAccount, riderId, riderIsOnline]);

  if (isLoading || !account) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading rider account...</Text>
      </SafeAreaView>
    );
  }

  if (account.profile.role !== 'rider') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Opening your account...</Text>
      </SafeAreaView>
    );
  }

  if (!account.rider) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.messageTitle}>Rider profile is missing</Text>
        <Text style={styles.messageText}>Please contact AutoWala support.</Text>
      </SafeAreaView>
    );
  }

  const rider = account.rider;
  const earnings = earningsSummary?.todayEarnings ?? 0;

  const handleOnlineChange = async (nextValue: boolean) => {
    if (riderApprovalStatus !== 'approved') {
      Alert.alert('Approval Required', 'Your account is waiting for admin approval.');
      return;
    }

    try {
      if (nextValue) {
        const coordinates = await getCurrentCoordinates();
        await updateRiderLocation(coordinates.latitude, coordinates.longitude);
      }

      await setRiderOnline(nextValue);
      await refreshAccount();
    } catch (error) {
      Alert.alert('Location Needed', getFriendlyAuthError(error));
      if (nextValue) {
        try {
          await setRiderOnline(false);
          await refreshAccount();
        } catch {
          // Keep the original permission/network message visible.
        }
      }
    }
  };

  const handleRequest = async (request: RiderRideRequest, action: 'accept' | 'reject') => {
    if (action === 'accept') {
      try {
        await acceptRideRpc(request.ride.id);
        await refreshRequests();
        router.push('/current-ride');
      } catch (error) {
        Alert.alert('Could Not Accept Ride', getFriendlyAuthError(error));
        await refreshRequests();
      }
    } else {
      try {
        await rejectRide(request.ride.id);
        await refreshRequests();
      } catch (error) {
        Alert.alert('Ride Update Failed', getFriendlyAuthError(error));
      }
    }
  };

  const handleLogout = async () => {
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;
    try {
      await logout();
      router.replace('/rider-login');
    } catch (error) {
      Alert.alert('Logout Failed', getFriendlyAuthError(error));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>AutoWala Rider</Text>
            <Text style={styles.greeting}>{account.profile.full_name}</Text>
          </View>
          <Text style={styles.headerIcon}>🛺</Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Vehicle</Text>
          <Text style={styles.vehicleTitle}>{rider.vehicle_type.toUpperCase()}</Text>
          <Text style={styles.vehicleNumber}>{rider.vehicle_number || 'Vehicle number pending'}</Text>
          <Text style={styles.statusText}>Approval: {riderApprovalStatus ?? 'pending review'}</Text>
          <Text style={styles.statusText}>
            Location: {isValidCoordinatePair(rider.current_latitude, rider.current_longitude) ? 'Available' : 'Not shared'}
          </Text>
        </View>

        {riderApprovalStatus !== 'approved' ? (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Your account is waiting for admin approval.</Text>
            <Text style={styles.pendingText}>
              You can update your profile while documents are being reviewed. Location sharing becomes available after approval.
            </Text>
          </View>
        ) : (
          <View style={styles.onlineCard}>
            <View style={styles.onlineCopy}>
              <Text style={styles.onlineTitle}>{rider.is_online ? 'Go Offline' : 'Go Online'}</Text>
              <Text style={styles.onlineText}>
                {rider.is_online ? 'Online · location shared' : 'Offline · not receiving requests'}
              </Text>
            </View>
            <Switch
              value={rider.is_online}
              onValueChange={handleOnlineChange}
              trackColor={{ false: '#D0D0D0', true: '#A5D6A7' }}
              thumbColor={rider.is_online ? '#2E7D32' : '#F4F4F4'}
            />
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{earningsSummary?.completedRides ?? '—'}</Text>
            <Text style={styles.statLabel}>Completed rides</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>₹{earnings.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Today&apos;s earnings</Text>
          </View>
        </View>
        <Text style={styles.earningsMeta}>
          This week ₹{(earningsSummary?.weekEarnings ?? 0).toFixed(2)} · Pending payout ₹{(earningsSummary?.pendingPayout ?? 0).toFixed(2)}
        </Text>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Nearby ride requests</Text>
          <TouchableOpacity onPress={() => void refreshRequests()}>
            <Text style={styles.refreshText}>{isRefreshing ? 'Loading...' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>

        {requests.length === 0 ? (
          <Text style={styles.emptyText}>No ride requests right now.</Text>
        ) : (
          requests.map((request) => (
            <View key={request.request.id} style={styles.requestCard}>
              <Text style={styles.requestText}>Passenger: {request.passenger_name ?? 'AutoWala passenger'}</Text>
              <Text style={styles.requestTitle}>{request.ride.pickup_address}</Text>
              <Text style={styles.requestText}>To: {request.ride.destination_address}</Text>
              <Text style={styles.requestText}>Booking: {request.ride.id.slice(0, 8).toUpperCase()} · {new Date(request.request.sent_at).toLocaleTimeString()}</Text>
              <Text style={styles.requestText}>Pickup distance: {request.request.distance_km === null ? 'Unavailable' : `${request.request.distance_km.toFixed(1)} km`}</Text>
              <Text style={styles.requestText}>Estimated fare: {request.ride.estimated_fare === null ? 'Not available' : `₹${request.ride.estimated_fare.toFixed(2)}`}</Text>
              <Text style={styles.requestText}>Trip distance: {request.ride.estimated_distance_km === null ? 'Not provided' : `${request.ride.estimated_distance_km.toFixed(1)} km`}</Text>
              <Text style={styles.requestText}>
                {request.ride.passenger_count} passenger(s) · {request.ride.vehicle_preference}
              </Text>
              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={styles.rejectButton}
                  onPress={() => void handleRequest(request, 'reject')}
                >
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={() => void handleRequest(request, 'accept')}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <View style={styles.linksRow}>
          <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/current-ride')}>
            <Text style={styles.linkText}>Current Ride</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/rider-history')}>
            <Text style={styles.linkText}>Ride History</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/profile')}>
            <Text style={styles.linkText}>Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/help')}>
            <Text style={styles.linkText}>Help</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#666', fontSize: 15 },
  messageTitle: { color: '#222', fontSize: 20, fontWeight: '800' },
  messageText: { color: '#666', fontSize: 15, marginTop: 8 },
  container: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  brand: { color: '#2E7D32', fontSize: 27, fontWeight: '800' },
  greeting: { color: '#666', fontSize: 15, marginTop: 4 },
  headerIcon: { fontSize: 34 },
  infoCard: { backgroundColor: '#FFF', borderRadius: 18, padding: 18, marginBottom: 14 },
  infoLabel: { color: '#777', fontSize: 13 },
  vehicleTitle: { color: '#222', fontSize: 23, fontWeight: '800', marginTop: 3 },
  vehicleNumber: { color: '#555', fontSize: 15, marginTop: 3 },
  statusText: { color: '#2E7D32', fontSize: 14, fontWeight: '700', marginTop: 12 },
  pendingCard: { backgroundColor: '#FFF4D6', borderRadius: 16, padding: 16, marginBottom: 14 },
  pendingTitle: { color: '#6D4C00', fontSize: 16, fontWeight: '800', lineHeight: 23 },
  pendingText: { color: '#765F2A', fontSize: 14, marginTop: 6, lineHeight: 20 },
  onlineCard: { backgroundColor: '#E8F5E9', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  onlineCopy: { flex: 1 },
  onlineTitle: { color: '#222', fontSize: 17, fontWeight: '800' },
  onlineText: { color: '#557158', fontSize: 13, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 22 },
  statCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 15, padding: 16 },
  earningsMeta: { color: '#647064', fontSize: 12, marginTop: -14, marginBottom: 20 },
  statValue: { color: '#2E7D32', fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#777', fontSize: 13, marginTop: 5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { color: '#222', fontSize: 18, fontWeight: '800' },
  refreshText: { color: '#2E7D32', fontSize: 14, fontWeight: '700' },
  emptyText: { color: '#777', backgroundColor: '#FFF', borderRadius: 14, padding: 16, fontSize: 14 },
  requestCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 12 },
  requestTitle: { color: '#222', fontSize: 16, fontWeight: '800' },
  requestText: { color: '#666', fontSize: 14, marginTop: 5 },
  requestActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rejectButton: { flex: 1, borderRadius: 11, borderWidth: 1, borderColor: '#E0B8B5', height: 44, alignItems: 'center', justifyContent: 'center' },
  rejectText: { color: '#B3261E', fontWeight: '700' },
  acceptButton: { flex: 1, borderRadius: 11, backgroundColor: '#2E7D32', height: 44, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#FFF', fontWeight: '700' },
  linksRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  linkButton: { flex: 1, backgroundColor: '#FFF', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  linkText: { color: '#2E7D32', fontSize: 13, fontWeight: '700' },
  logoutButton: { alignItems: 'center', padding: 16, marginTop: 10 },
  logoutText: { color: '#B3261E', fontSize: 15, fontWeight: '700' },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, width: '100%', maxWidth: 400, maxHeight: '90%' },
  modalTitle: { color: '#1B1B1B', fontSize: 22, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  modalDetail: { flexDirection: 'row', marginBottom: 8 },
  modalLabel: { color: '#777', fontSize: 14, fontWeight: '700', width: 100 },
  modalValue: { color: '#222', fontSize: 14, flex: 1 },
  codeInstruction: { color: '#2E7D32', fontSize: 16, fontWeight: '800', marginTop: 16, marginBottom: 12, textAlign: 'center' },
  codeInputContainer: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12 },
  codeInput: { width: 44, height: 56, borderWidth: 2, borderColor: '#DDE3DD', borderRadius: 10, fontSize: 24, fontWeight: '800', textAlign: 'center', color: '#222', backgroundColor: '#FFF' },
  codeInputFilled: { borderColor: '#2E7D32', backgroundColor: '#E8F5E9' },
  codeInputEmpty: { borderColor: '#DDE3DD' },
  codeError: { color: '#B3261E', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalCancelButton: { flex: 1, borderRadius: 11, borderWidth: 1, borderColor: '#DDE3DD', height: 48, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { color: '#555', fontWeight: '700', fontSize: 16 },
  modalConfirmButton: { flex: 1, borderRadius: 11, backgroundColor: '#2E7D32', height: 48, alignItems: 'center', justifyContent: 'center' },
  modalConfirmText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  modalButtonDisabled: { opacity: 0.6 },
});
