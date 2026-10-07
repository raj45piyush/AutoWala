import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAuth } from '../../../components/AuthProvider';
import { getCurrentAccount, getFriendlyAuthError, signIn, signOut } from '../../../services/authService';

export default function AdminLoginScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 760;
  const { account, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading || !account) return;
    if (account.profile.role === 'admin') router.replace('/admin');
    else if (account.profile.role === 'rider') router.replace('/rider-home');
    else router.replace('/user-home');
  }, [account, isLoading, router]);

  const handleLogin = async () => {
    if (isSubmitting) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await signIn(email, password);
      const signedInAccount = await getCurrentAccount();

      if (!signedInAccount) {
        throw new Error('Your account profile could not be loaded. Please try again.');
      }

      if (signedInAccount.profile.role !== 'admin') {
        await signOut();
        setErrorMessage('This account does not have administrator access.');
        return;
      }

      router.replace('/admin');
    } catch (error) {
      setErrorMessage(getFriendlyAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || account) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator style={styles.loading} size="large" color="#2E7D32" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={[styles.shell, !isWide && styles.shellMobile]}>
            {isWide ? <View style={styles.brandPanel}>
              <View style={styles.brandMark}><Text style={styles.markText}>A</Text></View>
              <Text style={styles.brandName}>AutoWala</Text>
              <Text style={styles.brandTag}>OPERATIONS CONSOLE</Text>
              <View style={styles.brandRule} />
              <Text style={styles.brandHeadline}>Your network,{ '\n' }in clear view.</Text>
              <Text style={styles.brandDescription}>Manage riders, trips and payments from one secure workspace.</Text>
              <Text style={styles.brandFoot}>Secure access for authorised administrators</Text>
            </View> : null}

            <View style={[styles.formPanel, !isWide && styles.formPanelMobile]}>
              {!isWide ? <View style={styles.mobileMark}><Text style={styles.markText}>A</Text></View> : null}
              <Text style={styles.eyebrow}>ADMINISTRATOR SIGN IN</Text>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in with your AutoWala administrator account.</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Email or user ID</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  style={styles.input}
                  placeholder="admin@example.com"
                  placeholderTextColor="#929AA8"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  editable={!isSubmitting}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Password</Text>
                  <Text style={styles.secureLabel}>SECURE LOGIN</Text>
                </View>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor="#929AA8"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                  editable={!isSubmitting}
                  onSubmitEditing={() => void handleLogin()}
                  returnKeyType="go"
                />
              </View>

              {errorMessage ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text> : null}

              <TouchableOpacity
                style={[styles.loginButton, isSubmitting && styles.loginButtonDisabled]}
                onPress={() => void handleLogin()}
                disabled={isSubmitting}
                activeOpacity={0.85}
              >
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loginButtonText}>Sign in to dashboard</Text>}
              </TouchableOpacity>

              <Text style={styles.footnote}>Access is verified against your authenticated Supabase profile.</Text>
              <TouchableOpacity style={styles.returnLink} onPress={() => router.replace('/login')}>
                <Text style={styles.returnText}>Return to AutoWala login</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  safeArea: { flex: 1, backgroundColor: '#F3F5F8' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  shell: { width: '100%', maxWidth: 1080, minHeight: 620, alignSelf: 'center', flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 24, overflow: 'hidden', shadowColor: '#18212F', shadowOpacity: 0.1, shadowRadius: 35, shadowOffset: { width: 0, height: 20 }, elevation: 8 },
  shellMobile: { maxWidth: 500, minHeight: 0, flexDirection: 'column', borderRadius: 18 },
  brandPanel: { flex: 1, minWidth: 320, backgroundColor: '#14261F', padding: 44, justifyContent: 'center' },
  brandMark: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#BDEBCF', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  markText: { color: '#174A31', fontSize: 24, fontWeight: '900' },
  brandName: { color: '#F9FBFA', fontSize: 20, fontWeight: '800', letterSpacing: 0.3 },
  brandTag: { color: '#A9C1B3', fontSize: 10, fontWeight: '800', letterSpacing: 2.2, marginTop: 8 },
  brandRule: { width: 40, height: 3, backgroundColor: '#73D79A', borderRadius: 2, marginTop: 48, marginBottom: 25 },
  brandHeadline: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', lineHeight: 43, letterSpacing: -0.8 },
  brandDescription: { color: '#BDCCC3', fontSize: 15, lineHeight: 24, maxWidth: 330, marginTop: 16 },
  brandFoot: { color: '#8EA99A', fontSize: 11, marginTop: 64 },
  formPanel: { flex: 1, minWidth: 350, maxWidth: 510, paddingHorizontal: 54, paddingVertical: 54, justifyContent: 'center', alignSelf: 'center', width: '100%' },
  formPanelMobile: { flex: 0, minWidth: 0, maxWidth: undefined, paddingHorizontal: 25, paddingVertical: 34, alignSelf: 'stretch' },
  mobileMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#DDF4E4', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  eyebrow: { color: '#218653', fontSize: 10, fontWeight: '900', letterSpacing: 1.6, marginBottom: 12 },
  title: { color: '#18221D', fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: '#747F79', fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 32 },
  fieldGroup: { marginBottom: 20 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#2E3933', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  secureLabel: { color: '#96A39B', fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginBottom: 8 },
  input: { width: '100%', height: 52, borderWidth: 1, borderColor: '#DCE3DE', borderRadius: 11, color: '#18221D', backgroundColor: '#FFFFFF', paddingHorizontal: 15, fontSize: 15 },
  error: { color: '#9E2F2D', backgroundColor: '#FFF0EE', borderWidth: 1, borderColor: '#F5CFCA', borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  loginButton: { height: 52, backgroundColor: '#1F8B53', borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  loginButtonDisabled: { opacity: 0.7 },
  loginButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.15 },
  footnote: { color: '#929C96', textAlign: 'center', fontSize: 11, lineHeight: 17, marginTop: 20 },
  returnLink: { alignSelf: 'center', padding: 10, marginTop: 13 },
  returnText: { color: '#287A4D', fontSize: 12, fontWeight: '700' },
});
