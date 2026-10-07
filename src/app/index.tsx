import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { testSupabaseConnection } from '../../lib/supabase-test';
import { useAuth } from '../../components/AuthProvider';

export default function WelcomeScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();

  useEffect(() => {
    testSupabaseConnection();
  }, []);

  useEffect(() => {
    if (isLoading || !account) {
      return;
    }

    if (account.profile.role === 'admin') {
      router.replace('/admin');
    } else if (account.profile.role === 'rider') {
      router.replace('/rider-home');
    } else {
      router.replace('/user-home');
    }
  }, [account, isLoading, router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        {/* Logo */}
        <View style={styles.logoCircle}>
          <Text style={styles.logo}>🛺</Text>
        </View>

        {/* App Name */}
        <Text style={styles.title}>AutoWala</Text>

        <Text style={styles.subtitle}>
          Village Auto & Toto Sharing
        </Text>

        {/* Description */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>
            Easy. Local. Affordable.
          </Text>

          <Text style={styles.infoText}>
            Book an Auto or Toto easily from your village
            and travel together with nearby passengers.
          </Text>
        </View>

        {/* Continue Button */}
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/choose-role')}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continue</Text>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>
          Safe rides for your village
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 25,
  },

  logoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },

  logo: {
    fontSize: 65,
  },

  title: {
    fontSize: 38,
    fontWeight: '800',
    color: '#1B1B1B',
    marginBottom: 5,
  },

  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginBottom: 35,
  },

  infoBox: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },

  infoTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#222222',
    marginBottom: 8,
  },

  infoText: {
    fontSize: 15,
    lineHeight: 23,
    color: '#666666',
  },

  button: {
    width: '100%',
    height: 58,
    borderRadius: 16,
    backgroundColor: '#2E7D32',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },

  arrow: {
    color: '#FFFFFF',
    fontSize: 24,
    marginLeft: 12,
  },

  footer: {
    fontSize: 13,
    color: '#888888',
  },
});
