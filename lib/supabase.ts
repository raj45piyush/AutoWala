import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import { getNodeRealtimeTransport } from './supabaseRealtimeTransport';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL');
}

if (!supabasePublishableKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}

const serverStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
};

const storage =
  Platform.OS === 'web' && typeof window === 'undefined'
    ? serverStorage
    : AsyncStorage;

// Expo web statically renders routes in Node.js, where Node 20 has no native
// WebSocket. The browser bundle and native app use their platform WebSocket.
const isNodeWebRuntime = Platform.OS === 'web' && typeof window === 'undefined';
type RealtimeOptions = NonNullable<
  NonNullable<Parameters<typeof createClient>[2]>['realtime']
>;

const nodeRealtimeTransport = isNodeWebRuntime ? getNodeRealtimeTransport() : undefined;
const nodeRealtimeOptions: RealtimeOptions | undefined = nodeRealtimeTransport
  ? {
      // ws and Supabase expose compatible runtime constructors with different
      // TypeScript declarations, so keep this cast limited to the transport.
      transport: nodeRealtimeTransport as RealtimeOptions['transport'],
    }
  : undefined;

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    ...(nodeRealtimeOptions ? { realtime: nodeRealtimeOptions } : {}),
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
