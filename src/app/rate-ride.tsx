import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../components/AuthProvider';
import { submitRating } from '../../services/ratingService';

export default function RateRideScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const { rideId, rateeId } = useLocalSearchParams<{ rideId: string; rateeId: string }>();
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!account) {
      router.replace('/login');
    } else if (account.profile.role === 'rider') {
      router.replace('/rider-home');
    } else if (account.profile.role === 'admin') {
      router.replace('/admin');
    }
  }, [account, isLoading, router]);

  const handleSubmit = async () => {
    if (!rideId || !rateeId) {
      Alert.alert('Missing ride details', 'This ride cannot be rated yet.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitRating({ rideId, rateeId, stars, review });
      Alert.alert('Thank You', 'Your rating was submitted.', [{ text: 'Done', onPress: () => router.back() }]);
    } catch (error) {
      Alert.alert('Could Not Rate Ride', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !account || account.profile.role !== 'user') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading your ride...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Rate Your Ride</Text>
        <Text style={styles.subtitle}>How was your AutoWala experience?</Text>

        <View style={styles.card}>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((value) => (
              <TouchableOpacity key={value} onPress={() => setStars(value)}>
                <Text style={[styles.star, value <= stars && styles.selectedStar]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Optional review"
            placeholderTextColor="#999"
            value={review}
            onChangeText={setReview}
            multiline
          />
          <TouchableOpacity style={styles.submitButton} onPress={() => void handleSubmit()} disabled={isSubmitting}>
            <Text style={styles.submitText}>{isSubmitting ? 'Sending...' : 'Submit Rating'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#666', fontSize: 15 },
  container: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { padding: 20 },
  backButton: { alignSelf: 'flex-start', padding: 4 },
  backText: { color: '#2E7D32', fontSize: 16, fontWeight: '700' },
  title: { color: '#222', fontSize: 28, fontWeight: '800', marginTop: 15 },
  subtitle: { color: '#777', fontSize: 15, marginTop: 5, marginBottom: 18 },
  card: { backgroundColor: '#FFF', borderRadius: 18, padding: 20 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 },
  star: { color: '#D8D8D8', fontSize: 39 },
  selectedStar: { color: '#F4B400' },
  input: { minHeight: 100, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, padding: 14, color: '#222', textAlignVertical: 'top' },
  submitButton: { height: 53, backgroundColor: '#2E7D32', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
