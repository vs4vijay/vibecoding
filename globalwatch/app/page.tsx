'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { VisualMode } from '../src/utils/visualModes';
import VisualModeSelector from '../src/components/VisualModeSelector';

// Dynamically import Globe component with SSR disabled
const Globe = dynamic(
  () => import('../src/components/Globe'),
  { 
    ssr: false,
    loading: () => (
      <div style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div>
          <p>Loading GlobalWatch...</p>
          <p style={{ fontSize: '12px', opacity: 0.6 }}>Initializing 3D Globe</p>
        </div>
      </div>
    )
  }
);

export default function Home() {
  const [visualMode, setVisualMode] = useState<VisualMode>('standard');

  return (
    <main className="map-container">
      <div className="map-viewport">
        <Globe visualMode={visualMode} />
      </div>
      
      {/* Header */}
      <header className="app-header">
        <h1>GlobalWatch</h1>
        <p>Open-Source Satellite & Aircraft Tracker</p>
      </header>
      
      {/* Visual Mode Selector */}
      <VisualModeSelector 
        currentMode={visualMode}
        onModeChange={setVisualMode}
      />
    </main>
  );
}
