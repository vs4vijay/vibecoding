import { useState, useEffect, useCallback } from 'react';
import { openskyService, OpenSkyApiError, AircraftState } from '../services/opensky';

interface UseAircraftDataResult {
  data: AircraftState[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook for fetching real-time aircraft data from OpenSky Network
 * Polls every 10 seconds (OpenSky anonymous rate limit)
 */
export function useAircraftData(
  options?: {
    boundingBox?: {
      lamin: number;
      lomin: number;
      lamax: number;
      lomax: number;
    };
    interval?: number;
  }
): UseAircraftDataResult {
  const [data, setData] = useState<AircraftState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = options?.boundingBox
        ? await openskyService.getStatesInArea(options.boundingBox)
        : await openskyService.getAllStates();
      
      setData(result.states);
      setError(null);
    } catch (err) {
      if (err instanceof OpenSkyApiError) {
        setError(new Error(`OpenSky API Error: ${err.message}`));
      } else {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    } finally {
      setLoading(false);
    }
  }, [options?.boundingBox]);

  useEffect(() => {
    fetchData();
    
    // Poll every 10 seconds (OpenSky anonymous limit)
    const interval = setInterval(fetchData, options?.interval || 10000);
    
    return () => clearInterval(interval);
  }, [fetchData, options?.interval]);

  return { data, loading, error, refetch: fetchData };
}
