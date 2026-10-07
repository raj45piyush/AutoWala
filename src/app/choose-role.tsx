import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
    ActivityIndicator,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuth } from '../../components/AuthProvider';

export default function ChooseRoleScreen() {
  const router = useRouter();
  const { account, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading || !account) return;
    if (account.profile.role === 'admin') router.replace('/admin');
    else if (account.profile.role === 'rider') router.replace('/rider-home');
    else router.replace('/user-home');
  }, [account, isLoading, router]);

  if (isLoading || account) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.loading} size="large" color="#2E7D32" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        <Text style={styles.title}>Welcome to AutoWala</Text>

        <Text style={styles.subtitle}>
          How do you want to use AutoWala?
        </Text>

        {/* User */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push('/user-register')}
          activeOpacity={0.8}
        >
          <View style={styles.iconBox}>
            <Text style={styles.icon}>👤</Text>
          </View>

          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>I am a Passenger</Text>
            <Text style={styles.cardText}>
              Book an Auto or Toto for your journey
            </Text>
          </View>

          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.loginLink}
          onPress={() => router.push('/login')}
          activeOpacity={0.7}
        >
          <Text style={styles.loginLinkText}>Already a passenger? Log in</Text>
        </TouchableOpacity>

        {/* Rider */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push('/rider-register')}
          activeOpacity={0.8}
        >
          <View style={styles.iconBox}>
            <Text style={styles.icon}>🛺</Text>
          </View>

          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>I am a Rider</Text>
            <Text style={styles.cardText}>
              Drive your Auto/Toto and earn money
            </Text>
          </View>

          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.loginLink}
          onPress={() => router.push('/rider-login')}
          activeOpacity={0.7}
        >
          <Text style={styles.loginLinkText}>Already a rider? Log in</Text>
        </TouchableOpacity>

        <Text style={styles.bottomText}>
          Register or log in to continue as a passenger or rider.
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
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  loading: { flex: 1, alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },

  title: {
    fontSize: 29,
    fontWeight: '800',
    color: '#1B1B1B',
    textAlign: 'center',
    marginBottom: 10,
  },

  subtitle: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 35,
  },

  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },

  iconBox: {
    width: 60,
    height: 60,
    borderRadius: 15,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  icon: {
    fontSize: 32,
  },

  cardContent: {
    flex: 1,
    marginLeft: 15,
  },

  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222222',
    marginBottom: 5,
  },

  cardText: {
    fontSize: 13,
    color: '#777777',
    lineHeight: 19,
  },

  arrow: {
    fontSize: 30,
    color: '#2E7D32',
    marginLeft: 8,
  },

  bottomText: {
    textAlign: 'center',
    fontSize: 13,
    color: '#888888',
    marginTop: 15,
  },

  loginLink: {
    alignSelf: 'center',
    paddingVertical: 5,
    marginTop: -10,
    marginBottom: 12,
  },

  loginLinkText: {
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: '700',
  },
});
