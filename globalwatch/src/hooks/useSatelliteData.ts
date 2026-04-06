import { useState, useEffect, useCallback } from 'react';
import { celestrakService, CelesTrakApiError, SatelliteGroup } from '../services/celestrak';
import type { Satellite } from '../types';

interface UseSatelliteDataResult {
  data: Satellite[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook for fetching satellite TLE data from CelesTrak
 * Refreshes every 2 hours (CelesTrak data updates)
 */
export function useSatelliteData(
  group: SatelliteGroup = 'stations'
): UseSatelliteDataResult {
  const [data, setData] = useState<Satellite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const satellites = await celestrakService.getSatellites({ group });
      setData(satellites);
      setError(null);
    } catch (err) {
      if (err instanceof CelesTrakApiError) {
        setError(new Error(`CelesTrak API Error: ${err.message}`));
      } else {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    } finally {
      setLoading(false);
    }
  }, [group]);

  useEffect(() => {
    fetchData();
    
    // Refresh every 2 hours (CelesTrak rate limit)
    const interval = setInterval(fetchData, 2 * 60 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
