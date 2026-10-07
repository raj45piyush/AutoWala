import type { Coordinates } from '../../services/locationService';

export interface LocationMapProps {
  pickup: Coordinates | null;
  destination: Coordinates | null;
  riderLocation?: Coordinates | null;
  passengerLocation?: Coordinates | null;
  routePolyline?: string | null;
}

export interface LocationMapDomProps extends LocationMapProps {
  height?: number;
  dom?: import('expo/dom').DOMProps;
}
