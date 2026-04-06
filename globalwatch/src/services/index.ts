/**
 * GlobalWatch - API Services
 */

// OpenSky - values (classes, enums, instances)
export {
  OpenSkyService,
  openskyService,
  OpenSkyApiError,
  PositionSource,
  AircraftCategory,
} from './opensky';

// OpenSky - types (interfaces)
export type {
  AircraftState,
  OpenSkyStatesResponse,
  StateRequestOptions,
} from './opensky';

// CelesTrak - values
export {
  CelesTrakService,
  celestrakService,
  CelesTrakApiError,
} from './celestrak';

// CelesTrak - types
export type {
  CelesTrakQueryOptions,
  SatelliteGroup,
} from './celestrak';
