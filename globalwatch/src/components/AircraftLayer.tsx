'use client';

import { useEffect, useRef } from 'react';
import { Viewer, Cartesian3, Color, Entity } from 'cesium';
import { useAircraftData } from '../hooks/useAircraftData';

interface AircraftLayerProps {
  viewer: Viewer | null;
}

export default function AircraftLayer({ viewer }: AircraftLayerProps) {
  const entitiesRef = useRef<Entity[]>([]);
  const { data: aircraft, loading, error } = useAircraftData();

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || loading || error || !aircraft?.length) return;

    try {
      // Remove old entities
      entitiesRef.current.forEach(entity => {
        try {
          viewer.entities.remove(entity);
        } catch (e) {
          // Ignore removal errors
        }
      });
      entitiesRef.current = [];

      // Add aircraft entities (limit to 100 for performance)
      const limitedAircraft = aircraft.slice(0, 100);
      
      limitedAircraft.forEach(ac => {
        if (ac.longitude === null || ac.latitude === null || ac.baroAltitude === null) {
          return;
        }

        try {
          const entity = viewer.entities.add({
            position: Cartesian3.fromDegrees(
              ac.longitude,
              ac.latitude,
              ac.baroAltitude
            ),
            point: {
              pixelSize: 6,
              color: Color.CYAN,
              outlineColor: Color.WHITE,
              outlineWidth: 1,
            },
            description: `
              <h3>${ac.callsign || ac.icao24}</h3>
              <ul>
                <li>ICAO24: ${ac.icao24}</li>
                <li>Origin: ${ac.originCountry}</li>
                <li>Altitude: ${ac.baroAltitude?.toFixed(0) || 'N/A'} m</li>
                <li>Velocity: ${ac.velocity?.toFixed(0) || 'N/A'} m/s</li>
                <li>On Ground: ${ac.onGround ? 'Yes' : 'No'}</li>
              </ul>
            `,
          });

          entitiesRef.current.push(entity);
        } catch (e) {
          console.warn('Failed to add aircraft entity:', e);
        }
      });
    } catch (e) {
      console.error('AircraftLayer error:', e);
    }

    // Cleanup on unmount
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        entitiesRef.current.forEach(entity => {
          try {
            viewer.entities.remove(entity);
          } catch (e) {
            // Ignore removal errors
          }
        });
        entitiesRef.current = [];
      }
    };
  }, [viewer, aircraft, loading, error]);

  // Don't render status in the globe view - just log
  if (error) {
    console.warn('Aircraft data error:', error.message);
  }

  return null;
}
