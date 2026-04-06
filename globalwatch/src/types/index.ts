/**
 * OSINT Data Type Definitions
 * 
 * Type definitions for:
 * - Aircraft state data (OpenSky API)
 * - Satellite TLE data (CelesTrak)
 * - Visual mode configurations
 * - Coordinate system representations
 */

/**
 * OpenSky API Aircraft State
 * Represents an aircraft's state as returned by the OpenSky Network API
 * @see https://opensky-network.org/apidoc/v5.html
 */
export interface AircraftState {
  /** Unique ICAO 24-bit address in hex string format */
  icao24: string;
  /** ISO 8601 timestamp of last position update */
  lastSeen: string;
  /** Callsign (8 characters, null if not available) */
  callsign: string | null;
  /** Country name based on ICAO registration */
  originCountry: string;
  /** Unix timestamp for last position update */
  lastPositionUpdate: number | null;
  /** Longitude in decimal degrees (-180 to 180) */
  longitude: number | null;
  /** Latitude in decimal degrees (-90 to 90) */
  latitude: number | null;
  /** Geometric altitude in meters (WGS84) */
  geoAltitude: number | null;
  /** Pressure altitude in meters (standard pressure) */
  altitude: number | null;
  /** True track in decimal degrees (0-360) */
  trueTrack: number | null;
  /** Vertical velocity in meters per second */
  verticalRate: number | null;
  /** Sensor(s) used for position */
  sensors: number[] | null;
  /** Barometric altitude in meters (geometric if baro altitude unavailable) */
  baroAltitude: number | null;
  /** Boolean indicating if transponder is in emergency mode */
  emergency: boolean | null;
  /** SPI (Special Position Indicator) / alert flag */
  spi: boolean | null;
  /** Position configuration indicator */
  positionSource: PositionSource;
  /** Vertical status (0 = unknown, 1 = ground, 2 = airborne) */
  verticalStatus: number | null;
  /** Differentiated GPS (0 = undifferentiated, 1 = high precision) */
  gpsDiffFromBarometer: number | null;
  /** Contact type (0 = ADS-B, 1 = MODE_S, 2 = FLARM) */
  contactType: number | null;
  /** Registered aircraft category */
  category: AircraftCategory | null;
}

/**
 * Position source types from OpenSky API
 */
export enum PositionSource {
  /** ADS-B */
  ADSB = 0,
  /** Asterix */
  ASTERIX = 1,
  /** MLAT */
  MLAT = 2,
  /** Fixed wing */
  FIXED_WING = 3,
}

/**
 * Aircraft category codes
 */
export enum AircraftCategory {
  /** No information */
  NONE = 0,
  /** Light (< 15500 lbs) */
  LIGHT = 1,
  /** Small (15500 to 75000 lbs) */
  SMALL = 2,
  /** Large (75000 to 300000 lbs) */
  LARGE = 3,
  /** High vortex large */
  HIGH_VORTEX = 4,
  /** Heavy (> 300000 lbs) */
  HEAVY = 5,
  /** High performance (> 5g, > 400 kts) */
  HIGH_PERFORMANCE = 6,
  /** Rotorcraft */
  ROTORCRAFT = 7,
  /** Glider */
  GLIDER = 8,
  /** Lighter-than-air */
  LTA = 9,
  /** Parachute */
  PARACHUTE = 10,
  /** Ultralight */
  ULTRALIGHT = 11,
  /** Reserved */
  RESERVED_12 = 12,
  /** Reserved */
  RESERVED_13 = 13,
  /** Reserved */
  RESERVED_14 = 14,
  /** Reserved */
  RESERVED_15 = 15,
  /** UAV */
  UAV = 16,
  /** Space */
  SPACE = 17,
  /** Emergency vehicle */
  EMERGENCY = 18,
  /** Service vehicle */
  SERVICE = 19,
  /** Point obstacle */
  POINT_OBSTACLE = 20,
  /** Cluster obstacle */
  CLUSTER_OBSTACLE = 21,
  /** Line obstacle */
  LINE_OBSTACLE = 22,
}

/**
 * CelesTrak TLE (Two-Line Element) Satellite Data
 * @see https://celestrak.org/NORAD/elements/
 */
export interface Satellite {
  /** Satellite name (includes designation in parentheses when available) */
  name: string;
  /** NORAD catalog number (5-digit) */
  noradCatId: number;
  /** International designator (YYYYNNNXXX format) */
  internationalDesignator: string;
  /** Orbital epoch in Julian Date format */
  epoch: string;
  /** First time derivative of mean motion (rev/day^2) */
  meanMotionDot: number;
  /** Second time derivative of mean motion (rev/day^3) */
  meanMotionDdot: number;
  /** BSTAR drag term (1/earth radii) */
  bstar: number;
  /** Ephemeris type */
  ephemerisType: number;
  /** Element set number */
  elementSetNum: number;
  /** Inclination in degrees (0 to 180) */
  inclination: number;
  /** Right ascension of ascending node in degrees (0 to 360) */
  rightAscension: number;
  /** Eccentricity (decimal point assumed) */
  eccentricity: number;
  /** Argument of perigee in degrees (0 to 360) */
  argumentOfPerigee: number;
  /** Mean anomaly in degrees (0 to 360) */
  meanAnomaly: number;
  /** Mean motion in revolutions per day */
  meanMotion: number;
  /** Revolutions at epoch */
  revolutionsAtEpoch: number;
  /** Status of satellite */
  status: SatelliteStatus;
  /** Orbital ID */
  orbitalId: number | null;
  /** Data on file (single JSON or two-line element set) */
  dataOnFile: DataOnFile;
}

/**
 * Satellite operational status
 */
export enum SatelliteStatus {
  /** Operating */
  OPERATING = '+',
  /** Non-operating */
  NON_OPERATING = '-',
  /** Tentative */
  TENTATIVE = '?',
}

/**
 * Type of data on file
 */
export enum DataOnFile {
  /** Single element set */
  SINGLE = 0,
  /** Two-line element set */
  TWO_LINE = 1,
}

/**
 * Parsed TLE (Two-Line Element) format
 * Raw line-by-line format as typically distributed
 */
export interface TLE {
  /** Line 0 - Name line */
  nameLine: string;
  /** Line 1 - Element line 1 */
  line1: string;
  /** Line 2 - Element line 2 */
  line2: string;
}

/**
 * Visual mode types for display/rendering
 */
export type VisualMode = 
  | 'standard' 
  | 'nvg' 
  | 'flir' 
  | 'crt' 
  | 'anime';

/**
 * Visual mode configuration
 */
export interface VisualModeConfig {
  /** The visual mode type */
  mode: VisualMode;
  /** Display name for UI */
  displayName: string;
  /** Description of the mode */
  description: string;
  /** Color scheme */
  colorScheme: ColorScheme;
  /** Whether night vision effect is enabled */
  nightVision: boolean;
  /** Whether thermal rendering is enabled */
  thermal: boolean;
}

/**
 * Color scheme definitions for visual modes
 */
export interface ColorScheme {
  /** Primary color (hex) */
  primary: string;
  /** Secondary color (hex) */
  secondary: string;
  /** Background color (hex) */
  background: string;
  /** Text color (hex) */
  text: string;
  /** Grid color (hex) */
  grid: string;
  /** Alert/danger color (hex) */
  alert: string;
}

/**
 * Predefined visual mode configurations
 */
export const VISUAL_MODES: Record<VisualMode, VisualModeConfig> = {
  standard: {
    mode: 'standard',
    displayName: 'Standard',
    description: 'Default color scheme with high contrast',
    colorScheme: {
      primary: '#00ff00',
      secondary: '#008800',
      background: '#000000',
      text: '#ffffff',
      grid: '#333333',
      alert: '#ff0000',
    },
    nightVision: false,
    thermal: false,
  },
  nvg: {
    mode: 'nvg',
    displayName: 'Night Vision Goggles',
    description: 'Green phosphor night vision effect',
    colorScheme: {
      primary: '#00ff00',
      secondary: '#004400',
      background: '#000000',
      text: '#00ff00',
      grid: '#002200',
      alert: '#ffff00',
    },
    nightVision: true,
    thermal: false,
  },
  flir: {
    mode: 'flir',
    displayName: 'FLIR Thermal',
    description: 'Forward Looking Infrared thermal imaging',
    colorScheme: {
      primary: '#ff0000',
      secondary: '#ff8800',
      background: '#000000',
      text: '#ffffff',
      grid: '#440000',
      alert: '#ffffff',
    },
    nightVision: false,
    thermal: true,
  },
  crt: {
    mode: 'crt',
    displayName: 'CRT Monitor',
    description: 'Retro CRT monitor effect with scanlines',
    colorScheme: {
      primary: '#00ff00',
      secondary: '#004400',
      background: '#001100',
      text: '#00ff00',
      grid: '#002200',
      alert: '#ffff00',
    },
    nightVision: false,
    thermal: false,
  },
  anime: {
    mode: 'anime',
    displayName: 'Anime',
    description: 'Stylized anime/cartoon rendering',
    colorScheme: {
      primary: '#00aaff',
      secondary: '#ff66aa',
      background: '#112233',
      text: '#ffffff',
      grid: '#334455',
      alert: '#ff3366',
    },
    nightVision: false,
    thermal: false,
  },
};

/**
 * Coordinate Systems
 */

/**
 * WGS84 Geodetic coordinate
 * Standard GPS coordinate system
 */
export interface GeodeticCoord {
  /** Latitude in decimal degrees (-90 to 90) */
  latitude: number;
  /** Longitude in decimal degrees (-180 to 180) */
  longitude: number;
  /** Altitude in meters above WGS84 ellipsoid */
  altitude: number;
}

/**
 * ECEF (Earth-Centered, Earth-Fixed) coordinate
 */
export interface ECEFCoord {
  /** X coordinate in meters */
  x: number;
  /** Y coordinate in meters */
  y: number;
  /** Z coordinate in meters */
  z: number;
}

/**
 * ENU (East-North-Up) local coordinate
 */
export interface ENUCoord {
  /** East offset in meters */
  east: number;
  /** North offset in meters */
  north: number;
  /** Up offset in meters */
  up: number;
}

/**
 * Azimuth/Elevation coordinate for satellite tracking
 */
export interface AzElCoord {
  /** Azimuth angle in degrees (0-360, clockwise from North) */
  azimuth: number;
  /** Elevation angle in degrees (-90 to 90) */
  elevation: number;
  /** Range in meters */
  range: number;
}

/**
 * Range rate (Doppler) measurement
 */
export interface RangeRate {
  /** Range rate in meters per second */
  rangeRate: number;
  /** Timestamp of measurement */
  timestamp: number;
}

/**
 * Full spherical coordinate for radar/tracking
 */
export interface SphericalCoord {
  /** Azimuth angle in degrees (0-360) */
  azimuth: number;
  /** Elevation angle in degrees (-90 to 90) */
  elevation: number;
  /** Range in meters */
  range: number;
  /** Range rate in meters per second */
  rangeRate: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Cartesian velocity vector
 */
export interface VelocityVector {
  /** Velocity in X direction (ECEF) in m/s */
  vx: number;
  /** Velocity in Y direction (ECEF) in m/s */
  vy: number;
  /** Velocity in Z direction (ECEF) in m/s */
  vz: number;
}

/**
 * Combined position and velocity state
 */
export interface StateVector {
  /** Position in ECEF */
  position: ECEFCoord;
  /** Velocity in ECEF */
  velocity: VelocityVector;
  /** Timestamp */
  timestamp: number;
}

/**
 * Utility type for optional temporal data
 */
export interface TemporalData<T> {
  /** The data */
  data: T;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Optional validity duration in seconds */
  validFor?: number;
}

/**
 * OSINT Source metadata
 */
export interface OSINTSource {
  /** Source identifier */
  sourceId: string;
  /** Source type */
  sourceType: 'opensky' | 'celestrak' | 'radar' | 'manual';
  /** Source name */
  name: string;
  /** Confidence level 0-1 */
  confidence: number;
  /** Last update timestamp */
  lastUpdate: string;
}

/**
 * Combined track for an object (aircraft or satellite)
 */
export interface OSINTTrack<T = AircraftState | Satellite> {
  /** Unique track identifier */
  trackId: string;
  /** The tracked object data */
  object: T;
  /** Position in WGS84 */
  position: GeodeticCoord;
  /** Velocity if available */
  velocity?: VelocityVector;
  /** Data source */
  source: OSINTSource;
  /** History of positions */
  history?: GeodeticCoord[];
}
