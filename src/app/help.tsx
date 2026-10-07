import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { submitComplaint } from '../../services/complaintService';
import type { ComplaintCategory } from '../../types/database';

const categories: ComplaintCategory[] = ['ride', 'payment', 'rider', 'other'];

export default function HelpScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const [category, setCategory] = useState<ComplaintCategory>('ride');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!account) {
      router.replace('/login');
    } else if (account.profile.role === 'admin') {
      router.replace('/admin');
    }
  }, [account, isLoading, router]);

  if (isLoading || !account || account.profile.role === 'admin') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading support...</Text>
      </SafeAreaView>
    );
  }

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Tell us what happened', 'Please describe your issue.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitComplaint({ category, description });
      setDescription('');
      Alert.alert('Complaint Submitted', 'Our support team will review your message.');
    } catch (error) {
      Alert.alert('Could Not Submit', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Help & Support</Text>
        <Text style={styles.subtitle}>Tell us how we can help.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Issue type</Text>
          <View style={styles.optionsRow}>
            {categories.map((option) => (
              <TouchableOpacity key={option} style={[styles.option, category === option && styles.selectedOption]} onPress={() => setCategory(option)}>
                <Text style={[styles.optionText, category === option && styles.selectedOptionText]}>{option[0].toUpperCase() + option.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>What happened?</Text>
          <TextInput
            style={styles.textArea}
            multiline
            value={description}
            onChangeText={setDescription}
            placeholder="Write your message here"
            placeholderTextColor="#999"
          />
          <TouchableOpacity style={styles.submitButton} onPress={() => void handleSubmit()} disabled={isSubmitting}>
            <Text style={styles.submitText}>{isSubmitting ? 'Sending...' : 'Send to Support'}</Text>
          </TouchableOpacity>
        </View>
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
  title: { color: '#222', fontSize: 28, fontWeight: '800', marginTop: 15 },
  subtitle: { color: '#777', fontSize: 15, marginTop: 5, marginBottom: 18 },
  card: { backgroundColor: '#FFF', borderRadius: 18, padding: 18 },
  label: { color: '#333', fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1, borderColor: '#D5D5D5', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12 },
  selectedOption: { backgroundColor: '#E8F5E9', borderColor: '#2E7D32' },
  optionText: { color: '#555', fontWeight: '700' },
  selectedOptionText: { color: '#2E7D32' },
  textArea: { height: 130, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, padding: 14, color: '#222', fontSize: 15, textAlignVertical: 'top' },
  submitButton: { height: 53, borderRadius: 14, backgroundColor: '#2E7D32', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
