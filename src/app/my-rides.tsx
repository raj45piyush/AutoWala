import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../components/AuthProvider';
import { RidePaymentButton } from '../../components/RidePaymentButton';
import { getRideHistory, getRideRiderInfo, getStatusDisplay } from '../../services/rideService';
import type { Ride } from '../../types/database';

export default function MyRidesScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [isLoadingRides, setIsLoadingRides] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riderNames, setRiderNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!account) {
      router.replace('/login');
      return;
    }
    if (account.profile.role === 'rider') {
      router.replace('/rider-history');
      return;
    }
    if (account.profile.role === 'admin') {
      router.replace('/admin');
      return;
    }
    void getRideHistory('user')
      .then(async (nextRides) => {
        setRides(nextRides);
        const riderEntries = await Promise.all(
          nextRides.filter((ride) => ride.rider_id).map(async (ride) => {
            const rider = await getRideRiderInfo(ride.id);
            return rider ? ([ride.id, rider.rider_name] as const) : null;
          })
        );
        setRiderNames(Object.fromEntries(riderEntries.filter((entry): entry is readonly [string, string] => entry !== null)));
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load rides.'))
      .finally(() => setIsLoadingRides(false));
  }, [account, isLoading, router]);

  if (isLoading || isLoadingRides || !account || account.profile.role !== 'user') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading your rides...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Rides</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {rides.length === 0 && !error ? <Text style={styles.emptyText}>Your rides will appear here.</Text> : null}
        {rides.map((ride) => (
          <View key={ride.id} style={styles.rideCard}>
            <View style={styles.row}>
              <Text style={styles.date}>{new Date(ride.created_at).toLocaleDateString()}</Text>
              <Text style={styles.status}>{getStatusDisplay(ride.status, false)}</Text>
            </View>
            <Text style={styles.address}>From: {ride.pickup_address}</Text>
            <Text style={styles.address}>To: {ride.destination_address}</Text>
            {riderNames[ride.id] ? <Text style={styles.address}>Rider: {riderNames[ride.id]}</Text> : null}
            <View style={styles.rowFooter}>
              <Text style={styles.fare}>{ride.final_fare ?? ride.estimated_fare ? `₹${(ride.final_fare ?? ride.estimated_fare)?.toFixed(2)}` : 'Fare pending'}</Text>
              <Text style={styles.passengers}>{ride.passenger_count} passenger(s)</Text>
            </View>
            {['requested', 'accepted', 'arrived', 'picked_up', 'in_progress'].includes(ride.status) ? (
              <TouchableOpacity style={styles.trackButton} onPress={() => router.push('/current-ride')}>
                <Text style={styles.trackText}>Track Current Ride</Text>
              </TouchableOpacity>
            ) : null}
            {account && ride.status === 'completed' ? <RidePaymentButton ride={ride} account={account} /> : null}
            {ride.status === 'completed' && ride.rider_id ? (
              <TouchableOpacity style={styles.rateButton} onPress={() => router.push({ pathname: '/rate-ride', params: { rideId: ride.id, rateeId: ride.rider_id ?? '' } })}>
                <Text style={styles.rateText}>Rate Rider</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#666', fontSize: 15 },
  container: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { padding: 20, paddingBottom: 40 },
  backButton: { padding: 4, alignSelf: 'flex-start' },
  backText: { color: '#2E7D32', fontSize: 16, fontWeight: '700' },
  title: { color: '#222', fontSize: 28, fontWeight: '800', marginTop: 15, marginBottom: 18 },
  emptyText: { backgroundColor: '#FFF', borderRadius: 15, padding: 18, color: '#777', fontSize: 15 },
  errorText: { backgroundColor: '#FDECEA', borderRadius: 15, padding: 16, color: '#B3261E', fontSize: 14, marginBottom: 12 },
  rideCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: '#777', fontSize: 13 },
  status: { color: '#2E7D32', fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  address: { color: '#444', fontSize: 14, marginTop: 10 },
  rowFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  trackButton: { backgroundColor: '#2E7D32', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  trackText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  fare: { color: '#2E7D32', fontSize: 16, fontWeight: '800' },
  passengers: { color: '#777', fontSize: 13 },
  rateButton: { borderWidth: 1, borderColor: '#A5D6A7', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 14 },
  rateText: { color: '#2E7D32', fontSize: 13, fontWeight: '700' },
});
