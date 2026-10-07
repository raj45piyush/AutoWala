import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { LOCATION_MAP_HEIGHT } from '../../services/mapConfig';
import type { LocationMapDomProps, LocationMapProps } from './LocationMap.types';

type LocationMapDomComponent = typeof import('./LocationMapDom').default;

export default function LocationMap(props: LocationMapProps) {
  const [Map, setMap] = useState<LocationMapDomComponent | null>(null);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void import('./LocationMapDom').then((module) => {
      if (active) setMap(() => module.default);
    }).catch(() => {
      if (active) setMapLoadFailed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!Map) {
    return (
      <View style={{ height: LOCATION_MAP_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#EEF4EF' }}>
        <Text style={{ color: '#536254', fontSize: 14, textAlign: 'center', paddingHorizontal: 20 }}>
          {mapLoadFailed ? 'Map could not be loaded. You can still choose locations above.' : 'Loading map…'}
        </Text>
      </View>
    );
  }

  const mapProps: LocationMapDomProps = {
    ...props,
    dom: {
      scrollEnabled: false,
      userAgent: 'AutoWala/1.0',
    },
  };
  return <Map {...mapProps} />;
}
