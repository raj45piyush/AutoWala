import * as DocumentPicker from 'expo-document-picker';
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
  registerRider,
} from '../../services/authService';
import { uploadRiderDocument } from '../../services/documentService';

type SelectedDocument = {
  uri: string;
  name: string;
  mimeType?: string | null;
};

export default function RiderRegisterScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();
  const submissionLock = useRef(false);
  const registrationCompleted = useRef(false);

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

  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleDetails, setVehicleDetails] = useState('');

  const [licenceNumber, setLicenceNumber] = useState('');
  const [idProofType, setIdProofType] = useState('');
  const [idProofFile, setIdProofFile] = useState<SelectedDocument | null>(null);
  const [vehiclePhotoFile, setVehiclePhotoFile] = useState<SelectedDocument | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistrationCompleted, setIsRegistrationCompleted] = useState(false);

  const pickDocument = async (type: 'id-proof' | 'vehicle-photo') => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: type === 'vehicle-photo' ? 'image/*' : '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets[0];
      const selectedFile = { uri: file.uri, name: file.name, mimeType: file.mimeType };
      if (type === 'id-proof') {
        setIdProofFile(selectedFile);
      } else {
        setVehiclePhotoFile(selectedFile);
      }
    } catch (error) {
      Alert.alert('Could Not Select File', getFriendlyAuthError(error));
    }
  };

  const handleRegister = async () => {
    if (isSubmitting || submissionLock.current) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (
      !name ||
      !age ||
      !phone ||
      !normalizedEmail ||
      !password ||
      !confirmPassword ||
      !vehicleType ||
      !vehicleNumber ||
      !licenceNumber ||
      !idProofType
    ) {
      Alert.alert(
        'Missing Information',
        'Please fill all required fields.'
      );
      return;
    }

    if (Number(age) < 16 || Number(age) > 100) {
      Alert.alert(
        'Invalid Age',
        'Rider must be at least 18 years old.'
      );
      return;
    }

    if (phone.length !== 10) {
      Alert.alert(
        'Invalid Mobile Number',
        'Please enter a valid 10-digit mobile number.'
      );
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

    if (!idProofFile || !vehiclePhotoFile) {
      Alert.alert('Documents Required', 'Please select your ID proof and vehicle photo.');
      return;
      
    }

    submissionLock.current = true;
    setIsSubmitting(true);

    try {
      const data = await registerRider({
        fullName: name,
        age: Number(age),
        phone,
        email: normalizedEmail,
        password,
        vehicleType: vehicleType.toLowerCase() as 'auto' | 'toto',
        vehicleNumber,
        vehicleDetails,
        licenceNumber,
        idProofType,
      });

      if (!data.user) {
        throw new Error('Registration could not be completed. Please try again.');
      }

      registrationCompleted.current = true;
      setIsRegistrationCompleted(true);

      if (!data.session) {
        Alert.alert(
          'Registration Successful',
          'Rider account created successfully. Please log in to continue.',
          [
            {
              text: 'Go to Rider Login',
              onPress: () =>
                router.replace(`/rider-login?email=${encodeURIComponent(normalizedEmail)}`),
            },
          ]
        );
        return;
      }

      if (!data.riderProfileVerified) {
        Alert.alert(
          'Account Created',
          'Your rider account was created, but we could not verify its rider profile. Please use Rider Login or contact AutoWala support.',
          [
            {
              text: 'Go to Rider Login',
              onPress: () =>
                router.replace(`/rider-login?email=${encodeURIComponent(normalizedEmail)}`),
            },
          ]
        );
        return;
      }

      let documentUploadMessage = 'Your rider account is pending admin approval.';

      try {
        await uploadRiderDocument('id-proof', idProofFile);
        await uploadRiderDocument('vehicle-photo', vehiclePhotoFile);
      } catch (uploadError) {
        documentUploadMessage =
          `Your rider account is pending admin approval, but a document could not be uploaded: ${getFriendlyAuthError(uploadError)}`;
      }

      Alert.alert(
        'Registration Submitted',
        documentUploadMessage,
        [{ text: 'Continue', onPress: () => router.replace('/rider-home') }]
      );
    } catch (error) {
      const authError = getAuthErrorDiagnostics(getOriginalAuthError(error));
      if (authError.code === 'user_already_exists') {
        Alert.alert(
          'Email Already Registered',
          'This email is already registered. Please use Rider Login.',
          [
            {
              text: 'Rider Login',
              onPress: () =>
                router.replace(`/rider-login?email=${encodeURIComponent(normalizedEmail)}`),
            },
          ]
        );
        return;
      }

      Alert.alert('Registration Failed', getFriendlyAuthError(error));
    } finally {
      if (!registrationCompleted.current) {
        submissionLock.current = false;
        setIsSubmitting(false);
      }
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
              <Text style={styles.icon}>🛺</Text>
            </View>

            <Text style={styles.title}>Rider Registration</Text>

            <Text style={styles.subtitle}>
              Register your Auto/Toto to start accepting rides
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Personal Details</Text>

            <Text style={styles.label}>Full Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor="#999"
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.label}>Age *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your age"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              value={age}
              onChangeText={setAge}
              maxLength={3}
            />

            <Text style={styles.label}>Mobile Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter 10-digit mobile number"
              placeholderTextColor="#999"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              maxLength={10}
            />

            <Text style={styles.label}>Email Address *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.label}>Password *</Text>
            <TextInput
              style={styles.input}
              placeholder="Create a password"
              placeholderTextColor="#999"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <Text style={styles.label}>Confirm Password *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter password again"
              placeholderTextColor="#999"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vehicle Details</Text>

            <Text style={styles.label}>Vehicle Type *</Text>

            <View style={styles.vehicleRow}>
              <TouchableOpacity
                style={[
                  styles.vehicleOption,
                  vehicleType === 'Auto' && styles.vehicleSelected,
                ]}
                onPress={() => setVehicleType('Auto')}
              >
                <Text style={styles.vehicleEmoji}>🛺</Text>
                <Text
                  style={[
                    styles.vehicleText,
                    vehicleType === 'Auto' && styles.selectedText,
                  ]}
                >
                  Auto
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.vehicleOption,
                  vehicleType === 'Toto' && styles.vehicleSelected,
                ]}
                onPress={() => setVehicleType('Toto')}
              >
                <Text style={styles.vehicleEmoji}>🚕</Text>
                <Text
                  style={[
                    styles.vehicleText,
                    vehicleType === 'Toto' && styles.selectedText,
                  ]}
                >
                  Toto
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Vehicle Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="Example: BR02AB1234"
              placeholderTextColor="#999"
              autoCapitalize="characters"
              value={vehicleNumber}
              onChangeText={setVehicleNumber}
            />

            <Text style={styles.label}>Vehicle Details</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Model, colour, seating capacity, etc."
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              value={vehicleDetails}
              onChangeText={setVehicleDetails}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Verification Details</Text>

            <Text style={styles.label}>Driving Licence Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter driving licence number"
              placeholderTextColor="#999"
              autoCapitalize="characters"
              value={licenceNumber}
              onChangeText={setLicenceNumber}
            />

            <Text style={styles.label}>ID Proof Type *</Text>

            <View style={styles.proofRow}>
              {['Aadhaar', 'Voter ID', 'PAN'].map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.proofOption,
                    idProofType === type && styles.proofSelected,
                  ]}
                  onPress={() => setIdProofType(type)}
                >
                  <Text
                    style={[
                      styles.proofText,
                      idProofType === type && styles.selectedText,
                    ]}
                  >
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.uploadButton}
              onPress={() => void pickDocument('id-proof')}
            >
              <Text style={styles.uploadIcon}>📄</Text>
              <View>
                <Text style={styles.uploadTitle}>
                  Upload ID Proof
                </Text>
                <Text style={styles.uploadSubtitle}>
                  {idProofFile?.name ?? 'Aadhaar / Voter ID / PAN'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.uploadButton}
              onPress={() => void pickDocument('vehicle-photo')}
            >
              <Text style={styles.uploadIcon}>📷</Text>
              <View>
                <Text style={styles.uploadTitle}>
                  Upload Vehicle Photo
                </Text>
                <Text style={styles.uploadSubtitle}>
                  {vehiclePhotoFile?.name ?? 'Clear photo of your Auto/Toto'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.registerButton, isSubmitting && styles.registerButtonDisabled]}
            onPress={handleRegister}
            disabled={isSubmitting || isRegistrationCompleted}
            activeOpacity={0.8}
          >
            <Text style={styles.registerText}>
              {isSubmitting ? 'Creating account...' : 'Submit Rider Registration'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            Your documents will be reviewed before your rider account is
            approved.
          </Text>
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
    paddingBottom: 45,
  },

  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 10,
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
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  icon: {
    fontSize: 40,
  },

  title: {
    fontSize: 27,
    fontWeight: '800',
    color: '#1B1B1B',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    marginTop: 7,
    lineHeight: 20,
  },

  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#222',
    marginBottom: 8,
  },

  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 13,
    marginBottom: 7,
  },

  input: {
    width: '100%',
    height: 52,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#222',
  },

  textArea: {
    height: 95,
    paddingTop: 14,
    textAlignVertical: 'top',
  },

  vehicleRow: {
    flexDirection: 'row',
    gap: 12,
  },

  vehicleOption: {
    flex: 1,
    height: 85,
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
  },

  vehicleSelected: {
    borderColor: '#2E7D32',
    backgroundColor: '#E8F5E9',
  },

  vehicleEmoji: {
    fontSize: 28,
    marginBottom: 5,
  },

  vehicleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
  },

  selectedText: {
    color: '#2E7D32',
    fontWeight: '700',
  },

  proofRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },

  proofOption: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: '#FAFAFA',
  },

  proofSelected: {
    borderColor: '#2E7D32',
    backgroundColor: '#E8F5E9',
  },

  proofText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '600',
  },

  uploadButton: {
    minHeight: 70,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#BDBDBD',
    borderRadius: 13,
    marginTop: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },

  uploadIcon: {
    fontSize: 28,
    marginRight: 14,
  },

  uploadTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },

  uploadSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 3,
  },

  registerButton: {
    height: 57,
    backgroundColor: '#2E7D32',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },

  registerButtonDisabled: {
    opacity: 0.65,
  },

  registerText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  note: {
    textAlign: 'center',
    color: '#888',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 13,
    paddingHorizontal: 15,
  },
});
