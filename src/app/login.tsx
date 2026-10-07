import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
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
} from '../../services/authService';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; registered?: string }>();
  const registeredEmail = Array.isArray(params.email) ? params.email[0] : params.email;
  const registrationCompleted =
    (Array.isArray(params.registered) ? params.registered[0] : params.registered) === 'true';
  const [email, setEmail] = useState(registeredEmail ?? '');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const registrationMessage = registrationCompleted
    ? 'Registration successful. Please login to continue.'
    : '';

  const handleLogin = async () => {
    setIsSubmitting(true);

    try {
      await signIn(email, password);
      const account = await getCurrentAccount();

      if (!account) {
        throw new Error('Your account profile could not be loaded. Please try again.');
      }

      if (account.profile.role === 'admin') {
        router.replace('/admin');
      } else if (account.profile.role === 'rider') {
        router.replace('/rider-home');
      } else {
        router.replace('/user-home');
      }
    } catch (error) {
      Alert.alert('Login Failed', getFriendlyAuthError(error));
    } finally {
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
            onPress={() => router.back()}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>🛺</Text>
            </View>

            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>
              Login to your AutoWala account
            </Text>
          </View>

          <View style={styles.form}>
            {registrationMessage ? (
              <Text accessibilityRole="alert" style={styles.registrationMessage}>
                {registrationMessage}
              </Text>
            ) : null}

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
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor="#999"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <TouchableOpacity
              style={styles.loginButton}
              onPress={handleLogin}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              <Text style={styles.loginButtonText}>
                {isSubmitting ? 'Logging in...' : 'Login'}
              </Text>
            </TouchableOpacity>

            <View style={styles.registerRow}>
              <Text style={styles.registerText}>Don&apos;t have an account?</Text>
              <TouchableOpacity
                onPress={() => router.push('/choose-role')}
                activeOpacity={0.7}
              >
                <Text style={styles.registerLink}>Create one</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  container: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },

  content: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 40,
    justifyContent: 'center',
  },

  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 15,
  },

  backText: {
    fontSize: 16,
    color: '#2E7D32',
    fontWeight: '600',
  },

  header: {
    alignItems: 'center',
    marginBottom: 28,
  },

  iconCircle: {
    width: 75,
    height: 75,
    borderRadius: 38,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },

  icon: {
    fontSize: 38,
  },

  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1B1B1B',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    marginTop: 7,
  },

  form: {
    width: '100%',
  },

  registrationMessage: {
    color: '#2E7D32',
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },

  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 7,
    marginTop: 12,
  },

  input: {
    width: '100%',
    height: 52,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 15,
    fontSize: 15,
    color: '#222',
  },

  loginButton: {
    height: 55,
    backgroundColor: '#2E7D32',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },

  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },

  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    gap: 5,
  },

  registerText: {
    fontSize: 14,
    color: '#777',
  },

  registerLink: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '700',
  },
});
