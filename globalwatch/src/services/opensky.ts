/**
 * OpenSky Network API Service
 * Fetches live aircraft positions from OpenSky Network
 * API Docs: https://opensky-network.org/api/states/all
 * 
 * Rate limit: 10 seconds for anonymous access
 */

const OPENSKY_API_URL = 'https://opensky-network.org/api';

/**
 * ICAO24 address of the aircraft transponder (hex string)
 */
export interface AircraftState {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  timePosition: number | null;
  lastContact: number;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  sensors: number[] | null;
  geoAltitude: number | null;
  squawk: string | null;
  spi: boolean;
  positionSource: PositionSource;
}

/**
 * Position source types
 */
export enum PositionSource {
  ADS_B = 0,
  ASTERIX = 1,
  MLAT = 2,
  FLARM = 3,
}

/**
 * Aircraft category for classification
 */
export enum AircraftCategory {
  NO_INFO = 0,
  NO_ADSB_INFO = 1,
  LIGHT = 2,
  SMALL = 3,
  LARGE = 4,
  HIGH_VORTEX = 5,
  HEAVY = 6,
  HIGH_PERFORMANCE = 7,
  ROTORCRAFT = 8,
  GLIDER = 9,
  LIGHT_AIRPLANE = 10,
  PARACHUTE = 11,
  ULTRALIGHT = 12,
  UNMANNED_AERIAL = 13,
  SPACE = 14,
  EMERGENCY_VEHICLE = 15,
  SERVICE_VEHICLE = 16,
  POINT_OBSTACLE = 17,
}

/**
 * Response from the OpenSky states/all endpoint
 */
export interface OpenSkyStatesResponse {
  time: number;
  states: AircraftState[];
}

/**
 * Optional parameters for filtering state requests
 */
export interface StateRequestOptions {
  /** Unix timestamp (seconds). If 0, returns most recent */
  time?: number;
  /** Specific ICAO24 address to filter */
  icao24?: string;
  /** Bounding box filters */
  bbox?: {
    /** Lower latitude */
    lamin: number;
    /** Lower longitude */
    lomin: number;
    /** Upper latitude */
    lamax: number;
    /** Upper longitude */
    lomax: number;
  };
}

/**
 * OpenSky Network API Service
 * Provides access to live aircraft position data
 * 
 * @example
 * ```typescript
 * const opensky = new OpenSkyService();
 * const states = await opensky.getAllStates();
 * console.log(`Found ${states.states.length} aircraft`);
 * 
 * // Filter by bounding box (Switzerland)
 * const nearby = await opensky.getStatesInArea({
 *   bbox: { lamin: 45.8389, lomin: 5.9962, lamax: 47.8229, lomax: 10.5226 }
 * });
 * ```
 */
export class OpenSkyService {
  private baseUrl: string;
  private requestTimeout: number;

  constructor(baseUrl: string = OPENSKY_API_URL, requestTimeout: number = 15000) {
    this.baseUrl = baseUrl;
    this.requestTimeout = requestTimeout;
  }

  /**
   * Fetch all current aircraft states (anonymous access)
   * Rate limited to once per 10 seconds for anonymous users
   */
  async getAllStates(): Promise<OpenSkyStatesResponse> {
    return this.getStates();
  }

  /**
   * Fetch aircraft states with optional filters
   * 
   * @param options - Optional filters for the request
   */
  async getStates(options?: StateRequestOptions): Promise<OpenSkyStatesResponse> {
    const params = new URLSearchParams();

    if (options?.time !== undefined && options.time > 0) {
      params.set('time', options.time.toString());
    }

    if (options?.icao24) {
      params.set('icao24', options.icao24.toLowerCase());
    }

    if (options?.bbox) {
      const { lamin, lomin, lamax, lomax } = options.bbox;
      params.set('lamin', lamin.toString());
      params.set('lomin', lomin.toString());
      params.set('lamax', lamax.toString());
      params.set('lomax', lomax.toString());
    }

    const url = `${this.baseUrl}/states/all${params.toString() ? '?' + params.toString() : ''}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new OpenSkyApiError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          errorBody
        );
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      if (error instanceof OpenSkyApiError) {
        throw error;
      }
      throw new OpenSkyApiError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Fetch states for a specific aircraft
   * 
   * @param icao24 - ICAO24 hex address (e.g., 'c0ffee')
   */
  async getStateByIcao24(icao24: string): Promise<OpenSkyStatesResponse> {
    return this.getStates({ icao24 });
  }

  /**
   * Fetch states within a geographic bounding box
   * 
   * @param bbox - Bounding box coordinates
   */
  async getStatesInArea(bbox: StateRequestOptions['bbox']): Promise<OpenSkyStatesResponse> {
    if (!bbox) {
      throw new Error('Bounding box is required');
    }
    return this.getStates({ bbox });
  }

  /**
   * Parse raw API response into typed objects
   * The API returns states as a 2D array, we convert to typed objects
   */
  private parseResponse(data: unknown): OpenSkyStatesResponse {
    if (!data || typeof data !== 'object') {
      throw new OpenSkyApiError('Invalid response format', 0, undefined);
    }

    const response = data as Record<string, unknown>;

    if (typeof response.time !== 'number') {
      throw new OpenSkyApiError('Missing or invalid time in response', 0, undefined);
    }

    const rawStates = response.states;
    if (!Array.isArray(rawStates)) {
      return { time: response.time, states: [] };
    }

    const states: AircraftState[] = rawStates
      .filter((state): state is (string | number | boolean | null)[] => Array.isArray(state))
      .map((state) => this.parseStateArray(state))
      .filter((state): state is AircraftState => state !== null);

    return { time: response.time, states };
  }

  /**
   * Parse a single state array into a typed AircraftState object
   * Array indices based on OpenSky API documentation:
   * 0: icao24, 1: callsign, 2: origin_country, 3: time_position, 4: last_contact,
   * 5: longitude, 6: latitude, 7: baro_altitude, 8: on_ground, 9: velocity,
   * 10: true_track, 11: vertical_rate, 12: sensors, 13: geo_altitude,
   * 14: squawk, 15: spi, 16: position_source
   */
  private parseStateArray(state: (string | number | boolean | null)[]): AircraftState | null {
    try {
      return {
        icao24: String(state[0] ?? ''),
        callsign: state[1] ? String(state[1]).trim() || null : null,
        originCountry: state[2] ? String(state[2]) : 'Unknown',
        timePosition: state[3] !== null ? Number(state[3]) : null,
        lastContact: Number(state[4]) || 0,
        longitude: state[5] !== null ? Number(state[5]) : null,
        latitude: state[6] !== null ? Number(state[6]) : null,
        baroAltitude: state[7] !== null ? Number(state[7]) : null,
        onGround: Boolean(state[8]),
        velocity: state[9] !== null ? Number(state[9]) : null,
        trueTrack: state[10] !== null ? Number(state[10]) : null,
        verticalRate: state[11] !== null ? Number(state[11]) : null,
        sensors: Array.isArray(state[12]) ? (state[12] as number[]) : null,
        geoAltitude: state[13] !== null ? Number(state[13]) : null,
        squawk: state[14] ? String(state[14]) : null,
        spi: Boolean(state[15]),
        positionSource: this.parsePositionSource(state[16]),
      };
    } catch {
      return null;
    }
  }

  private parsePositionSource(value: unknown): PositionSource {
    const num = typeof value === 'number' ? value : -1;
    if (num >= 0 && num <= 3) {
      return num as PositionSource;
    }
    return PositionSource.ADS_B;
  }
}

/**
 * Custom error class for OpenSky API errors
 */
export class OpenSkyApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'OpenSkyApiError';
  }
}

// Default instance for convenience
export const openskyService = new OpenSkyService();
