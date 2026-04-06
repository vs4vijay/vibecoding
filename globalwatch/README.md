# GlobalWatch

**Open-Source Spy Satellite Simulator**

A browser-based 3D spy satellite simulator built with open-source intelligence (OSINT) data. Track aircraft and satellites in real-time with multiple visual modes inspired by military reconnaissance systems.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Framework](https://img.shields.io/badge/Next.js-14-black)
![Runtime](https://img.shields.io/badge/Bun-1.3+-white)

## Features

### 🌍 3D Globe Visualization
- Interactive 3D globe powered by CesiumJS
- OpenStreetMap tile provider (no API key required)
- Smooth camera controls and zoom

### ✈️ Real-Time Aircraft Tracking
- Live aircraft positions via OpenSky Network API
- Callsign, altitude, and velocity data
- Automatic refresh every 30 seconds

### 🛰️ Satellite Tracking
- Real-time satellite orbital positions via CelesTrak TLE data
- ISS and other notable satellites
- Orbital path visualization

### 🎮 Visual Modes
- **Standard**: Default natural color view
- **NVG**: Night Vision Green (military night vision simulation)
- **FLIR**: Thermal Imaging (forward-looking infrared)
- **CRT**: Retro Scanlines (vintage CRT monitor effect)
- **Anime**: Cel-Shading (stylized artistic render)

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Runtime | Bun |
| 3D Engine | CesiumJS |
| Testing | Playwright |
| Styling | CSS Modules |

## Data Sources (100% OSINT)

| Data Type | Source | Cost |
|-----------|--------|------|
| Aircraft | [OpenSky Network](https://opensky-network.org/) | Free |
| Satellites | [CelesTrak](https://celestrak.org/) | Free |
| Maps | [OpenStreetMap](https://www.openstreetmap.org/) | Free |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.3 or higher
- Node.js 18+ (for tooling compatibility)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/globalwatch.git
cd globalwatch

# Install dependencies
bun install

# Start development server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
bun run build
bun run start
```

## Project Structure

```
globalwatch/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Main application page
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles
├── src/
│   ├── components/        # React components
│   │   ├── Globe.tsx      # 3D globe with CesiumJS
│   │   ├── AircraftLayer.tsx
│   │   ├── SatelliteLayer.tsx
│   │   └── VisualModeSelector.tsx
│   ├── services/          # API services
│   │   ├── opensky.ts     # Aircraft tracking API
│   │   └── celestrak.ts   # Satellite tracking API
│   ├── hooks/             # Custom React hooks
│   │   ├── useAircraftData.ts
│   │   └── useSatelliteData.ts
│   ├── types/             # TypeScript definitions
│   └── utils/             # Utilities
│       └── visualModes.ts # WebGL shaders for effects
├── tests/                 # Playwright tests
├── playwright.config.ts
└── package.json
```

## API Reference

### OpenSky Network

```typescript
// Fetch aircraft within bounding box
GET https://opensky-network.org/api/states/all
  ?lamin=51.2  // Latitude min
  &lomin=-0.5  // Longitude min
  &lamax=51.8  // Latitude max
  &lomax=0.3   // Longitude max
```

### CelesTrak

```typescript
// Fetch Two-Line Element (TLE) data
GET https://celestrak.org/NORAD/elements/gp.php
  ?GROUP=stations
  &FORMAT=tle
```

## Testing

```bash
# Run all tests
bun run test

# Run tests with UI
bun run test:ui
```

## Visual Mode Shaders

Each visual mode uses WebGL post-processing shaders:

| Mode | Effect | Shader Technique |
|------|--------|-----------------|
| NVG | Green tint + noise | Color matrix + noise function |
| FLIR | Heat signature simulation | Luminance inversion + contrast |
| CRT | Scanlines + curvature | UV distortion + line overlay |
| Anime | Cel-shading | Quantized color bands |

## Configuration

The application focuses on London by default. To change the initial view:

```typescript
// In src/components/Globe.tsx
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(
    -0.1278,  // Longitude
    51.5074,  // Latitude
    200000    // Altitude (meters)
  ),
});
```

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome | ✅ Full |
| Firefox | ✅ Full |
| Safari | ✅ Full |
| Edge | ✅ Full |

Requires WebGL 2.0 support.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Inspired by [WorldView](https://www.spatialintelligence.ai/p/i-built-a-spy-satellite-simulator)
- Aircraft data from [OpenSky Network](https://opensky-network.org/)
- Satellite data from [CelesTrak](https://celestrak.org/)
- 3D visualization by [CesiumJS](https://cesium.com/cesiumjs/)

---

**Built with vibe coding** 🎯
