'use client';

import type { VisualMode } from '../utils/visualModes';

interface VisualModeSelectorProps {
  currentMode: VisualMode;
  onModeChange: (mode: VisualMode) => void;
}

const MODE_CONFIG: { mode: VisualMode; label: string; description: string }[] = [
  { mode: 'standard', label: 'Standard', description: 'Default view' },
  { mode: 'nvg', label: 'NVG', description: 'Night Vision Green' },
  { mode: 'flir', label: 'FLIR', description: 'Thermal Imaging' },
  { mode: 'crt', label: 'CRT', description: 'Scanlines' },
  { mode: 'anime', label: 'Anime', description: 'Cel-shading' },
];

export default function VisualModeSelector({ 
  currentMode, 
  onModeChange 
}: VisualModeSelectorProps) {
  return (
    <div className="visual-mode-selector">
      <span className="mode-label">Visual Mode</span>
      <div className="mode-buttons">
        {MODE_CONFIG.map(({ mode, label }) => (
          <button
            key={mode}
            className={`mode-btn ${currentMode === mode ? 'active' : ''}`}
            onClick={() => onModeChange(mode)}
            title={mode.toUpperCase()}
            data-active={currentMode === mode}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
