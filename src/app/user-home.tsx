import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../components/AuthProvider';

function DashboardButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.dashboardButton} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.buttonIcon}>{icon}</Text>
      <Text style={styles.buttonLabel}>{label}</Text>
      <Text style={styles.buttonArrow}>›</Text>
    </TouchableOpacity>
  );
}

export default function UserHomeScreen() {
  const router = useRouter();
  const { account, isLoading, logout } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (!account) {
        router.replace('/login');
      } else if (account.profile.role === 'rider') {
        router.replace('/rider-home');
      } else if (account.profile.role === 'admin') {
        router.replace('/admin');
      }
    }
  }, [account, isLoading, router]);

  if (isLoading || !account || account.profile.role !== 'user') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading your AutoWala account...</Text>
      </SafeAreaView>
    );
  }

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch (error) {
      Alert.alert('Logout Failed', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>AutoWala</Text>
            <Text style={styles.greeting}>Hello, {account.profile.full_name}</Text>
          </View>
          <Text style={styles.headerIcon}>👤</Text>
        </View>

        <View style={styles.bookingCard}>
          <Text style={styles.bookingTitle}>Book an Auto/Toto</Text>
          <Text style={styles.bookingSubtitle}>Safe, simple rides for your village</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/book-ride')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Book Ride</Text>
            <Text style={styles.primaryButtonArrow}>→</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.grid}>
          <DashboardButton icon="🧾" label="My Rides" onPress={() => router.push('/my-rides')} />
          <DashboardButton icon="📍" label="Current Ride" onPress={() => router.push('/current-ride')} />
          <DashboardButton icon="👤" label="Profile" onPress={() => router.push('/profile')} />
          <DashboardButton icon="❓" label="Help" onPress={() => router.push('/help')} />
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { color: '#666', fontSize: 15 },
  container: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { flex: 1, padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  brand: { color: '#2E7D32', fontSize: 28, fontWeight: '800' },
  greeting: { color: '#666', fontSize: 15, marginTop: 4 },
  headerIcon: { fontSize: 34 },
  bookingCard: {
    backgroundColor: '#E8F5E9',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  bookingTitle: { color: '#1B1B1B', fontSize: 23, fontWeight: '800' },
  bookingSubtitle: { color: '#557158', fontSize: 14, marginTop: 6 },
  primaryButton: {
    backgroundColor: '#2E7D32',
    borderRadius: 14,
    height: 54,
    marginTop: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  primaryButtonArrow: { color: '#FFF', fontSize: 24, marginLeft: 12 },
  grid: { gap: 12 },
  dashboardButton: {
    backgroundColor: '#FFF',
    minHeight: 64,
    borderRadius: 15,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  buttonIcon: { fontSize: 25, width: 42 },
  buttonLabel: { flex: 1, color: '#222', fontSize: 17, fontWeight: '700' },
  buttonArrow: { color: '#2E7D32', fontSize: 28 },
  logoutButton: { alignItems: 'center', marginTop: 24, padding: 12 },
  logoutText: { color: '#B3261E', fontSize: 15, fontWeight: '700' },
});
