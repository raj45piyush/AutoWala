import type { LocationMapProps } from './LocationMap.types';
import LocationMapDom from './LocationMapDom';

export default function LocationMap(props: LocationMapProps) {
  return <LocationMapDom {...props} />;
}