'use client';

import { useEffect, useRef } from 'react';
import { Viewer, Cartesian3, Color, Entity } from 'cesium';
import { useSatelliteData } from '../hooks/useSatelliteData';

interface SatelliteLayerProps {
  viewer: Viewer | null;
  group?: 'stations' | 'starlink' | 'gps-ops' | 'military';
}

// Simple orbital position approximation
function getSatellitePosition(sat: {
  inclination: number;
  rightAscension: number;
  eccentricity: number;
  argumentOfPerigee: number;
  meanAnomaly: number;
  meanMotion: number;
}): { lat: number; lon: number; alt: number } {
  const period = 1440 / sat.meanMotion;
  const elapsed = (Date.now() / 60000) % period;
  const meanAnomalyRad = (sat.meanAnomaly + (360 * elapsed / period)) * Math.PI / 180;
  const lat = sat.inclination * Math.sin(meanAnomalyRad);
  const lon = (meanAnomalyRad * 180 / Math.PI) % 360 - 180;
  const alt = Math.max(200000, 35786000 * (1 - sat.eccentricity));
  return { lat, lon, alt };
}

export default function SatelliteLayer({ 
  viewer, 
  group = 'stations' 
}: SatelliteLayerProps) {
  const entitiesRef = useRef<Entity[]>([]);
  const { data: satellites, loading, error } = useSatelliteData(group);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || loading || error || !satellites?.length) return;

    try {
      entitiesRef.current.forEach(entity => {
        try { viewer.entities.remove(entity); } catch {}
      });
      entitiesRef.current = [];

      satellites.slice(0, 50).forEach(sat => {
        try {
          const pos = getSatellitePosition(sat);
          const entity = viewer.entities.add({
            position: Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt),
            point: {
              pixelSize: 4,
              color: Color.YELLOW,
              outlineColor: Color.ORANGE,
              outlineWidth: 1,
            },
            description: `<h3>${sat.name}</h3><ul><li>NORAD ID: ${sat.noradCatId}</li></ul>`,
          });
          entitiesRef.current.push(entity);
        } catch {}
      });
    } catch (e) {
      console.error('SatelliteLayer error:', e);
    }

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        entitiesRef.current.forEach(entity => {
          try { viewer.entities.remove(entity); } catch {}
        });
        entitiesRef.current = [];
      }
    };
  }, [viewer, satellites, loading, error]);

  if (error) console.warn('Satellite data error:', error.message);
  return null;
}
