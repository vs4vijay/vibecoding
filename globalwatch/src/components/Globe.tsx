'use client';

import '../utils/cesiumConfig'; // Must be first!
import { useEffect, useRef, useState } from 'react';
import { Viewer, Cartesian3 } from 'cesium';

import AircraftLayer from './AircraftLayer';
import SatelliteLayer from './SatelliteLayer';
import { applyVisualMode, VisualMode } from '../utils/visualModes';
import './Globe.css';
interface GlobeProps {
  visualMode?: VisualMode;
}

export default function Globe({ visualMode = 'standard' }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);

  // Initialize viewer
  useEffect(() => {
    if (!containerRef.current) return;
    if (viewerRef.current) return;

    const initViewer = async () => {
      try {
        const cesiumViewer = new Viewer(containerRef.current!, {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: true,
          sceneModePicker: true,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: true,
          vrButton: false,
          terrain: undefined,
        });

        cesiumViewer.camera.setView({
          destination: Cartesian3.fromDegrees(-0.1276, 51.5074, 500000),
        });

        viewerRef.current = cesiumViewer;
        setViewer(cesiumViewer);
      } catch (error) {
        console.error('Failed to initialize Cesium viewer:', error);
      }
    };

    initViewer();

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
        setViewer(null);
      }
    };
  }, []);

  // Apply visual mode changes
  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) {
      applyVisualMode(viewer, visualMode);
    }
  }, [viewer, visualMode]);

  return (
    <div className="globe-container">
      <div ref={containerRef} className="cesium-viewer" />
      {viewer && (
        <>
          <AircraftLayer viewer={viewer} />
          <SatelliteLayer viewer={viewer} group="stations" />
        </>
      )}
    </div>
  );
}
