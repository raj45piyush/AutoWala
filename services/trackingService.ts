import { supabase } from '../lib/supabase';
import type { Ride, RideLocation } from '../types/database';

export function subscribeToRideTracking(
  rideId: string,
  onRideChange: (ride: Ride) => void,
  onLocationChange: (location: RideLocation) => void,
  onConnectionChange?: (connected: boolean) => void
) {
  let stopped = false;
  let retryCount = 0;
  let channelAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const connect = () => {
    if (stopped) return;

    const nextChannel = supabase
      .channel(`ride-tracking-${rideId}-${channelAttempt++}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
        (payload) => onRideChange(payload.new as Ride)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ride_locations', filter: `ride_id=eq.${rideId}` },
        (payload) => {
          const location = payload.new as RideLocation;
          onLocationChange(location);
        }
      );

    nextChannel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ride_locations', filter: `ride_id=eq.${rideId}` },
      (payload) => onLocationChange(payload.new as RideLocation)
    );

    channel = nextChannel;
    void nextChannel.subscribe((status) => {
      if (stopped || channel !== nextChannel) return;
      if (status === 'SUBSCRIBED') {
        if (stableConnectionTimer) clearTimeout(stableConnectionTimer);
        stableConnectionTimer = setTimeout(() => {
          retryCount = 0;
          stableConnectionTimer = null;
        }, 30000);
        onConnectionChange?.(true);
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (stableConnectionTimer) {
          clearTimeout(stableConnectionTimer);
          stableConnectionTimer = null;
        }
        onConnectionChange?.(false);
        channel = null;
        void supabase.removeChannel(nextChannel);
        const delay = Math.min(1000 * 2 ** retryCount, 15000);
        retryCount += 1;
        retryTimer = setTimeout(connect, delay);
      }
    });
  };

  onConnectionChange?.(false);
  connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (stableConnectionTimer) clearTimeout(stableConnectionTimer);
    const activeChannel = channel;
    channel = null;
    if (activeChannel) void supabase.removeChannel(activeChannel);
  };
}
