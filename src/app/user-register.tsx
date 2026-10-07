import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useAuth } from '../../components/AuthProvider';
import {
  getAuthErrorDiagnostics,
  getFriendlyAuthError,
  getOriginalAuthError,
  registerUser,
} from '../../services/authService';

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

export default function UserRegisterScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const submissionLock = useRef(false);

  useEffect(() => {
    if (isLoading || !account) return;
    if (account.profile.role === 'admin') router.replace('/admin');
    else if (account.profile.role === 'rider') router.replace('/rider-home');
    else router.replace('/user-home');
  }, [account, isLoading, router]);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const handleRegister = async () => {
    if (isSubmitting || submissionLock.current) {
      return;
    }

    setFeedback(null);

    const trimmedName = name.trim();
    const trimmedAge = age.trim();
    const trimmedPhone = phone.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (
      !trimmedName ||
      !trimmedAge ||
      !trimmedPhone ||
      !normalizedEmail ||
      !password ||
      !confirmPassword
    ) {
      Alert.alert('Missing Information', 'Please fill all fields.');
      return;
    }

    const parsedAge = Number(trimmedAge);
    if (!Number.isInteger(parsedAge) || parsedAge < 10 || parsedAge > 120) {
      Alert.alert('Invalid Age', 'Please enter a valid age.');
      return;
    }

    if (!/^\d{10}$/.test(trimmedPhone)) {
      Alert.alert(
        'Invalid Mobile Number',
        'Please enter a valid 10-digit mobile number.'
      );
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      Alert.alert(
        'Weak Password',
        'Password must contain at least 6 characters.'
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        'Password Mismatch',
        'Password and Confirm Password do not match.'
      );
      return;
    }

    submissionLock.current = true;
    setIsSubmitting(true);

    try {
      const data = await registerUser({
        fullName: trimmedName,
        age: parsedAge,
        phone: trimmedPhone,
        email: normalizedEmail,
        password,
      });

      if (data.session) {
        setFeedback({ type: 'success', message: 'Registration successful!' });
        await new Promise((resolve) => setTimeout(resolve, 700));
        router.replace('/user-home');
      } else {
        router.replace({
          pathname: '/login',
          params: { email: normalizedEmail, registered: 'true' },
        });
      }
    } catch (error) {
      const message = getFriendlyAuthError(error);
      console.error('[AutoWala auth] user registration failed', {
        error: getAuthErrorDiagnostics(getOriginalAuthError(error)),
      });
      setFeedback({ type: 'error', message });
      Alert.alert('Registration Failed', message);
    } finally {
      submissionLock.current = false;
      setIsSubmitting(false);
    }
  };

  if (isLoading || account) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.loading} size="large" color="#2E7D32" />
      </SafeAreaView>
    );
  }

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
              <Text style={styles.icon}>👤</Text>
            </View>

            <Text style={styles.title}>Create Passenger Account</Text>

            <Text style={styles.subtitle}>
              Enter your details to start using AutoWala
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor="#999"
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.label}>Age</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your age"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              value={age}
              onChangeText={setAge}
              maxLength={3}
            />

            <Text style={styles.label}>Mobile Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter 10-digit mobile number"
              placeholderTextColor="#999"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              maxLength={10}
            />

            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Create a password"
              placeholderTextColor="#999"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter password again"
              placeholderTextColor="#999"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            {feedback ? (
              <Text
                accessibilityRole="alert"
                style={[
                  styles.feedback,
                  feedback.type === 'success'
                    ? styles.successFeedback
                    : styles.errorFeedback,
                ]}
              >
                {feedback.message}
              </Text>
            ) : null}

            <TouchableOpacity
              style={styles.registerButton}
              onPress={handleRegister}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              <Text style={styles.registerText}>
                {isSubmitting ? 'Creating Account...' : 'Create Account'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.loginText}>
              Already have an account?
            </Text>

            <TouchableOpacity
              onPress={() => router.push('/login')}
              activeOpacity={0.7}
            >
              <Text style={styles.loginLink}>Login</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  flex: {
    flex: 1,
  },

  container: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },

  content: {
    padding: 20,
    paddingBottom: 40,
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
    marginBottom: 25,
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
    fontSize: 25,
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

  feedback: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 18,
  },

  successFeedback: {
    color: '#2E7D32',
    backgroundColor: '#E8F5E9',
  },

  errorFeedback: {
    color: '#B3261E',
    backgroundColor: '#FDECEC',
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

  registerButton: {
    height: 55,
    backgroundColor: '#2E7D32',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },

  registerText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },

  loginText: {
    textAlign: 'center',
    color: '#777',
    fontSize: 14,
    marginTop: 22,
  },

  loginLink: {
    textAlign: 'center',
    color: '#2E7D32',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
  },
});
