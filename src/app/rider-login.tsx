import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
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

import {
  getCurrentAccount,
  getFriendlyAuthError,
  signIn,
  signOut,
  type Account,
} from '../../services/authService';

export default function RiderLoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const initialEmail = Array.isArray(params.email) ? params.email[0] : params.email;
  const loginLock = useRef(false);

  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    if (isSubmitting || loginLock.current) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      Alert.alert('Missing Information', 'Enter your email and password.');
      return;
    }

    loginLock.current = true;
    setIsSubmitting(true);

    try {
      await signIn(normalizedEmail, password);

      let account: Account | null;
      try {
        account = await getCurrentAccount();
      } catch (profileError) {
        await signOut().catch(() => undefined);
        throw profileError;
      }

      if (!account) {
        await signOut();
        Alert.alert('Login Failed', 'Your account profile could not be loaded. Please try again.');
        return;
      }

      if (account.profile.role === 'admin') {
        router.replace('/admin');
      } else if (account.profile.role === 'user') {
        router.replace('/user-home');
      } else if (!account.rider) {
        await signOut();
        Alert.alert(
          'Rider Profile Missing',
          'This rider account is missing its rider details. Please contact AutoWala support.'
        );
        return;
      } else {
        router.replace('/rider-home');
      }
    } catch (error) {
      Alert.alert('Rider Login Failed', getFriendlyAuthError(error));
    } finally {
      loginLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.replace('/choose-role')}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>🛺</Text>
            </View>
            <Text style={styles.title}>Rider Login</Text>
            <Text style={styles.subtitle}>Log in to manage your AutoWala rides</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
              editable={!isSubmitting}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor="#999"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!isSubmitting}
              onSubmitEditing={() => void handleLogin()}
              returnKeyType="go"
            />

            <TouchableOpacity
              style={[styles.loginButton, isSubmitting && styles.disabledButton]}
              onPress={() => void handleLogin()}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              <Text style={styles.loginButtonText}>
                {isSubmitting ? 'Logging in...' : 'Login'}
              </Text>
            </TouchableOpacity>

            <View style={styles.registerRow}>
              <Text style={styles.registerText}>New to AutoWala?</Text>
              <TouchableOpacity
                onPress={() => router.replace('/rider-register')}
                disabled={isSubmitting}
                activeOpacity={0.7}
              >
                <Text style={styles.registerLink}>Create Rider Account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#F7F9FC' },
  content: { flexGrow: 1, padding: 20, paddingBottom: 40, justifyContent: 'center' },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 15 },
  backText: { fontSize: 16, color: '#2E7D32', fontWeight: '600' },
  header: { alignItems: 'center', marginBottom: 28 },
  iconCircle: { width: 75, height: 75, borderRadius: 38, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  icon: { fontSize: 38 },
  title: { fontSize: 28, fontWeight: '800', color: '#1B1B1B', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#777', textAlign: 'center', marginTop: 7 },
  form: { width: '100%' },
  label: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 7, marginTop: 12 },
  input: { width: '100%', height: 52, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, paddingHorizontal: 14, fontSize: 15, color: '#222' },
  loginButton: { height: 57, backgroundColor: '#2E7D32', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  disabledButton: { opacity: 0.65 },
  loginButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 22 },
  registerText: { color: '#666', fontSize: 14 },
  registerLink: { color: '#2E7D32', fontSize: 14, fontWeight: '700' },
});
