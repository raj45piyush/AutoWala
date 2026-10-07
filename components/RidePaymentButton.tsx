import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';

import { getRidePayment, payForRide } from '../services/paymentService';
import type { Account } from '../services/authService';
import type { Ride } from '../types/database';

type PaymentUiStatus = 'idle' | 'processing' | 'success' | 'failed';

export function RidePaymentButton({ ride, account }: { ride: Ride; account: Account }) {
  const [paymentStatus, setPaymentStatus] = useState<PaymentUiStatus>('idle');
  const [isLoadingPayment, setIsLoadingPayment] = useState(true);
  const fare = ride.final_fare ?? ride.estimated_fare;

  useEffect(() => {
    let active = true;

    void getRidePayment(ride.id)
      .then((payment) => {
        if (!active) {
          return;
        }
        if (payment?.payment_status === 'paid' || payment?.status === 'paid') {
          setPaymentStatus('success');
        } else if (payment?.payment_status === 'failed' || payment?.status === 'failed') {
          setPaymentStatus('failed');
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setIsLoadingPayment(false);
        }
      });

    return () => {
      active = false;
    };
  }, [ride.id]);

  if (ride.status !== 'completed' || !fare || isLoadingPayment) {
    return null;
  }

  const handlePay = async () => {
    setPaymentStatus('processing');
    try {
      await payForRide({
        rideId: ride.id,
        expectedFare: fare,
        customer: {
          name: account.profile.full_name,
          email: account.profile.email ?? account.user.email,
          phone: account.profile.phone,
        },
      });
      setPaymentStatus('success');
    } catch (error) {
      setPaymentStatus('failed');
      Alert.alert('Payment Failed', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  if (paymentStatus === 'success') {
    return <Text style={styles.successText}>Payment Successful</Text>;
  }

  if (paymentStatus === 'processing') {
    return (
      <TouchableOpacity style={styles.processingButton} disabled>
        <ActivityIndicator color="#2E7D32" />
        <Text style={styles.processingText}>Processing...</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.button} onPress={() => void handlePay()} activeOpacity={0.8}>
      <Text style={styles.buttonText}>{paymentStatus === 'failed' ? 'Payment Failed · Try Again' : 'Pay Now'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#2E7D32',
    borderRadius: 10,
    marginTop: 14,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  processingButton: {
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
    marginTop: 14,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  processingText: { color: '#2E7D32', fontSize: 14, fontWeight: '800' },
  successText: { color: '#2E7D32', fontSize: 14, fontWeight: '800', marginTop: 14, textAlign: 'center' },
});
