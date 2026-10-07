import { StyleSheet, Text, View } from 'react-native';

export function MapPlaceholder({
  title = 'Live map',
  latitude,
  longitude,
}: {
  title?: string;
  latitude?: number | null;
  longitude?: number | null;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🗺️</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>Live ride tracking is not available yet.</Text>
      {latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined ? (
        <Text style={styles.coordinates}>
          Latest location: {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#E8F5E9', borderRadius: 18, minHeight: 190, alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { fontSize: 42 },
  title: { color: '#2E7D32', fontSize: 19, fontWeight: '800', marginTop: 10 },
  text: { color: '#557158', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  coordinates: { color: '#2E7D32', fontSize: 12, marginTop: 10, textAlign: 'center' },
});
