import { Stack } from 'expo-router';

import { AuthProvider } from '../../components/AuthProvider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </AuthProvider>
  );
}
