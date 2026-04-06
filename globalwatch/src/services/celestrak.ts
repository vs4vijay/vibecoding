/**
 * CelesTrak TLE API Service
 * Fetches satellite orbital data from CelesTrak (NORAD elements)
 * API Docs: https://celestrak.org/NORAD/elements/
 * 
 * Free, no API key required
 */

import type { Satellite } from '../types';
import { DataOnFile, SatelliteStatus } from '../types';

const CELESTRAK_BASE_URL = 'https://celestrak.org/NORAD/elements/gp.php';

/**
 * Supported satellite groups from CelesTrak
 */
export type SatelliteGroup = 
  | 'stations'      // ISS, Tiangong, and other space stations
  | 'starlink'      // SpaceX Starlink constellation
  | 'gps-ops'       // GPS satellites
  | 'glo-ops'       // GLONASS satellites
  | 'galileo'       // Galileo satellites
  | 'beidou'        // BeiDou satellites
  | 'sbas'          // SBAS satellites
  | 'military'      // Various military satellites
  | 'tle-new'       // Recently added TLE data
  | 'visual'        // Bright satellites for visual observation
  | 'amateur'       // Amateur radio satellites
  | 'cubesats'      // CubeSats
  | 'education'     // Educational satellites
  | 'weather'       // Weather satellites
  | 'noaa'          // NOAA POES satellites
  | 'goes'          // GOES satellites
  | 'planet'        // Planet Labs Dove satellites
  | 'spire'         // Spire LEMUR satellites
  | 'iridium'       // Iridium constellation
  | 'iridium-next'  // Iridium NEXT constellation
  | 'oneweb'        // OneWeb constellation
  | 'spacex'        // SpaceX satellites (includes Starlink)
  | 'booster'       // Rocket boosters
  | 'debris'        // Space debris
  | 'last-30-days'  // Objects launched in last 30 days
  | 'analyst'       // Analyst satellites
  | 'default';      // Default group

/**
 * CelesTrak API query options
 */
export interface CelesTrakQueryOptions {
  /** Satellite group to fetch */
  group: SatelliteGroup;
  /** Return format (default: json) */
  format?: 'json' | 'tle';
  /** Object name filter (partial match) */
  name?: string;
  /** NORAD catalog ID filter */
  noradCatId?: number;
  /** International designator filter */
  internationalDesignator?: string;
}

/**
 * Raw satellite data from CelesTrak JSON response
 */
interface CelesTrakSatelliteRaw {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  NORAD_CAT_ID: number;
  OBJECT_TYPE: string;
  CLASSIFICATION_TYPE: string;
  INTLDES: string;
  EPOCH: string;
  EPOCH_MJD: number;
  EPOCH_JD: number;
  MEAN_MOTION: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  BSTAR: number;
  EPHEMERIS_TYPE: number;
  ELEMENT_SET_NO: number;
  INCLINATION: number;
  RAAN: number;
  ECCENTRICITY: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  'MEAN_MOTION_REV/EQUAT': number;
  ORBIT_STATUS: string;
  ORBIT_CENTER: string;
  ORBIT_CLASS: string;
}

/**
 * Custom error class for CelesTrak API errors
 */
export class CelesTrakApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 0,
    public readonly responseBody?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'CelesTrakApiError';
  }
}

/**
 * CelesTrak TLE API Service
 * Provides access to NORAD Two-Line Element satellite data
 */
export class CelesTrakService {
  private baseUrl: string;
  private requestTimeout: number;

  constructor(baseUrl: string = CELESTRAK_BASE_URL, requestTimeout: number = 30000) {
    this.baseUrl = baseUrl;
    this.requestTimeout = requestTimeout;
  }

  /**
   * Fetch satellites from a specific group
   */
  async getSatellites(options: CelesTrakQueryOptions): Promise<Satellite[]> {
    const params = new URLSearchParams({
      GROUP: options.group,
      FORMAT: options.format || 'json',
    });

    const url = `${this.baseUrl}?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'GlobalWatch/1.0 (Satellite Tracking)',
        },
        signal: AbortSignal.timeout(this.requestTimeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new CelesTrakApiError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          errorBody
        );
      }

      const data = await response.json();
      return this.parseResponse(data, options);
    } catch (error) {
      if (error instanceof CelesTrakApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new CelesTrakApiError(
          'Request timeout - CelesTrak may be experiencing high load',
          0,
          undefined,
          error instanceof Error ? error : undefined
        );
      }
      throw new CelesTrakApiError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getStations(): Promise<Satellite[]> {
    return this.getSatellites({ group: 'stations' });
  }

  async getStarlink(): Promise<Satellite[]> {
    return this.getSatellites({ group: 'starlink' });
  }

  async getGPS(): Promise<Satellite[]> {
    return this.getSatellites({ group: 'gps-ops' });
  }

  private parseResponse(data: unknown, options: CelesTrakQueryOptions): Satellite[] {
    if (!data || !Array.isArray(data)) {
      return [];
    }

    let satellites: CelesTrakSatelliteRaw[] = data as CelesTrakSatelliteRaw[];

    if (options.name) {
      const nameFilter = options.name.toLowerCase();
      satellites = satellites.filter(sat => 
        sat.OBJECT_NAME.toLowerCase().includes(nameFilter)
      );
    }

    if (options.noradCatId) {
      satellites = satellites.filter(sat => 
        sat.NORAD_CAT_ID === options.noradCatId
      );
    }

    return satellites.map(sat => this.parseSatellite(sat));
  }

  private parseSatellite(raw: CelesTrakSatelliteRaw): Satellite {
    return {
      name: raw.OBJECT_NAME,
      noradCatId: raw.NORAD_CAT_ID,
      internationalDesignator: raw.INTLDES,
      epoch: raw.EPOCH,
      meanMotionDot: raw.MEAN_MOTION_DOT,
      meanMotionDdot: raw.MEAN_MOTION_DDOT,
      bstar: raw.BSTAR,
      ephemerisType: raw.EPHEMERIS_TYPE,
      elementSetNum: raw.ELEMENT_SET_NO,
      inclination: raw.INCLINATION,
      rightAscension: raw.RAAN,
      eccentricity: raw.ECCENTRICITY,
      argumentOfPerigee: raw.ARG_OF_PERICENTER,
      meanAnomaly: raw.MEAN_ANOMALY,
      meanMotion: raw.MEAN_MOTION,
      revolutionsAtEpoch: raw['MEAN_MOTION_REV/EQUAT'],
      status: this.parseStatus(raw.ORBIT_STATUS),
      orbitalId: null,
      dataOnFile: DataOnFile.TWO_LINE,
    };
  }

  private parseStatus(status: string): SatelliteStatus {
    switch (status?.toUpperCase()) {
      case '+':
        return SatelliteStatus.OPERATING;
      case '-':
        return SatelliteStatus.NON_OPERATING;
      case '?':
        return SatelliteStatus.TENTATIVE;
      default:
        return SatelliteStatus.NON_OPERATING;
    }
  }
}

// Default instance for convenience
export const celestrakService = new CelesTrakService();
