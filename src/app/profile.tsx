import * as DocumentPicker from 'expo-document-picker';
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
import { getFriendlyAuthError, updateProfile, updateRiderDetails } from '../../services/authService';
import { listOwnRiderDocuments, uploadRiderDocument } from '../../services/documentService';
import { getRiderPayoutProfile, saveRiderPayoutProfile, type RiderPayoutProfileSummary } from '../../services/payoutService';
import type { RiderDocumentType } from '../../services/documentService';
import type { VehicleType } from '../../types/database';

export default function ProfileScreen() {
  const router = useRouter();
  const { account, isLoading, logout, refreshAccount } = useAuth();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('auto');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleDetails, setVehicleDetails] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingType, setUploadingType] = useState<RiderDocumentType | null>(null);
  const [documentNames, setDocumentNames] = useState<string[]>([]);
  const [payoutMethod, setPayoutMethod] = useState<'bank' | 'upi'>('bank');
  const [payoutProfile, setPayoutProfile] = useState<RiderPayoutProfileSummary | null>(null);
  const [payoutAccountHolder, setPayoutAccountHolder] = useState('');
  const [payoutAccountNumber, setPayoutAccountNumber] = useState('');
  const [payoutIfsc, setPayoutIfsc] = useState('');
  const [payoutUpiId, setPayoutUpiId] = useState('');
  const [payoutError, setPayoutError] = useState('');
  const [isSavingPayout, setIsSavingPayout] = useState(false);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!account) {
      router.replace('/login');
      return;
    }
    if (account.profile.role === 'admin') {
      router.replace('/admin');
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setName(account.profile.full_name);
      setAge(account.profile.age?.toString() ?? '');
      setPhone(account.profile.phone ?? '');
      if (account.rider) {
        setVehicleType(account.rider.vehicle_type);
        setVehicleNumber(account.rider.vehicle_number ?? '');
        setVehicleDetails(account.rider.vehicle_details ?? '');
        setLicenceNumber(account.rider.licence_number ?? '');
        void listOwnRiderDocuments().then((documents) => setDocumentNames(documents.map((document) => document.name))).catch(() => undefined);
        void getRiderPayoutProfile().then((profile) => {
          if (active) {
            setPayoutProfile(profile);
            if (profile.payoutMethod) setPayoutMethod(profile.payoutMethod);
          }
        }).catch((error) => {
          if (active) setPayoutError(getFriendlyAuthError(error));
        });
      }
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [account, isLoading, router]);

  const handleSave = async () => {
    const parsedAge = Number(age);
    if (!name.trim() || !phone.trim() || !Number.isInteger(parsedAge) || parsedAge < 10 || parsedAge > 120) {
      Alert.alert('Invalid Profile', 'Please enter your name, phone number, and a valid age.');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({ fullName: name, age: parsedAge, phone });
      if (account?.rider) {
        await updateRiderDetails({ vehicleType, vehicleNumber, vehicleDetails, licenceNumber });
      }
      await refreshAccount();
      Alert.alert('Profile Saved', 'Your details have been updated.');
    } catch (error) {
      Alert.alert('Could Not Save', getFriendlyAuthError(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDocumentUpload = async (type: RiderDocumentType) => {
    setUploadingType(type);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: type === 'vehicle-photo' ? 'image/*' : '*/*', copyToCacheDirectory: true });
      if (result.canceled) {
        return;
      }
      const file = result.assets[0];
      await uploadRiderDocument(type, { uri: file.uri, name: file.name, mimeType: file.mimeType });
      const documents = await listOwnRiderDocuments();
      setDocumentNames(documents.map((document) => document.name));
      Alert.alert('Document Uploaded', 'Your private document was uploaded for admin review.');
    } catch (error) {
      Alert.alert('Upload Failed', getFriendlyAuthError(error));
    } finally {
      setUploadingType(null);
    }
  };

  const handleSavePayoutDetails = async () => {
    setIsSavingPayout(true);
    setPayoutError('');
    try {
      const saved = await saveRiderPayoutProfile(payoutMethod === 'bank'
        ? {
            payoutMethod,
            accountHolder: payoutAccountHolder,
            accountNumber: payoutAccountNumber,
            ifsc: payoutIfsc,
          }
        : { payoutMethod, upiId: payoutUpiId });
      setPayoutProfile(saved);
      setPayoutAccountHolder('');
      setPayoutAccountNumber('');
      setPayoutIfsc('');
      setPayoutUpiId('');
      Alert.alert('Payout Details Saved', `Saved destination: ${saved.maskedDestination ?? '••••'}.`);
    } catch (error) {
      setPayoutError(getFriendlyAuthError(error));
    } finally {
      setIsSavingPayout(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch (error) {
      Alert.alert('Logout Failed', getFriendlyAuthError(error));
    }
  };

  if (isLoading || !account || account.profile.role === 'admin') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Profile</Text>
        <Text style={styles.subtitle}>{account.profile.role === 'rider' ? 'Rider account' : 'Passenger account'}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
          <Text style={styles.label}>Age</Text>
          <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="number-pad" />
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Text style={styles.label}>Email</Text>
          <Text style={styles.readOnly}>{account.profile.email ?? account.user.email ?? 'Email unavailable'}</Text>

          {account.rider ? (
            <>
              <Text style={styles.sectionTitle}>Rider details</Text>
              <Text style={styles.label}>Vehicle type</Text>
              <View style={styles.optionsRow}>
                {(['auto', 'toto'] as VehicleType[]).map((option) => (
                  <TouchableOpacity key={option} style={[styles.option, vehicleType === option && styles.selectedOption]} onPress={() => setVehicleType(option)}>
                    <Text style={[styles.optionText, vehicleType === option && styles.selectedOptionText]}>{option.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Vehicle number</Text>
              <TextInput style={styles.input} value={vehicleNumber} onChangeText={setVehicleNumber} autoCapitalize="characters" />
              <Text style={styles.label}>Vehicle details</Text>
              <TextInput style={[styles.input, styles.textArea]} value={vehicleDetails} onChangeText={setVehicleDetails} multiline />
              <Text style={styles.label}>Driving licence number</Text>
              <TextInput style={styles.input} value={licenceNumber} onChangeText={setLicenceNumber} autoCapitalize="characters" />
              <Text style={styles.status}>Approval status: {account.rider.approval_status}</Text>

              <Text style={styles.sectionTitle}>Payout details</Text>
              {payoutProfile?.configured ? (
                <Text style={styles.status}>Saved {payoutProfile.payoutMethod?.toUpperCase()} destination: {payoutProfile.maskedDestination}</Text>
              ) : (
                <Text style={styles.helper}>No payout destination saved.</Text>
              )}
              <Text style={styles.helper}>Only a masked destination is shown after saving. Enter new details to replace it.</Text>
              <View style={styles.optionsRow}>
                {(['bank', 'upi'] as const).map((method) => (
                  <TouchableOpacity key={method} style={[styles.option, payoutMethod === method && styles.selectedOption]} onPress={() => setPayoutMethod(method)}>
                    <Text style={[styles.optionText, payoutMethod === method && styles.selectedOptionText]}>{method === 'bank' ? 'Bank account' : 'UPI'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {payoutMethod === 'bank' ? (
                <>
                  <Text style={styles.label}>Account holder</Text>
                  <TextInput style={styles.input} value={payoutAccountHolder} onChangeText={setPayoutAccountHolder} autoCapitalize="words" />
                  <Text style={styles.label}>Account number</Text>
                  <TextInput style={styles.input} value={payoutAccountNumber} onChangeText={setPayoutAccountNumber} keyboardType="number-pad" secureTextEntry />
                  <Text style={styles.label}>IFSC</Text>
                  <TextInput style={styles.input} value={payoutIfsc} onChangeText={setPayoutIfsc} autoCapitalize="characters" maxLength={11} />
                </>
              ) : (
                <>
                  <Text style={styles.label}>UPI ID</Text>
                  <TextInput style={styles.input} value={payoutUpiId} onChangeText={setPayoutUpiId} autoCapitalize="none" keyboardType="email-address" />
                </>
              )}
              {payoutError ? <Text accessibilityRole="alert" style={styles.errorText}>{payoutError}</Text> : null}
              <TouchableOpacity style={styles.uploadButton} onPress={() => void handleSavePayoutDetails()} disabled={isSavingPayout}>
                <Text style={styles.uploadText}>{isSavingPayout ? 'Saving securely…' : 'Save payout destination'}</Text>
              </TouchableOpacity>

              <Text style={styles.sectionTitle}>Private documents</Text>
              <Text style={styles.helper}>Documents are stored in a private Supabase bucket. Public URLs are not created.</Text>
              <TouchableOpacity style={styles.uploadButton} onPress={() => void handleDocumentUpload('id-proof')} disabled={uploadingType !== null}>
                <Text style={styles.uploadText}>{uploadingType === 'id-proof' ? 'Uploading...' : '📄 Upload ID proof'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadButton} onPress={() => void handleDocumentUpload('vehicle-photo')} disabled={uploadingType !== null}>
                <Text style={styles.uploadText}>{uploadingType === 'vehicle-photo' ? 'Uploading...' : '📷 Upload vehicle photo'}</Text>
              </TouchableOpacity>
              {documentNames.length > 0 ? <Text style={styles.documents}>Uploaded: {documentNames.join(', ')}</Text> : null}
            </>
          ) : null}

          <TouchableOpacity style={styles.saveButton} onPress={() => void handleSave()} disabled={isSaving}>
            <Text style={styles.saveText}>{isSaving ? 'Saving...' : 'Save Profile'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={() => void handleLogout()}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
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
  label: { color: '#333', fontSize: 15, fontWeight: '700', marginTop: 12, marginBottom: 7 },
  input: { height: 50, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, paddingHorizontal: 14, color: '#222', fontSize: 15 },
  textArea: { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' },
  readOnly: { color: '#777', backgroundColor: '#F5F5F5', borderRadius: 12, padding: 15, fontSize: 15 },
  sectionTitle: { color: '#222', fontSize: 18, fontWeight: '800', marginTop: 24, marginBottom: 3 },
  optionsRow: { flexDirection: 'row', gap: 10 },
  option: { flex: 1, borderWidth: 1, borderColor: '#D5D5D5', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  selectedOption: { backgroundColor: '#E8F5E9', borderColor: '#2E7D32' },
  optionText: { color: '#555', fontWeight: '700' },
  selectedOptionText: { color: '#2E7D32' },
  status: { color: '#2E7D32', fontSize: 14, fontWeight: '700', marginTop: 14 },
  errorText: { color: '#B3261E', fontSize: 13, lineHeight: 18, marginTop: 8 },
  helper: { color: '#777', fontSize: 13, lineHeight: 19, marginTop: 6 },
  uploadButton: { backgroundColor: '#F1F8F2', borderRadius: 12, padding: 14, marginTop: 10 },
  uploadText: { color: '#2E7D32', fontSize: 15, fontWeight: '700' },
  documents: { color: '#777', fontSize: 12, marginTop: 10 },
  saveButton: { backgroundColor: '#2E7D32', borderRadius: 14, height: 53, alignItems: 'center', justifyContent: 'center', marginTop: 25 },
  saveText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  logoutButton: { alignItems: 'center', padding: 18 },
  logoutText: { color: '#B3261E', fontSize: 15, fontWeight: '700' },
});
