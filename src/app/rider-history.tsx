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
import { getRideHistory, getRidePassengerInfo, getStatusDisplay } from '../../services/rideService';
import type { Ride } from '../../types/database';

export default function RiderHistoryScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [isLoadingRides, setIsLoadingRides] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passengerNames, setPassengerNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!account) {
      router.replace('/rider-login');
      return;
    }
    if (account.profile.role === 'user') {
      router.replace('/user-home');
      return;
    }
    if (account.profile.role === 'admin') {
      router.replace('/admin');
      return;
    }
    void getRideHistory('rider')
      .then(async (nextRides) => {
        setRides(nextRides);
        const passengerEntries = await Promise.all(
          nextRides.map(async (ride) => {
            const passenger = await getRidePassengerInfo(ride.id);
            return passenger ? ([ride.id, passenger.passenger_name] as const) : null;
          })
        );
        setPassengerNames(Object.fromEntries(passengerEntries.filter((entry): entry is readonly [string, string] => entry !== null)));
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load rides.'))
      .finally(() => setIsLoadingRides(false));
  }, [account, isLoading, router]);

  if (isLoading || isLoadingRides || !account || account.profile.role !== 'rider') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading ride history...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Ride History</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {rides.length === 0 && !error ? <Text style={styles.emptyText}>Your completed and previous rides will appear here.</Text> : null}
        {rides.map((ride) => (
          <View key={ride.id} style={styles.rideCard}>
            <View style={styles.row}>
              <Text style={styles.date}>{new Date(ride.created_at).toLocaleDateString()}</Text>
              <Text style={styles.status}>{getStatusDisplay(ride.status, true)}</Text>
            </View>
            <Text style={styles.address}>From: {ride.pickup_address}</Text>
            <Text style={styles.address}>To: {ride.destination_address}</Text>
            {passengerNames[ride.id] ? <Text style={styles.address}>Passenger: {passengerNames[ride.id]}</Text> : null}
            <View style={styles.rowFooter}>
              <Text style={styles.fare}>{ride.final_fare ?? ride.estimated_fare ? `₹${(ride.final_fare ?? ride.estimated_fare)?.toFixed(2)}` : 'Fare pending'}</Text>
              <Text style={styles.passengers}>Passenger ride</Text>
            </View>
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
  fare: { color: '#2E7D32', fontSize: 16, fontWeight: '800' },
  passengers: { color: '#777', fontSize: 13 },
});
